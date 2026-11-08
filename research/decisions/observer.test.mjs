import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserver } from './observer.mjs';
import { SUPPORT_NEEDS } from './rubric.mjs';
import { createObserverState } from './state.mjs';

const response = () => ({ model:'gpt-6-luna', answers:[
  { type:'choice',name:'support_need',choice:'starting_point',confidence:0.99,probabilities:SUPPORT_NEEDS.map(value=>({value,probability:value==='starting_point'?1:0})) },
  { type:'predicate',name:'already_addressed',probability:0 },
],usage:{input_tokens:100,output_tokens:0,total_tokens:100} });
function setup() {
  let revision = 0;
  const state = {
    snapshot: () => ({fictional:true,authorized:true,closed:false,accountId:'fictional-account',callId:'fictional-call',studentId:'fictional-student',fingerprint:String(revision),inputRevision:revision,currentQuestion:{text:'Where should I start?'},recentTranscripts:[],researchFindings:[],opportunities:[]}),
    matches: s => s.fingerprint === String(revision),
    advance: () => {revision++;return state.snapshot();},
  };
  let reserved = 0, settled = 0, unknown = 0;
  const budget = {reserve:()=>({id:++reserved}),settle:()=>{settled++;},markUnknown:()=>{unknown++;}};
  return {state,budget,counts:()=>({reserved,settled,unknown})};
}
test('default off never spends or invokes client', async () => {
  const h = setup(); let calls=0;
  const observer = createObserver({...h,client:{evaluate:()=>{calls++;}}});
  assert.equal(observer.observe().reason,'disabled'); await observer.idle();
  assert.equal(calls,0); assert.equal(h.counts().reserved,0);
});
test('one inflight/newest pending: stale result accounted, old pending coalesced, duplicate skipped', async () => {
  const h=setup(), resolvers=[];
  const observer=createObserver({...h,mode:'observe',threshold:0.9,client:{evaluate:()=>new Promise(resolve=>resolvers.push(resolve))}});
  assert.equal(observer.observe().queued,true);
  assert.equal(observer.observe().reason,'duplicate');
  observer.observe(h.state.advance());
  observer.observe(h.state.advance());
  assert.equal(resolvers.length,1);
  resolvers.shift()({response:response(),requestId:'req1',durationMs:10});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resolvers.length,1);
  resolvers.shift()({response:response(),requestId:'req2',durationMs:10});
  await observer.idle();
  assert.deepEqual(h.counts(),{reserved:2,settled:2,unknown:0});
  assert.deepEqual(observer.records().map(r=>r.reason),['coalesced','stale_after_request',null]);
  assert.equal(observer.records().at(-1).disposition,'shadow_candidate');
  assert.ok(observer.records().every(r=>!r.intervention&&!r.contextSent&&!r.playbackClaim));
});
test('close drops queued evaluations and late classifications without refunding usage',async()=>{
  const h=setup();let resolve;
  const observer=createObserver({...h,mode:'observe',client:{evaluate:()=>new Promise(r=>{resolve=r;})}});
  observer.observe();observer.observe(h.state.advance());observer.close();
  resolve({response:response(),requestId:'late',durationMs:1});await observer.idle();
  assert.equal(observer.observe().reason,'closed_or_unauthorized');
  assert.equal(observer.records().at(-1).status,'discarded');assert.equal(h.counts().settled,1);
});
test('timeout is unavailable and keeps reservation; failures are not false classifications',async()=>{
  const h=setup();
  const observer=createObserver({...h,mode:'observe',client:{evaluate:async()=>{throw Object.assign(new Error('timeout'),{code:'timeout'});}}});
  observer.observe();await observer.idle();
  assert.deepEqual(h.counts(),{reserved:1,settled:0,unknown:1});
  assert.equal(observer.records()[0].result,null);assert.equal(observer.records()[0].status,'unavailable');
});
test('per-call cap prevents additional evaluations',async()=>{
  const h=setup();
  const observer=createObserver({...h,mode:'observe',maxEvaluations:1,client:{evaluate:async()=>({response:response(),durationMs:1})}});
  observer.observe();await observer.idle();assert.equal(observer.observe(h.state.advance()).reason,'evaluation_limit');
});

test('failed budget accounting disables observation without unhandled rejection', async () => {
  const h = setup();
  h.budget.markUnknown = () => { throw Error('ledger_unavailable'); };
  const observer = createObserver({ ...h, mode: 'observe', client: { evaluate: async () => { throw Error('provider_failed'); } } });
  observer.observe(); await observer.idle();
  assert.equal(observer.records()[0].status, 'unavailable');
  assert.equal(observer.observe(h.state.advance()).reason, 'closed_or_unauthorized');
});

test('playback-only evidence cannot trigger a duplicate paid classification', async () => {
  const h = setup();
  const state = createObserverState({ fictional: true, accountId: 'a', callId: 'c', studentId: 's' });
  state.apply({ type: 'transcript', id: 'q', role: 'user', text: 'Where do I start?', startMs: 0, endMs: 1, complete: true });
  const observer = createObserver({ state, budget: h.budget, mode: 'observe', client: { evaluate: async () => ({ response: response(), durationMs: 1 }) } });
  observer.observe(); await observer.idle();
  state.apply({ type: 'playback', id: 'p', state: 'ended', atMs: 20 });
  assert.equal(observer.observe().reason, 'duplicate');
  assert.equal(h.counts().reserved, 1);
});

test('versioned observation policy logs independent findings without an action channel', async () => {
  const h = setup(); let requested = false;
  const disposition = { mode: 'observe_only', predicates: { changed_question: { status: 'observed' } }, actionAuthorized: false };
  const policy = { version: 'broad-test-1',
    buildRequest(snapshot) { requested = snapshot.authorized; return { model: 'gpt-6-luna' }; },
    parseResponse() { return { status: 'completed', result: { predicates: { changed_question: { probability: 0.8 } } } }; },
    disposition() { return disposition; },
  };
  const observer = createObserver({ ...h, mode: 'observe', policy,
    client: { evaluate: async () => ({ response: response(), durationMs: 1 }) } });
  observer.observe(); await observer.idle();
  assert.equal(requested, true);
  assert.equal(observer.records()[0].rubricVersion, policy.version);
  assert.deepEqual(observer.records()[0].disposition, disposition);
  assert.equal(observer.records()[0].contextSent, false);
  assert.throws(() => createObserver({ ...h, policy: {} }), /invalid_observation_policy/);
});

test('32 evaluations retain four slots for meaningful research rather than assistant or caller churn', async () => {
  const h = setup(); let calls = 0;
  const observer = createObserver({ ...h, mode: 'observe', maxEvaluations: 32, researchReserve: 4,
    client: { evaluate: async () => { calls++; return { response: response(), durationMs: 1 }; } } });
  for (let index = 0; index < 28; index++) { assert.equal(observer.observe(h.state.advance()).queued, true); await observer.idle(); }
  assert.equal(observer.observe(h.state.advance()).reason, 'research_capacity_reserved');
  for (let index = 0; index < 4; index++) {
    assert.equal(observer.observe(h.state.advance(), { researchChanged: true }).queued, true); await observer.idle();
  }
  assert.equal(observer.observe(h.state.advance(), { researchChanged: true }).reason, 'evaluation_limit');
  assert.equal(calls, 32); assert.equal(h.counts().reserved, 32);
  assert.equal(observer.records().at(-1).ordinaryEvaluationCount, 28);
  assert.throws(() => createObserver({ ...h, researchReserve: 12 }), /invalid_research_reserve/);
});

test('coalescing retains pending research capacity only for identical task evidence in the same scope', async () => {
  const h = setup(), resolvers = [];
  const observer = createObserver({ ...h, mode: 'observe', maxEvaluations: 2, researchReserve: 1,
    client: { evaluate: () => new Promise(resolve => resolvers.push(resolve)) } });
  observer.observe();
  observer.observe(h.state.advance(), { researchChanged: true });
  assert.equal(observer.observe(h.state.advance()).queued, true);
  resolvers.shift()({ response: response(), durationMs: 1 }); await new Promise(resolve => setImmediate(resolve));
  resolvers.shift()({ response: response(), durationMs: 1 }); await observer.idle();
  assert.equal(h.counts().reserved, 2);
  assert.equal(observer.records().at(-1).trigger.researchChanged, true);
  assert.equal(observer.records().at(-1).ordinaryEvaluationCount, 1);
});
