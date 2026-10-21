import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';

test('sharing lifecycle: truthful cancellation, deliverable replies, published names and stable pagination',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await coordinatorPilotFixture();t.after(()=>f.close());
 const student=(path,input)=>f.call('other','/api/'+path,{studentId:'alex',...input});
 const staff=(path,input)=>f.call('staff','/api/'+path,{organizationId:f.org,...input});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id;
 const connect=async id=>{
  const c=randomUUID();
  await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,$3,id,'accepted',$4,now()+interval '7 days',now(),$3 FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$5",[c,account,id,randomUUID(),f.org]);
  return c;
 };
 const connection=await connect('alex');
 const preview=()=>student('binder-sharing',{action:'preview',connectionId:connection,topics:['options','costs'],entryIds:f.notes.slice(0,2)});
 const publish=async()=>{const p=await preview();return student('binder-sharing',{action:'publish',previewId:p.previewId,confirmed:true});};
 let pub=await publish();const grant=(await student('binder-sharing',{action:'status'})).grants[0].id;
 const read=()=>staff('coordinator-binders',{action:'read',grantId:grant});
 const make=async(extra={})=>staff('coordinator-feedback',{action:'staff-create',grantId:grant,publicationId:pub.publicationId,topic:'options',kind:'guidance',body:'Synthetic guidance',requestId:randomUUID(),...extra});
 const reply=id=>student('coordinator-feedback',{action:'student-reply',feedbackId:id,version:1,body:'Synthetic reply',requestId:randomUUID()});
 const received=()=>student('coordinator-feedback',{action:'student-list'});

 await t.test('cancel before publishing prevents publication; cancel after commit reports published without hiding access',async()=>{
  let p=await preview();assert.equal((await student('binder-sharing',{action:'cancel',previewId:p.previewId})).status,'cancelled');
  await assert.rejects(student('binder-sharing',{action:'publish',previewId:p.previewId,confirmed:true}),{status:409});
  p=await preview();const command={action:'publish',previewId:p.previewId,confirmed:true};
  const result=await student('binder-sharing',command);
  assert.deepEqual(await student('binder-sharing',{action:'cancel',previewId:p.previewId}),result);
  assert.deepEqual(await student('binder-sharing',command),result);
  assert.equal((await read()).entries.length,2);pub=result;
 });
 await t.test('superseded and withdrawn item guidance stays student-owned but cannot accept undeliverable replies',async()=>{
  const attached=await make({publicationItemId:(await read()).entries.find(x=>x.topic==='options').id});
  const topicGuidance=await make();
  assert.equal((await received()).feedback.find(x=>x.id===attached.id).replyAvailable,true);
  await reply(attached.id);
  pub=await publish();
  assert.equal((await received()).feedback.find(x=>x.id===attached.id).replyAvailable,false);
  await assert.rejects(reply(attached.id),{status:404,message:'feedback_unavailable'});
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_coordinator_replies WHERE feedback_id=$1',[attached.id])).rows[0].n,1);
  await assert.rejects(staff('coordinator-feedback',{action:'staff-thread',grantId:grant,feedbackId:attached.id}),{status:404});
  assert.equal((await received()).feedback.find(x=>x.id===topicGuidance.id).replyAvailable,true);
  await reply(topicGuidance.id);
  assert.equal((await staff('coordinator-feedback',{action:'staff-thread',grantId:grant,feedbackId:topicGuidance.id})).replies.length,1);
  const item=(await read()).entries.find(x=>x.topic==='options');const current=await make({publicationItemId:item.id});
  await student('binder-sharing',{action:'withdraw',grantId:grant,itemId:item.id});
  assert.equal((await received()).feedback.find(x=>x.id===current.id).replyAvailable,false);
  await assert.rejects(reply(current.id),{status:404});
  await student('binder-sharing',{action:'remove-topic',grantId:grant,topic:'options'});
  assert.equal((await received()).feedback.find(x=>x.id===topicGuidance.id).replyAvailable,false);
  await assert.rejects(reply(topicGuidance.id),{status:403});
  pub=await publish();
  const edited=await make({publicationItemId:(await read()).entries.find(x=>x.topic==='options').id});
  await f.note({action:'update',studentId:'alex',id:f.notes[0],version:1,note:{topic:'options',kind:'note',content:'Updated private note',language:'en'}},'other');
  assert.equal((await received()).feedback.find(x=>x.id===edited.id).replyAvailable,false);
  await assert.rejects(reply(edited.id),{status:404});
 });
 await t.test('profile edits stay private until publication; names and search then use the reviewed identity',async()=>{
  await f.family('other',{action:'save-student',student:{id:'alex',name:'Updated name',stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
  assert.equal((await read()).studentName,'alex');
  assert.equal((await staff('coordinator-binders',{action:'list',search:'Updated name'})).counts.all,0);
  const p=await preview();assert.equal(p.studentName,'Updated name');
  pub=await student('binder-sharing',{action:'publish',previewId:p.previewId,confirmed:true});
  assert.equal((await read()).studentName,'Updated name');
  assert.equal((await staff('coordinator-binders',{action:'list',search:'Updated name'})).counts.all,1);
 });
 await t.test('page two survives a cursor being reviewed or revoked; foreign and unknown cursors remain denied',async()=>{
  for(let i=0;i<10;i++){
   const id='page-'+i,n=randomUUID();
   await f.family('other',{action:'save-student',student:{id,name:id,stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
   const c=await connect(id);
   await f.note({action:'create',studentId:id,id:n,note:{topic:'options',kind:'note',content:'Synthetic page note',language:'en'}},'other');
   const p=await student('binder-sharing',{action:'preview',studentId:id,connectionId:c,topics:['options'],entryIds:[n]});await student('binder-sharing',{action:'publish',studentId:id,previewId:p.previewId,confirmed:true});
  }
  const first=await staff('coordinator-binders',{action:'list',view:'new'});
  const command={action:'list',view:'new',cursor:first.nextCursor};
  const before=await staff('coordinator-binders',command);assert.equal(before.binders.length,1);
  const anchor=first.binders.find(x=>x.id===first.nextCursor);
  await staff('coordinator-binders',{action:'review',grantId:anchor.id,publicationId:anchor.publicationId});
  assert.deepEqual((await staff('coordinator-binders',command)).binders,before.binders);
  const id=(await f.owner.query('SELECT student_id FROM origen_binder_share_grants WHERE id=$1',[anchor.id])).rows[0].student_id;
  await student('binder-sharing',{action:'revoke',studentId:id,grantId:anchor.id});
  assert.deepEqual((await staff('coordinator-binders',command)).binders,before.binders);
  await assert.rejects(staff('coordinator-binders',{...command,cursor:randomUUID()}),{status:404});
  await assert.rejects(f.call('colleague','/api/coordinator-binders',{...command,organizationId:f.org}),{status:404});
 });
 await t.test('new private helpers cannot be executed by the runtime role',async()=>{
  assert.equal((await f.owner.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[f.role,`${f.schema}.origen_coordinator_reply_available(uuid)`])).rows[0].allowed,false);
 });
});
