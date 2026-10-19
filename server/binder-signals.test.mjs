import test from 'node:test';
import assert from 'node:assert/strict';
import {createBinderActivity,createBinderNoteUpdates} from '../src/binderSignals.mjs';
import {voiceSession} from './profile-voice.mjs';

test('only confirmed college conversations expose the visual topic tool across languages and guide changes',()=>{
 for(const language of ['en','es'])for(const mode of ['profile','planning','finance','loans','admissions'])for(const role of ['parent','student'])for(const confirmed of [false,true]){
  const config=voiceSession({mode,language,role,profile:{name:'Synthetic'},studentId:'student-a',routeConversations:role==='parent'&&mode!=='profile',targetConfirmed:confirmed,continuing:true},{});
  const available=mode!=='profile'&&(role==='student'||confirmed);
  assert.equal(config.tools.filter(tool=>tool.name==='highlight_binder_topics').length,available?1:0);
  if(available){assert.match(config.instructions,/does not navigate, edit or save notes/);assert.match(config.instructions,/Do not call on every reply/);}
 }
});

test('topic glow changes contain IDs only, are scope-bound, and an old call cannot clear a new call',()=>{
 const activity=createBinderActivity();let updates=0;const unsubscribe=activity.subscribe(()=>updates++);
 assert.equal(activity.begin('call-a','account-a','student-a',['options']),true);
 assert.equal(activity.update('call-a',['transfer','costs']),true);
 assert.deepEqual(activity.snapshot().topics,['transfer','costs']);
 assert.equal(activity.update('call-a',['transfer','costs']),true);assert.equal(updates,2);
 for(const topics of [['summary'],['costs','costs'],['costs','other'],{},null,'costs'])assert.equal(activity.update('call-a',topics),false);
 activity.begin('call-b','account-a',null,['applications']);
 activity.end('call-a');assert.equal(activity.snapshot().studentId,null);
 assert.equal(activity.update('call-a',['options']),false);
 activity.clear();assert.equal(activity.snapshot(),null);unsubscribe();
});

test('first note load is quiet; later saved IDs remain new until actually read, across pages and partial batches',()=>{
 const updates=createBinderNoteUpdates();
 updates.observe('student-a',[{id:'existing'}]);assert.deepEqual(updates.snapshot().ids,[]);
 updates.observe('student-a',[{id:'existing'},{id:'new-1'}]);assert.deepEqual(updates.snapshot().ids,['new-1']);
 updates.observe('student-a',[{id:'existing'},{id:'new-1'},{id:'new-2'}]);assert.deepEqual(updates.snapshot().ids,['new-1','new-2']);
 updates.read('student-a','new-1');assert.deepEqual(updates.snapshot().ids,['new-2']);
 updates.observe('family',[{id:'family-old'}]);assert.deepEqual(updates.snapshot().ids,[]);
 updates.read('family','new-2');
 updates.observe('student-a',[{id:'existing'},{id:'new-1'},{id:'new-2'}]);assert.deepEqual(updates.snapshot().ids,['new-2']);
 updates.observe('student-a',[{id:'existing'},{id:'new-1'}]);assert.deepEqual(updates.snapshot().ids,[]);
 updates.clear();updates.observe('account-b',[{id:'different'}]);assert.deepEqual(updates.snapshot().ids,[]);
});
