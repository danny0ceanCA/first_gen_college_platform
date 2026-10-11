import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {createSheetRepository,createSheetHandler,validateSheetRequest} from './workspace-sheets.mjs';
import {createTopicRepository} from './topic-notes.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createHistoryRepository} from './history.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {blankSheet,validateSheet,offerNetCost,offerPeriodsMatch,sheetHTML,sheetText} from '../src/workspaceSheets.mjs';
const student={id:'sofia',name:'Sofia',stage:'Community college',interest:'Art',goals:'Explore transfer while working.',gpa:'',color:'peach'};
async function setup(t){
 const f=await fixture();t.after(()=>f.pool.end());
 for(const file of ['031_topic_notebooks.sql','032_home_actions.sql','033_workspace_sheets.sql'])await f.pool.query((await readFile(new URL('./migrations/'+file,import.meta.url),'utf8')).replace('kind text NOT NULL CHECK','kind text NOT NULL CONSTRAINT origen_topic_notes_kind_check CHECK'));
 await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student});await f.run('owner',{action:'save-student',student:{...student,id:'mateo'}});
 return {...f,repo:createSheetRepository(f.pool),notes:createTopicRepository(f.pool),history:createHistoryRepository(f.pool),plans:(subject,input)=>createPlanRepository(f.pool,{})(subject,validatePlan(input))};
}
const create=(studentId='sofia')=>({action:'create',studentId,id:crypto.randomUUID(),reviewed:true,sheet:{...blankSheet('meeting'),entries:[{kind:'question',text:'Which courses transfer?',done:false}]}});
test('saved sheets enforce owner and exact scope, survive reload, and protect stale writes and deleted retries',async t=>{
 const {repo}=await setup(t),input=create();
 let data=await repo('owner',input);assert.equal(data.sheets.length,1);assert.equal(data.sheets[0].version,1);assert.equal((await repo('owner',input)).sheets.length,1);
 for(const [subject,studentId] of [['other','sofia'],['owner','mateo'],['owner',null]])assert.deepEqual((await repo(subject,{action:'load',studentId})).sheets,[]);
 await assert.rejects(repo('other',{action:'delete',studentId:'sofia',id:input.id,version:1}),{status:404});
 await assert.rejects(repo('owner',{action:'update',studentId:'mateo',id:input.id,version:1,sheet:input.sheet,reviewed:true}),{status:404});
 await assert.rejects(repo('owner',{...input,sheet:{...input.sheet,title:'Different retry'}}),{status:409});
 data=await repo('owner',{...input,action:'update',version:1,sheet:{...input.sheet,goal:'Updated goal'}});assert.equal(data.sheets[0].version,2);
 await assert.rejects(repo('owner',{...input,action:'update',version:1}),{status:409});
 await assert.rejects(repo('owner',{action:'delete',studentId:'sofia',id:input.id,version:1}),{status:409});
 await repo('owner',{action:'delete',studentId:'sofia',id:input.id,version:2});await assert.rejects(repo('owner',input),{status:409,message:'sheet_deleted'});
 await repo('owner',create(null));assert.equal((await repo('owner',{action:'load',studentId:null})).sheets.length,1);
});
test('preparation copies only explicitly selected saved records from the exact account and scope',async t=>{
 const {repo,notes,history,plans,pool}=await setup(t),noteId=crypto.randomUUID();
 const summary={id:'conversation',studentId:'sofia',mode:'planning',date:'2026-10-08T12:00:00Z',summary:'Maybe ask about transfer requirements.',sources:[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-08T12:00:00Z'}]};await history('owner',{action:'save',item:summary});
 const owner=(await pool.query("SELECT id FROM origen_accounts WHERE auth0_subject='owner'")).rows[0].id;
 await pool.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id,source_quote) VALUES($1,$2,'sofia','transfer','question','Maybe ask about transfer requirements.','en','saved','conversation','conversation','Maybe ask about transfer requirements.')",[owner,noteId]);
 const secret=crypto.randomUUID();await notes('owner',{action:'create',studentId:'sofia',id:secret,note:{topic:'costs',kind:'note',language:'en',content:'PRIVATE UNSELECTED NOTE'}});
 const plan=(await plans('owner',{action:'create',requestId:crypto.randomUUID(),plan:{studentId:'sofia',title:'Steps',goal:'',category:'transfer',status:'active',summaryIds:[],steps:[{id:'ask',title:'Meet counselor',action:'Discuss options.',notes:'',status:'complete',dueDate:'2026-12-01',sources:[{title:'Campus',url:'https://example.edu/'}]}]}})).plans[0];
 const input={action:'prepare',studentId:'sofia',notes:[{id:noteId,version:1}],actions:[{planId:plan.id,stepId:'ask',version:1}],includeGoal:false,includeSources:false};
 let data=await repo('owner',input);assert.equal(data.entries.length,2);assert.equal(data.entries[0].kind,'question');assert.equal(data.entries[1].done,true);assert.match(data.entries[1].text,/2026-12-01/);assert.equal(data.goal,'');assert.deepEqual(data.sources,[]);assert.doesNotMatch(JSON.stringify(data),/PRIVATE/);
 data=await repo('owner',{...input,includeGoal:true,includeSources:true});assert.equal(data.goal,student.goals);assert.equal(data.sources.length,2);assert.equal(data.sources[0].checkedAt,new Date(summary.date).toISOString());assert.equal(data.sources[1].checkedAt,null);
 for(const [subject,studentId] of [['other','sofia'],['owner','mateo'],['owner',null]])await assert.rejects(repo(subject,{...input,studentId}),{status:404});
 await assert.rejects(repo('owner',{...input,notes:[{id:noteId,version:2}]}),{status:409});
 await pool.query("UPDATE origen_topic_notes SET status='suggested' WHERE id=$1",[noteId]);await assert.rejects(repo('owner',input),{status:404});
 await pool.query("UPDATE origen_topic_notes SET status='saved' WHERE id=$1",[noteId]);
 const sheet=create();sheet.sheet.entries=data.entries;sheet.sheet.sources=data.sources;await repo('owner',sheet);
 await history('owner',{action:'delete',id:'conversation'});assert.equal((await repo('owner',{action:'load',studentId:'sofia'})).sheets[0].sheet.entries.length,2,'explicitly saved copies survive source removal');await assert.rejects(repo('owner',input),{status:404});
});
test('sheet validation bounds content, requires review, rejects unsafe sources and invalid financial amounts',()=>{
 const input=create();assert.deepEqual(validateSheetRequest({...input,accountId:'forged'}).sheet,input.sheet);assert.equal(validateSheetRequest({...input,accountId:'forged'}).accountId,undefined);
 for(const bad of [{...input,reviewed:false},{action:'load'},{...input,id:'bad'},{...input,sheet:{...input.sheet,sources:[{title:'Unsafe',url:'javascript:alert(1)',checkedAt:null}]}},{...input,sheet:{...input.sheet,entries:Array(41).fill(input.sheet.entries[0])}}])assert.throws(()=>validateSheetRequest(bad),{status:400});
 const offer={name:'College A',period:'2027–28',cost:25000,grants:5000,scholarships:3000,loans:5500,workStudy:2000,url:''};
 assert.equal(offerPeriodsMatch([offer,{...offer,period:'2028–29'}]),false);assert.equal(offerPeriodsMatch([offer,{...offer,period:''}]),false);assert.equal(offerPeriodsMatch([offer,{...offer}]),true);assert.match(sheetText({...blankSheet('aid'),offers:[{...offer,period:''}]}),/Attendance periods are missing/);assert.match(sheetHTML({...blankSheet('aid'),offers:[{...offer,period:''}]}),/Attendance periods are missing/);assert.equal(offerNetCost(offer),17000);assert.equal(offerNetCost({...offer,scholarships:null}),null);assert.equal(offerNetCost({...offer,cost:0,grants:0,scholarships:0}),0);
 for(const value of [null,42])assert.throws(()=>validateSheet({...blankSheet('aid'),offers:[value]}),{status:400});
 for(const amount of [-1,Infinity,NaN,1000001,1.005,'1000'])assert.throws(()=>validateSheet({...blankSheet('aid'),offers:[{...offer,cost:amount}]}),{status:400});
 const result=validateSheet({...blankSheet('aid'),offers:[offer]});assert.match(sheetText(result),/\$17,000.00/);assert.match(sheetText({...result,offers:[{...offer,cost:null}]}),/Not provided/);
 const es=sheetText({...blankSheet('aid','es'),offers:[{...offer,cost:100}]});assert.match(es,/La ayuda supera/);assert.match(es,/USD/);
 assert.throws(()=>validateSheetRequest({action:'prepare',studentId:'sofia',notes:[{id:crypto.randomUUID(),version:0}],actions:[],includeGoal:false,includeSources:false}),{status:400});
});
test('downloaded sheets escape content, exclude app data, preserve uncertainty, and require no remote assets',()=>{
 const sheet={...blankSheet('meeting','es'),title:'<script>alert(1)</script>',entries:[{kind:'question',text:'Quizás preguntar <img src=x onerror=alert(1)>',done:false}]};
 const html=sheetHTML(sheet);assert.doesNotMatch(html,/<script>|<img|onload=/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Quizás preguntar/);assert.match(html,/default-src 'none'/);assert.match(html,/<html lang="es">/);assert.doesNotMatch(html,/auth0|studentId|account_id/);
});
test('account export includes sheets and receipts; account and student deletion remove saved sheet content',async t=>{
 const {repo,pool,run}=await setup(t);await repo('owner',create());await repo('owner',create(null));
 const lifecycle=createLifecycleRepository(pool),data=await lifecycle('owner',{action:'export'});assert.equal(data.workspaceSheets.length,2);assert.equal(data.workspaceSheetReceipts.length,2);
 await run('owner',{action:'delete-student',id:'sofia'});assert.equal((await pool.query('SELECT * FROM origen_workspace_sheets')).rows.length,1);
 await lifecycle('owner',{action:'delete',confirmation:'DELETE'});for(const table of ['origen_workspace_sheets','origen_workspace_sheet_receipts'])assert.equal((await pool.query(`SELECT * FROM ${table}`)).rows.length,0);
});
test('sheet HTTP endpoint requires authentication, rejects oversized bodies, and sanitizes server failures',async()=>{
 const handler=createSheetHandler(null);
 async function call(body,authorized=true){let status,headers,data;const req=Readable.from([body]);Object.assign(req,{url:'/api/workspace-sheets',method:'POST',headers:{'content-type':'application/json'},origenAuthorized:authorized,origenIdentity:{sub:'owner'}});await handler(req,{writeHead(s,h){status=s;headers=h;},end(text){data=JSON.parse(text);}},()=>assert.fail());return {status,headers,data};}
 assert.equal((await call('{}',false)).status,401);assert.equal((await call('x'.repeat(120001))).status,413);assert.equal((await call('{')).status,400);
 const result=await call(JSON.stringify({action:'load',studentId:null}));assert.equal(result.status,503);assert.equal(result.headers['Cache-Control'],'no-store');assert.deepEqual(result.data,{error:'sheets_unavailable'});
});
