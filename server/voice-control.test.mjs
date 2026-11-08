import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:http';
import WebSocket from 'ws';
import {voiceControlSession,createVoiceControl} from './voice-control.mjs';
import {studentLiveSession,studentLiveUpdate} from './student-live-session.mjs';
import {buildOpeningBrief} from './voice-opening-brief.mjs';
import {studentVoiceChannel} from '../src/studentVoiceChannel.mjs';
import {discussionExamples} from '../src/researchDiscussion.fixture.mjs';
import {voiceTargetResult} from '../src/voiceTargetResult.mjs';
import {capturePayload} from '../src/voiceCapture.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeoutMs=1000){for(let n=0;n<timeoutMs/10;n++){if(check())return;await pause(10);}assert.fail('condition timed out');}
const tool=(name,call_id,args={})=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});
const config={language:'en',instructions:'Authorized context',tools:[{name:'lookup_financial_aid'},{name:'propose_profile'}],routingPolicy:'bounded-follow-up-v1'};
function fixture(options={}){
 const sent=[],events=[],jobs=[];
 const engine=voiceControlSession({provider:{send:text=>sent.push(JSON.parse(text))},config:{...config,...options.config},scope:{sessionId:'physical-call',studentId:'aiden',confirmed:true},
  emit:event=>events.push(event),jobRequest:async(method,id,body)=>{jobs.push({method,id,body});return method==='POST'?{id:'job-1',status:'queued'}:{id,status:'running'};},...options,config:{...config,...options.config}});
 engine.start();
 function backend(type,id,extra={}){engine.receive({type:'response.event',delegation_id:'delegation-'+id,event:{type,response:{id},...extra}});}
 function call(items,id='r'){backend('response.created',id);for(const item of items)backend('response.output_item.done',id,{item});backend('response.completed',id);}
 return {engine,sent,events,jobs,backend,call};
}
for(const language of ['en','es'])test(`${language}: unavailable diagnostics cannot delay the intro or add provider speech instructions`,async()=>{
 const calls=[],observer={observe:e=>calls.push(e),playback:()=>{throw Error('diagnostic sink failed');},close:()=>new Promise(()=>{}),reset:()=>{}};
 const f=fixture({observer,researchDeliveryV2:true,config:{language}});
 try{
  const greeting=language==='es'?'Hola, qué gusto escucharte.':'Hi, it is good to hear from you.';
  f.engine.receive({type:'session.output_transcript.delta',delta:greeting,start_ms:0,end_ms:1000});
  await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'));
  f.engine.playback({idle:true,version:1});await f.engine.flush();
  assert.equal(f.events.find(e=>e.type==='response.output_audio_transcript.done').transcript,greeting);
  assert.equal(f.sent.filter(e=>['session.commentary.append','session.instructions.append'].includes(e.type)).length,0);
  assert.ok(calls.length);f.engine.close();
 }finally{f.engine.close();}
});
for(const language of ['en','es'])for(const callerAsks of [false,true])for(const invitedEarly of [false,true])test(`${language}: selection ${invitedEarly?'with an early invitation':'acknowledgment only'} and ${callerAsks?'an arriving caller question':'a name-only selection'} keep one native continuation through later refresh`,async()=>{
 const input={mode:'planning',role:'parent',language,studentId:'aiden',targetConfirmed:true,routeConversations:true,profile:{id:'aiden',name:'Aiden',school:'Synthetic Community College'}};
 input.openingBrief=buildOpeningBrief(input);
 const f=fixture({config:{language,tools:[{name:'request_conversation_target'}]},scope:{sessionId:'physical-call',studentId:null,confirmed:false}});
 try{
  f.engine.receive({type:'session.input_transcript.delta',delta:'Aiden'});
  await until(()=>f.events.some(e=>e.type==='input_audio_buffer.speech_started'));
  await f.engine.flush();
  f.call([tool('request_conversation_target','choose',{scope:'student:aiden'})]);
  await until(()=>f.events.some(e=>e.controlLease));const lease=f.events.find(e=>e.controlLease).controlLease;
  const acknowledgment=language==='en'?'Thanks.':'Gracias.';
  f.engine.receive({type:'session.output_transcript.delta',delta:acknowledgment});
  await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'&&e.delta===acknowledgment));
  const invitation=language==='en'?' What would you like help with?':' ¿Con qué te gustaría recibir ayuda?';
  if(invitedEarly){
   f.engine.receive({type:'session.output_transcript.delta',delta:invitation});
   await until(()=>f.events.some(e=>e.type==='response.output_audio_transcript.delta'&&e.delta===invitation));
  }
  await f.engine.configure({...config,language,...studentLiveUpdate(input)}, {sessionId:'physical-call',studentId:'aiden',confirmed:true},'first-selection');
  assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='research-state'),'first selection must not report a cancelled or missing lookup');
  assert.equal(f.jobs.length,0,'selecting the student does not start research');
  const packets=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='selected-student-context');
  assert.equal(f.sent.filter(e=>e.type==='session.instructions.append').length,0,'the ordinary introduction must not redirect or interrupt speech');
  assert.equal(packets.length,0,'student facts stay out of voice context before the successful selection receipt');
  const questionParts=language==='en'?['How can he choose ','between colleges?']:['¿Cómo puede elegir ','entre universidades?'];
  if(callerAsks){
   f.engine.receive({type:'session.input_transcript.delta',delta:questionParts[0]});
   await until(()=>f.events.filter(e=>e.type==='input_audio_buffer.speech_started').length===2);
  }
  await pause(0);assert.ok(!f.events.some(e=>e.type==='session.updated'));
  f.engine.receive({type:'session.updated',client_event_id:'first-selection'});
  await until(()=>f.events.some(e=>e.type==='session.updated'));
  assert.equal(f.events.find(e=>e.type==='origen.configuration.applied').contextDelivery,'staged_for_selection');
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,0,'context delivery alone cannot open a second speaking turn');
  const receipt=voiceTargetResult(true,'Aiden');
  assert.equal(f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'choose',output:JSON.stringify(receipt)}},lease),true);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
  const delivered=JSON.parse(f.sent.find(e=>e.item?.call_id==='choose').item.output);
  assert.deepEqual(delivered.selectionContext.openingBrief,input.openingBrief,'the backend retains the complete authorized brief');
  const snapshots=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='confirmed-student-brief');
  assert.equal(snapshots.length,1);assert.ok(new TextEncoder().encode(snapshots[0].content).length<=480);
  assert.equal(JSON.parse(snapshots[0].content).profile.school,'Synthetic Community College');
  f.engine.receive({type:'session.thinking.appended',client_event_id:snapshots[0].event_id,start_ms:1000,end_ms:1400});
  await until(()=>f.events.some(e=>e.type==='origen.selection.context'&&e.stage==='acknowledged'));
  assert.equal(delivered.status,receipt.status);
  assert.equal(delivered.selectionDelivery.mode,callerAsks?'caller_first':invitedEarly?'leave_floor':'conditional_recap');
  assert.equal(delivered.selectionDelivery.assistantQuestionObserved,invitedEarly);
  assert.equal(delivered.selectionDelivery.callerSpeechObserved,callerAsks);
  if(!callerAsks&&!invitedEarly)assert.equal(delivered.instruction,receipt.instruction);
  else assert.doesNotMatch(delivered.instruction,/then invite their priority/);
  if(callerAsks){
   // The caller still owns the microphone when the receipt returns. Their
   // remaining words stay in the native conversation, never a replayed prompt.
   assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').length,1);
   f.engine.receive({type:'session.input_transcript.delta',delta:questionParts[1]});await pause(0);
  }
  await f.engine.flush();
  assert.deepEqual(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').map(e=>e.transcript),callerAsks?['Aiden',questionParts.join('')]:['Aiden']);
  assert.deepEqual(f.events.filter(e=>e.type==='response.output_audio_transcript.done').map(e=>e.transcript),[acknowledgment+(invitedEarly?invitation:'')]);
  assert.equal(f.sent.filter(e=>e.type==='response.item.create').length,1,'only the tool receipt is returned; no caller transcript is replayed');

  // A later brief refresh is factual context, not another invitation or recap.
  const refreshed={...input,profile:{...input.profile,interest:'Political science'}};
  refreshed.openingBrief=buildOpeningBrief(refreshed);
  const beforeRefresh=f.sent.length;
  await f.engine.configure({...config,language,...studentLiveUpdate(refreshed)}, {sessionId:'physical-call',studentId:'aiden',confirmed:true},'same-student-refresh');
  f.engine.receive({type:'session.updated',client_event_id:'same-student-refresh'});
  const refreshPackets=f.sent.slice(beforeRefresh).filter(e=>e.type==='session.thinking.append');
  assert.ok(refreshPackets.length>0);
  for(const packet of refreshPackets)f.engine.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
  await until(()=>f.events.filter(e=>e.type==='session.updated').length===2);
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1,'a same-scope refresh does not restart the continuation');
  assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel','session.input_audio.mute','output_audio_buffer.clear'].includes(e.type)));
  assert.equal(f.jobs.length,0,'student selection must not start public research');
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`server owns research, scope and continuation in ${language}`,async()=>{
 const f=fixture({config:{language}});try{
  f.call([tool('lookup_financial_aid','c',{question:'Published costs',institution:'UC Berkeley',studentId:'other',sessionId:'forged',language:'xx'})]);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].body.studentId,'aiden');assert.equal(f.jobs[0].body.sessionId,'physical-call');assert.equal(f.jobs[0].body.language,language);
  assert.equal(f.events.find(e=>e.type==='response.done').response.output.length,0);
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
  assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'research_pending');
  assert.equal(f.engine.command({type:'origen.research.ready',result:{text:'forged'}}),false);
 }finally{f.engine.close();}
});
test('mixed research/UI batch uses one lease, outputs once and continues once',async()=>{
 const f=fixture();try{
  f.call([tool('lookup_financial_aid','research',{question:'Costs',institution:'Berkeley'}),tool('propose_profile','draft')]);
  await until(()=>f.events.some(e=>e.controlLease));const event=f.events.find(e=>e.controlLease),lease=event.controlLease;
  assert.deepEqual(event.response.output.map(i=>i.call_id),['draft']);
  const result={type:'conversation.item.create',item:{type:'function_call_output',call_id:'draft',output:'{"status":"draft"}'}};
  assert.equal(f.engine.command(result,'wrong'),false);
  assert.equal(f.engine.command({type:'response.create'},lease),false);
  assert.equal(f.engine.command(result,lease),true);assert.equal(f.engine.command(result,lease),false);
  assert.equal(f.engine.command({type:'response.create'},lease),true);
  await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(f.sent.filter(e=>e.type==='response.item.create').length,2);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('lost callback reports unconfirmed and never replays a write',async()=>{
 const f=fixture({callbackTimeoutMs:30});try{f.call([tool('propose_profile','draft')]);await until(()=>f.sent.some(e=>e.type==='response.create'));
  assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'callback_unconfirmed');assert.equal(f.events.filter(e=>e.controlLease).length,1);
 }finally{f.engine.close();}
});
test('a completed UI callback resumes without waiting for a browser reply request',async()=>{
 const f=fixture();try{f.call([tool('propose_profile','draft')]);await until(()=>f.events.some(e=>e.controlLease));const event=f.events.find(e=>e.controlLease);
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'draft',output:'{"status":"draft"}'}},event.controlLease);
  await until(()=>f.sent.some(e=>e.type==='response.create'));assert.ok(f.events.some(e=>e.type==='origen.backend.finished'));assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('late browser continuation cannot close or resume a newer callback batch',async()=>{
 const f=fixture();try{f.call([tool('propose_profile','first')],'first-response');await until(()=>f.events.some(e=>e.controlLease));const old=f.events.find(e=>e.controlLease);
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'first',output:'{}'}},old.controlLease);await until(()=>f.events.some(e=>e.type==='origen.backend.finished'));
  f.call([tool('propose_profile','second')],'second-response');await until(()=>f.events.filter(e=>e.controlLease).length===2);
  assert.equal(f.engine.command({type:'response.create'},old.controlLease),true);assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('detail follow-ups read the retained report without another external job and cannot cross scopes',async()=>{
 let posts=0;const full='The retained report includes a qualified supporting detail [1].',tools=[...config.tools,{name:'read_research_details'}];
 const f=fixture({config:{tools},jobRequest:async method=>method==='POST'?(posts++,{id:'job-1',status:'queued'}):{status:'completed',result:{text:full,sources:[{url:'https://example.edu/policy'}]}}});
 try{f.call([tool('lookup_financial_aid','lookup',{question:'Costs',institution:'Example'})]);await until(()=>f.events.some(e=>e.type==='origen.research.result'));
  f.call([tool('read_research_details','details',{jobId:'job-1',revision:1})],'read');await until(()=>f.sent.some(e=>e.item?.call_id==='details'));
  const retained=JSON.parse(f.sent.find(e=>e.item?.call_id==='details').item.output);
  assert.equal(retained.text,full);assert.equal(posts,1);
  assert.equal(retained.searchStarted,false);assert.equal(retained.reportState,'completed');
  assert.equal(retained.searchedQuestion,'Costs');assert.equal(retained.institution,'Example');assert.equal(retained.requestId,'lookup');assert.equal(retained.revision,1);
  assert.match(retained.instruction,/not researched, not a failed verification/);assert.match(retained.instruction,/reading it performs no new search/);
  f.call([tool('read_research_details','stale-revision',{jobId:'job-1',revision:2})],'read-stale');await until(()=>f.sent.some(e=>e.item?.call_id==='stale-revision'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='stale-revision').item.output).status,'research_details_unavailable');
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='stale-revision').item.output).searchStarted,false);
  await f.engine.configure({...config,tools},{sessionId:'physical-call',studentId:'other',confirmed:true},'scope');
  f.call([tool('read_research_details','wrong-scope',{jobId:'job-1',revision:1})],'read-other');await until(()=>f.sent.some(e=>e.item?.call_id==='wrong-scope'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='wrong-scope').item.output).status,'research_details_unavailable');assert.equal(posts,1);
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: managed research corrects a finished scenario and preserves the searched scope of each report`,async()=>{
 const posted=[],deleted=[];const questions=language==='en'?['Berkeley residence-hall budget for 2026–27','Berkeley off-campus budget for 2026–27']:['Presupuesto de Berkeley en residencia universitaria para 2026–27','Presupuesto de Berkeley fuera del campus para 2026–27'];
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async(method,id,body)=>{
  if(method==='POST'){posted.push(body);return {id:`job-${posted.length}`,status:'queued'};}
  if(method==='DELETE'){deleted.push(id);return {status:'cancelled'};}
  return {status:'completed',result:{text:`Sourced answer for ${id} [1].`,sources:[{url:'https://example.edu/costs'}]}};
 }});
 try{
  f.call([tool('lookup_financial_aid','initial',{question:questions[0],institution:'UC Berkeley'})],'initial-response');
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'),1500);
  f.call([tool('lookup_financial_aid','correction',{question:questions[1],institution:'UC Berkeley',replaceRequestId:'initial',replaceRevision:1,
   replacementChange:{kind:'correct_scope',uncoveredNeed:language==='en'?'Off-campus housing replaces the residence-hall assumption.':'Vivienda fuera del campus sustituye la residencia universitaria.'}})],'correction-response');
  await until(()=>f.sent.some(e=>e.item?.call_id==='correction'));
  const corrected=JSON.parse(f.sent.find(e=>e.item?.call_id==='correction').item.output);
  assert.equal(corrected.status,'research_pending');assert.equal(corrected.revision,2);assert.equal(corrected.requestId,'initial');
  await until(()=>f.events.filter(e=>e.type==='origen.research.result'&&e.status==='completed').length===2,1500);
  for(const [index,revision]of [[1,1],[2,2]]){
   f.call([tool('read_research_details',`detail-${index}`,{jobId:`job-${index}`,revision})],`detail-response-${index}`);
   await until(()=>f.sent.some(e=>e.item?.call_id===`detail-${index}`));
   const report=JSON.parse(f.sent.find(e=>e.item?.call_id===`detail-${index}`).item.output);
   assert.equal(report.searchedQuestion,questions[index-1]);assert.equal(report.researchPending,false);assert.equal(report.revision,revision);
    assert.equal(report.searchStarted,false);assert.equal(report.reportState,'completed');
  }
  assert.equal(posted.length,2);assert.deepEqual(deleted,[]);
  assert.ok(f.events.some(e=>e.type==='origen.research.state_changed'&&e.revision===2&&e.state==='completed'));
  assert.equal(f.sent.some(e=>e.type==='session.instructions.append'),false,'research cannot interrupt speech with steering');
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`${language}: server forwards first checked findings while recovery continues, then the final version`,async()=>{
 let posts=0,complete=false;
 const initial={text:'Checked tuition is USD 12000 per year [1].',sources:[{url:'https://example.edu/fees'}],evidenceVersion:1,researchPending:true};
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async method=>method==='POST'?(posts++,{id:'job-1',status:'queued'}):{status:complete?'completed':'running',result:{...initial,text:complete?'Checked tuition is USD 12000 per year; housing is USD 15000 [1].':initial.text,evidenceVersion:complete?2:1,researchPending:!complete}}});
 try{
  f.call([tool('lookup_financial_aid','lookup',{question:'Costs',institution:'Example'})]);
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='running'),1500);
  assert.equal(f.events.filter(e=>e.type==='origen.research.active').at(-1).active,true);
  f.call([tool('read_research_details','initial-detail',{jobId:'job-1',revision:1})],'detail');
  await until(()=>f.sent.some(e=>e.item?.call_id==='initial-detail'));
  const details=JSON.parse(f.sent.find(e=>e.item?.call_id==='initial-detail').item.output);
  assert.equal(details.text,initial.text);assert.equal(details.researchPending,true);assert.equal(posts,1);
  assert.equal(details.searchStarted,false);assert.equal(details.reportState,'running','reading the partial report does not restart its existing recovery');
  complete=true;
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'),1500);
  assert.equal(f.events.filter(e=>e.type==='origen.research.result').length,2);
  assert.equal(f.events.filter(e=>e.type==='origen.research.active').at(-1).active,false);
  assert.equal(posts,1);
 }finally{f.engine.close();}
});
for(const language of ['en','es'])test(`${language}: a completed unverified report is a terminal answer, not a new or pending search`,async()=>{
 const question=language==='en'?'What is the off-campus total at UC Irvine?':'¿Cuál es el costo total fuera del campus en UC Irvine?';
 const text=language==='en'?'The requested UC Irvine off-campus total could not be verified from the checked official sources.':'No se pudo verificar el costo total solicitado fuera del campus en UC Irvine con las fuentes oficiales consultadas.';
 let posts=0;
 const f=fixture({researchDeliveryV2:true,config:{language,tools:[...config.tools,{name:'read_research_details'}]},jobRequest:async method=>method==='POST'?(posts++,{id:'irvine',status:'queued'}):{status:'completed',result:{text,sources:[{url:'https://www.uci.edu/'}]}}});
 try{
  f.call([tool('lookup_financial_aid','irvine-search',{question,institution:'UC Irvine'})],'search');
  await until(()=>f.events.some(e=>e.type==='origen.research.result'&&e.status==='completed'));
  const beforeRead=f.sent.length;
  f.call([tool('read_research_details','irvine-detail',{jobId:'irvine',revision:1})],'read');
  await until(()=>f.sent.some(e=>e.item?.call_id==='irvine-detail'));
  const receipt=JSON.parse(f.sent.find(e=>e.item?.call_id==='irvine-detail').item.output);
  assert.equal(receipt.status,'cached_research_details');assert.equal(receipt.searchStarted,false);
  assert.equal(receipt.reportState,'completed');assert.equal(receipt.researchPending,false);
  assert.equal(receipt.text,text);assert.equal(receipt.searchedQuestion,question);assert.equal(posts,1);
  assert.match(receipt.instruction,/completed means the check ended, even when a requested fact remains unverified/);
  assert.match(receipt.instruction,/Do not announce checking when reusing this report/);
  assert.match(receipt.instruction,/source-supported material qualification/);
  const followup=f.sent.slice(beforeRead);
  assert.equal(followup.filter(e=>e.type==='response.item.create').length,1);
  assert.equal(followup.filter(e=>e.type==='response.create').length,1,'one normal tool continuation');
  assert.ok(!followup.some(e=>['session.commentary.append','session.instructions.append','response.cancel','output_audio_buffer.clear'].includes(e.type)),'local report read adds no spoken announcement or interruption');
 }finally{f.engine.close();}
});
test('provider session ACL blocks primary tool/control writes only when negotiated',()=>{
 const base={instructions:'policy',tools:[]},input={language:'en',voiceControlProtocol:'server-v1'};
 assert.equal(studentLiveSession(base,input).client,undefined);
 assert.deepEqual(studentLiveSession(base,input,[],{ORIGEN_LIVE_SERVER_CONTROL:'true'}).client.data_channel,{allowed_client_events:['session.close'],allowed_server_events:[]});
 assert.equal(studentLiveSession(base,{language:'en'},[],{ORIGEN_LIVE_SERVER_CONTROL:'true'}).client,undefined);
});
class Provider extends EventEmitter{
 constructor(){super();this.readyState=WebSocket.CONNECTING;this.sent=[];setImmediate(()=>{this.readyState=WebSocket.OPEN;this.emit('open');});}
 send(text){this.sent.push(JSON.parse(text));}close(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;this.emit('close');}
}
async function transportFixture(options={}){
 let revision=1;const providers=[],urls=[],logs=[];
 const control=createVoiceControl({productionSessionFactory:options.productionSessionFactory,resumeGraceMs:options.resumeGraceMs,heartbeatIntervalMs:options.heartbeatIntervalMs,env:{ORIGEN_LIVE_SERVER_CONTROL:'true',ORIGEN_BACKGROUND_RESEARCH:'true',ALLOWED_ORIGINS:'http://allowed.test',...options.env},authenticate:async token=>{if(!['owner','other'].includes(token))throw Error('invalid');return {sub:token};},authorize:async()=>revision,request:options.request|| (async()=>({})),log:event=>logs.push(event),connect:url=>{urls.push(url);const socket=new Provider();providers.push(socket);return socket;}});
 const server=createServer();control.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const receipt=(providerId='live_session_prefixed')=>control.register({subject:'owner',permissionRevision:1,providerId,sessionId:'call',scope:{sessionId:'call',studentId:'aiden',confirmed:true},config:{...config,...options.config}});
 const connect=async(origin='http://allowed.test',socketOptions={})=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/voice-control`,{...socketOptions,origin});ws.on('error',()=>{});const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');return {ws,messages};};
 return {control,receipt,connect,providers,urls,logs,base:`http://127.0.0.1:${server.address().port}`,revoke:()=>revision++,async close(){control.close();await new Promise(r=>server.close(r));}};
}
test('bridge verifies ownership, preserves provider ID, and closes on permission revision',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
  await until(()=>messages.some(e=>e.type==='ready'));assert.match(f.urls[0],/\/live_session_prefixed\/attach$/);
  assert.ok(!f.providers[0].sent.some(e=>e.type==='session.start'));
  f.revoke();await once(ws,'close');assert.ok(f.providers[0].sent.some(e=>e.type==='session.close'));
  assert.ok(!JSON.stringify(f.logs).includes('owner'));
 }finally{await f.close();}
});
for(const language of ['en','es'])test(`${language}: provider voice is confirmed across the actual control socket on connect and reconnect without holding speech`,async()=>{
 const f=await transportFixture({config:{language,requestedVoice:'marin'}});
 try{
  for(const [index,providerVoice] of [[0,'marin'],[1,'cedar']]){
   const providerId=`live-connection-${index}`,receipt=f.receipt(providerId),{ws,messages}=await f.connect();
   ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
   await until(()=>messages.some(e=>e.event?.type==='origen.provider.voice'));
   const pending=messages.find(e=>e.event?.type==='origen.provider.voice').event;
   assert.equal(pending.status,'pending');assert.equal(pending.providerVoice,null);assert.equal(pending.requestedVoice,'marin');assert.equal(pending.providerSessionId,providerId);
   assert.ok(messages.some(e=>e.type==='ready'),'control readiness does not wait for voice confirmation');
   const provider=f.providers[index],probe=provider.sent.find(e=>e.type==='session.update'&&Object.keys(e.session).length===0);
   assert.ok(probe);assert.equal(provider.sent.filter(e=>e.type==='session.update').length,1);
   provider.emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:language==='en'?'Of course.':'Claro.'})));
   await until(()=>messages.some(e=>e.event?.type==='response.output_audio_transcript.delta'));
   provider.emit('message',Buffer.from(JSON.stringify({type:'session.updated',event_id:'provider-confirmed',client_event_id:probe.event_id,session:{id:providerId,model:'gpt-live-1',audio:{output:{voice:providerVoice}},instructions:'PRIVATE',client_secret:'SECRET'}})));
   await until(()=>messages.some(e=>e.event?.type==='origen.provider.voice'&&e.event.providerVoice));
   const result=capturePayload(messages.find(e=>e.event?.type==='origen.provider.voice'&&e.event.providerVoice).event);
   assert.equal(result.status,index?'mismatch':'confirmed');assert.equal(result.providerVoice,providerVoice);assert.equal(result.source,'session.updated');
   assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET/);
   assert.ok(!messages.some(e=>e.event?.type==='session.updated'),'diagnostic ACK cannot complete an application configuration update');
   ws.close();await once(ws,'close');
  }
 }finally{await f.close();}
});
test('overlapping callback batches keep their own lease and resume only after all results',async()=>{
 const f=fixture();try{
  f.call([tool('propose_profile','first')],'r1');await until(()=>f.events.some(e=>e.controlLease));
  f.call([tool('propose_profile','second')],'r2');await until(()=>f.events.filter(e=>e.controlLease).length===2);
  const events=f.events.filter(e=>e.controlLease);
  for(const event of events){const call=event.response.output[0];assert.equal(f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:'{}'}},event.controlLease),true);assert.equal(f.engine.command({type:'response.create'},event.controlLease),true);await pause(0);}
  assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 }finally{f.engine.close();}
});
test('language callback completes before server research in the same batch',async()=>{
 const f=fixture({config:{tools:[...config.tools,{name:'set_conversation_language'}]}});try{
  f.call([tool('lookup_financial_aid','research',{question:'Costos oficiales',institution:'Berkeley'}),tool('set_conversation_language','language',{language:'es'})]);
  await until(()=>f.events.some(e=>e.controlLease));assert.equal(f.jobs.length,0);
  const event=f.events.find(e=>e.controlLease);await f.engine.configure({...config,language:'es'},{sessionId:'physical-call',studentId:'aiden',confirmed:true},'language-update');
  f.engine.command({type:'conversation.item.create',item:{type:'function_call_output',call_id:'language',output:'{"status":"language_updated"}'}},event.controlLease);f.engine.command({type:'response.create'},event.controlLease);
  await until(()=>f.jobs.length);assert.equal(f.jobs[0].body.language,'es');
 }finally{f.engine.close();}
});
test('malformed authenticated control messages fail closed',async()=>{
 const f=await transportFixture();try{const {ws}=await f.connect();ws.send('null');const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(f.providers.length,0);}finally{await f.close();}
});
test('simultaneous claims cannot acquire two native writers',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),first=await f.connect(),second=await f.connect();
  for(const client of [first,second])client.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
  await until(()=>[first,second].some(client=>client.messages.some(m=>m.type==='ready')));await pause(20);assert.equal(f.providers.length,1);
  first.ws.close();second.ws.close();
 }finally{await f.close();}
});
test('guide updates are account/call bound, language-only changes use server policy',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt();assert.throws(()=>f.control.stage(receipt.id,'other',config,{sessionId:'call'}));assert.throws(()=>f.control.stage(receipt.id,'owner',config,{sessionId:'different'}));
  const {ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(m=>m.type==='ready'));
  const {voiceLanguageInstructions}=await import('../src/voiceLanguage.mjs');
  ws.send(JSON.stringify({type:'event',event:{type:'session.update',event_id:'spanish',session:{controlLanguage:'es',instructions:voiceLanguageInstructions(config.instructions,'es')}}}));
  await until(()=>f.providers[0].sent.some(e=>e.type==='session.update'&&e.event_id==='spanish'));const update=f.providers[0].sent.find(e=>e.type==='session.update'&&e.event_id==='spanish');assert.match(update.session.delegation.responses.instructions,/Spanish/);
  ws.send(JSON.stringify({type:'event',event:{type:'session.update',session:{controlLanguage:'es',instructions:'invented policy',tools:[]}}}));await once(ws,'close');
 }finally{await f.close();}
});
for(const language of ['en','es'])test(`server polls worker and injects acknowledged evidence quietly (${language})`,async()=>{
 let reads=0;const f=fixture({config:{language},jobRequest:async(method,id,body)=>method==='POST'?{id:'job-1',status:'queued'}:method==='GET'?(reads++,{id,status:'completed',result:{text:'Verified published estimate; not a personal aid award.',sources:[{url:'https://example.edu/costs',title:'Published costs'}]}}):{id,status:'cancelled'}});
 try{f.call([tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Berkeley'})]);await until(()=>reads>0);
  await until(()=>f.sent.some(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'));
  const evidence=f.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence');
  assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.match(evidence.map(e=>JSON.parse(e.content).text).join(''),/not a personal aid award/);
  for(const e of evidence)f.engine.receive({type:'session.thinking.appended',client_event_id:e.event_id});
  await until(()=>f.events.some(e=>e.type==='origen.research.context_acknowledged'));assert.ok(f.events.some(e=>e.type==='origen.control.tool_result'));
 }finally{f.engine.close();}
});
test('browser facade and sideband owner complete a mixed tool batch over a real WebSocket',async()=>{
 const jobs=[],events=[],primaryWrites=[];
 const f=await transportFixture({request:async(token,method,path,body)=>{jobs.push({token,method,path,body});return method==='POST'?{id:'job-1',status:'queued'}:{status:'running'};}});
 const raw={readyState:'connecting',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1});
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 channel.onmessage=event=>{const e=JSON.parse(event.data);events.push(e);if(e.controlLease){
  for(const item of e.response.output)channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:'{"status":"draft"}'}}));
  channel.send(JSON.stringify({type:'response.create'}));
 }};
 try{const receipt=f.receipt();await channel.configure({voiceControl:receipt},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});raw.readyState='open';raw.onopen({});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  native({type:'response.created',response:{id:'r'}});
  for(const item of [tool('lookup_financial_aid','lookup',{question:'Cost?',institution:'Berkeley'}),tool('propose_profile','draft')])native({type:'response.output_item.done',response_id:'r',item});
  native({type:'response.completed',response:{id:'r'}});
  await until(()=>provider.sent.some(e=>e.type==='response.create'));
  assert.equal(provider.sent.filter(e=>e.type==='response.item.create').length,2);assert.equal(provider.sent.filter(e=>e.type==='response.create').length,1);
  assert.equal(jobs[0].token,'owner');assert.equal(jobs[0].body.studentId,'aiden');assert.equal(primaryWrites.length,0);
  assert.ok(events.some(e=>e.type==='origen.control.tool_result'));assert.deepEqual(events.find(e=>e.controlLease).response.output.map(i=>i.name),['propose_profile']);
 }finally{channel.close();await f.close();}
});
test('another account cannot claim a control ID or open a provider sideband',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),{ws}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id}));const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(f.providers.length,0);}finally{await f.close();}
});
test('browser disconnect closes provider with no replay or second owner',async()=>{
 const f=await transportFixture();try{const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));ws.close();await once(ws,'close');await until(()=>f.providers[0].readyState===WebSocket.CLOSED);
  const next=await f.connect();next.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await once(next.ws,'close');assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('overlapping quiet-boundary RPCs share the observation without closing the call',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  for(const id of ['wait-one','wait-two'])ws.send(JSON.stringify({type:'rpc',method:'settle',id}));
  await pause(25);assert.equal(ws.readyState,WebSocket.OPEN);assert.equal(messages.filter(e=>e.type==='reply').length,0);
  ws.send(JSON.stringify({type:'playback',idle:true,version:1}));
  await until(()=>messages.filter(e=>e.type==='reply').length===2);
  assert.deepEqual(messages.filter(e=>e.type==='reply').map(e=>[e.id,e.value]),[['wait-one',true],['wait-two',true]]);
  assert.equal(f.providers.length,1);assert.ok(!f.logs.some(e=>e.event==='voice.control.closed'));
 }finally{await f.close();}
});

test('abnormal transport loss resumes the same provider and research after fresh owner verification',async()=>{
 const jobs=[],f=await transportFixture({request:async(token,method,path,body)=>{jobs.push({method,body});return method==='POST'?{id:'retained-job',status:'queued'}:{status:'running'};}});
 try{
  const receipt=f.receipt(),first=await f.connect();first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  for(const event of [{type:'response.created',response:{id:'lookup'}},{type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Example'})},{type:'response.completed',response:{id:'lookup'}}])native(event);
  await until(()=>jobs.some(j=>j.method==='POST'));first.ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  assert.equal(provider.readyState,WebSocket.OPEN);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  provider.emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'Continuing the same conversation.'})));
  const wrong=await f.connect();wrong.ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id}));assert.equal((await once(wrong.ws,'close'))[0],1008);
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>resumed.messages.some(e=>e.type==='ready'));
  assert.equal(resumed.messages[0].resumed,true);await until(()=>resumed.messages.some(e=>e.event?.type==='response.output_audio_transcript.delta'));
  assert.equal(f.providers.length,1);assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  assert.equal(provider.sent.filter(e=>e.type==='session.close').length,0);
  resumed.ws.send(JSON.stringify({type:'playback',idle:true,version:1}));resumed.ws.send(JSON.stringify({type:'rpc',method:'settle',id:'resumed-wait'}));
  await until(()=>resumed.messages.some(e=>e.type==='reply'&&e.id==='resumed-wait'),3000);
 }finally{await f.close();}
});

test('resume grace expires without keeping the provider or worker alive indefinitely',async()=>{
 const f=await transportFixture({resumeGraceMs:50});try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.reason==='resume_timeout'));
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);assert.ok(f.providers[0].sent.some(e=>e.type==='session.close'));
  const late=await f.connect();late.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(late.ws,'close'))[0],1008);assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('detached event overflow closes safely instead of resuming an incomplete buffered stream',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  for(let i=0;i<270;i++)f.providers[0].emit('message',Buffer.from(JSON.stringify({type:'session.output_transcript.delta',delta:'word '})));
  await until(()=>f.logs.some(e=>e.reason==='resume_buffer_exceeded'));
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
 }finally{await f.close();}
});

test('explicit close ends the session immediately instead of starting transport grace',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.send(JSON.stringify({type:'close'}));assert.equal((await once(ws,'close'))[0],1000);
  assert.equal(f.providers[0].readyState,WebSocket.CLOSED);assert.ok(!f.logs.some(e=>e.event==='voice.control.detached'));
 }finally{await f.close();}
});

test('revoked permission cannot reattach during transport grace',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));f.revoke();
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
  await until(()=>f.providers[0].readyState===WebSocket.CLOSED,1500);assert.ok(f.logs.some(e=>e.reason==='permission_changed'));
 }finally{await f.close();}
});

test('verified resume retries a still-attached socket without taking over its writer',async()=>{
 const f=await transportFixture();try{
  const receipt=f.receipt(),first=await f.connect();first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  const early=await f.connect();early.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));
  const [code,reason]=await once(early.ws,'close');assert.equal(code,1013);assert.equal(reason.toString(),'control_still_attached');
  assert.equal(first.ws.readyState,WebSocket.OPEN);assert.equal(f.providers.length,1);
  const wrong=await f.connect();wrong.ws.send(JSON.stringify({type:'authenticate',token:'other',id:receipt.id,resume:true}));assert.equal((await once(wrong.ws,'close'))[0],1008);
  first.ws.terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));await until(()=>resumed.messages.some(e=>e.type==='ready'&&e.resumed));
  assert.equal(f.providers.length,1);assert.ok(!f.providers[0].sent.some(e=>e.type==='session.close'));
 }finally{await f.close();}
});

test('protocol heartbeat detects a half-open client and preserves its provider for resume',async()=>{
 const f=await transportFixture({heartbeatIntervalMs:30});try{
  const receipt=f.receipt(),first=await f.connect('http://allowed.test',{autoPong:false});let pings=0;first.ws.on('ping',()=>pings++);
  first.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>first.messages.some(e=>e.type==='ready'));
  assert.equal((await once(first.ws,'close'))[0],1006);assert.equal(pings,2);
  await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));assert.equal(f.providers[0].readyState,WebSocket.OPEN);
  const resumed=await f.connect();resumed.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id,resume:true}));await until(()=>resumed.messages.some(e=>e.type==='ready'&&e.resumed));
  await pause(150);assert.equal(resumed.ws.readyState,WebSocket.OPEN,'responsive pongs keep a healthy transport open');assert.equal(f.providers.length,1);
 }finally{await f.close();}
});

test('browser automatically resumes a real control socket and receives retained research once',async()=>{
 const jobs=[],events=[],sockets=[];let finishResearch,opens=0;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},request:async(token,method)=>{
  jobs.push(method);if(method==='POST')return {id:'persistent-job',status:'queued'};
  if(method==='GET')return new Promise(resolve=>{finishResearch=resolve;});return {status:'cancelled'};
 }});
 const primaryWrites=[],raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>1});channel.onopen=()=>opens++;channel.onmessage=e=>events.push(JSON.parse(e.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});sockets.push(this);}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify({type:'response.event',delegation_id:'delegation',event})));
  for(const event of [{type:'response.created',response:{id:'lookup'}},{type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published cost',institution:'Example'})},{type:'response.completed',response:{id:'lookup'}}])native(event);
  await until(()=>finishResearch,1500);sockets[0].terminate();await until(()=>f.logs.some(e=>e.event==='voice.control.detached'));
  finishResearch({status:'completed',result:{text:'Verified published cost [1].',sources:[{url:'https://example.edu/costs'}]}});
  await until(()=>f.logs.some(e=>e.event==='voice.control.resumed'),2000);
  await until(()=>events.some(e=>e.type==='origen.research.result'&&e.status==='completed'));
  assert.equal(events.filter(e=>e.type==='origen.research.result'&&e.status==='completed').length,1);
  assert.equal(jobs.filter(m=>m==='POST').length,1);assert.equal(jobs.filter(m=>m==='DELETE').length,0);
  assert.equal(opens,1);assert.equal(f.providers.length,1);assert.equal(primaryWrites.length,0);assert.equal(raw.readyState,'open');
  channel.close();await until(()=>provider.readyState===WebSocket.CLOSED);
 }finally{channel.close();await f.close();}
});

test('policy rejection records its actual safe reason and is never resumable',async()=>{
 const {diagnosticRecord}=await import('./diagnostics.mjs');const f=await transportFixture();try{
  const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));await until(()=>messages.some(e=>e.type==='ready'));
  ws.send(JSON.stringify({type:'event',event:{type:'untrusted-command',secret:'never log this'}}));assert.equal((await once(ws,'close'))[0],1008);
  await until(()=>f.logs.some(e=>e.event==='voice.control.closed'));
  const record=diagnosticRecord(f.logs.find(e=>e.event==='voice.control.closed'));
  assert.equal(record.reason,'invalid_command');assert.doesNotMatch(JSON.stringify(record),/never log this/);
  const reconnect=await f.connect();reconnect.ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));assert.equal((await once(reconnect.ws,'close'))[0],1008);
 }finally{await f.close();}
});

test('delivery v2 retains both completed reports for a comparison, fenced by revision and student',async()=>{
 let posts=0;const full=id=>`Detailed verified report for ${id}.`,tools=[...config.tools,{name:'read_research_details'}];
 const f=fixture({researchDeliveryV2:true,config:{tools},jobRequest:async(method,id)=>method==='POST'?{id:'job-'+(++posts),status:'queued'}:method==='GET'?{status:'completed',result:{text:full(id),sources:[]}}:{status:'cancelled'}});
 try{
  for(const [index,institution] of [[1,'Berkeley'],[2,'Davis']]){
   f.call([tool('lookup_financial_aid','lookup-'+index,{question:'Published cost at '+institution,institution})],'response-'+index);
   await until(()=>f.events.filter(e=>e.type==='origen.research.result').length===index);
  }
  for(const index of [1,2]){
   f.call([tool('read_research_details','details-'+index,{jobId:'job-'+index,revision:1})],'read-'+index);
   await until(()=>f.sent.some(e=>e.item?.call_id==='details-'+index));
   assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='details-'+index).item.output).text,full('job-'+index));
  }
  assert.equal(posts,2,'a comparison must not launch new research');
  f.call([tool('read_research_details','stale',{jobId:'job-1',revision:2})],'stale');await until(()=>f.sent.some(e=>e.item?.call_id==='stale'));
  const unavailable=JSON.parse(f.sent.find(e=>e.item?.call_id==='stale').item.output);
  assert.equal(unavailable.status,'research_details_unavailable');assert.equal(unavailable.availableReports.length,2);
  await f.engine.configure({...config,tools},{sessionId:'physical-call',studentId:'other',confirmed:true},'scope');
  f.call([tool('read_research_details','cross-scope',{jobId:'job-1',revision:1})],'cross-scope');await until(()=>f.sent.some(e=>e.item?.call_id==='cross-scope'));
  assert.deepEqual(JSON.parse(f.sent.find(e=>e.item?.call_id==='cross-scope').item.output).availableReports,[]);
 }finally{f.engine.close();}
});

for(const language of ['en','es'])test(`delivery v2 crosses the real browser control socket without cutting into speech (${language})`,async()=>{
 const answer=language==='en'?'The published annual tuition is 12345 dollars at Example University.':'La matrícula anual publicada es de 12345 dólares en la Universidad Ejemplo.';
 const qualification=language==='en'?'Housing is separate.':'La vivienda es aparte.';
 const events=[],jobs=[],primaryWrites=[];let idle=false,sound=0;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},config:{language},request:async(token,method,path,body)=>{
  jobs.push({method,body});return method==='POST'?{id:'job-delivery',status:'queued'}:method==='GET'?{status:'completed',result:{text:answer+'\n'+qualification,sources:[]}}:{status:'cancelled'};
 }});
 const raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>idle,getPlaybackVersion:()=>sound});
 channel.onmessage=event=>events.push(JSON.parse(event.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=event=>provider.emit('message',Buffer.from(JSON.stringify(event)));
  const backend=event=>native({type:'response.event',delegation_id:'delegation',event});
  native({type:'session.input_transcript.delta',delta:language==='en'?'Can we discuss essays while you check?':'¿Podemos hablar de los ensayos mientras investigas?'});
  backend({type:'response.created',response:{id:'lookup'}});
  backend({type:'response.output_item.done',response_id:'lookup',item:tool('lookup_financial_aid','lookup',{question:'Published tuition',institution:'Example'})});
  backend({type:'response.completed',response:{id:'lookup'}});
  await until(()=>events.some(e=>e.type==='origen.research.supplied'));
  for(const e of provider.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'))native({type:'session.thinking.appended',client_event_id:e.event_id});
  await until(()=>events.some(e=>e.type==='origen.research.context_acknowledged'));
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0);
  await pause(450); // Caller transcript has settled; playback is still busy.
  native({type:'session.output_transcript.delta',delta:language==='en'?'We can start with the story you want to share.':'Podemos empezar con la historia que quieres compartir.'});sound++;
  await pause(1900);assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0,'no commentary while audio is playing');
  idle=true;await until(()=>provider.sent.some(e=>e.type==='session.commentary.append'),6000);
  const contribution=provider.sent.find(e=>e.type==='session.commentary.append');native({type:'session.commentary.appended',client_event_id:contribution.event_id});
  await until(()=>events.some(e=>e.deliveryStage==='commentary_acknowledged'));
  assert.ok(!events.some(e=>e.deliveryStage==='evidence_overlap_observed'),'acknowledgment is not evidence of speech');
  idle=false;native({type:'session.output_transcript.delta',delta:answer+' '+qualification});sound++;
  await pause(1900);idle=true;await until(()=>events.some(e=>e.deliveryStage==='evidence_overlap_observed'),3000);
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs[0].body.language,language);
  assert.equal(primaryWrites.length,0);assert.ok(!provider.sent.some(e=>['response.cancel','session.input_audio.mute','session.instructions.append'].includes(e.type)));
  assert.ok(f.logs.some(e=>e.deliveryStage==='reply_observed'));assert.equal(f.logs.filter(e=>e.event==='voice.research.delivery'&&e.deliveryStage==='commentary_requested').length,1);assert.ok(!JSON.stringify(f.logs).includes('12345'));
 }finally{channel.close();await f.close();}
});

for(const [language,{answer,spoken}] of Object.entries(discussionExamples))test(`${language}: covered clarification keeps one worker job and its native paraphrase is not announced again over the control socket`,async()=>{
 const events=[],jobs=[],primaryWrites=[];let idle=false,sound=0,complete=false;
 const f=await transportFixture({env:{ORIGEN_RESEARCH_DELIVERY_V2:'true'},config:{language},request:async(token,method,path,body)=>{
  jobs.push({method,body});return method==='POST'?{id:'job-original',status:'queued'}:method==='GET'?{status:complete?'completed':'running',...(complete?{result:{text:answer,sources:[]}}:{})}:{status:'cancelled'};
 }});
 const raw={readyState:'open',send:text=>primaryWrites.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>idle,getPlaybackVersion:()=>sound});channel.onmessage=e=>events.push(JSON.parse(e.data));
 class BrowserSocket extends WebSocket{constructor(url){super(url,{origin:'http://allowed.test'});}}
 try{
  await channel.configure({voiceControl:f.receipt()},{token:'owner',url:f.base,WebSocketClass:BrowserSocket});
  const provider=f.providers[0],native=e=>provider.emit('message',Buffer.from(JSON.stringify(e)));
  const lookup=(callId,args)=>{for(const event of [{type:'response.created',response:{id:callId}},{type:'response.output_item.done',response_id:callId,item:tool('lookup_financial_aid',callId,args)},{type:'response.completed',response:{id:callId}}])native({type:'response.event',delegation_id:'delegation-'+callId,event});};
  const question=language==='en'?'Berkeley 2026–27 budgets comparing living on campus, off campus and with parents.':'Presupuestos de Berkeley 2026–27 dentro del campus, fuera del campus y con padres.';
  lookup('initial',{question,institution:'Berkeley'});
  await until(()=>provider.sent.some(e=>e.item?.call_id==='initial'));
  native({type:'session.input_transcript.delta',delta:language==='en'?'He is considering near campus, not on campus, compared with home.':'Quiere comparar vivir cerca del campus, no dentro, con vivir en casa.'});
  lookup('focus',{question:language==='en'?'Compare near-campus living and home.':'Compara vivir cerca del campus y en casa.',institution:'Berkeley',replaceRequestId:'initial',replaceRevision:1,replacementChange:{kind:'focus_existing',uncoveredNeed:''}});
  await until(()=>provider.sent.some(e=>e.item?.call_id==='focus'));
  const receipt=JSON.parse(provider.sent.find(e=>e.item?.call_id==='focus').item.output);
  assert.equal(receipt.jobId,'job-original');assert.equal(receipt.revision,1);assert.equal(receipt.reuseReason,'already_covered');assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  complete=true;await until(()=>events.some(e=>e.type==='origen.research.supplied'));
  await until(()=>events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
  // Native conversation starts using the finding before the estimated context
  // injection ACK, just as it did in the reported production session.
  native({type:'session.output_transcript.delta',delta:spoken});sound++;
  for(const e of provider.sent.filter(e=>e.type==='session.thinking.append'&&JSON.parse(e.content).kind==='untrusted-research-evidence'))native({type:'session.thinking.appended',client_event_id:e.event_id});
  await pause(1900);idle=true;
  await until(()=>events.some(e=>e.deliveryStage==='evidence_overlap_observed'),3000);
  native({type:'session.input_transcript.delta',delta:language==='en'?'Yes, that was very informative.':'Sí, eso me ayuda mucho.'});
  await pause(500);idle=false;native({type:'session.output_transcript.delta',delta:language==='en'?'Mm-hmm.':'Claro.'});sound++;
  await pause(1900);idle=true;await pause(4000);
  assert.equal(provider.sent.filter(e=>e.type==='session.commentary.append').length,0,'no redundant result or caveat after the acknowledgment');
  assert.equal(provider.sent.filter(e=>e.type==='response.create').length,2,'one continuation per actual tool batch, none for delivery');
  assert.equal(jobs.filter(j=>j.method==='POST').length,1);assert.equal(jobs.filter(j=>j.method==='DELETE').length,0);
  assert.equal(primaryWrites.length,0,'no browser provider writes during research or speech');
  assert.ok(!provider.sent.some(e=>['response.cancel','session.input_audio.mute','session.instructions.append'].includes(e.type)));
 }finally{channel.close();await f.close();}
});

for(const enabled of [false,true])test('authenticated socket selects production Decisions factory only when enabled: '+enabled,async()=>{
 const received=[];const f=await transportFixture({env:{NODE_ENV:'production',ORIGEN_DECISIONS_SUPPORT:String(enabled)},productionSessionFactory:options=>{received.push(options);return voiceControlSession(options);}});
 try{const receipt=f.receipt(),{ws,messages}=await f.connect();ws.send(JSON.stringify({type:'authenticate',token:'owner',id:receipt.id}));
 await until(()=>messages.some(row=>row.type==='ready'));assert.equal(received.length,enabled?1:0);
 if(enabled){assert.equal(received[0].subject,'owner');assert.equal(received[0].scope.studentId,'aiden');assert.equal(received[0].config.instructions,config.instructions);}
 assert.equal(f.providers[0].sent.filter(row=>['session.instructions.append','session.commentary.append'].includes(row.type)).length,0);
 }finally{await f.close();}
});
