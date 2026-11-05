import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {createServer} from 'node:http';
import WebSocket from 'ws';
import {voiceControlSession,createVoiceControl} from './voice-control.mjs';
import {studentLiveSession} from './student-live-session.mjs';
import {studentVoiceChannel} from '../src/studentVoiceChannel.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(check())return;await pause(10);}assert.fail('condition timed out');}
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
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='details').item.output).text,full);assert.equal(posts,1);
  f.call([tool('read_research_details','stale-revision',{jobId:'job-1',revision:2})],'read-stale');await until(()=>f.sent.some(e=>e.item?.call_id==='stale-revision'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='stale-revision').item.output).status,'research_details_unavailable');
  await f.engine.configure({...config,tools},{sessionId:'physical-call',studentId:'other',confirmed:true},'scope');
  f.call([tool('read_research_details','wrong-scope',{jobId:'job-1',revision:1})],'read-other');await until(()=>f.sent.some(e=>e.item?.call_id==='wrong-scope'));
  assert.equal(JSON.parse(f.sent.find(e=>e.item?.call_id==='wrong-scope').item.output).status,'research_details_unavailable');assert.equal(posts,1);
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
 const control=createVoiceControl({env:{ORIGEN_LIVE_SERVER_CONTROL:'true',ORIGEN_BACKGROUND_RESEARCH:'true',ALLOWED_ORIGINS:'http://allowed.test'},authenticate:async token=>{if(!['owner','other'].includes(token))throw Error('invalid');return {sub:token};},authorize:async()=>revision,request:options.request|| (async()=>({})),log:event=>logs.push(event),connect:url=>{urls.push(url);const socket=new Provider();providers.push(socket);return socket;}});
 const server=createServer();control.attach(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const receipt=()=>control.register({subject:'owner',permissionRevision:1,providerId:'live_session_prefixed',sessionId:'call',scope:{sessionId:'call',studentId:'aiden',confirmed:true},config});
 const connect=async(origin='http://allowed.test')=>{const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/voice-control`,{origin});ws.on('error',()=>{});const messages=[];ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');return {ws,messages};};
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
  await until(()=>f.providers[0].sent.some(e=>e.type==='session.update'));const update=f.providers[0].sent.find(e=>e.type==='session.update');assert.match(update.session.delegation.responses.instructions,/Spanish/);
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
