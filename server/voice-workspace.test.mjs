import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fixture} from './family-fixture.mjs';
import {loadVoiceWorkspace,validateWorkspaceFocus,workspaceInstructions} from './voice-workspace.mjs';
import {createProfileVoiceHandler,voiceSession} from './profile-voice.mjs';
import {createTopicRepository,validateTopicRequest} from './topic-notes.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {voiceWorkspaceQueue} from '../src/voiceWorkspace.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {createHistoryRepository} from './history.mjs';
const student={id:'s',name:'Sofia',stage:'Community college',interest:'Art',gpa:'',color:'peach'};
const step={id:'step',title:'Ask a counselor',action:'Ask which courses transfer.',notes:'Keep working while studying.',status:'not-started',dueDate:'2026-11-01',sources:[]};
const plan={studentId:'s',title:'My plan',goal:'',category:'transfer',status:'active',summaryIds:[],steps:[step]};
async function setup(t){
 const f=await fixture();t.after(()=>f.pool.end());
 await f.pool.query((await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8')).replace('kind text NOT NULL CHECK','kind text NOT NULL CONSTRAINT origen_topic_notes_kind_check CHECK'));
 await f.pool.query(await readFile(new URL('./migrations/032_home_actions.sql',import.meta.url),'utf8'));
 for(const subject of ['owner','other'])await f.run(subject,{action:'save-student',student});
 await f.run('owner',{action:'save-student',student:{...student,id:'sibling'}});
 const topics=createTopicRepository(f.pool),plans=createPlanRepository(f.pool,{});
 const add=async(subject,studentId,content,kind='note',topic='transfer')=>{const id=crypto.randomUUID();await topics(subject,validateTopicRequest({action:'create',id,studentId,note:{kind,topic,content,language:'en',decisionConfirmed:kind==='decision'}}));return id;};
 const load=(focus,studentId='s',mode='planning',subject='owner')=>loadVoiceWorkspace(f.pool,subject,{studentId,mode,focus});
 return {...f,add,load,topics,plans:async(input)=>plans('owner',validatePlan(input))};
}
test('workspace loads only saved entries for exact account/student/family and relevant topic',async t=>{
 const f=await setup(t),id=await f.add('owner','s','I chose the local college.','decision');
 await f.add('owner','s','What should I ask next?','question');await f.add('owner','s','Cost-only private note.','note','costs');
 await f.add('owner','sibling','SIBLING PRIVATE');await f.add('other','s','OTHER ACCOUNT PRIVATE');await f.add('owner',null,'FAMILY ONLY');
 await createHistoryRepository(f.pool)('owner',{action:'save',item:{id:'source',studentId:'s',mode:'planning',date:'2026-10-01T12:00:00Z',summary:'A possibility to review.',sources:[]}});
 const suggested=await f.add('owner','s','UNACCEPTED SUGGESTION');await f.pool.query("UPDATE origen_topic_notes SET status='suggested',origin='conversation',source_summary_id='source' WHERE id=$1",[suggested]);
 const memory=await f.load();assert.equal(memory.notes.length,2);assert.match(JSON.stringify(memory),/I chose the local college/);assert.doesNotMatch(JSON.stringify(memory),/PRIVATE|FAMILY ONLY|UNACCEPTED/);
 assert.equal((await f.load(undefined,null)).notes[0].content,'FAMILY ONLY');assert.equal((await f.load(undefined,'s','finance')).notes[0].content,'Cost-only private note.');
 const focus={kind:'note',studentId:'s',topic:'transfer',noteId:id,version:1};assert.equal((await f.load(focus)).notes[0].selected,true);
 await assert.rejects(f.load(focus,'s','planning','other'),{status:404});await assert.rejects(f.load({...focus,studentId:'sibling'},'sibling'),{status:404});
 await assert.rejects(f.load({...focus,noteId:suggested}),{status:404});await assert.rejects(f.load({...focus,version:2}),{status:409});await assert.rejects(f.load({...focus,topic:'costs'}),{status:409});
 await f.topics('owner',{action:'update',id,studentId:'s',version:1,note:{topic:'transfer',kind:'note',content:'I am only considering it now.',language:'en'}});
 await assert.rejects(f.load(focus),{status:409});assert.equal((await f.load({...focus,version:2})).notes[0].kind,'note');
 await f.topics('owner',{action:'delete',studentId:'s',id,version:2});await assert.rejects(f.load({...focus,version:2}),{status:404});assert.doesNotMatch(JSON.stringify(await f.load()),/I chose|considering/);
});
test('actions preserve self-reported status and dates, refresh edits, reject archived and deleted tasks',async t=>{
 const f=await setup(t);const saved=(await f.plans({action:'create',plan})).plans[0];
 const focus={kind:'action',studentId:'s',topic:'transfer',planId:saved.id,stepId:'step',version:1};
 let context=await f.load(focus);assert.equal(context.actions[0].personalTargetDate,'2026-11-01');assert.equal(context.actions[0].status,'not-started');
 await assert.rejects(f.load({...focus,studentId:null},null),{status:404});
 await f.plans({action:'update',id:saved.id,version:1,plan:{...plan,steps:[{...step,status:'complete'}]}});
 await assert.rejects(f.load(focus),{status:409});context=await f.load({...focus,version:2});assert.equal(context.actions[0].status,'complete');
 await f.plans({action:'update',id:saved.id,version:2,plan:{...plan,status:'archived'}});await assert.rejects(f.load({...focus,version:3}),{status:404});assert.equal((await f.load()).actions.length,0);
 await f.plans({action:'delete',id:saved.id,version:3});await assert.rejects(f.load({...focus,version:3}),{status:404});
});
test('focused context remains bounded and retains older selected notes without inferring meaning',async t=>{
 const f=await setup(t),note=await f.add('owner','s','Maybe I will transfer. '+'X'.repeat(1900),'question');
 await f.pool.query("UPDATE origen_topic_notes SET updated_at='2020-01-01' WHERE id=$1",[note]);
 for(let i=0;i<9;i++)await f.add('owner','s',`Question ${i} `+'Y'.repeat(1800),'question');
 await f.plans({action:'create',plan:{...plan,steps:Array.from({length:8},(_,i)=>({...step,id:`step${i}`,action:'Z'.repeat(4000),notes:'N'.repeat(4000)}))}});
 const context=await f.load({kind:'note',studentId:'s',topic:'transfer',noteId:note,version:1});assert.ok(JSON.stringify(context).length<=10000);assert.match(context.notes[0].content,/Maybe I will transfer/);assert.equal(context.notes[0].kind,'question');assert.equal(context.notes[0].selected,true);
 const policy=workspaceInstructions(context,{continuing:true});assert.match(policy,/Current spoken corrections override older notes/);assert.match(policy,/completion is user-reported/);assert.match(policy,/not official deadlines/);assert.match(policy,/Do not greet again/);assert.match(policy,/Do not claim a note.*changed in storage/);
});
async function call(handler,body,subject='owner'){
 const req=Object.assign(Readable.from([JSON.stringify(body)]),{url:'/api/profile-voice',method:'POST',headers:{host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173','content-type':'application/json'},origenAuthorized:true,origenIdentity:{sub:subject}});
 let status,output;await handler(req,{writeHead(s){status=s;},end(text){output=JSON.parse(text);}},()=>assert.fail('route'));return {status,output};
}
test('voice handler owns context, protects unresolved scopes, and updates focus without new realtime calls',async t=>{
 const f=await setup(t),id=await f.add('owner','s','Saved question for the real owner.','question');let calls=0,captured;
 const handler=createProfileVoiceHandler({OPENAI_API_KEY:'test'},async(_url,options)=>{calls++;captured=JSON.parse(options.body.get('session'));return new Response('v=0\r\nanswer');},()=>{},f.pool);
 const body={sdp:'v=0\r\n',mode:'planning',language:'es',role:'parent',studentId:'s',routeConversations:true,targetConfirmed:true,profile:{},workspace:{available:true,notes:[{content:'FORGED PRIVATE CONTEXT'}]},plans:[{title:'FORGED PLAN'}]};
 let result=await call(handler,body);assert.equal(result.status,200);assert.match(captured.instructions,/Saved question for the real owner/);assert.doesNotMatch(captured.instructions,/FORGED/);
 result=await call(handler,{...body,targetConfirmed:false});assert.equal(result.status,200);assert.doesNotMatch(captured.instructions,/Saved question for the real owner/);
 const focus={kind:'note',studentId:'s',topic:'transfer',noteId:id,version:1};
 result=await call(handler,{...body,action:'update-guide',workspaceFocus:focus});assert.equal(result.status,200);assert.equal(calls,2);assert.match(result.output.session.instructions,/pressed Talk about this during the same call/);assert.match(result.output.session.instructions,/Current conversation language: Spanish/);assert.equal(result.output.session.audio,undefined);
 result=await call(handler,{...body,action:'update-guide',mode:'admissions',workspaceFocus:focus,workspaceRefreshOnly:true});assert.equal(result.status,200);assert.match(result.output.session.instructions,/Saved question for the real owner/);assert.match(result.output.session.instructions,/latest spoken question takes priority/);assert.doesNotMatch(result.output.session.instructions,/pressed Talk about this during/);
 result=await call(handler,{...body,action:'update-guide',mode:'admissions',workspaceFocus:{...focus,version:9},workspaceRefreshOnly:true});assert.equal(result.status,200);assert.doesNotMatch(result.output.session.instructions,/Saved question for the real owner/);
 result=await call(handler,{...body,workspaceFocus:{...focus,version:9}});assert.equal(result.status,409);assert.equal(calls,2);
 result=await call(handler,{...body,workspaceFocus:focus},'other');assert.equal(result.status,404);assert.equal(calls,2);
 for(const mode of ['finance','loans','admissions','planning']){
  const session=voiceSession({...body,mode,continuing:true,workspace:{available:true,selection:'topic',notes:[],actions:[]}},{});
  assert.match(session.instructions,/Current spoken corrections/);assert.match(session.instructions,/Do not greet again/);
 }
});
test('derived notes bring only their owned source summary and disappear with that source',async t=>{
 const f=await setup(t),history=createHistoryRepository(f.pool),id=await f.add('owner','s','A question to revisit.','question');
 await history('owner',{action:'save',item:{id:'linked',studentId:'s',mode:'planning',date:'2026-09-01T12:00:00Z',summary:'Original discussion about comparing colleges.',sources:[]}});
 await f.pool.query("UPDATE origen_topic_notes SET origin='conversation',source_summary_id='linked' WHERE id=$1",[id]);
 const focus={kind:'note',studentId:'s',topic:'transfer',noteId:id,version:1},context=await f.load(focus);assert.match(context.sourceSummary.summary,/Original discussion/);assert.match(context.sourceSummary.date,/2026-09-01/);
 await history('owner',{action:'delete',id:'linked'});await assert.rejects(f.load(focus),{status:404});assert.equal((await f.load()).notes.length,0);
});
test('selection validation strips client content and rejects incomplete or conflicting references',()=>{
 const focus={kind:'topic',topic:'costs',studentId:null};assert.deepEqual(validateWorkspaceFocus({...focus,notes:'PRIVATE'}),focus);
 for(const value of [null,{}, {...focus,topic:'invalid'},{...focus,kind:'note'},{...focus,kind:'action',version:1,planId:crypto.randomUUID()}])assert.throws(()=>validateWorkspaceFocus(value),{status:400});
});
test('workspace queue waits for actual audio, coalesces rapid clicks, and stops after hangup',async()=>{
 const callbacks=[],applied=[],sent=[],turns=voiceTurns(e=>sent.push(e));
 const queue=voiceWorkspaceQueue({busy:()=>turns.busy(),apply:async s=>applied.push(s.serial),schedule:fn=>(callbacks.push(fn),fn),cancel:fn=>{const i=callbacks.indexOf(fn);if(i>=0)callbacks.splice(i,1);}});
 turns.created();turns.playback({type:'output_audio_buffer.started',response_id:'talking'});turns.beginDone('talking');turns.completed();
 queue.select({serial:'one'});queue.select({serial:'two'});assert.equal(applied.length,0);assert.equal(sent.length,0);
 turns.playback({type:'output_audio_buffer.stopped',response_id:'talking'});await callbacks.shift()();assert.deepEqual(applied,['two']);assert.equal(sent.length,0);
 turns.created();queue.select({serial:'three'});queue.stop();assert.equal(callbacks.length,0);assert.deepEqual(applied,['two']);turns.stop();
});
