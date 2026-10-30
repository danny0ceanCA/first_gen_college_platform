import test from 'node:test';
import assert from 'node:assert/strict';
import {ONBOARDING_TEST_SUBJECT,isOnboardingTestAccount,shouldReplayTestOnboarding,testAccountAdultScreen,testWorkspaceSeed} from '../src/testAccount.mjs';
import {fixture} from './family-fixture.mjs';
import {createPermissionRepository} from './guardian-permission.mjs';
const owner={sub:'auth0|synthetic-owner',email:'test@test.org',email_verified:true};

test('designated fictional-mailbox identity is recognized without falsifying email verification',()=>{
 const pinned={sub:ONBOARDING_TEST_SUBJECT,email:'test@test.org',email_verified:false};
 assert.equal(isOnboardingTestAccount(pinned),true);
 assert.equal(shouldReplayTestOnboarding(pinned,'new','old'),true);
 assert.equal(isOnboardingTestAccount({...pinned,sub:'auth0|different'}),false);
 assert.equal(isOnboardingTestAccount({...pinned,email:'other@example.org'}),false);
 assert.equal(isOnboardingTestAccount({...pinned,sub:''}),false);
});

test('test conveniences require the exact verified signed-in identity',()=>{
 assert.equal(isOnboardingTestAccount(owner),true);
 for(const user of [undefined,{}, {...owner,sub:''},{...owner,email_verified:false},{...owner,email_verified:undefined},{...owner,email:'another@test.org'},{...owner,email:'test@test.org.example'}]){
  assert.equal(isOnboardingTestAccount(user),false);
  assert.equal(testAccountAdultScreen(user,'unknown'),null);
  assert.equal(shouldReplayTestOnboarding(user,'login-2','login-1'),false);
 }
});
test('onboarding repeats for a new login, not a completed login reload',()=>{
 assert.equal(shouldReplayTestOnboarding(owner,'login-1',null),true);
 assert.equal(shouldReplayTestOnboarding(owner,'login-1','login-1'),false);
 assert.equal(shouldReplayTestOnboarding(owner,'login-2','login-1'),true);
});
test('test adult screening never overrides an existing permission decision',()=>{
 assert.deepEqual(testAccountAdultScreen(owner,'unknown'),{action:'screen',ageBand:'18plus',audience:'adult_supporter'});
 for(const status of ['pending','expired','approved','adult','denied','revoked','blocked'])assert.equal(testAccountAdultScreen(owner,status),null);
});
test('binder shortcut reuses the existing profile without changing its ID or details',()=>{
 const student={id:'existing-student',name:'Fictional student',goals:'Keep this',notes:'Existing notes'};
 const before=structuredClone(student);
 const seed=testWorkspaceSeed({firstName:'Owner',role:'parent'},[student],()=>{throw Error('must not create another profile');});
 assert.equal(seed.student,student);assert.deepEqual(student,before);
 assert.equal(seed.firstName,'Owner');assert.equal(seed.role,'parent');
});
test('a new test account receives one minimal fictional profile for a working binder',()=>{
 const seed=testWorkspaceSeed({},[],()=> 'new-synthetic-profile');
 assert.equal(seed.student.id,'new-synthetic-profile');assert.equal(seed.student.name,'Test student');
 assert.equal(seed.firstName,'Test');assert.equal(seed.role,'student');
});
test('normal adult eligibility persists without recording any guardian approval',async()=>{
 const {pool}=await fixture();
 try{
  const repository=createPermissionRepository(pool);
  const status=await repository.account(owner.sub,{action:'status'});
  const screened=await repository.account(owner.sub,testAccountAdultScreen(owner,status.status));
  assert.equal(screened.allowed,true);assert.equal(screened.status,'adult');
  assert.equal((await repository.account(owner.sub,{action:'status'})).allowed,true);
  const events=(await pool.query('SELECT decision FROM origen_permission_events')).rows;
  assert.deepEqual(events.map(row=>row.decision),['screened']);
  await assert.rejects(repository.account(owner.sub,{action:'screen',ageBand:'18plus',audience:'adult_supporter'}),{status:409});
 }finally{await pool.end();}
});
