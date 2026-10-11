import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './family-fixture.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {createTopicRepository,validateTopicRequest,validateSuggestions} from './topic-notes.mjs';
import {createHistoryRepository} from './history.mjs';
import {createLifecycleRepository} from './account-lifecycle.mjs';
import {legacyPlanBatches,legacyCreationId} from '../src/planImport.mjs';
const student={id:'s',name:'Sofia',stage:'Community college',interest:'Art',gpa:'',color:'peach'};
const step={id:'one',title:'Ask a counselor',action:'Ask which courses transfer.',notes:'',status:'not-started',dueDate:'2026-11-01',sources:[]};
const plan={studentId:'s',title:'Next steps',goal:'',category:'transfer',status:'active',summaryIds:[],steps:[step]};
async function setup(t){
 const f=await fixture();t.after(()=>f.pool.end());
 await f.pool.query((await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8')).replace('kind text NOT NULL CHECK', 'kind text NOT NULL CONSTRAINT origen_topic_notes_kind_check CHECK'));
 await f.pool.query(await readFile(new URL('./migrations/032_home_actions.sql',import.meta.url),'utf8'));
 await f.run('owner',{action:'save-student',student});await f.run('other',{action:'save-student',student});await f.run('owner',{action:'save-student',student:{...student,id:'sibling'}});
 const repo=createPlanRepository(f.pool,{}),notes=createTopicRepository(f.pool);
 return {...f,plans:(subject,input)=>repo(subject,validatePlan(input)),notes:(subject,input)=>notes(subject,validateTopicRequest(input)),history:createHistoryRepository(f.pool)};
}
test('accepted plan creation is retry-safe and cannot resurrect after deletion',async t=>{
 const {plans}=await setup(t),requestId=crypto.randomUUID(),input={action:'create',requestId,plan};
 let result=await plans('owner',input);const saved=result.plans[0];assert.equal(result.supportsActions,true);assert.deepEqual(result.creationIds,[requestId]);
 assert.equal((await plans('owner',input)).plans.length,1);
 await assert.rejects(plans('owner',{...input,plan:{...plan,title:'Changed retry'}}),{status:409,message:'create_request_changed'});
 await plans('owner',{action:'update',id:saved.id,version:1,plan:{...plan,steps:[{...step,status:'complete'}]}});
 assert.equal((await plans('owner',input)).plans[0].steps[0].status,'complete','retry must not overwrite subsequent edits');
 await plans('owner',{action:'delete',id:saved.id,version:2});await assert.rejects(plans('owner',input),{status:409,message:'plan_deleted'});
 result=await plans('owner',{action:'load',studentId:'s'});assert.deepEqual(result.plans,[]);assert.deepEqual(result.creationIds,[requestId]);
 assert.deepEqual((await plans('other',{action:'load',studentId:'s'})).creationIds,[]);
});
test('a note becomes an independent accepted action with validated owner, scope, version and source references',async t=>{
 const {notes,plans,history,pool}=await setup(t),noteId=crypto.randomUUID();
 await notes('owner',{action:'create',studentId:'s',id:noteId,note:{topic:'transfer',kind:'question',content:'Which courses transfer?',language:'en'}});
 const fromNote={id:noteId,version:1,stepId:'one'};
 for(const [subject,p] of [['other',plan],['owner',{...plan,studentId:'sibling'}],['owner',{...plan,studentId:null}]])await assert.rejects(plans(subject,{action:'create',requestId:crypto.randomUUID(),plan:p,fromNote}),{status:404});
 await assert.rejects(plans('owner',{action:'create',plan,fromNote:{...fromNote,version:2}}),{status:409,message:'note_changed'});
 await assert.rejects(plans('owner',{action:'create',plan:{...plan,steps:[{...step,status:'complete'}]},fromNote}),{status:400});
 const saved=(await plans('owner',{action:'create',requestId:crypto.randomUUID(),plan,fromNote})).plans[0];
 assert.equal(saved.steps[0].status,'not-started');assert.equal((await notes('owner',{action:'load',studentId:'s'})).notes[0].kind,'question');
 assert.equal((await pool.query('SELECT * FROM origen_plan_note_links')).rows[0].note_id,noteId);
 await plans('owner',{action:'update',id:saved.id,version:1,plan:{...saved,steps:[{...step,dueDate:'2026-12-09',status:'in-progress'}]}});
 assert.equal((await pool.query('SELECT * FROM origen_plan_note_links')).rows.length,1);
 await notes('owner',{action:'delete',studentId:'s',id:noteId,version:1});assert.equal((await pool.query('SELECT * FROM origen_plan_note_links')).rows.length,0);
 assert.equal((await plans('owner',{action:'load',studentId:'s'})).plans[0].steps[0].dueDate,'2026-12-09');
 await history('owner',{action:'save',item:{id:'source',studentId:'s',mode:'planning',summary:'Consider asking a counselor.',date:'2026-10-01T12:00:00Z',sources:[{title:'ASSIST',url:'https://assist.org/',checkedAt:'2026-10-01T12:00:00Z'}]}});
 const owner=(await pool.query("SELECT id FROM origen_accounts WHERE auth0_subject='owner'")).rows[0].id,derivedId=crypto.randomUUID();
 await pool.query("INSERT INTO origen_topic_notes(account_id,id,student_id,topic,kind,content,language,status,origin,source_summary_id,source_quote) VALUES($1,$2,'s','transfer','question','What should I ask?','en','suggested','conversation','source','Consider asking a counselor.')",[owner,derivedId]);
 const copied=(await plans('owner',{action:'create',requestId:crypto.randomUUID(),plan,fromNote:{...fromNote,id:derivedId}})).plans.find(p=>p.summaryIds.includes('source'));
 assert.ok(copied);assert.deepEqual(copied.steps[0].sources,[{title:'ASSIST',url:'https://assist.org/'}]);
 assert.equal((await notes('owner',{action:'load',studentId:'s'})).notes[0].status,'suggested','accepting an action must not implicitly accept a notebook suggestion');
 await history('owner',{action:'delete',id:'source'});const after=(await plans('owner',{action:'load',studentId:'s'})).plans.find(p=>p.id===copied.id);
 assert.equal(after.steps[0].title,step.title);assert.deepEqual(after.summaryIds,[]);assert.equal((await pool.query('SELECT * FROM origen_plan_note_links')).rows.length,0);
});
test('decisions require explicit confirmation; extraction cannot infer a decision',async t=>{
 const {notes}=await setup(t),input={action:'create',studentId:'s',id:crypto.randomUUID(),note:{topic:'applications',kind:'decision',content:'I decided to apply.',language:'en'}};
 assert.throws(()=>validateTopicRequest(input),{status:400});
 const result=await notes('owner',{...input,note:{...input.note,decisionConfirmed:true}});assert.equal(result.notes[0].kind,'decision');assert.equal(result.notes[0].status,'saved');
 assert.throws(()=>validateSuggestions([{kind:'decision',topic:'applications',content:'Decided to apply.',quote:'Consider applying.'}],'Consider applying.'),{status:502});
 await assert.rejects(async()=>notes('owner',{action:'update',studentId:'s',id:input.id,version:1,note:input.note}),{status:400});
});
test('creation and conversion metadata are exported and cascade with account closure',async t=>{
 const {pool,notes,plans}=await setup(t),id=crypto.randomUUID();await notes('owner',{action:'create',studentId:'s',id,note:{topic:'transfer',kind:'note',content:'Consider transfer.',language:'en'}});
 await plans('owner',{action:'create',requestId:crypto.randomUUID(),plan,fromNote:{id,version:1,stepId:'one'}});
 const lifecycle=createLifecycleRepository(pool),data=await lifecycle('owner',{action:'export'});assert.equal(data.planCreationReceipts.length,1);assert.equal(data.planNoteLinks.length,1);
 await lifecycle('owner',{action:'delete',confirmation:'DELETE'});for(const table of ['origen_plans','origen_plan_creations','origen_plan_note_links','origen_topic_notes'])assert.equal((await pool.query(`SELECT * FROM ${table}`)).rows.length,0);
});
test('browser-only steps are scoped, batched, use stable retry IDs, and preserve uncertainty',async()=>{
 const rows=Array.from({length:31},(_,i)=>({id:'duplicate',title:`Consider option ${i}`,action:'Maybe ask a counselor.',why:'Explore, not decided.',notes:'Original notes',date:'2026-02-30',deadline:'Check with campus',source:'javascript:alert(1)',status:'complete'}));
 assert.deepEqual(legacyPlanBatches({s:rows},'other'),[]);assert.deepEqual(legacyPlanBatches({s:{}},'s'),[]);
 const batches=legacyPlanBatches({s:rows},'s');assert.deepEqual(batches.map(b=>b.length),[30,1]);assert.equal(new Set(batches.flat().map(s=>s.id)).size,31);assert.equal(batches[0][0].dueDate,null);assert.deepEqual(batches[0][0].sources,[]);assert.match(batches[0][0].notes,/Explore, not decided/);assert.match(batches[0][0].notes,/Check with campus/);
 const first=await legacyCreationId('owner','s',batches[0]);assert.equal(first,await legacyCreationId('owner','s',batches[0]));assert.notEqual(first,await legacyCreationId('other','s',batches[0]));assert.notEqual(first,await legacyCreationId('owner','sibling',batches[0]));assert.notEqual(first,await legacyCreationId('owner','s',batches[1]));
});
