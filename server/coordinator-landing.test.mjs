import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultWorkspace,adminAccessDecision} from '../src/accountAccess.mjs';

const member={memberships:[{id:'org',role:'owner'}],hasPersonalAccount:false,coordinatorAccountsEnabled:true,coordinatorApplicationStatus:'approved'};
test('approved coordinators land in their workspace with or without a personal binder',()=>{
 for(const hasPersonalAccount of [false,true])assert.equal(defaultWorkspace({...member,hasPersonalAccount}),'coordinator');
});
test('approved accounts with removed membership see coordinator access state, not student onboarding',()=>{
 assert.equal(defaultWorkspace({...member,memberships:[]}),'coordinator');
});
test('personal deep links cannot send coordinators into student onboarding',()=>{
 for(const hasPersonalAccount of [false,true]){
  for(const memberships of [[],member.memberships]){
   assert.equal(defaultWorkspace({...member,hasPersonalAccount,memberships},{personalRequested:true}),'coordinator');
  }
 }
 for(const coordinatorApplicationStatus of ['pending','declined','withdrawn']){
  assert.equal(defaultWorkspace({...member,coordinatorApplicationStatus},{personalRequested:true}),'registration');
 }
});
test('personal deep links still open student and non-coordinator personal workspaces',()=>{
 for(const memberships of [[],member.memberships]){
  assert.equal(defaultWorkspace({...member,memberships,coordinatorApplicationStatus:null},{personalRequested:true}),'personal');
 }
});
test('pending, declined and withdrawn applicants still reach their application',()=>{
 for(const coordinatorApplicationStatus of ['pending','declined','withdrawn'])assert.equal(defaultWorkspace({...member,coordinatorApplicationStatus}),'registration');
});
test('organization membership alone does not imply coordinator approval',()=>{
 assert.equal(defaultWorkspace({...member,coordinatorApplicationStatus:null}),'chooser');
 assert.equal(defaultWorkspace({...member,coordinatorAccountsEnabled:false}),'institution');
 assert.equal(defaultWorkspace({...member,coordinatorAccountsEnabled:false,hasPersonalAccount:true}),'chooser');
 assert.equal(defaultWorkspace({...member,coordinatorApplicationStatus:null,memberships:[]}),'personal');
});
test('admin routing retains explicit access decisions and fails closed on outages',async()=>{
 assert.equal(await adminAccessDecision(Response.json({admin:true})),'allowed');
 assert.equal(await adminAccessDecision(Response.json({error:'admin_required'},{status:403})),'denied');
 await assert.rejects(()=>adminAccessDecision(Response.json({error:'unavailable'},{status:503})));
});
