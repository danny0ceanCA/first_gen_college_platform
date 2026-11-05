import test from 'node:test';
import assert from 'node:assert/strict';
test('background work can finish past the former seven-second cutoff without exposing the wrong scope',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,resolve;
 const p=createVoicePreparation({now:()=>now}),scope={studentId:'a',role:'parent',routeConversations:true,targetConfirmed:true};
 const pending=p.warm('owner',scope,()=>new Promise(r=>resolve=r));await Promise.resolve();
 now=18000;t.mock.timers.tick(18000);resolve({preparedContextId:'slow-ready'});await pending;
 assert.equal(p.consumeReady('owner',{...scope,targetConfirmed:false}),undefined);assert.equal(p.consumeReady('owner',scope),'slow-ready');p.clear();
});
test('failed background preparations retry after cooldown instead of being stuck until full TTL',async()=>{
 let now=0,loads=0;const p=createVoicePreparation({now:()=>now});const scope={studentId:'a'};
 const load=async()=>{loads++;return loads===1?undefined:{preparedContextId:'ready'};};
 await p.warm('owner',scope,load);now=4000;await p.warm('owner',scope,load);assert.equal(loads,1);
 now=5001;await p.warm('owner',scope,load);assert.equal(loads,2);assert.equal(p.consumeReady('owner',scope),'ready');p.clear();
});
test('confirmed target can take only a ready matching preparation once, without starting another load',async()=>{
 let now=0,loads=0;const p=createVoicePreparation({now:()=>now,ttlMs:100});const input={studentId:'a',mode:'planning',role:'parent',routeConversations:true,targetConfirmed:true,language:'en'};
 const load=async()=>{loads++;return {preparedContextId:'opaque'};};
 assert.equal(p.consumeReady('owner',input),undefined);assert.equal(loads,0);
 await p.warm('owner',input,load);
 for(const [owner,scope]of [['other',input],['owner',{...input,studentId:'b'}],['owner',{...input,language:'es'}],['owner',{...input,targetConfirmed:false}]])assert.equal(p.consumeReady(owner,scope),undefined);
 assert.equal(p.consumeReady('owner',{...input,workspaceRefreshOnly:false}),'opaque');assert.equal(p.consumeReady('owner',input),undefined);assert.equal(loads,1);
 await p.warm('owner',input,load);now=101;assert.equal(p.consumeReady('owner',input),undefined);p.clear();
});
import {createVoicePreparation} from './voicePreparation.mjs';
import {voicePreparationSignature as signature} from './voicePreparationScope.mjs';
const scope={mode:'planning',language:'en',role:'student',studentId:'alex'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));

test('preparation warms before a call, joins pending work, and is consumed exactly once',async()=>{
 const cache=createVoicePreparation(),pending=deferred();let calls=0;
 const load=()=>{calls++;return pending.promise;};
 const warm=cache.warm('one',scope,load);
 const call=cache.consume('one',{...scope,voiceProtocol:'live-v1',enableLiveMemory:true},load);
 await tick();assert.equal(calls,1);
 pending.resolve({preparedContextId:'first',expiresInMs:60000});
 assert.equal(await warm,'first');assert.equal(await call,'first');
 assert.equal(await cache.consume('one',scope,async()=>({preparedContextId:'second'})),'second');
 cache.clear();
});

test('selected child context is separate from an unconfirmed parent opening',async()=>{
 const cache=createVoicePreparation();
 const selected={...scope,role:'parent',routeConversations:true,targetConfirmed:true};
 const neutral={...selected,studentId:undefined,targetConfirmed:false};
 await cache.warm('parent',selected,async()=>({preparedContextId:'selected'}));
 await cache.warm('parent',neutral,async()=>({preparedContextId:'neutral'}));
 const unexpected=()=>{throw Error('duplicate preparation');};
 assert.equal(await cache.consume('parent',neutral,unexpected),'neutral');
 assert.equal(await cache.consume('parent',selected,unexpected),'selected');cache.clear();
});

test('account changes and invalidation discard late preparation responses',async()=>{
 for(const reason of ['logout','account','edit']){
  const cache=createVoicePreparation(),pending=deferred();let signal;
  const first=cache.warm('one',scope,s=>{signal=s;return pending.promise;});await tick();
  if(reason==='account')await cache.warm('two',scope,async()=>({preparedContextId:'two'}));else cache.clear();
  assert.equal(signal.aborted,true);pending.resolve({preparedContextId:'private-old'});assert.equal(await first,undefined);
  assert.equal(await cache.consume('one',scope,async()=>({preparedContextId:'new'})),'new');cache.clear();
 }
});

test('scope and query selectors change the key; transport and untrusted context do not',()=>{
 for(const change of [{studentId:'sam'},{language:'es'},{mode:'applications'},{role:'parent'},{routeConversations:true,targetConfirmed:false},{workspaceFocus:{kind:'note',noteId:'n',version:2}},{continuity:[{role:'user',text:'What changed?'}]},{workspaceRefreshOnly:true},{onboarding:true}])assert.notEqual(signature(scope),signature({...scope,...change}));
 assert.equal(signature(scope),signature({...scope,action:'prepare',voiceProtocol:'live-v1',continuing:true,saveOnboarding:false,profile:{name:'untrusted'},memory:[{summary:'untrusted'}]}));
 assert.equal(signature({...scope,workspaceFocus:{kind:'note',noteId:'n',version:1,serial:1}}),signature({...scope,workspaceFocus:{serial:2,version:1,noteId:'n',kind:'note'}}));
});

test('expiry, failed preparation and cancelled consumers fall back without stale handles',async()=>{
 let time=0;const cache=createVoicePreparation({now:()=>time,timeoutMs:1000});
 await cache.warm('one',scope,async()=>({preparedContextId:'expired',expiresInMs:10}));time=11;
 assert.equal(await cache.consume('one',scope,async()=>({preparedContextId:'fresh'})),'fresh');
 assert.equal(await cache.consume('one',scope,async()=>{throw Error('offline');}),undefined);
 const pending=deferred(),abort=new AbortController();let signal;
 const consuming=cache.consume('one',scope,s=>{signal=s;return pending.promise;},abort.signal);await tick();abort.abort();
 await assert.rejects(consuming);assert.equal(signal.aborted,true);pending.resolve({preparedContextId:'late'});await tick();
 assert.equal(await cache.consume('one',scope,async()=>({preparedContextId:'recovered'})),'recovered');cache.clear();
});

test('prefetch failure is cooled down and cache has a bounded number of scopes',async()=>{
 const cache=createVoicePreparation();let calls=0;
 const failure=async()=>{calls++;throw Error('offline');};
 await cache.warm('one',scope,failure);await cache.warm('one',scope,failure);assert.equal(calls,1);
 for(const studentId of ['sam','jules','pat'])await cache.warm('one',{...scope,studentId},async()=>({preparedContextId:studentId}));
 await cache.warm('one',scope,failure);assert.equal(calls,2);cache.clear();
});
