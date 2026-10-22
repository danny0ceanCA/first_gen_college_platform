import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {coordinatorPilotFixture} from './fixtures/coordinator-pilot.mjs';
import {createOrganizationService} from './binder-organization.mjs';
import {createPlanRepository,validatePlan} from './plans.mjs';
import {validateFeedbackInput} from './coordinator-feedback.mjs';
import {coordinatorConfigurationIssues} from './binder-sharing-policy.mjs';

test('follow-through configuration and feedback gate are server-owned',()=>{
 assert.ok(coordinatorConfigurationIssues({ORIGEN_COORDINATOR_FOLLOW_THROUGH:'true'}).length);
 assert.ok(coordinatorConfigurationIssues({ORIGEN_COORDINATOR_FOLLOW_THROUGH:'invalid'}).length);
 assert.equal(validateFeedbackInput({action:'student-list',studentId:'alex',derivedEnabled:true,followThroughEnabled:true}).derivedEnabled,undefined);
});

test('help, attributed suggestions, student action and replies respect current publication',{skip:!process.env.DATABASE_TEST_URL,timeout:60000},async t=>{
 const f=await coordinatorPilotFixture({followThrough:true});t.after(()=>f.close());
 const student=(path,input)=>f.call('other','/api/'+path,{studentId:'alex',...input});
 const staff=(path,input)=>f.call('staff','/api/'+path,{organizationId:f.org,...input});
 const account=(await f.owner.query("SELECT id FROM origen_accounts WHERE auth0_subject='other'")).rows[0].id,connection=randomUUID();
 await f.owner.query("INSERT INTO origen_binder_connections(id,account_id,student_id,coordinator_id,status,request_id,expires_at,accepted_at,display_name) SELECT $1,$2,'alex',id,'accepted',$3,now()+interval '7 days',now(),'alex' FROM origen_coordinator_profiles WHERE auth0_subject='staff' AND institution_id=$4",[connection,account,randomUUID(),f.org]);
 const quote='I need help comparing college costs.',summaryId=randomUUID();await f.save(summaryId,quote,{sub:'other'});
 const settings={ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'};
 await f.as('other',()=>createOrganizationService(f.db,settings,async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({items:[{topic:'costs',category:'question',certainty:'unresolved',language:'en',quote}]})}]}]})))('other',{studentId:'alex',summaryId}));
 const derived=(await student('binder-sharing',{action:'entries'})).entries.find(e=>e.content.includes('not a verbatim quote'));assert.ok(derived);
 const card=await student('binder-sharing',{action:'preview',connectionId:connection,topics:['costs'],entryIds:[derived.id]});
 const publication=await student('binder-sharing',{action:'publish',previewId:card.previewId,confirmed:true});
 const grant=(await student('binder-sharing',{action:'status'})).grants[0].id;
 const notices=()=>staff('coordinator-notifications',{action:'list',audience:'staff'});
 await t.test('help is explicit, deduplicated, content-free and no longer openable after withdrawal',async()=>{
  await f.sweep();assert.equal((await notices()).notifications.filter(n=>n.kind==='help').length,0);
  await Promise.all([student('binder-sharing',{action:'help',grantId:grant,requested:true}),student('binder-sharing',{action:'help',grantId:grant,requested:true})]);
  await f.sweep();const list=await notices(),help=list.notifications.filter(n=>n.kind==='help');assert.equal(help.length,1);
  assert.deepEqual(Object.keys(help[0]).sort(),['createdAt','id','kind','read']);assert.ok(!JSON.stringify(list).includes(quote)&&!JSON.stringify(list).includes('SENTINEL'));
  const target=await staff('coordinator-notifications',{action:'open',audience:'staff',id:help[0].id});assert.equal(target.destination,'binder');assert.equal(target.grantId,grant);
  await student('binder-sharing',{action:'help',grantId:grant,requested:false});assert.ok(!(await notices()).notifications.some(n=>n.kind==='help'));
  await assert.rejects(staff('coordinator-notifications',{action:'open',audience:'staff',id:help[0].id}),{status:404});
 });
 let feedback;
 await t.test('coordinator can attach a suggested step to the authorized derived entry and student can reply',async()=>{
  const view=await staff('coordinator-binders',{action:'read',grantId:grant});assert.equal(view.entries.length,1);
  feedback=await staff('coordinator-feedback',{action:'staff-create',grantId:grant,publicationId:publication.publicationId,publicationItemId:view.entries[0].id,topic:'costs',kind:'suggested-step',body:'Compare the two aid estimates before deciding.',requestId:randomUUID()});
  const received=(await student('coordinator-feedback',{action:'student-list'})).feedback.find(x=>x.id===feedback.id);assert.equal(received.kind,'suggested-step');assert.equal(received.replyAvailable,true);
  await student('coordinator-feedback',{action:'student-reply',feedbackId:feedback.id,version:feedback.version,body:'Could we compare them together?',requestId:randomUUID()});
  await f.sweep();assert.ok((await notices()).notifications.some(n=>n.kind==='reply'));
  const thread=await staff('coordinator-feedback',{action:'staff-thread',grantId:grant,feedbackId:feedback.id});assert.equal(thread.replies.length,1);
 });
 await t.test('student can revise the suggested action without exposing their private plan',async()=>{
  const stepId=randomUUID(),requestId=randomUUID();
  const input=validatePlan({action:'create',requestId,fromFeedback:{id:feedback.id,version:feedback.version,stepId},plan:{studentId:'alex',title:'My next step',goal:'',category:'financial',status:'active',summaryIds:[],steps:[{id:stepId,title:'Compare with Jordan',action:'Compare one estimate together on Tuesday.',notes:'PRIVATE_PLAN_SENTINEL',status:'not-started',dueDate:null,sources:[]}]}});
  const save=()=>f.as('other',()=>createPlanRepository(f.db,{})('other',input));await save();await save();
  assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_plans WHERE account_id=$1',[account])).rows[0].n,1);
  const shared=await staff('coordinator-binders',{action:'read',grantId:grant}),guidance=await staff('coordinator-feedback',{action:'staff-list',grantId:grant});
  assert.ok(!JSON.stringify([shared,guidance,await notices()]).includes('PRIVATE_PLAN_SENTINEL'));
 });
 await t.test('removing the shared item closes attached reply access and suppresses notices',async()=>{
  const item=(await staff('coordinator-binders',{action:'read',grantId:grant})).entries[0];await student('binder-sharing',{action:'withdraw',grantId:grant,itemId:item.id});
  assert.equal((await staff('coordinator-feedback',{action:'staff-list',grantId:grant})).feedback.length,0);
  const own=(await student('coordinator-feedback',{action:'student-list'})).feedback.find(x=>x.id===feedback.id);assert.equal(own.replyAvailable,false);
  await assert.rejects(student('coordinator-feedback',{action:'student-reply',feedbackId:feedback.id,version:feedback.version,body:'Late reply',requestId:randomUUID()}),{status:404});
  assert.ok(!(await notices()).notifications.some(n=>n.kind==='reply'));
 });
});
