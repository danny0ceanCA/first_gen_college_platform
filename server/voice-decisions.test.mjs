import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { createProductionDecisionsFactory, assertDecisionsReady } from './voice-decisions.mjs';
import { createDecisionsCallBudget } from './decisions-call-budget.mjs';
import { decisionsDiagnosticData } from './decisions-diagnostics.mjs';
import { createEarlyEvidenceTracker } from '../research/decisions/local-call/early-projector.mjs';
import { earlyResultFixture } from '../research/decisions/local-call/early-fixtures.mjs';
import { createObserverState } from '../research/decisions/state.mjs';
import { conversationPolicy } from '../research/decisions/conversation-rubric.mjs';

test('production flag defaults off and validates dependencies', () => {
  assert.equal(createProductionDecisionsFactory({ env: {}, database: null }), undefined);
  assert.throws(() => createProductionDecisionsFactory({ env: { ORIGEN_DECISIONS_SUPPORT:'true' }, database:{} }), /dependencies/);
});
test('production data stays truthfully marked and reaches the existing classifier request builder', () => {
  const state = createObserverState({ productionSession:true, dataKind:'production', fictional:false,
    accountId:'hashed-owner', callId:'call-a', studentId:'student-a', language:'en' });
  const s = state.snapshot(); assert.equal(s.dataKind,'production'); assert.equal(s.fictional,false); assert.equal(s.isolatedLocal,false);
  const request = conversationPolicy.buildRequest(s); assert.equal(request.model,'gpt-6-luna');
  assert.ok(!JSON.stringify(request).includes('hashed-owner'));
});
test('per-call accounting retains unknown usage and rejects request 33', () => {
  const budget=createDecisionsCallBudget();
  const usage={input_tokens:1000,output_tokens:0,total_tokens:1000,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}};
  for(let i=0;i<32;i++){const {id}=budget.reserve({operationId:'op-'+i});if(i===0)budget.markUnknown(id);else budget.settle(id,usage);}
  assert.equal(budget.summary().requestCount,32);assert.equal(budget.summary().unknownCount,1);
  assert.equal(budget.summary().reservedUsd,.005);assert.throws(()=>budget.reserve({operationId:'overflow'}),/limit/);
  budget.close();assert.throws(()=>budget.reserve({operationId:'after-close'}));
});
test('durable diagnostic projection excludes transcript, prompts, keys and classifier prose', () => {
  const projected=decisionsDiagnosticData({sourceText:'PRIVATE',transcripts:['PRIVATE'],apiKey:'PRIVATE',
    request:{input:'PRIVATE'},reason:'caller_speech_in_progress',result:{facts:{simplify_requested:.9},text:'PRIVATE'},
    sourceEventIds:['event-a'],durationMs:340,inputOpen:true,playbackClaim:false});
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.equal(projected.probabilities.simplify_requested,.9);
  assert.equal(projected.reason,'caller_speech_in_progress');assert.equal(projected.playbackClaim,false);
});
test('readiness requires the diagnostic table and runtime insert/read privileges', async () => {
  await assertDecisionsReady(null,{});
  await assert.rejects(assertDecisionsReady({query:async()=>({rows:[{present:true,permitted:false}]})},{ORIGEN_DECISIONS_SUPPORT:'true'}));
  await assertDecisionsReady({query:async()=>({rows:[{present:true,permitted:true}]})},{ORIGEN_DECISIONS_SUPPORT:'true'});
});

for(const language of ['en','es'])for(const betweenThoughts of [false,true])test(`${language}: production wrapper preserves intro with between-thought support ${betweenThoughts ? 'enabled' : 'disabled'}`,async()=>{
  const messages=[],sent=[],writes=[],worker=new EventEmitter();let settings,mirror;
  worker.postMessage=packet=>{messages.push(structuredClone(packet));if(packet.source)mirror.receive(packet);
    queueMicrotask(()=>worker.emit('message',{type:'ack'}));
    if(packet.type==='close')queueMicrotask(()=>worker.emit('message',{type:'closed'}));};
  worker.terminate=async()=>{};
  const env={ORIGEN_DECISIONS_SUPPORT:'true',ORIGEN_LIVE_SERVER_CONTROL:'true',ORIGEN_BACKGROUND_RESEARCH:'true',OPENAI_API_KEY:'fake-not-used'};
  if(betweenThoughts)env.ORIGEN_DECISIONS_BETWEEN_THOUGHTS='true';
  const database={query:async(sql,args)=>{writes.push({sql,args});return {rowCount:1};}};
  const factory=createProductionDecisionsFactory({env,database,dependencies:{createWorker:(_url,s)=>{
    settings=s.workerData;mirror=createEarlyEvidenceTracker(settings.seed,{allowedStudentIds:settings.allowedStudentIds});return worker;}}});
  const scope={sessionId:'11111111-1111-4111-8111-111111111111',studentId:'student-a',confirmed:true};
  const engine=factory({subject:'verified-owner',scope,config:{language,tools:[],requestedVoice:'marin'},
    provider:{readyState:1,send:text=>sent.push(JSON.parse(text))},emit(){},jobRequest(){throw Error('unexpected_research');}});
  try{
    assert.equal(settings.production,true);assert.equal(settings.lateEnabled,false);assert.equal(settings.seed.dataKind,'production');
    assert.equal(settings.betweenThoughtsEnabled,betweenThoughts);assert.equal(settings.meaningfulScheduling,true);
    assert.equal(settings.seed.fictional,false);worker.emit('message',{type:'ready'});engine.start();
    engine.receive({type:'session.output_transcript.delta',event_id:'intro',delta:language==='en'?'Hello. How can I help?':'Hola. ¿Cómo te puedo ayudar?',start_ms:0,end_ms:500});
    await new Promise(r=>setImmediate(r));await engine.flush();engine.playback({idle:true,version:1});assert.equal(engine.observation.status().support.introReady,true);
    const introCommands=sent.length;
    engine.receive({type:'session.input_transcript.delta',event_id:'need',delta:language==='en'?'I need one simple example.':'Necesito un ejemplo sencillo.',start_ms:2000,end_ms:3000});
    const s=mirror.snapshot();worker.emit('message',{type:'early_candidate',stamp:s.stamp,record:{status:'completed',callId:scope.sessionId,
      studentId:scope.studentId,sourceEventIds:s.sourceEventIds,sourceText:s.text,supportRevision:engine.observation.status().support.early.supportRevision,
      assistantOutputRevision:s.assistantOutputRevision,operationId:'operation-a',requestId:'request-a',result:earlyResultFixture()}});
    assert.equal(sent.length,introCommands);assert.equal(engine.observation.status().support.early.pending,true);
    await new Promise(r=>setImmediate(r));await engine.flush();engine.playback({idle:true,version:2});
    assert.equal(sent.length,introCommands+1);assert.equal(sent.at(-1).type,'session.thinking.append');assert.equal(sent.at(-1).delegation_id,null);
    worker.emit('message',{type:'diagnostic',event:{type:'support_early_sent',sourceText:'PRIVATE',contextSent:true,playbackClaim:false}});
    await new Promise(r=>setImmediate(r));assert.ok(writes.length>0);assert.ok(!JSON.stringify(writes).includes('PRIVATE'));
    assert.ok(writes.every(row=>row.args[1]===scope.sessionId));
  }finally{engine.close();await engine.observation.closed;mirror.close();}
});

for(const language of ['en','es'])test(`${language}: actual production helper thread classifies, accounts and delivers through the shared guard`,async()=>{
  const writes=[],sent=[];
  const factory=createProductionDecisionsFactory({env:{ORIGEN_DECISIONS_SUPPORT:'true',ORIGEN_LIVE_SERVER_CONTROL:'true',ORIGEN_BACKGROUND_RESEARCH:'true',OPENAI_API_KEY:'fake-not-used'},
    database:{query:async(sql,args)=>{writes.push({sql,args});return {rowCount:1};}},
    dependencies:{createWorker:(_url,settings)=>new Worker(new URL('./fixtures/decisions-worker-test.mjs',import.meta.url),settings)}});
  const engine=factory({subject:'authenticated-fixture-owner',scope:{sessionId:'22222222-2222-4222-8222-222222222222',studentId:'student-a',confirmed:true},
    config:{language,tools:[],requestedVoice:'marin'},provider:{readyState:1,send:text=>sent.push(JSON.parse(text))},emit(){},jobRequest(){throw Error('unexpected_research');}});
  async function until(check){const end=Date.now()+2500;while(!check()){if(Date.now()>end)assert.fail('helper condition timed out');await new Promise(r=>setTimeout(r,10));}}
  try{
    assert.equal(await engine.observation.ready,true);engine.start();
    engine.receive({type:'session.output_transcript.delta',event_id:'intro',delta:language==='en'?'Hello. How can I help?':'Hola. ¿Cómo te puedo ayudar?',start_ms:0,end_ms:500});
    await new Promise(r=>setImmediate(r));await engine.flush();engine.playback({idle:true,version:1});
    engine.receive({type:'session.input_transcript.delta',event_id:'caller-need',delta:language==='en'?'I do not understand what a prerequisite means.':'No entiendo qué significa un requisito previo.',start_ms:2000,end_ms:3000});
    await until(()=>engine.observation.status().support.early.pending);
    assert.equal(sent.filter(row=>row.event_id?.startsWith('support_early_')).length,0);
    await engine.flush();engine.playback({idle:true,version:2});
    await until(()=>sent.some(row=>row.event_id?.startsWith('support_early_')));
    const cue=sent.find(row=>row.event_id?.startsWith('support_early_'));
    engine.receive({type:'session.thinking.appended',client_event_id:cue.event_id,start_ms:3100,end_ms:3200});
    await until(()=>writes.some(row=>row.args[3]==='support_early_context_acknowledged'));
    assert.ok(writes.some(row=>row.args[3]==='early_decisions_completed'));
    assert.ok(!writes.some(row=>JSON.stringify(row).includes('requisito previo')||JSON.stringify(row).includes('prerequisite means')));
    const completed=writes.find(row=>row.args[3]==='early_decisions_completed').args[6];
    assert.equal(completed.budget.requestCount>=1,true);assert.equal(completed.budget.spentUsd>0,true);
    assert.equal(engine.observation.status().support.early.lateEnabled,false);
  }finally{engine.close();await engine.observation.closed;}
});
