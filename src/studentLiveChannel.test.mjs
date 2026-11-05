import test from 'node:test';
import assert from 'node:assert/strict';
import {studentLiveChannel,liveBackendDeadlineMs} from './studentLiveChannel.mjs';
import {voiceProfileSaveConsent} from './voiceProfileSave.mjs';
import {voiceHandoff,deferredVoiceHandoff} from './voiceHandoff.mjs';
import {capturePayload} from './voiceCapture.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));


test('private diagnostics preserve request state without copying the question',()=>{
 const payload=capturePayload({type:'origen.research.state_changed',requestId:'r',jobId:'j',state:'running',question:'PRIVATE'});
 assert.equal(payload.state,'running');assert.equal(payload.jobId,'j');assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
});
for(const language of ['en','es'])test(`${language}: selection keeps speech flowing and confirms only after voice context and backend acknowledgments`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Initial backend',tools:[]}});
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'What would you like':'¿Qué te gustaría'});await pause(0);
 const context={scope:{confirmed:true,studentId:'aiden'},openingBrief:{profile:{name:'Aiden',school:'SAVED_SCHOOL'},records:[{content:'A useful qualified note. '.repeat(40)}]}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'selected',session:{language,instructions:'Authorized Aiden backend',tools:[],liveInstructions:'Use the newest confirmed scope. Continue the current conversation.',liveContext:context}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append'),directions=f.sent.filter(e=>e.type==='session.instructions.append');
 assert.ok(packets.length>1);assert.equal(directions.length,1);
 assert.ok(!directions[0].content.includes('SAVED_SCHOOL'));
 assert.deepEqual(JSON.parse(packets.map(e=>JSON.parse(e.content).text).join('')),context);
 assert.ok(!f.sent.some(e=>['response.cancel','session.commentary.append','output_audio_buffer.clear'].includes(e.type)));
 f.receive({type:'session.updated',client_event_id:'selected'});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'),'backend ready is not voice context delivery');
 for(const packet of [...packets,directions[0]].slice(0,-1))f.receive({type:packet.type+'ed',client_event_id:packet.event_id});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?' to focus on?':' conversar?'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'His college options.':'Sus opciones universitarias.'});await pause(0);
 clock.advance(200);
 f.receive({type:'session.instructions.appended',client_event_id:directions[0].event_id});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').length,1);
 const timing=f.events.find(e=>e.type==='origen.configuration.applied');assert.equal(timing.contextPacketCount,packets.length);assert.equal(timing.instructionPacketCount,1);assert.equal(timing.durationMs,200);
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'),'configuration is not a second speaking cue');
 f.channel.close();
});
test('failed selection context reports the configuration failure and cannot later confirm scope',async()=>{
 const f=fixture({autoAcknowledge:false});
 f.channel.send(JSON.stringify({type:'session.update',event_id:'scope',session:{instructions:'New backend',tools:[],liveContext:{scope:{studentId:'aiden'}}}}));
 const packet=f.sent.find(e=>e.type==='session.thinking.append');
 f.receive({type:'error',error:{code:'context_rejected',client_event_id:packet.event_id}});await pause(0);
 f.receive({type:'session.updated',client_event_id:'scope'});f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.ok(f.events.some(e=>e.type==='error'&&e.error.event_id==='scope'));
 assert.ok(!f.events.some(e=>e.type==='session.updated'));f.channel.close();
});
test('missing selection acknowledgment expires, permits a fresh update and rejects late acknowledgments',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false,researchDeliveryV2:true});
 const session={instructions:'Same backend',tools:[],liveContext:{scope:{studentId:'aiden'}}};
 f.channel.send(JSON.stringify({type:'session.update',event_id:'expired',session}));
 const oldPacket=f.sent.find(e=>e.type==='session.thinking.append');
 f.receive({type:'session.updated',client_event_id:'expired'});await pause(0);clock.advance(10000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='error'&&e.error.event_id==='expired'&&e.error.code==='configuration_context_timeout'));
 f.channel.send(JSON.stringify({type:'session.update',event_id:'fresh',session}));
 f.receive({type:'session.thinking.appended',client_event_id:oldPacket.event_id});
 f.receive({type:'session.updated',client_event_id:'expired',session:{delegation:{responses:{instructions:'Same backend'}}}});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'));
 const packet=f.sent.filter(e=>e.type==='session.thinking.append').at(-1);
 f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});await pause(0);
 assert.ok(!f.events.some(e=>e.type==='session.updated'),'old backend acknowledgment cannot complete fresh retry');
 f.receive({type:'session.updated',client_event_id:'fresh'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').length,1);f.channel.close();
});
test('late older context acknowledgments never restore a superseded configuration',async()=>{
 const f=fixture({autoAcknowledge:false});
 for(const studentId of ['aiden','elodie'])f.channel.send(JSON.stringify({type:'session.update',event_id:studentId,session:{instructions:studentId,tools:[],liveContext:{scope:{studentId}}}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append');
 for(const eventId of ['elodie','aiden']){
  f.receive({type:'session.updated',client_event_id:eventId});
  for(const packet of packets.filter(p=>JSON.parse(p.content).resultId===eventId))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
  await pause(0);
 }
 assert.deepEqual(f.events.filter(e=>e.type==='session.updated').map(e=>e.session.instructions),['elodie']);f.channel.close();
});
test('same-scope language change does not resend the student brief or unchanged direction',async()=>{
 const f=fixture();const same={liveInstructions:'Confirmed scope; continue.',liveContext:{scope:{studentId:'aiden'}}};
 f.channel.configure({voiceProvider:'live',voiceSession:{...same,language:'en',instructions:'Backend',tools:[]}});
 f.channel.send(JSON.stringify({type:'session.update',event_id:'language',session:{...same,language:'es',instructions:'Backend in Spanish',tools:[]}}));await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.thinking.append').length,0);
 assert.equal(f.sent.filter(e=>e.type==='session.instructions.append').length,1);
 assert.match(f.sent.find(e=>e.type==='session.instructions.append').content,/Respond in Spanish/);f.channel.close();
});
for(const language of ['en','es'])test(`${language}: speech before a target proposal triggers one reevaluation without asking for the name again`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Scope must be confirmed',tools:[{name:'request_conversation_target'}]}});
 f.receive({type:'session.input_transcript.delta',delta:'Aiden'});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','selecting');await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'What would you like help with?':'¿Con qué te gustaría recibir ayuda?'});await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'His college options.':'Sus opciones universitarias.'});await pause(0);clock.advance(1100);await pause(0);
 const proposal={type:'function_call',name:'request_conversation_target',call_id:'old-selection',arguments:'{"scope":"student:aiden"}'};
 f.backend('response.output_item.done','selecting',{item:proposal});f.backend('response.completed','selecting');await pause(0);
 assert.ok(!f.events.some(e=>e.response?.output?.some(i=>i.call_id==='old-selection')),'stale selection may be a correction: re-evaluate safely');
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.match(JSON.parse(f.sent.find(e=>e.item?.call_id==='old-selection').item.output).instruction,/do not ask them to repeat/);
 f.backend('response.created','current');await pause(0);
 f.backend('response.output_item.done','current',{item:{...proposal,call_id:'current-selection'}});f.backend('response.completed','current');await pause(0);
 assert.ok(f.events.some(e=>e.response?.output?.some(i=>i.call_id==='current-selection')));
 assert.ok(!f.sent.some(e=>['session.commentary.append','session.instructions.append','response.cancel'].includes(e.type)));f.channel.close();
});
for(const language of ['en','es'])test(`${language}: delivery v2 waits through an ordinary reply and then introduces completed research once`,async()=>{
 const clock=fakeClock();let audible=0;
 const f=fixture({...clock,researchDeliveryV2:true,getPlaybackVersion:()=>audible});
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Can we discuss essays?':'¿Podemos hablar de los ensayos?'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',requestId:'request',revision:1,question:'Costs',result:{text:'The verified annual tuition is 12345 dollars.\nHousing is separate.'}}));
 clock.advance(1100);await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'We can start with the story you want to share.':'Podemos empezar con la historia que quieres compartir.'});await pause(0);audible++;
 clock.advance(1800);await pause(0);clock.advance(1000);await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.ok(f.events.some(e=>e.deliveryStage==='reply_observed'));
 assert.ok(!f.events.some(e=>e.deliveryStage==='evidence_overlap_observed'));
 clock.advance(10000);await pause(0);assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.ok(!f.sent.some(e=>['response.cancel','response.create','session.instructions.append'].includes(e.type)));f.channel.close();
});
test('delivery v2 survives a same-scope language update but waits for its acknowledgment',async()=>{
 const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'job',question:'Costs',result:{text:'The verified annual tuition is 12345 dollars.'}}));await pause(0);
 f.channel.send(JSON.stringify({type:'session.update',event_id:'language',session:{instructions:'Current conversation language: Spanish',tools:[]}}));
 clock.advance(5000);await pause(0);assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,0);
 f.receive({type:'session.updated',client_event_id:'language'});await pause(0);clock.advance(1000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
for(const text of ['How much does it cost to go to UC Santa Cruz?','How much is that?','What does residency mean?','Okay.','Yes.','¿Cuánto cuesta ir a UC Santa Cruz?','¿Cuánto es?','¿Qué significa residencia?','Gracias.'])test('native conversation has no keyword or silence-triggered second decision: '+text,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);clock.advance(30000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'&&e.transcript===text));
 assert.ok(!f.sent.some(e=>['response.create','session.commentary.append'].includes(e.type)));
 // Native requests remain executable, including affirmative workflow replies.
 f.backend('response.created','native');await pause(0);
 f.backend('response.output_item.done','native',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{"institution":"UC Santa Cruz","question":"Published costs"}'}});
 f.backend('response.completed','native');await pause(0);
 assert.equal(f.events.find(e=>e.type==='response.done').response.output[0].call_id,'lookup');f.channel.close();
});
test('active research does not generate repeated backend calls on conversational follow-ups',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{requestId:'r',jobId:'j',state:'running',question:'Santa Cruz costs'}}));
 for(const text of ['What does tuition residency mean?','Okay.','How much is that?']){
  f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);clock.advance(6000);await pause(0);
 }
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'));
 assert.equal(f.events.filter(e=>e.type==='origen.research.state_changed').length,1);f.channel.close();
});

for(const language of ['en','es'])test(`${language}: completed partial research replaces pending state without interrupting conversation or starting a lookup`,async()=>{
 const clock=fakeClock(),f=fixture({...clock,researchDeliveryV2:true});
 const request={requestId:'request',jobId:'job',revision:1,question:'Published cost of attendance with the requested scenario. '.repeat(25)};
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'running'}}));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'The budget is an estimate':'El presupuesto es una estimación'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'completed'}}));
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{...request,state:'completed',elapsedMs:90000}}));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 assert.equal(packets.length,2,'one compact state packet per change; elapsed time is not another update');
 const states=packets.map(p=>JSON.parse(p.text));
 assert.equal(states[0].researchPending,true);assert.equal(states[1].researchPending,false);
 assert.equal(states[1].state,'completed');assert.match(states[1].meaning,/No lookup is running/);
 const backend=f.sent.filter(e=>e.type==='response.item.create');
 assert.equal(backend.length,1,'the backend pending receipt receives the terminal update once');
 assert.equal(backend[0].item.role,'developer');assert.equal(backend[0].item.type,'message');
 assert.match(backend[0].item.content[0].text,/"requestId":"request".*"state":"completed".*"researchPending":false/);
 assert.ok(!backend[0].item.content[0].text.includes(request.question),'sourced/user text is never elevated into app instructions');
 f.receive({type:'session.output_transcript.delta',delta:'.'});await pause(0);clock.advance(2000);await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'What does a budget mean?':'¿Qué significa un presupuesto?'});await pause(0);clock.advance(1100);await pause(0);clock.advance(4000);await pause(0);
 assert.ok(!f.sent.some(e=>['response.create','response.cancel','session.instructions.append','session.commentary.append','output_audio_buffer.clear'].includes(e.type)));
 f.channel.close();
});
test('a superseded research result cannot be announced as the current answer',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.state',request:{requestId:'new',jobId:'new-job',state:'running'}}));
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'old-job',question:'Old costs',result:{status:'completed',answer:'OLD_FIGURE'}}));
 clock.advance(5000);await pause(0);
 assert.ok(!JSON.stringify(f.sent).includes('OLD_FIGURE'));assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});

for(const language of ['en','es'])test(`${language}: ordinary new speech preserves an authorized pending research call without flushing that speech`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'Check Berkeley costs.':'Consulta los costos de Berkeley.'});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','research');await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:language==='en'?'I feel overwhelmed':'Me siento abrumado'});await pause(0);
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{}'}});f.backend('response.completed','research');await pause(0);
 assert.ok(f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.call_id==='lookup')));
 assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').length,1,'do not prematurely flush a follow-up');
 assert.equal(f.events.find(e=>e.type==='response.done').response.metadata.origen_user_turn,'superseded-live-turn');
 assert.ok(!f.sent.some(e=>e.type==='response.create'||e.type==='session.commentary.append'));f.channel.close();
});
for(const barrier of ['cancel','configuration'])test(`${barrier}: an old read-only request cannot restart research`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.backend('response.created','research');await pause(0);
 if(barrier==='cancel')f.channel.send(JSON.stringify({type:'origen.research.cancel'}));
 else f.channel.send(JSON.stringify({type:'session.update',event_id:'new-scope',session:{instructions:'New scope',tools:[]}}));
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'old',arguments:'{}'}});f.backend('response.completed','research');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.call_id==='old')));f.channel.close();
});
test('a mixed stale tool batch preserves research but never a write or sharing approval',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'},{name:'save_next_step'},{name:'confirm_coordinator_review_request'}]}});
 f.backend('response.created','mixed');await pause(0);f.receive({type:'session.input_transcript.delta',delta:'Also, I am worried.'});await pause(0);
 for(const name of ['lookup_financial_aid','save_next_step','confirm_coordinator_review_request'])f.backend('response.output_item.done','mixed',{item:{type:'function_call',name,call_id:name,arguments:'{}'}});
 f.backend('response.completed','mixed');clock.advance(1100);await pause(0);
 assert.deepEqual(f.events.find(e=>e.type==='response.done').response.output.map(i=>i.name),['lookup_financial_aid']);
 assert.deepEqual(f.sent.filter(e=>e.type==='response.item.create').map(e=>e.item.call_id),['save_next_step','confirm_coordinator_review_request']);f.channel.close();
});
test('research commentary waits for every matching context acknowledgment and deduplicates the result',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});
 const event={type:'origen.research.ready',jobId:'job',question:'Costs',result:{text:'A fact with a necessary qualification. '.repeat(40)}};
 f.channel.send(JSON.stringify(event));f.channel.send(JSON.stringify(event));
 const packets=f.sent.filter(e=>e.type==='session.thinking.append');assert.ok(packets.length>1);
 clock.advance(3000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 f.receive({type:'session.thinking.appended',client_event_id:'unmatched'});
 for(const packet of packets.slice(0,-1))f.receive({type:'session.thinking.appended',client_event_id:packet.event_id});
 await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 f.receive({type:'session.thinking.appended',client_event_id:packets.at(-1).event_id});await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.equal(f.events.filter(e=>e.type==='origen.research.context_acknowledged').length,1);
 f.channel.send(JSON.stringify(event));clock.advance(3000);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
test('a rejected context update never triggers a result announcement',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified'}}));
 const packet=f.sent.find(e=>e.type==='session.thinking.append');f.receive({type:'error',error:{code:'context_rejected',client_event_id:packet.event_id}});await pause(0);clock.advance(10000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.ok(f.events.some(e=>e.type==='origen.research.context_failed'));f.channel.close();
});
test('missing context acknowledgments expire without treating supplied facts as heard speech',async()=>{
 const clock=fakeClock(),f=fixture({...clock,autoAcknowledge:false});f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified'}}));
 clock.advance(30000);await pause(0);
 assert.ok(f.events.some(e=>e.type==='origen.research.context_failed'&&e.reason==='acknowledgment_timeout'));
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));assert.ok(!f.events.some(e=>e.type==='origen.research.announced'));f.channel.close();
});
for(const language of ['en','es'])test(`${language}: Live can integrate delivered context without a second application speech request`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Costs',result:{text:'Verified budget; this is not an individual bill.'}}));
 await pause(0);f.receive({type:'session.output_transcript.delta',delta:language==='en'?'I found the published budget.':'Encontré el presupuesto publicado.'});await pause(0);
 clock.advance(10000);await pause(0);clock.advance(1000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 assert.ok(f.events.some(e=>e.type==='origen.research.native_reply_observed'));
 assert.ok(!f.events.some(e=>e.type==='origen.research.announced'),'native speech observed is not a claim of verified spoken delivery');f.channel.close();
});

for(const text of ['How much does UC Santa Cruz cost?','¿Cuánto cuesta ir a UC Santa Cruz?'])test('an empty native backend outcome produces one clarification, no automatic tool retry: '+text,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[{name:'lookup_financial_aid'}]}});
 f.receive({type:'session.input_transcript.delta',delta:text});await pause(0);clock.advance(1100);await pause(0);
 for(const id of ['empty','same-turn-empty']){f.backend('response.created',id);await pause(0);f.backend('response.completed',id);await pause(0);}
 assert.equal(f.events.filter(e=>e.type==='origen.backend.empty').length,1);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,/one short, concrete clarification/);
 assert.ok(!f.sent.some(e=>e.type==='response.create'),'no auto-retry of writes or research');f.channel.close();
});

test('a completed native tool continuation may be silent without another clarification',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[]}});
 f.channel.send(JSON.stringify({type:'response.create'}));
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'verified',output:'{"status":"research_pending","jobId":"job"}'}}));
 f.channel.send(JSON.stringify({type:'response.create'}));f.backend('response.created','continued');await pause(0);f.backend('response.completed','continued');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.backend.empty'));
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1,'opening only');f.channel.close();
});

test('a useful backend text answer does not trigger empty-result recovery',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',tools:[]}});
 f.backend('response.created','text');await pause(0);f.backend('response.output_item.done','text',{item:{type:'message',content:[{type:'output_text',text:'A useful explanation.'}]}});f.backend('response.completed','text');await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.backend.empty'));assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
test('a failed source check never announces verified findings or asks to share them',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',result:{status:'research_failed'},question:'Costs?'}));
 clock.advance(2000);await pause(0);
 const prompt=f.sent.find(e=>e.type==='session.commentary.append').content;
 assert.match(prompt,/source check failed/);assert.match(prompt,/no verified findings/);assert.doesNotMatch(prompt,/source check is ready|explain the verified finding/);f.channel.close();
});
for(const language of ['en','es'])test(`${language}: end call drains current audio before requesting a separate farewell`,async()=>{
 const clock=fakeClock();let idle=false;
 const f=fixture({...clock,isPlaybackIdle:()=>idle});let ready;
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'The housing budget':'El presupuesto de vivienda'});await pause(0);
 void f.channel.prepareClose().then(value=>ready=value);
 await pause(0);clock.advance(2000);await pause(0);
 assert.equal(ready,undefined);assert.ok(!f.events.some(e=>e.type==='response.done'));
 f.receive({type:'session.input_transcript.delta',delta:'No, give me a straight answer.'});await pause(0);
 f.receive({type:'session.output_transcript.delta',delta:'.'});await pause(0);idle=true;
 clock.advance(2000);await pause(0);clock.advance(100);await pause(0);
 assert.equal(ready,true);assert.ok(!f.events.some(e=>e.type==='conversation.item.input_audio_transcription.completed'));
 const previous=f.events.find(e=>e.type==='response.output_audio_transcript.done').response_id;
 f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'},instructions:'A warm goodbye only.'}}));
 f.receive({type:'session.output_transcript.delta',delta:language==='en'?'Take care!':'¡Hasta luego!'});await pause(0);
 clock.advance(3000);await pause(0);
 const goodbye=f.events.filter(e=>e.type==='response.output_audio_transcript.done').at(-1);
 assert.notEqual(goodbye.response_id,previous);assert.doesNotMatch(goodbye.transcript,/budget|presupuesto|straight answer/);
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));f.channel.close();
});
test('caller reference text is never injected as assistant thinking',()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'conversation.item.create',item:{role:'user',type:'message',content:[{text:'No, give me a straight answer.'}]}}));
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));assert.match(f.sent.find(e=>e.type==='session.instructions.append').content,/Caller reference data/);f.channel.close();
});

for(const status of ['target_confirmed','target_update_failed'])test(`scope continuation ${status} always completes the backend tool loop`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});
for(const barrier of ['pending-configuration','multiple-tools'])test(`scope continuation retains backend checks for ${barrier}`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 if(barrier==='multiple-tools')f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'recall_student_context',call_id:'memory',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 if(barrier==='pending-configuration')f.channel.send(JSON.stringify({type:'session.update',event_id:'pending',session:{instructions:'New scope',tools:[]}}));
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status:'target_confirmed'})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.channel.close();
});

test('closing drain has a bounded fallback without declaring unfinished audio complete',async()=>{
 const clock=fakeClock(),f=fixture({...clock,isPlaybackIdle:()=>false});let ready;
 f.receive({type:'session.output_transcript.delta',delta:'Unfinished explanation'});await pause(0);
 void f.channel.prepareClose().then(value=>ready=value);await pause(0);
 clock.advance(12000);await pause(0);
 assert.equal(ready,false);assert.ok(!f.events.some(e=>e.type==='output_audio_buffer.stopped'));
 assert.ok(f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('speech boundary')));f.channel.close();
});

test('student handoff is context to answer, never a thinking transcript',()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:voiceHandoff('What about Elodie?')}]}}));
 const handoff=f.sent.filter(e=>e.type==='session.instructions.append').map(e=>e.content).join('');
 assert.ok(handoff.includes('Pending caller question: '+JSON.stringify('What about Elodie?')));
 assert.ok(handoff.includes('listen until they finish, then answer it directly'));
 assert.ok(!f.sent.some(e=>e.type==='session.thinking.append'));f.channel.close();
});
test('background evidence waits for a quiet boundary before a natural continuation',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Cost?',result:{sources:[{url:'https://studentaid.gov'}],answer:'Verified'}}));
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 clock.advance(2000);await pause(0);
 assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
 assert.ok(f.sent.some(e=>e.type==='session.commentary.append'&&e.content.includes('If the topic has moved on')));
 assert.ok(!f.sent.some(e=>e.type==='response.cancel'));f.channel.close();
});

for(const [language,head,tail,question] of [
 ['en','And if it helps,',' we can start with that example.','What does the cost include?'],
 ['es','Y si te sirve,',' podemos empezar con ese ejemplo.','¿Qué incluye ese costo?'],
]){
 test(`${language}: research cannot splice into an unfinished sentence, even after a long pause`,async()=>{
  const clock=fakeClock();let idle=false;
  // Playback can continue long after transcript text has arrived.
  const g=fixture({...clock,isPlaybackIdle:()=>idle});
  g.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  g.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Cost?',result:{answer:'Verified'}}));
  clock.advance(5000);await pause(0);assert.ok(!g.sent.some(e=>e.type==='session.commentary.append'));
  idle=true;clock.advance(5000);await pause(0);clock.advance(5000);await pause(0);
  assert.ok(!g.sent.some(e=>e.type==='session.commentary.append'),'a quiet comma is not a completed thought');
  g.receive({type:'session.output_transcript.delta',delta:tail});await pause(0);
  clock.advance(1800);await pause(0);clock.advance(250);await pause(0);
  assert.equal(g.sent.filter(e=>e.type==='session.commentary.append').length,1);
  clock.advance(5000);await pause(0);assert.equal(g.sent.filter(e=>e.type==='session.commentary.append').length,1);
  assert.equal(g.events.filter(e=>e.type==='origen.research.announced').length,1);g.channel.close();
 });
 test(`${language}: a new caller turn receives evidence without a competing announcement`,async()=>{
  const clock=fakeClock(),f=fixture(clock);
  f.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'j',question:'Cost?',result:{answer:'Verified'}}));
  f.receive({type:'session.input_transcript.delta',delta:question});await pause(0);
  assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
  clock.advance(5000);await pause(0);
  assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
  assert.equal(f.events.filter(e=>e.type==='origen.research.supplied').length,1);f.channel.close();
 });
 test(`${language}: a student handoff waits for audible acknowledgment without closing or muting the call`,async()=>{
  const clock=fakeClock();let idle=false;
  const f=fixture({...clock,isPlaybackIdle:()=>idle});let result;
  f.receive({type:'session.output_transcript.delta',delta:language==='en'?"Let's talk about Elodie.":'Hablemos de Elodie.'});await pause(0);
  void f.channel.settle().then(value=>{result=value;});
  clock.advance(4000);await pause(0);assert.equal(result,undefined);
  assert.equal(f.raw.readyState,'open');assert.ok(!f.sent.some(e=>e.type==='session.input_audio.mute'));
  idle=true;clock.advance(250);await pause(0);clock.advance(100);await pause(0);
  assert.equal(result,true);f.channel.close();
 });
 test(`${language}: an interruption supersedes a pending student switch and retains the complete question`,async()=>{
  const clock=fakeClock(),f=fixture(clock);let result;
  f.receive({type:'session.output_transcript.delta',delta:head});await pause(0);
  const turn=f.consent.token();void f.channel.settle({isCurrent:()=>f.consent.token()===turn}).then(value=>{result=value;});
  f.receive({type:'session.input_transcript.delta',delta:question});await pause(0);
  clock.advance(1100);await pause(0);
  assert.equal(result,false);assert.equal(f.raw.readyState,'open');
  assert.equal(f.events.find(e=>e.type==='conversation.item.input_audio_transcription.completed').transcript,question);
  assert.ok(!f.sent.some(e=>e.type==='session.close'));f.channel.close();
 });
}

for(const question of ['What matters most to you?','¿Qué es lo más importante para ti?'])test(`research leaves room for an answer without indefinitely stranding the finding: ${question}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.output_transcript.delta',delta:question});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 clock.advance(2000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 clock.advance(4500);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('a deferred handoff preserves the request without claiming a technical failure or confirmed scope',()=>{
 const result=deferredVoiceHandoff();assert.equal(result.status,'target_switch_deferred');
 assert.match(result.instruction,/latest complete caller request/);assert.match(result.instruction,/do not ask them to repeat/);
 assert.match(result.instruction,/Do not use the proposed student context/);assert.doesNotMatch(result.instruction,/loading problem|failed technically/);
});

for(const reason of ['cancel','close','transport','session','farewell'])test(`${reason} discards queued research rather than speaking it later`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Cost?',result:{answer:'Verified'}}));
 if(reason==='cancel')f.channel.send(JSON.stringify({type:'origen.research.cancel'}));
 if(reason==='close')f.channel.close();
 if(reason==='transport')f.raw.onclose({});
 if(reason==='session')f.receive({type:'session.closed'});
 if(reason==='farewell')f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'}}}));
 await pause(0);const count=f.sent.length;clock.advance(10000);await pause(0);
 assert.equal(f.sent.length,count);assert.ok(!f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('Verified')));f.channel.close();
});

test('handoff timeout and aborted/closed calls never authorize forced audio teardown',async()=>{
 for(const action of ['timeout','abort','close','transport']){
  const clock=fakeClock(),f=fixture({...clock,isPlaybackIdle:()=>false}),abort=new AbortController();let result;
  void f.channel.settle({signal:abort.signal,timeoutMs:2000}).then(value=>{result=value;});
  if(action==='abort')abort.abort();if(action==='close')f.channel.close();if(action==='transport')f.raw.onclose({});
  clock.advance(2000);await pause(0);assert.equal(result,false);f.channel.close();
 }
});

test('research waits for application tool handling even after model generation finished',async()=>{
 const clock=fakeClock(),f=fixture(clock);let release;
 const pending=new Promise(resolve=>release=resolve),original=f.channel.onmessage;
 f.channel.onmessage=async event=>{original(event);if(JSON.parse(event.data).type==='response.done')await pending;};
 f.backend('response.created','scope');f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'switch',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 clock.advance(5000);await pause(0);assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));
 release();await pause(0);clock.advance(250);await pause(0);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('superseded queued evidence never becomes the next research announcement',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Old',result:{answer:'Old evidence'}}));
 f.channel.send(JSON.stringify({type:'origen.research.cancel'}));
 const afterCancellation=f.sent.length;
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'New',result:{answer:'New evidence'}}));
 clock.advance(2000);await pause(0);
 const context=f.sent.slice(afterCancellation).filter(e=>e.type==='session.thinking.append').map(e=>e.content).join('');
 assert.doesNotMatch(context,/Old evidence/);assert.match(context,/New evidence/);
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);f.channel.close();
});

test('results arriving during the caller turn are available to that reply without a spoken interruption',async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.input_transcript.delta',delta:'¿Qué incluye ese costo?'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',question:'Costs',result:{answer:'Verified'}}));
 assert.ok(f.sent.some(e=>e.type==='session.thinking.append'&&e.content.includes('Verified')));
 clock.advance(5000);await pause(0);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
function fixture(options={}){
 const {autoAcknowledge=true,...channelOptions}=options;
 const sent=[],events=[],consent=voiceProfileSaveConsent();
 const raw={readyState:'open',send:value=>{const event=JSON.parse(value);sent.push(event);if(autoAcknowledge&&['session.thinking.append','session.instructions.append'].includes(event.type))queueMicrotask(()=>receive({type:event.type+'ed',client_event_id:event.event_id}));},close(){this.readyState='closed';}};
 const channel=studentLiveChannel(raw,{getTurn:()=>consent.token(),isPlaybackIdle:()=>true,...channelOptions});
 channel.onmessage=({data})=>{const e=JSON.parse(data);events.push(e);if(e.type==='input_audio_buffer.speech_started')consent.begin(e.item_id);if(e.type==='conversation.item.input_audio_transcription.completed')consent.transcript(e.item_id,e.transcript);};
 channel.configure({voiceProvider:'live',voiceSession:{instructions:'Backend policy',tools:[]}});
 const receive=e=>raw.onmessage({data:JSON.stringify(e)});
 receive({type:'session.started'});
 const backend=(type,responseId,fields={})=>receive({type:'response.event',delegation_id:'d',event:{type,...(type==='response.created'?{response:{id:responseId}}:{response_id:responseId}),...fields}});
 return {sent,events,consent,channel,receive,backend,raw};
}
test('Realtime remains an unchanged pass-through',()=>{const sent=[];const raw={send:value=>sent.push(value)};const dc=studentLiveChannel(raw);dc.send('{"type":"response.create"}');assert.deepEqual(sent,['{"type":"response.create"}']);});
test('routing policy reaches timing metadata but is not an unsupported provider session option',async()=>{
 const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{routingPolicy:'bounded-follow-up-v1',instructions:'Backend',tools:[]}});
 f.receive({type:'session.started'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.created').at(-1).session.routingPolicy,'bounded-follow-up-v1');
 f.channel.send(JSON.stringify({type:'session.update',event_id:'reset',session:{routingPolicy:'backend-first',instructions:'New backend',tools:[],liveInstructions:'Replace earlier delegation policy.'}}));
 const update=f.sent.find(e=>e.type==='session.update');assert.equal(update.session.routingPolicy,undefined);assert.equal(update.session.delegation.responses.routingPolicy,undefined);
 assert.ok(f.sent.some(e=>e.type==='session.instructions.append'&&e.content.includes('Replace earlier delegation policy.')));
 f.receive({type:'session.updated',client_event_id:'reset'});await pause(0);
 assert.equal(f.events.filter(e=>e.type==='session.updated').at(-1).session.routingPolicy,'backend-first');f.channel.close();
});

test('model timing ends before quiet-window and async tool handling; Live boundaries are labeled estimates',async()=>{
 const clock=fakeClock(),f=fixture(clock);let release;
 const pending=new Promise(resolve=>release=resolve),original=f.channel.onmessage;
 f.channel.onmessage=async event=>{original(event);if(JSON.parse(event.data).type==='response.done')await pending;};
 f.receive({type:'session.input_transcript.delta',delta:'Recall my earlier plan.'});await pause(0);
 f.backend('response.created','b');await pause(0);
 const started=f.events.find(e=>e.type==='origen.backend.started');assert.ok(started.item_id);
 f.backend('response.output_item.done','b',{item:{type:'function_call',name:'recall_student_context',call_id:'c',arguments:'{}'}});
 f.backend('response.completed','b');await pause(0);
 assert.ok(f.events.some(e=>e.type==='origen.backend.model_finished'));assert.ok(!f.events.some(e=>e.type==='origen.backend.finished'));
 clock.advance(1100);await pause(0);
 assert.equal(f.events.find(e=>e.type==='input_audio_buffer.speech_stopped').liveBoundary,'transcript_quiet_estimate');
 assert.ok(f.events.some(e=>e.type==='response.done'));assert.ok(!f.events.some(e=>e.type==='origen.backend.finished'));
 release();await pause(0);assert.ok(f.events.some(e=>e.type==='origen.backend.finished'));f.channel.close();
});
test('Live opening waits for session startup; regular response requests do not duplicate speech',()=>{const f=fixture();f.channel.send(JSON.stringify({type:'response.create',response:{instructions:'Introduce yourself as Origen'}}));f.channel.send(JSON.stringify({type:'response.create'}));assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);assert.equal(f.sent.filter(e=>e.type==='response.create').length,0);f.channel.close();});
test('opening transport follows familiar context and preserves exact approved check-ins',()=>{
 for(const language of ['en','es'])for(const onboarding of [true,false]){
  const f=fixture();f.channel.configure({voiceProvider:'live',voiceSession:{language,onboarding,instructions:'Scoped policy',tools:[]}});
  f.channel.send(JSON.stringify({type:'response.create'}));
  const opening=f.sent.find(e=>e.type==='session.commentary.append').content;
  assert.match(opening,new RegExp(language==='es'?'Spanish':'English'));
  assert.match(opening,onboarding?/approved onboarding welcome/:/familiar context already supplied/);
  assert.doesNotMatch(opening,/introduce yourself as Origen/);f.channel.close();
 }
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_follow_up'},instructions:'Do you want to revisit your saved question?'}}));
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,/Speak only the exact application-provided check-in/);f.channel.close();
});
test('An explicit complete save request retains consent through delegated function completion',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Yes, save my profile now.'});f.backend('response.created','r');
 f.backend('response.output_item.done','r',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'c',arguments:'{}'}});f.backend('response.completed','r');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(done.response.output[0].call_id,'c');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),true);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'c',output:'{"saved":true}'}}));f.channel.send(JSON.stringify({type:'response.create'})); // Opening has not been requested yet.
 assert.equal(f.sent.find(e=>e.type==='response.item.create').item.call_id,'c');f.channel.close();
});
test('A newer user turn cannot authorize an older backend write',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Save my profile.'});f.backend('response.created','old');await pause(1200);
 f.receive({type:'session.input_transcript.delta',delta:'No, do not save it yet.'});f.backend('response.output_item.done','old',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'old-c',arguments:'{}'}});f.backend('response.completed','old');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(done.response.metadata.origen_user_turn,'superseded-live-turn');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),false);f.channel.close();
});
for(const name of ['remember_student_detail','recall_student_context','prepare_coordinator_connection','prepare_coordinator_review_request','confirm_coordinator_review_request','set_conversation_language'])test(`Stale ${name} never reaches a current-turn handler`,async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'An earlier request.'});f.backend('response.created','old');await pause(1200);
 f.receive({type:'session.input_transcript.delta',delta:'Stop. I changed my mind.'});f.backend('response.output_item.done','old',{item:{type:'function_call',name,call_id:'stale-call',arguments:'{}'}});f.backend('response.completed','old');await pause(1200);
 assert.ok(!f.events.some(event=>event.type==='response.done'&&event.response.output?.some(item=>item.type==='function_call')));
 const reply=f.sent.find(event=>event.type==='response.item.create');assert.equal(reply.item.call_id,'stale-call');assert.equal(JSON.parse(reply.item.output).status,'superseded_turn');assert.match(JSON.parse(reply.item.output).instruction,/not a hearing failure/);assert.match(JSON.parse(reply.item.output).instruction,/do not ask them to repeat/);assert.match(JSON.parse(reply.item.output).instruction,/retry writes automatically/);assert.equal(f.sent.filter(event=>event.type==='response.create').length,1);f.channel.close();
});
test('Partial save phrase followed by not yet never grants save consent',async()=>{
 const f=fixture();f.receive({type:'session.input_transcript.delta',delta:'Save my profile'});f.backend('response.created','r');f.receive({type:'session.input_transcript.delta',delta:'? No, not yet.'});f.backend('response.output_item.done','r',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'c',arguments:'{}'}});f.backend('response.completed','r');await pause(1200);
 const done=f.events.find(e=>e.type==='response.done');assert.equal(f.consent.consume(done.response.metadata.origen_user_turn),false);f.channel.close();
});
test('All chunks preserve complete teaching text and have bounded UTF-8 lengths',()=>{const f=fixture(),text='Warmly acknowledge uncertainty. '.repeat(100);f.channel.send(JSON.stringify({type:'session.update',event_id:'u',session:{instructions:'Backend updated',tools:[],liveInstructions:text}}));const parts=f.sent.filter(e=>e.type==='session.instructions.append').map(e=>e.content);assert.equal(parts.join(''),text);assert.ok(parts.every(part=>Buffer.byteLength(part)<=440));f.channel.close();});

test('End-of-call flush labels output completion as forced, never played consent',async()=>{
 const f=fixture();f.receive({type:'session.output_transcript.delta',delta:'An unfinished readback.'});await pause(0);await f.channel.flush();
 assert.equal(f.events.find(e=>e.type==='output_audio_buffer.stopped').liveBoundary,'forced_flush');f.channel.close();
});

test('Live guide updates keep the workflow response budget and preserve it on partial updates',()=>{
  const f=fixture();
  f.channel.configure({voiceProvider:'live',voiceSession:{instructions:'Full sharing policy',tools:[],max_output_tokens:3000}});
  f.channel.send(JSON.stringify({type:'session.update',event_id:'budget',session:{instructions:'Updated sharing policy',max_output_tokens:3000,tools:[]}}));
  assert.equal(f.sent.find(e=>e.type==='session.update').session.delegation.responses.max_output_tokens,3000);
  assert.deepEqual(f.sent.find(e=>e.type==='session.update').session.delegation.responses.reasoning,{effort:'low'});
  f.receive({type:'session.updated',client_event_id:'budget'});
  f.channel.send(JSON.stringify({type:'session.update',event_id:'partial',session:{tools:[]}}));
  assert.equal(f.sent.filter(e=>e.type==='session.update').at(-1).session.delegation.responses.max_output_tokens,3000);
  assert.deepEqual(f.sent.filter(e=>e.type==='session.update').at(-1).session.delegation.responses.reasoning,{effort:'low'});
  f.channel.close();
 });

function fakeClock(){
 let time=0,next=0;const jobs=new Map();
 return {now:()=>time,schedule:(fn,ms)=>{const id=++next;jobs.set(id,{fn,at:time+ms});return id;},cancel:id=>jobs.delete(id),
  advance(ms){time+=ms;for(const [id,job]of [...jobs])if(job.at<=time){jobs.delete(id);job.fn();}}};
}
for(const [language,head,tail]of [['es','Guarda un próximo paso sobre estudios',' ambientales.'],['en','Save a next step about environmental',' studies.']])test(`A brief ${language} pause preserves the complete request while fencing earlier work`,async()=>{
 const clock=fakeClock(),f=fixture(clock);
 f.receive({type:'session.input_transcript.delta',delta:head});await pause(0);
 f.backend('response.created','fragment');clock.advance(1100);await pause(0);
 f.receive({type:'session.input_transcript.delta',delta:tail});await pause(0);
 f.backend('response.output_item.done','fragment',{item:{type:'function_call',name:'save_next_step',call_id:'old',arguments:'{}'}});
 f.backend('response.completed','fragment');clock.advance(1100);await pause(0);
 assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').at(-1).transcript,head+tail);
 assert.equal(f.events.filter(e=>e.type==='input_audio_buffer.speech_started').at(-1).liveBoundary,'transcript_continuation');
 assert.equal(JSON.parse(f.sent.find(e=>e.type==='response.item.create').item.output).status,'superseded_turn');
 assert.ok(!f.events.some(e=>e.type==='response.done'&&e.response.output?.some(i=>i.type==='function_call')));f.channel.close();
});
test('Transcript stitching never crosses an assistant reply or a long pause',async()=>{
 for(const boundary of ['reply','reply-before-flush','silence']){
  const clock=fakeClock(),f=fixture(clock);
  f.receive({type:'session.input_transcript.delta',delta:'Save an earlier step.'});await pause(0);
  if(boundary==='reply-before-flush')f.receive({type:'session.output_transcript.delta',delta:'Do you want to save it?'});
  await pause(0);clock.advance(1100);await pause(0);
  if(boundary==='reply')f.receive({type:'session.output_transcript.delta',delta:'Do you want to save it?'});else if(boundary==='silence')clock.advance(1500);
  await pause(0);f.receive({type:'session.input_transcript.delta',delta:'No, do not save it.'});await pause(0);clock.advance(1100);await pause(0);
  assert.equal(f.events.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').at(-1).transcript,'No, do not save it.');f.channel.close();
 }
});
for(const language of ['en','es'])test(`A stalled ${language} backend is bounded and late write proposals never execute`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.configure({voiceProvider:'live',voiceSession:{language,instructions:'Policy',tools:[]}});
 f.backend('response.created','slow');
 f.backend('response.output_item.done','slow',{item:{type:'function_call',name:'save_onboarding_profile',call_id:'late',arguments:'{}'}});
 clock.advance(liveBackendDeadlineMs-1);await pause(0);assert.equal(f.sent.filter(e=>e.type==='response.cancel').length,0);
 clock.advance(1);await pause(0);
 assert.equal(f.sent.find(e=>e.type==='response.cancel').response_id,'slow');
 assert.equal(f.events.find(e=>e.type==='origen.backend.finished').outcome,'timed_out');
 assert.match(f.sent.find(e=>e.type==='session.commentary.append').content,language==='es'?/no pude completarla/:/couldn’t finish it/);
 // Even after a new turn, a delayed terminal event or replayed creation cannot
 // execute the old write, release a second hold, or schedule another attempt.
 f.receive({type:'session.input_transcript.delta',delta:'No, do not save.'});
 f.backend('response.created','slow');f.backend('response.completed','slow');await pause(0);
 assert.equal(f.events.filter(e=>e.type==='origen.backend.started').length,1);
 assert.equal(f.events.filter(e=>e.type==='origen.backend.finished').length,1);
 assert.ok(!f.events.some(e=>e.type==='response.done'));
 assert.ok(!f.sent.some(e=>e.type==='response.create'));f.channel.close();
});
test('A completed response clears its deadline before application tools run',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','ok');
 f.backend('response.output_item.done','ok',{item:{type:'function_call',name:'highlight_binder_topics',call_id:'ok',arguments:'{"topics":["transfer"]}'}});
 f.backend('response.completed','ok');await pause(0);clock.advance(liveBackendDeadlineMs);await pause(0);
 assert.ok(f.events.some(e=>e.type==='response.done'&&e.response.output[0]?.call_id==='ok'));
 assert.ok(!f.sent.some(e=>e.type==='response.cancel'||e.type==='session.commentary.append'));f.channel.close();
});
test('A timed-out turn cannot silently restart; a new caller turn can still delegate',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','slow');
 clock.advance(liveBackendDeadlineMs);await pause(0);f.backend('response.created','automatic-retry');
 f.backend('response.output_item.done','automatic-retry',{item:{type:'function_call',name:'remember_student_detail',call_id:'retry-write',arguments:'{}'}});
 f.backend('response.completed','automatic-retry');await pause(0);
 assert.ok(f.sent.some(e=>e.type==='response.cancel'&&e.response_id==='automatic-retry'));
 assert.ok(!f.events.some(e=>e.type==='response.done'));
 f.receive({type:'session.input_transcript.delta',delta:'Please try that again.'});f.backend('response.created','requested-retry');
 assert.ok(f.events.some(e=>e.type==='origen.backend.started'&&e.response_id==='requested-retry'));f.channel.close();
});
test('An expired old turn does not interrupt a newer turn with a failure announcement',async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','old');clock.advance(1000);
 f.receive({type:'session.input_transcript.delta',delta:'Instead, discuss my essay.'});f.backend('response.created','new');
 clock.advance(liveBackendDeadlineMs-1000);await pause(0);
 assert.deepEqual(f.sent.filter(e=>e.type==='response.cancel').map(e=>e.response_id),['old']);
 assert.ok(!f.sent.some(e=>e.type==='session.commentary.append'));f.channel.close();
});
for(const ending of ['close','transport','session','farewell'])test(`${ending} clears the pending backend deadline`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.backend('response.created','pending');
 if(ending==='close')f.channel.close();
 if(ending==='transport')f.raw.onclose({});
 if(ending==='session')f.receive({type:'session.closed'});
 if(ending==='farewell')f.channel.send(JSON.stringify({type:'response.create',response:{metadata:{topic:'origen_farewell'},instructions:'Say goodbye'}}));
 await pause(0);const sent=f.sent.length;clock.advance(liveBackendDeadlineMs);await pause(0);
 assert.equal(f.sent.length,sent);assert.ok(!f.events.some(e=>e.outcome==='timed_out'));f.channel.close();
});

test('configuration timing spans send through matching acknowledgment only',async()=>{const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'session.update',event_id:'scope-ready',session:{instructions:'New scope',tools:[]}}));clock.advance(2500);f.receive({type:'session.updated',client_event_id:'unknown'});await pause(0);assert.equal(f.events.filter(e=>e.type==='origen.configuration.applied').length,0);clock.advance(450);f.receive({type:'session.updated',client_event_id:'scope-ready'});await pause(0);assert.equal(f.events.find(e=>e.type==='origen.configuration.applied').durationMs,2950);f.channel.close();});

for(const name of ['Aiden','Hablemos de Aiden'])test(`scope confirmation resumes its native backend before the next research question: ${name}`,async()=>{
 const clock=fakeClock(),f=fixture(clock);f.channel.send(JSON.stringify({type:'response.create'}));
 f.receive({type:'session.input_transcript.delta',delta:name});await pause(0);clock.advance(1100);await pause(0);
 f.backend('response.created','scope');await pause(0);
 f.backend('response.output_item.done','scope',{item:{type:'function_call',name:'request_conversation_target',call_id:'target',arguments:'{}'}});
 f.backend('response.completed','scope');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'target',output:JSON.stringify({status:'target_confirmed'})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));clock.advance(6000);await pause(0);
 assert.ok(!f.events.some(e=>e.type==='origen.speech.silence_recovered'));
 assert.equal(f.sent.filter(e=>e.type==='session.commentary.append').length,1);
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1,'scope receipts must complete the same backend tool loop');f.channel.close();
});
for(const status of ['research_pending','research_failed'])test(`single research receipt ${status} resumes its native backend exactly once`,async()=>{
 const f=fixture();f.channel.send(JSON.stringify({type:'response.create'}));
 f.backend('response.created','research');await pause(0);
 f.backend('response.output_item.done','research',{item:{type:'function_call',name:'lookup_financial_aid',call_id:'lookup',arguments:'{}'}});
 f.backend('response.completed','research');await pause(0);
 f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'lookup',output:JSON.stringify({status})}}));
 f.channel.send(JSON.stringify({type:'response.create'}));
 assert.equal(f.sent.filter(e=>e.type==='response.create').length,1);f.channel.close();
});
test('quiet research evidence retains uncertainty and is never a behavioral instruction',async()=>{
 const f=fixture();
 f.receive({type:'session.input_transcript.delta',delta:'Tell me more'});await pause(0);
 f.channel.send(JSON.stringify({type:'origen.research.ready',jobId:'r',question:'Berkeley costs',result:{status:'completed',answer:'Could not verify the next year.'}}));
 const parts=f.sent.filter(e=>e.type==='session.thinking.append').map(e=>JSON.parse(e.content));
 assert.ok(parts.every(p=>p.kind==='untrusted-research-evidence'));
 assert.match(parts.map(p=>p.text).join(''),/Could not verify the next year/);
 assert.ok(!f.sent.some(e=>e.type==='session.instructions.append'));f.channel.close();
});
