import test from 'node:test';
import assert from 'node:assert/strict';
import {liveSelectionBrief} from './liveSelectionBrief.mjs';

const byteLength=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const studentId='11111111-2222-4333-8444-555555555555';
const context=(profile,records=[])=>({scope:{confirmed:true,studentId},openingBrief:{studentId,profile,records}});

for(const [language,profile,record] of [
 ['en',{name:'Aiden',goals:'Interested in transfer; no campus decided.'},
  {content:'Parent suggested Berkeley; Aiden has not chosen.',reportedBy:'parent',certainty:'unconfirmed',date:'2026-11-05'}],
 ['es',{name:'Aiden',goals:'Quiere transferirse; aún no ha elegido campus.'},
  {content:'Su madre sugirió Berkeley; Aiden no ha decidido.',reportedBy:'parent',certainty:'unconfirmed',date:'2026-11-05'}],
])test(`${language}: one complete snapshot preserves uncertainty and whole record attribution`,()=>{
 const input=context(profile,[record]);
 const snapshot=liveSelectionBrief(input,'conditional_recap');
 assert.equal(snapshot.kind,'confirmed-student-brief');
 assert.equal(snapshot.studentId,studentId);
 assert.equal(snapshot.mode,'conditional_recap');
 assert.equal(snapshot.partial,true);
 assert.deepEqual(snapshot.profile,profile);
 assert.deepEqual(snapshot.record,record);
 assert.ok(byteLength(snapshot)<=480);
 assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot,'the payload is one complete JSON value');
});

test('oversized fields and records are omitted whole without losing their ending qualifications',()=>{
 const tooLong='Possible plan '.repeat(70)+'but never confirmed.';
 const oversizedRecord={content:tooLong,reportedBy:'parent',certainty:'unconfirmed'};
 const record={content:'Interest only; no decision.',reportedBy:'parent',certainty:'unconfirmed'};
 const input=context({name:'Aiden',goals:tooLong,school:'Woodland',stage:'Community college'},[oversizedRecord,record]);
 const before=structuredClone(input);
 const snapshot=liveSelectionBrief(input,'caller_first');
 assert.equal(snapshot.profile.goals,undefined);
 assert.equal(snapshot.profile.school,'Woodland');
 assert.deepEqual(snapshot.record,record);
 assert.ok(!JSON.stringify(snapshot).includes('Possible plan'));
 assert.ok(byteLength(snapshot)<=480);
 assert.deepEqual(input,before,'projection never mutates the full backend context');
});

test('UTF-8 size, not JavaScript character count, bounds a complete multilingual snapshot',()=>{
 const profile={name:'José',goals:'大学進学'.repeat(55)+'まだ確定していない',school:'Colegio del Valle',interest:'Política; todavía explorando.'};
 const snapshot=liveSelectionBrief(context(profile),'leave_floor');
 assert.equal(snapshot.profile.goals,undefined);
 assert.equal(snapshot.profile.name,'José');
 assert.equal(snapshot.profile.school,profile.school);
 assert.equal(snapshot.profile.interest,profile.interest);
 assert.equal(snapshot.mode,'leave_floor');
 assert.ok(byteLength(snapshot)<=480);
});

test('unconfirmed or mismatched scopes never expose student facts',()=>{
 for(const input of [
  {scope:{confirmed:false,studentId},openingBrief:{studentId,profile:{name:'PRIVATE'},records:[{content:'PRIVATE'}]}},
  {scope:{confirmed:true,studentId},openingBrief:{studentId:'another-student',profile:{name:'PRIVATE'},records:[{content:'PRIVATE'}]}},
  {scope:{confirmed:true,studentId}},
  undefined,
 ]){
  const snapshot=liveSelectionBrief(input,'conditional_recap');
  assert.deepEqual(snapshot.profile,{});
  assert.equal(snapshot.record,undefined);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.ok(byteLength(snapshot)<=480);
 }
});

test('general family scope has no student recap even when stale student fields exist',()=>{
 const snapshot=liveSelectionBrief({scope:{confirmed:true,studentId:null},openingBrief:{studentId:null,profile:{name:'PRIVATE'},records:[{content:'PRIVATE'}]}},'conditional_recap');
 assert.equal(snapshot.studentId,null);
 assert.deepEqual(snapshot.profile,{});
 assert.equal(snapshot.record,undefined);
 assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('projection prioritizes the main goal and leaves the detailed dossier in the backend',()=>{
 const profile={name:'Aiden',goals:'Transfer to a UC campus; Berkeley is a possibility.',school:'Woodland Community College',interest:'Political science'};
 const input=context({...profile,institutions:'A long undecided campus list. '.repeat(30)});
 input.teachingReferences=[{content:'PRIVATE_TEACHING_DETAILS'}];
 const snapshot=liveSelectionBrief(input,'conditional_recap');
 assert.deepEqual(snapshot.profile,profile);
 assert.equal(snapshot.teachingReferences,undefined);
 assert.equal(snapshot.records,undefined);
 assert.equal(snapshot.profile.institutions,undefined);
 assert.ok(byteLength(snapshot)<=480);
 assert.ok(input.openingBrief.profile.institutions.length>480);
});

test('an oversized scope identifier never creates an oversized append or a truncated identity',()=>{
 const longId='界'.repeat(128);
 const snapshot=liveSelectionBrief({scope:{confirmed:true,studentId:longId},openingBrief:{studentId:longId,profile:{name:'Aiden'}}},'conditional_recap');
 assert.equal(snapshot,null);
});

test('an unexpected delivery mode defaults to leaving the floor with the caller',()=>{
 const snapshot=liveSelectionBrief(context({name:'Aiden'}),'urgent announcement '.repeat(50));
 assert.equal(snapshot.mode,'leave_floor');
 assert.equal(snapshot.profile.name,'Aiden');
 assert.ok(byteLength(snapshot)<=480);
});

test('selection identity remains whole inside the bounded snapshot',()=>{
 const callId='call_1234567890abcdef1234567890abcdef';
 const snapshot=liveSelectionBrief(context({name:'Aiden',goals:'Transfer; campus undecided.',school:'Synthetic Community College'}),'conditional_recap',callId);
 assert.equal(snapshot.callId,callId);assert.equal(snapshot.profile.name,'Aiden');assert.ok(byteLength(snapshot)<=480);
 assert.equal(liveSelectionBrief(context({name:'Aiden'}),'conditional_recap','x'.repeat(500)),null);
});
