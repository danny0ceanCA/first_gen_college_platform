import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { voiceControlSession } from '../../../server/voice-control.mjs';
import { createObservedLocalSession } from './session.mjs';
import { createCallProjector } from './projector.mjs';

const seed=callId=>({fictional:true,accountId:'fictional-account',callId,studentId:'fictional-student',language:'en',role:'family'});
function setup(callId,language,observed=false){
 const sent=[],events=[];
 const options={provider:{send:s=>sent.push(JSON.parse(s))},config:{language,tools:[],requestedVoice:'marin'},
  scope:{sessionId:callId,studentId:'fictional-student',confirmed:true},emit:e=>events.push(e),jobRequest:()=>{throw Error('no_research_in_test');}};
 const engine=observed?createObservedLocalSession(options,{localOnly:true,fictional:true,seed:{...seed(callId),language},allowedCallIds:[callId]}):voiceControlSession(options);
 return {engine,sent,events};
}
function fixtureOptions(callId) {
 return { provider:{send(){}}, config:{language:'en',tools:[],requestedVoice:'marin'},
  scope:{sessionId:callId,studentId:'fictional-student',confirmed:true},emit(){},jobRequest:()=>{throw Error('unexpected_research');} };
}
function labFor(callId) { return {localOnly:true,fictional:true,seed:seed(callId),allowedCallIds:[callId]}; }
function fakeWorker() {
 const worker=new EventEmitter();worker.messages=[];
 worker.postMessage=message=>{worker.messages.push(message);if(message.type==='close')queueMicrotask(()=>{worker.emit('message',{type:'closed'});worker.emit('exit',0);});};
 worker.terminate=async()=>{worker.emit('exit',0);};
 return worker;
}
const clean=v=>JSON.stringify(v).replace(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/gi,'ID');
for(const language of ['en','es'])test(`${language}: copied call events preserve intro, ordinary response and provider commands`,async()=>{
 const callId='fictional-'+randomUUID(),baseline=setup(callId,language),observed=setup(callId,language,true);
 try{
  assert.equal(await observed.engine.observation.ready,true);
  for(const f of [baseline,observed]){
   f.engine.start();
   f.engine.receive({type:'session.output_transcript.delta',delta:language==='es'?'Hola, qué gusto escucharte.':'Hi, it is good to hear from you.',start_ms:0,end_ms:1000});
   await new Promise(resolve=>setImmediate(resolve));
   await f.engine.flush();
   f.engine.receive({type:'session.input_transcript.delta',delta:language==='es'?'¿Por dónde empezamos?':'Where do we begin?',start_ms:1100,end_ms:2000});
   await f.engine.flush();
   f.engine.receive({type:'session.output_transcript.delta',delta:language==='es'?'Podemos empezar con lo que le interesa estudiar.':'We can start with what they would enjoy studying.',start_ms:2100,end_ms:3000});
   await new Promise(resolve=>setImmediate(resolve));
   f.engine.playback({idle:true,version:1});
   await f.engine.flush();
  }
  assert.equal(clean(observed.sent),clean(baseline.sent));
  assert.deepEqual(observed.events.map(e=>e.type),baseline.events.map(e=>e.type));
 }finally{baseline.engine.close();observed.engine.close();await observed.engine.observation.closed;}
 const rows=readFileSync(new URL(`../.local/${callId}.jsonl`,import.meta.url),'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(rows.some(r=>r.type==='snapshot_observed'));
 assert.ok(rows.some(r=>r.type==='application_transcript_boundary'&&r.role==='assistant'));
 assert.ok(rows.some(r=>r.type==='native_transcript_interval'));
 assert.ok(rows.some(r=>r.type==='playback_observation'&&r.heard==='unknown'));
 assert.ok(rows.every(r=>r.intervention===false));
});
test('local call construction rejects unapproved scope and production',()=>{
 const options={scope:{sessionId:'fictional-call',studentId:'fictional-student'}};
 assert.throws(()=>createObservedLocalSession(options,{}),/isolated_allowlisted/);
 assert.throws(()=>createObservedLocalSession(options,{localOnly:true,fictional:true,seed:seed('different'),allowedCallIds:['different']}),/isolated_allowlisted/);
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{assert.throws(()=>createObservedLocalSession(options,{localOnly:true,fictional:true,seed:seed('fictional-call'),allowedCallIds:['fictional-call']}),/isolated_allowlisted/);}
 finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
test('partial native transcripts never become finished turns; repeated boundaries do not repeat checks',()=>{
 const logs=[],snapshots=[];
 const p=createCallProjector(seed('fictional-projector'),s=>snapshots.push(s.snapshot()),r=>logs.push(r));
 p.receive({source:'native',atMs:1,event:{type:'session.input_transcript.delta',delta:'Where do',start_ms:0,end_ms:10}});
 assert.equal(snapshots.length,0);
 const packet={source:'application',atMs:2,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Where do we begin?'}};
 p.receive(packet);p.receive(packet);assert.equal(snapshots.length,1);
 p.receive({source:'application',atMs:3,event:{type:'response.output_audio_transcript.done',response_id:'a1',transcript:'Start with what you enjoy studying.'}});
 assert.equal(snapshots.length,2);assert.equal(snapshots[1].playbackEvidence.length,0);
 assert.equal(snapshots[1].currentQuestion.text,'Where do we begin?');
 p.receive({source:'scope',event:{type:'scope_changed'}});p.receive({...packet,event:{...packet.event,item_id:'u2'}});
 assert.equal(snapshots.length,2);assert.equal(p.state.snapshot().authorized,false);
});
test('a full observer queue cannot hold up or modify a call',async()=>{
 const f=setup('fictional-'+randomUUID(),'en',true);
 try{
  for(let i=0;i<500;i++)f.engine.receive({type:'session.input_transcript.delta',delta:'x',start_ms:i,end_ms:i+1});
  assert.ok(f.engine.observation.status().dropped>0);
  assert.equal(f.engine.observation.status().pending,64);
 }finally{f.engine.close();await f.engine.observation.closed;}
});

test('observer boot failure leaves baseline voice operational',async()=>{
 const id='fictional-'+randomUUID(),options=fixtureOptions(id),sent=[];
 options.provider.send=value=>sent.push(value);
 const engine=createObservedLocalSession(options,labFor(id),{createWorker(){throw Error('worker_unavailable');}});
 assert.equal(await engine.observation.ready,false);
 assert.equal(engine.observation.status().reason,'observer_boot_failed');
 assert.doesNotThrow(()=>engine.start());assert.ok(sent.length>0);
 assert.doesNotThrow(()=>engine.receive({type:'session.input_transcript.delta',delta:'Hello',start_ms:0,end_ms:10}));
 assert.doesNotThrow(()=>engine.close());await engine.observation.closed;
});

test('worker post failure and unexpected exit cannot interrupt voice',async()=>{
 for(const failure of ['post','exit']){
  const id='fictional-'+randomUUID(),worker=fakeWorker(),engine=createObservedLocalSession(fixtureOptions(id),labFor(id),{createWorker:()=>worker});
  worker.emit('message',{type:'ready'});assert.equal(await engine.observation.ready,true);
  if(failure==='post')worker.postMessage=()=>{throw Error('port_closed');};
  else worker.emit('exit',1);
  assert.doesNotThrow(()=>engine.receive({type:'session.input_transcript.delta',delta:'Hi',start_ms:0,end_ms:10}));
  assert.equal(engine.observation.status().failed,true);
  assert.doesNotThrow(()=>engine.close());worker.emit('exit',1);await engine.observation.closed;
 }
});

test('irrelevant native traffic does not fill the observer queue or copy secrets',async()=>{
 const id='fictional-'+randomUUID(),worker=fakeWorker(),engine=createObservedLocalSession(fixtureOptions(id),labFor(id),{createWorker:()=>worker});
 try{
  for(let i=0;i<500;i++)engine.receive({type:'session.output_audio.delta',delta:'audio',api_key:'secret'});
  assert.equal(worker.messages.length,0);assert.equal(engine.observation.status().failed,false);
  engine.receive({type:'session.input_transcript.delta',delta:'Hello',start_ms:0,end_ms:10,api_key:'secret',nested:{credential:'secret'}});
  assert.equal(worker.messages.length,1);assert.equal(JSON.stringify(worker.messages).includes('secret'),false);
 }finally{engine.close();await engine.observation.closed;}
});

test('same student configure continues; allowed selection clears only observer context',async()=>{
 const id='fictional-'+randomUUID(),worker=fakeWorker(),options=fixtureOptions(id);
 const engine=createObservedLocalSession(options,{...labFor(id),allowedStudentIds:['fictional-student','fictional-second']},{createWorker:()=>worker});
 try{
  await engine.configure(options.config,options.scope,'same');
  assert.equal(worker.messages.some(m=>m.source==='scope'),false);
  await engine.configure({...options.config,language:'es'},options.scope,'language');
  assert.deepEqual(worker.messages.filter(m=>m.source==='scope').map(m=>m.event.type),['context_changed']);
  await engine.configure(options.config,{...options.scope,studentId:'fictional-second'},'second');
  assert.deepEqual(worker.messages.filter(m=>m.source==='scope').map(m=>m.event.type),['context_changed','scope_transition','scope_changed']);
  assert.equal(worker.messages.at(-1).event.studentId,'fictional-second');
  assert.equal(engine.observation.status().failed,false);
 }finally{engine.close();await engine.observation.closed;}
});

test('unselected normalized scope and explicitly isolated account copy are truthful',async()=>{
 const id='local-'+randomUUID(),options=fixtureOptions(id),worker=fakeWorker();options.scope.studentId=null;
 const lab={localOnly:true,dataKind:'isolated-copy',seed:{...seed(id),fictional:false,isolatedLocal:true,dataKind:'isolated-copy',studentId:'unselected'},
  allowedCallIds:[id],allowedStudentIds:['local-aiden','local-elodie']};
 const engine=createObservedLocalSession(options,lab,{createWorker:()=>worker});
 try{await engine.configure(options.config,{...options.scope,studentId:'local-aiden'},'select');assert.equal(engine.observation.status().failed,false);}
 finally{engine.close();await engine.observation.closed;}
 assert.throws(()=>createObservedLocalSession(options,{...lab,seed:{...lab.seed,isolatedLocal:false}}),/isolated_allowlisted/);
});

test('native speech invalidates in-flight evidence without claiming a complete turn',()=>{
 const logs=[],p=createCallProjector(seed('fictional-native'),()=>{},r=>logs.push(r));
 p.receive({source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Where should I begin?'}});
 const original=p.state.snapshot();
 const fragment={source:'native',atMs:2,event:{type:'session.input_transcript.delta',event_id:'n1',delta:'Actually,',start_ms:10,end_ms:20}};
 p.receive(fragment);assert.equal(p.state.matches(original),false);
 const revised=p.state.snapshot();p.receive(fragment);assert.equal(p.state.matches(revised),true);
 assert.equal(revised.recentTranscripts.length,1);assert.equal(logs.at(-1).complete,false);
 p.receive({source:'application',atMs:1000,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u2',transcript:'Actually, what should I do next?'}});
 assert.equal(p.state.snapshot().recentTranscripts.at(-1).startMs,10);
 assert.equal(p.state.snapshot().recentTranscripts.at(-1).endMs,20);
});

test('playback is deduplicated and does not stale transcript classification',()=>{
 const logs=[],p=createCallProjector(seed('fictional-play'),()=>{},r=>logs.push(r));
 p.receive({source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Where should I begin?'}});
 const original=p.state.snapshot(),packet={source:'playback',atMs:2,event:{type:'browser_playback',idle:true,version:2}};
 p.receive(packet);p.receive(packet);p.receive({...packet,event:{...packet.event,version:1}});
 assert.equal(p.state.matches(original),true);assert.equal(p.state.snapshot().playbackEvidence.length,1);
 assert.equal(logs.filter(r=>r.type==='playback_observation').length,1);
});

test('oversized or changed finalized transcript stops observation and invalidates old results',()=>{
 for(const changed of [false,true]){
  const p=createCallProjector(seed('fictional-gap'),()=>{},()=>{});
  const original={source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Where should I begin?'}};
  p.receive(original);const snapshot=p.state.snapshot();
  p.receive({...original,event:{...original.event,item_id:changed?'u1':'u2',transcript:changed?'Correction':'word '.repeat(500)}});
  assert.equal(p.state.matches(snapshot),false);assert.equal(p.state.snapshot().authorized,false);
 }
});

test('scope transition suspends classification then resumes cleanly for the authorized student',()=>{
 const snapshots=[],p=createCallProjector(seed('fictional-scope'),s=>snapshots.push(s.snapshot()),()=>{}, {allowedStudentIds:['fictional-student','fictional-second']});
 const packet={source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Where should I begin?'}};
 p.receive(packet);const before=p.state.snapshot();
 p.receive({source:'scope',event:{type:'scope_transition'}});p.receive({...packet,event:{...packet.event,item_id:'u2'}});
 assert.equal(p.state.matches(before),false);assert.equal(snapshots.length,1);
 p.receive({source:'scope',event:{type:'scope_changed',studentId:'fictional-second',language:'es',confirmed:true}});
 p.receive({source:'native',atMs:2,event:{type:'session.input_transcript.delta',delta:'¿Por dónde empiezo?',start_ms:10,end_ms:20}});
 p.receive({...packet,event:{...packet.event,item_id:'u3',transcript:'¿Por dónde empiezo?'}});
 assert.equal(snapshots.length,2);assert.equal(snapshots[1].studentId,'fictional-second');assert.equal(snapshots[1].recentTranscripts.length,1);
 p.receive({source:'scope',event:{type:'context_changed',language:'en'}});
 assert.equal(p.state.snapshot().recentTranscripts.length,1);assert.equal(p.state.snapshot().language,'en');
 p.receive({source:'scope',event:{type:'scope_changed',studentId:'not-allowed'}});
 assert.equal(p.state.snapshot().authorized,false);
});

test('browser detach preserves native engine suspend and invalidates pending classifications',async()=>{
 const id='fictional-'+randomUUID(),worker=fakeWorker(),engine=createObservedLocalSession(fixtureOptions(id),labFor(id),{createWorker:()=>worker});
 try{
  assert.doesNotThrow(()=>engine.suspend());
  assert.equal(worker.messages.at(-1).source,'connection');
  const p=createCallProjector(seed('fictional-gap'),()=>{},()=>{}),before=p.state.snapshot();
  p.receive(worker.messages.at(-1));
  assert.equal(p.state.matches(before),false);assert.equal(p.state.snapshot().connectionGaps.at(-1).reason,'browser_control_detached');
  assert.equal(p.state.snapshot().connectionGaps.at(-1).transcriptContinuity,'unknown');
 }finally{engine.close();await engine.observation.closed;}
});

for(const language of ['en','es'])test(`${language}: assistant boundary cannot classify the old question while caller is still speaking`,()=>{
 const snapshots=[],logs=[],p=createCallProjector(seed('fictional-overlap'),s=>snapshots.push(s.snapshot()),row=>logs.push(row));
 p.receive({source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:language==='en'?'Where should I begin?':'¿Por dónde empiezo?'}});
 p.receive({source:'native',atMs:2,event:{type:'session.input_transcript.delta',delta:language==='en'?'Actually, ':'En realidad, ',start_ms:10,end_ms:20}});
 p.receive({source:'application',atMs:3,event:{type:'response.output_audio_transcript.done',response_id:'a1',transcript:language==='en'?'Start with what you enjoy.':'Empieza con lo que te interesa.'}});
 assert.equal(snapshots.length,1);assert.equal(logs.at(-1).reason,'user_input_incomplete');
 assert.equal(logs.find(row=>row.type==='native_transcript_interval').delta,language==='en'?'Actually, ':'En realidad, ');
 p.receive({source:'application',atMs:4,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u2',transcript:language==='en'?'Actually, can you explain it simply?':'En realidad, ¿puedes explicarlo de forma sencilla?'}});
 assert.equal(snapshots.length,2);assert.equal(snapshots[1].questionRevision,2);
});

test('first grouped span after selection cannot carry the prior student into the new scope',()=>{
 const snapshots=[],logs=[],p=createCallProjector(seed('fictional-late-scope'),s=>snapshots.push(s.snapshot()),r=>logs.push(r),{allowedStudentIds:['fictional-student','fictional-second']});
 p.receive({source:'native',atMs:1,event:{type:'session.input_transcript.delta',delta:'Old student words. ',start_ms:0,end_ms:10}});
 p.receive({source:'scope',event:{type:'scope_transition'}});
 p.receive({source:'scope',event:{type:'scope_changed',studentId:'fictional-second',language:'en',confirmed:true}});
 p.receive({source:'native',atMs:2,event:{type:'session.input_transcript.delta',delta:'New question.',start_ms:20,end_ms:30}});
 p.receive({source:'application',atMs:3,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'mixed',transcript:'Old student words. New question.'}});
 assert.equal(snapshots.length,0);assert.equal(p.state.snapshot().recentTranscripts.length,0);
 assert.equal(logs.at(-1).reason,'scope_boundary_ambiguous');assert.equal(p.state.snapshot().authorized,true);
 p.receive({source:'native',atMs:4,event:{type:'session.input_transcript.delta',delta:'Where should I begin?',start_ms:40,end_ms:50}});
 p.receive({source:'application',atMs:5,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'fresh',transcript:'Where should I begin?'}});
 assert.equal(snapshots.length,1);assert.equal(snapshots[0].studentId,'fictional-second');
 assert.equal(snapshots[0].recentTranscripts[0].text,'Where should I begin?');
});

const taskEvent=(overrides={})=>({type:'research_task',scopeGeneration:0,jobId:'fictional-job',revision:1,question:'Published off-campus costs?',
 status:'running',evidenceVersion:1,evidenceAvailability:'available',findings:[{fact:'Published annual total USD 40,000.',year:'2026–27',scenario:'off campus',
 limitation:'Before aid; excludes summer.',status:'verified',subject:'Fictional university',aspect:'total_budget',sourceIds:['1']}],...overrides});

for(const language of ['en','es'])test(`${language}: research observation waits for an unfinished caller question and duplicate polls do not classify twice`,()=>{
 const snapshots=[],logs=[],p=createCallProjector({...seed('fictional-research'),language},s=>snapshots.push(s.snapshot()),row=>logs.push(row));
 const question=language==='en'?'What does living near campus cost?':'¿Cuánto cuesta vivir cerca del campus?';
 p.receive({source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:question}});
 p.receive({source:'research',atMs:2,event:taskEvent({question})});
 assert.equal(snapshots.length,2);assert.equal(snapshots.at(-1).researchTasks.length,1);
 p.receive({source:'research',atMs:3,event:taskEvent({question})});assert.equal(snapshots.length,2);
 p.receive({source:'native',atMs:4,event:{type:'session.input_transcript.delta',delta:language==='en'?'Actually, ':'En realidad, ',start_ms:10,end_ms:20}});
 p.receive({source:'research',atMs:5,event:taskEvent({question,revision:2,status:'completed',evidenceVersion:2})});
 assert.equal(snapshots.length,2);assert.equal(logs.at(-1).reason,'user_input_incomplete');
 const changed=language==='en'?'Actually, tuition only.':'En realidad, solo la matrícula.';
 p.receive({source:'application',atMs:6,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u2',transcript:changed}});
 assert.equal(snapshots.length,3);assert.equal(snapshots.at(-1).currentQuestion.text,changed);
 assert.equal(snapshots.at(-1).researchTasks[0].question,question);
 assert.equal(snapshots.at(-1).researchTasks[0].status,'completed');
 assert.equal(logs.find(e=>e.type==='research_task_observed').independentlyVerified,false);
 assert.equal(logs.find(e=>e.type==='research_task_observed').playbackComplete,'unknown');
});

test('research copy clears at selection and stale evidence cannot revive the old scope',()=>{
 const logs=[],p=createCallProjector(seed('fictional-research-scope'),()=>{},r=>logs.push(r),{allowedStudentIds:['fictional-student','fictional-second']});
 p.receive({source:'research',event:taskEvent()});assert.equal(p.state.snapshot().researchTasks.length,1);
 p.receive({source:'scope',event:{type:'scope_transition',scopeGeneration:1}});
 p.receive({source:'research',event:taskEvent({revision:2,status:'completed'})});
 p.receive({source:'scope',event:{type:'scope_changed',scopeGeneration:1,studentId:'fictional-second',language:'es'}});
 assert.equal(p.state.snapshot().researchTasks.length,0);
 p.receive({source:'research',event:taskEvent({revision:3,status:'completed'})});
 assert.equal(p.state.snapshot().researchTasks.length,0);assert.equal(logs.at(-1).reason,'stale_scope');
 assert.equal(p.state.snapshot().authorized,true);
 p.receive({source:'research',event:taskEvent({scopeGeneration:1,jobId:'new-job',status:'completed',evidenceAvailability:'missing',findings:[]})});
 assert.equal(p.state.snapshot().researchTasks.at(-1).evidenceAvailability,'missing');
 assert.equal(p.state.snapshot().researchFindings.length,0);
});

for(const language of ['en','es'])test(`${language}: research arriving mid-answer is recorded immediately but classified after the estimated span finishes`,()=>{
 const snapshots=[],logs=[],p=createCallProjector({...seed('fictional-mid-answer'),language},s=>snapshots.push(s.snapshot()),row=>logs.push(row));
 p.receive({source:'application',atMs:1,event:{type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:language==='en'?'What does annual budget mean?':'¿Qué significa presupuesto anual?'}});
 const answer=language==='en'?'It is an estimate for one academic year.':'Es una estimación para un año académico.';
 p.receive({source:'native',atMs:2,event:{type:'session.output_transcript.delta',delta:answer,start_ms:10,end_ms:20}});
 p.receive({source:'research',atMs:3,event:taskEvent({status:'completed'})});
 assert.equal(snapshots.length,1);assert.equal(p.state.snapshot().researchTasks.length,1);
 assert.equal(logs.at(-1).reason,'assistant_output_incomplete');
 p.receive({source:'application',atMs:4,event:{type:'response.output_audio_transcript.done',response_id:'a1',transcript:answer}});
 assert.equal(snapshots.length,2);assert.equal(snapshots.at(-1).researchTasks[0].status,'completed');
 assert.equal(snapshots.at(-1).playbackEvidence.length,0);
});

for(const language of ['en','es'])test(`${language}: copied job responses preserve research requests, provider commands and emitted results`,async()=>{
 const id='fictional-'+randomUUID();
 function build(observed){
  const sent=[],events=[],requests=[],worker=fakeWorker();
  const options=fixtureOptions(id);options.config={...options.config,language,tools:[{name:'lookup_financial_aid'}]};
  options.provider.send=text=>sent.push(JSON.parse(text));options.emit=event=>events.push(event);
  options.jobRequest=async(method,jobId,body)=>{requests.push({method,jobId,body});return method==='POST'?{id:'fictional-job',status:'queued'}:
    method==='DELETE'?{id:jobId,status:'cancelled'}:{id:jobId,status:'completed',result:{text:'Published annual figure. [1]',sources:[{url:'https://fictional.invalid/costs',title:'Fictional source'}],evidenceVersion:1,
      voiceBrief:{status:'verified',answer:'Published annual figure. [1]',qualification:'Before aid. [1]',nextStep:'',findings:[{subject:'Fictional university',aspect:'total_budget',status:'verified',answer:'Published annual figure. [1]',qualification:'Before aid. [1]'}]}}};};
  const engine=observed?createObservedLocalSession(options,{...labFor(id),seed:{...seed(id),language}},{createWorker:()=>worker}):voiceControlSession(options);
  return {engine,sent,events,requests,worker};
 }
 const baseline=build(false),observed=build(true);
 try{
  for(const fixture of [baseline,observed]){
   fixture.engine.start();
   const question=language==='en'?'What is the published annual cost?':'¿Cuál es el costo anual publicado?';
   const item={type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:JSON.stringify({question,institution:'Fictional university'})};
   for(const event of [{type:'response.created',response:{id:'research-response'}},{type:'response.output_item.done',response_id:'research-response',item},{type:'response.completed',response:{id:'research-response'}}])
     fixture.engine.receive({type:'response.event',delegation_id:'delegation',event});
   for(let count=0;count<100&&!fixture.events.some(e=>e.type==='origen.research.result');count++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.ok(fixture.events.some(e=>e.type==='origen.research.result'));
  }
  // Completion timings vary, but all commands, tool outputs and browser result
  // events remain identical. The observer has no permission to issue commands.
  assert.equal(clean(observed.sent),clean(baseline.sent));
  assert.deepEqual(observed.requests,baseline.requests);
  assert.deepEqual(observed.events.map(e=>e.type),baseline.events.map(e=>e.type));
  const research=observed.worker.messages.filter(m=>m.source==='research');
  assert.equal(research.length,2);assert.equal(research[0].event.status,'queued');
  assert.equal(research[1].event.status,'completed');assert.equal(research[1].event.findings[0].limitation,'Before aid. [1]');
  assert.equal(research[1].event.question,observed.requests[0].body.question);
 }finally{baseline.engine.close();observed.engine.close();await observed.engine.observation.closed;}
});
