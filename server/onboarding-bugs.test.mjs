import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingRecovery,validOnboardingDraft} from '../src/onboardingRecovery.mjs';
import {voiceDraft} from '../src/voiceDraft.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {fixture} from './family-fixture.mjs';

function storage(){const records=new Map();return {getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};}
const student={id:'registration-student',name:'Alex',stage:'Community college',interest:'Biology',gpa:'',color:'lilac'};
const draft={name:'Alex',role:'student',step:'voice',draft:student};

test('corrupt and incomplete persisted onboarding cannot crash or trap registration',()=>{
 const local=storage(),recovery=onboardingRecovery(local,'account-draft',()=>100);
 for(const invalid of [null,[],{}, {...draft,name:42},{...draft,step:'choice',role:''},{...draft,draft:{...student,name:null}},{...draft,draft:{...student,goals:[]}}, {...draft,draft:{...student,stage:'unsupported'}}]){
  recovery.write(invalid);
  assert.equal(recovery.read(null,validOnboardingDraft),null);
  assert.equal(local.getItem('account-draft'),undefined);
 }
 recovery.write(draft);assert.deepEqual(recovery.read(null,validOnboardingDraft),draft);
 local.setItem('account-draft',JSON.stringify({version:1,at:200,value:draft}));
 assert.equal(recovery.read(null,validOnboardingDraft),null,'future timestamps must not preserve drafts indefinitely');
});

test('manual corrections survive voice/manual remounts without stale suggestion replay',()=>{
 const recovery=onboardingRecovery(storage(),'voice-suggestions');
 recovery.write({name:'Wrong name',goals:'Old goal'});
 let canonical={...student};
 const live=voiceDraft(recovery,true);
 assert.deepEqual(live.read(),{});
 live.write({});
 live.accept({}, {goals:'Transfer'},next=>{canonical={...canonical,...next};});
 canonical={...canonical,goals:'Finish an associate degree'};
 const manual=voiceDraft(recovery,true);manual.write({});
 assert.deepEqual(manual.read(),{});
 assert.equal(canonical.goals,'Finish an associate degree');
 assert.deepEqual(recovery.read({}),{});
 const regular=voiceDraft(recovery,false);
 const pending=regular.accept({}, {goals:'Review me'},()=>assert.fail('ordinary profile edits still require review'));
 regular.write(pending);assert.deepEqual(voiceDraft(recovery,false).read(),pending);
});

test('ending a call waits across response-request and asynchronous tool gaps',()=>{
 const turns=voiceTurns(()=>{});
 turns.speechStarted('last-detail');
 assert.equal(turns.busy(),true);
 turns.transcript('last-detail','Actually, I want to study nursing.');
 assert.equal(turns.busy(),true,'response.create is pending even before response.created arrives');
 turns.created();turns.beginDone('profile-update',true);
 assert.equal(turns.busy(),true,'tool processing still owns the turn');
 turns.toolsCompleted();assert.equal(turns.busy(),true);
 turns.created();turns.beginDone('acknowledgment');turns.completed();
 assert.equal(turns.busy(),false);
 turns.stop();assert.equal(turns.busy(),false);
});

test('actual registration persists the final voice correction and isolates another signed-in account',async()=>{
 const {pool,run}=await fixture();
 try{
  let canonical={...student};
  const live=voiceDraft(null,true),turns=voiceTurns(()=>{});
  turns.transcript('final','My goal is nursing.');
  assert.equal(turns.busy(),true);
  turns.created();turns.beginDone('final-update',true);
  live.accept({}, {goals:'Nursing'},next=>{canonical={...canonical,...next};});
  turns.toolsCompleted();turns.created();turns.beginDone('final-answer');turns.completed();
  assert.equal(turns.busy(),false);
  const input={action:'complete-onboarding',account:{firstName:'Alex',email:'',role:'student'},student:canonical};
  const result=await run('auth0|registered-student',input);
  assert.equal(result.account.role,'student');assert.equal(result.students[0].goals,'Nursing');
  assert.equal((await run('auth0|registered-student',input)).students.length,1,'retry does not duplicate the profile');
  assert.equal((await run('auth0|different-user',{action:'load'})).students.length,0);
 }finally{await pool.end();}
});
