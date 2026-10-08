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
 for(const name of ['001_family_storage.sql','002_local_imports.sql','003_history_imports.sql','004_account_links.sql','005_family_conversations.sql','006_planning_conversations.sql','007_planning_records.sql','008_institutions.sql','009_institution_metrics.sql','010_account_lifecycle.sql','011_subject_locks.sql','013_voice_experience.sql','014_account_role.sql']){let sql=await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8'); /* pg-mem omits PostgreSQL's generated CHECK name; give it the real name for migration testing. */ if(name==='001_family_storage.sql')sql=sql.replace("mode text NOT NULL CHECK","mode text NOT NULL CONSTRAINT origen_conversation_summaries_mode_check CHECK");db.public.none(sql);}
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
import {createHistoryRepository,createHistoryHandler,validateMemory} from './history.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createProfileVoiceHandler} from './profile-voice.mjs';

const student={id:'student-1',name:'Sofia',stage:'10th grade',interest:'Art',gpa:'',color:'peach'};
const item={id:'session-1',studentId:student.id,date:'2026-10-01T12:00:00Z',mode:'finance',summary:'Family asked about UC costs. Residency is unresolved.',sources:[]};
test('family histories remain account-private and survive student deletion',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{
  await run('auth0|one',{action:'save-student',student});await run('auth0|two',{action:'load'});
  await history('auth0|one',{action:'save',item});
  await history('auth0|one',{action:'save',item:{...item,id:'family-session',studentId:null,summary:'General family advice'}});
  assert.deepEqual((await history('auth0|one',{action:'context',studentId:null})).items.map(x=>x.summary),['General family advice']);
  assert.deepEqual((await history('auth0|two',{action:'context',studentId:null})).items,[]);
  await assert.rejects(history('auth0|one',{action:'save',item:{...item,id:'family-session'}}),{status:409});
  let session;
  const voice=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(url,options)=>{session=JSON.parse(options.body.get('session'));return new Response('v=0\r\nanswer');},()=>{},pool);
  const base={sdp:'v=0',language:'en',role:'parent',mode:'finance',routeConversations:true,students:[{id:'foreign',name:'FORGED NAME'}],profile:{name:'FORGED PROFILE'},memory:[{summary:'FORGED MEMORY'}]};
  assert.equal((await invoke(voice,base,'auth0|one','/api/profile-voice')).status,200);
  assert.deepEqual(session.tools.map(t=>t.name),['request_conversation_target','set_conversation_language']);
  assert.match(session.instructions,/Sofia/);assert.doesNotMatch(session.instructions,/FORGED|General family advice/);
  assert.equal((await invoke(voice,{...base,targetConfirmed:true,studentId:null},'auth0|one','/api/profile-voice')).status,200);
  assert.match(session.instructions,/General family advice/);assert.doesNotMatch(session.instructions,/Residency is unresolved|FORGED/);
  const summary=createSummaryHandler({OPENAI_API_KEY:'test'},async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'General application guidance.'}]}]})),pool);
  assert.equal((await invoke(summary,{...item,id:'generated-family',studentId:null,defer:true,language:'en',turns:[{role:'user',text:'What are the options?'}]},'auth0|one','/api/conversation-summary')).status,200);
  await run('auth0|one',{action:'delete-student',id:student.id});
  assert.equal((await history('auth0|one',{action:'load'})).items.length,2);
 }finally{await pool.end();}
});
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

test('planning summaries persist by student and feed the planning voice automatically',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{
  await run('auth0|one',{action:'save-student',student});
  await history('auth0|one',{action:'save',item:{...item,id:'plan',mode:'planning',summary:'Agreed to ask a counselor about next year’s science courses. Course approval is unresolved.'}});
  let instructions;
  const voice=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(url,options)=>{instructions=JSON.parse(options.body.get('session')).instructions;return new Response('v=0\r\nanswer');},()=>{},pool);
  assert.equal((await invoke(voice,{sdp:'v=0',mode:'planning',role:'parent',language:'en',routeConversations:true,targetConfirmed:true,studentId:student.id},'auth0|one','/api/profile-voice')).status,200);
  assert.match(instructions,/Course approval is unresolved/);
  assert.deepEqual((await history('auth0|two',{action:'load'})).items,[]);
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

test('topic-aware stored context excludes other accounts and family scope and requires an explicit target',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{
  await run('auth0|one',{action:'save-student',student});await run('auth0|two',{action:'save-student',student});
  for(let n=1;n<=12;n++)await history('auth0|one',{action:'save',item:{...item,id:`topic-${n}`,mode:n<=4?'planning':'finance',date:`2026-09-${String(n).padStart(2,'0')}T12:00:00Z`,summary:`Topic ${n}`}});
  await history('auth0|one',{action:'save',item:{...item,id:'family-private',studentId:null,mode:'planning',summary:'Family private'}});
  await history('auth0|two',{action:'save',item:{...item,id:'foreign-private',mode:'planning',summary:'Foreign private'}});
  const context=await history('auth0|one',{action:'context',studentId:student.id,mode:'planning'});
  assert.equal(context.items.length,6);assert.equal(context.items.filter(x=>x.mode==='planning').length,3);
  assert.ok(context.items.some(x=>x.summary==='Topic 12'));assert.ok(context.items.every(x=>!x.summary.includes('private')));
  const family=await history('auth0|one',{action:'context',studentId:null,mode:'planning'});
  assert.deepEqual(family.items.map(x=>x.summary),['Family private']);
  await assert.rejects(history('auth0|one',{action:'context',mode:'planning'}),{status:400});
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
  const incomplete=createSummaryHandler({OPENAI_API_KEY:'test'},async()=>new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{content:[{type:'output_text',text:'Partial advice without the important caveat'}]}]})),pool);
  const truncated=await invoke(incomplete,{...item,id:'truncated',language:'en',turns:[{role:'user',text:'Question'}]},'auth0|one','/api/conversation-summary');
  assert.equal(truncated.status,502);assert.equal(truncated.body.error,'incomplete_summary');
  assert.equal((await history('auth0|one',{action:'load'})).items.length,1);
 }finally{await pool.end();}
});

test('summary retry lookup is account scoped and finds records outside the recent history window',async()=>{
 const {pool,run}=await fixture();const history=createHistoryRepository(pool);
 try{await run('auth0|one',{action:'save-student',student});await run('auth0|two',{action:'load'});
 for(let i=0;i<102;i++)await history('auth0|one',{action:'save',item:{...item,id:`lookup-${i}`,date:new Date(Date.UTC(2025,0,1+i)).toISOString()}});
 assert.equal((await history('auth0|one',{action:'load'})).items.some(x=>x.id==='lookup-0'),false);
 assert.equal((await history('auth0|one',{action:'find',id:'lookup-0'})).items[0].id,'lookup-0');
 assert.deepEqual((await history('auth0|two',{action:'find',id:'lookup-0'})).items,[]);
 }finally{await pool.end();}
});

test('voice reads the welcome receipt from Postgres across devices and preserves explicit replay',async()=>{
 const {pool,run}=await fixture();let session;
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(_url,options)=>{session=JSON.parse(options.body.get('session'));return new Response('v=0\r\nanswer');},()=>{},pool);
 const input={sdp:'v=0\r\n',language:'en',role:'parent',mode:'profile',onboarding:true,profile:{}};
 try{
  let result=await invoke(handler,input,'auth0|one','/api/profile-voice');
  assert.equal(result.status,200);assert.equal(result.body.playWelcome,true);
  await run('auth0|one',{action:'welcome-heard'});
  result=await invoke(handler,input,'auth0|one','/api/profile-voice');
  assert.equal(result.body.playWelcome,false);assert.match(session.instructions,/RETURNING USER/);assert.doesNotMatch(session.instructions,/FIRST-REGISTRATION SETUP/);
  result=await invoke(handler,{...input,replayWelcome:true},'auth0|one','/api/profile-voice');
  assert.equal(result.body.playWelcome,true);assert.match(session.instructions,/FIRST-REGISTRATION SETUP/);
  result=await invoke(handler,input,'auth0|two','/api/profile-voice');assert.equal(result.body.playWelcome,true);
 }finally{await pool.end();}
});
