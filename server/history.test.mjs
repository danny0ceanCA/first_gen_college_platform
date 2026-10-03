import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {createFamilyHandler,createFamilyRepository,validateFamily} from './family.mjs';

async function fixture(){
 const db=newDb();
 db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.registerFunction({name:'btrim',args:[DataType.text],returns:DataType.text,implementation:value=>value.trim()});
 db.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:value=>value.length});
 db.public.registerFunction({name:'jsonb_typeof',args:[DataType.jsonb],returns:DataType.text,implementation:value=>Array.isArray(value)?'array':typeof value});
 for(const name of ['001_family_storage.sql','002_local_imports.sql','003_history_imports.sql'])db.public.none(await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8'));
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
import {createHistoryRepository,createHistoryHandler,validateMemory} from './history.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';

const student={id:'student-1',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};
const item={id:'session-1',studentId:student.id,date:'2026-10-01T12:00:00Z',mode:'finance',summary:'Family asked about UC costs. Residency is unresolved.',sources:[]};
async function invoke(handler,input,subject='auth0|one',path='/api/conversation-history'){let status,body;await handler(Object.assign(Readable.from([JSON.stringify(input)]),{url:path,method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173'},origenAuthorized:true,origenIdentity:{sub:subject}}),{writeHead(s){status=s;},end(s){body=s&&s.startsWith('{')?JSON.parse(s):s;}},()=>assert.fail());return {status,body};}
test('history belongs to the verified family and student, including matching IDs',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{await run('auth0|one',{action:'save-student',student});await run('auth0|two',{action:'save-student',student:{...student,name:'Mateo'}});
 await history('auth0|one',{action:'save',item});assert.deepEqual((await history('auth0|two',{action:'load',studentId:student.id})).items,[]);
 await assert.rejects(history('auth0|two',{action:'delete',id:item.id}),{status:404});
 await assert.rejects(history('auth0|one',{action:'save',item:{...item,id:'foreign',studentId:'missing'}}),{status:404});
 assert.equal((await history('auth0|one',{action:'context',studentId:student.id})).items[0].summary,item.summary);
 await run('auth0|one',{action:'delete-student',id:student.id});assert.deepEqual((await history('auth0|one',{action:'load'})).items,[]);
 }finally{await pool.end();}
});
test('history import is once per account, preserves saved summaries and cannot resurrect deletion',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{await run('auth0|one',{action:'save-student',student});await history('auth0|one',{action:'save',item});
 await history('auth0|one',{action:'import',items:[{...item,summary:'older local copy'},{...item,id:'orphan',studentId:'deleted'}]});
 assert.equal((await history('auth0|one',{action:'load'})).items[0].summary,item.summary);
 await history('auth0|one',{action:'delete',id:item.id});await history('auth0|one',{action:'import',items:[item]});assert.deepEqual((await history('auth0|one',{action:'load'})).items,[]);
 }finally{await pool.end();}
});
test('voice context is the most recent six summaries of the selected student',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{await run('auth0|one',{action:'save-student',student});await run('auth0|one',{action:'save-student',student:{...student,id:'other'}});
 for(let n=1;n<=8;n++)await history('auth0|one',{action:'save',item:{...item,id:`s-${n}`,date:`2026-10-0${n}T12:00:00Z`,summary:`Discussion ${n}`}});
 await history('auth0|one',{action:'save',item:{...item,id:'other-session',studentId:'other',summary:'Other student private history'}});
 const results=await history('auth0|one',{action:'context',studentId:student.id});assert.deepEqual(results.items.map(x=>x.summary),[3,4,5,6,7,8].map(n=>`Discussion ${n}`));
 let instructions='';const voice=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(url,options)=>{instructions=JSON.parse(options.body.get('session')).instructions;return new Response('v=0\r\nanswer');},()=>{},pool);
 const response=await invoke(voice,{sdp:'v=0',profile:{},language:'en',role:'parent',mode:'finance',studentId:student.id,memory:[{summary:'FORGED HISTORY'}]},'auth0|one','/api/profile-voice');
 assert.equal(response.status,200);assert.match(instructions,/Discussion 8/);assert.doesNotMatch(instructions,/FORGED HISTORY|Other student private history|Discussion 1/);
 assert.equal((await invoke(voice,{sdp:'v=0',profile:{},language:'en',role:'parent',mode:'finance',studentId:'missing'},'auth0|one','/api/profile-voice')).status,404);
 }finally{await pool.end();}
});
test('summary generation stores only a summary, is idempotent and refuses another family student',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);let calls=0;
 const handler=createSummaryHandler({OPENAI_API_KEY:'test'},async()=>{calls++;return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:item.summary}]}]})};},pool);
 try{await run('auth0|one',{action:'save-student',student});const input={...item,language:'en',turns:[{role:'user',text:'Private transcript'}]};
 assert.equal((await invoke(handler,input,'auth0|two','/api/conversation-summary')).status,404);assert.equal(calls,0);
 assert.equal((await invoke(handler,input,'auth0|one','/api/conversation-summary')).status,200);
 assert.equal((await invoke(handler,input,'auth0|one','/api/conversation-summary')).status,200);assert.equal(calls,1);
 const saved=(await history('auth0|one',{action:'load'})).items;assert.equal(saved.length,1);assert.equal(saved[0].summary,item.summary);assert.doesNotMatch(JSON.stringify(saved),/Private transcript/);
 }finally{await pool.end();}
});
test('history rejects unsafe sources, malformed input, unauthenticated access and hides storage errors',async()=>{
 assert.throws(()=>validateMemory({...item,sources:[{title:'x',url:'javascript:alert(1)',checkedAt:item.date}]}),{status:400});
 assert.throws(()=>validateMemory({...item,date:'invalid'}),{status:400});
 assert.equal((await invoke(createHistoryHandler(null),{action:'load'})).status,503);
 assert.equal((await invoke(createHistoryHandler(null),{action:'save',item:{...item,mode:'invalid'}})).status,400);
 let status;await createHistoryHandler(null)({url:'/api/conversation-history'}, {writeHead(s){status=s;},end(){}},()=>assert.fail());assert.equal(status,401);
});

test('onboarding summary waits for a saved student, and failed generation stores nothing',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 const summary=createSummaryHandler({OPENAI_API_KEY:'test'},async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'Student shared an interest in art.'}]}]})),pool);
 try{
  await run('auth0|one',{action:'load'});
  const response=await invoke(summary,{...item,defer:true,language:'en',turns:[{role:'user',text:'I like art.'}]},'auth0|one','/api/conversation-summary');
  assert.equal(response.status,200);assert.deepEqual((await history('auth0|one',{action:'load'})).items,[]);
  await assert.rejects(history('auth0|one',{action:'save',item:response.body.item}),{status:404});
  await run('auth0|one',{action:'save-student',student});
  await history('auth0|one',{action:'save',item:response.body.item});
  assert.equal((await history('auth0|one',{action:'load'})).items.length,1);
  const failed=createSummaryHandler({OPENAI_API_KEY:'test'},async()=>new Response('{}',{status:500}),pool);
  assert.equal((await invoke(failed,{...item,id:'failed',language:'en',turns:[{role:'user',text:'Question'}]},'auth0|one','/api/conversation-summary')).status,502);
  assert.equal((await history('auth0|one',{action:'load'})).items.length,1);
 }finally{await pool.end();}
});
