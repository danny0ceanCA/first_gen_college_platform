import test from 'node:test';
import assert from 'node:assert/strict';
import {studentVoiceChannel} from './studentVoiceChannel.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const sent=[],raw={readyState:'connecting',send:text=>sent.push(JSON.parse(text)),close(){this.readyState='closed';this.onclose?.({});}};
 let socket;class Socket{
  constructor(url){this.url=url;this.readyState=0;this.sent=[];socket=this;}
  send(text){this.sent.push(JSON.parse(text));}close(){this.readyState=3;this.onclose?.({});}
  open(){this.readyState=1;this.onopen();}receive(message){this.onmessage({data:JSON.stringify(message)});}
 }
 const disconnects=[];
 const channel=studentVoiceChannel(raw,{isPlaybackIdle:()=>true,getPlaybackVersion:()=>4,onDisconnect:details=>disconnects.push(details),...options});
 return {raw,sent,channel,disconnects,get socket(){return socket;},async configure(){const promise=channel.configure({voiceControl:{protocol:'server-v1',id:'opaque-call'}},{token:'private-token',url:'https://api.example.test',WebSocketClass:Socket});socket.open();socket.receive({type:'ready'});await promise;},open(){raw.readyState='open';raw.onopen({});}};
}
test('audio open waits for server owner, token is a first message, and UI uses one lease',async()=>{
 const f=fixture(),events=[];let opened=0;f.channel.onopen=()=>opened++;f.channel.onmessage=e=>events.push(JSON.parse(e.data));
 try{await f.configure();assert.equal(opened,0);assert.equal(f.socket.url,'wss://api.example.test/api/voice-control');assert.ok(!f.socket.url.includes('private-token'));
  assert.deepEqual(f.socket.sent[0],{type:'authenticate',id:'opaque-call',token:'private-token'});f.open();assert.equal(opened,1);
  f.socket.receive({type:'event',event:{type:'response.done',controlLease:'one-use',response:{output:[{type:'function_call',call_id:'c'}]}}});
  f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'c',output:'{}'}}));
  assert.equal(f.socket.sent.at(-1).lease,'one-use');assert.equal(f.sent.length,0);assert.equal(events.length,1);
 }finally{f.channel.close();}
});

function recoveryFixture(){
 const timers=new Map(),states=[];let next=0;
 const f=fixture({schedule:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},cancel:id=>timers.delete(id),onRecovery:state=>states.push(state.state)});
 return {...f,get socket(){return f.socket;},states,timers,fire(ms){const found=[...timers].find(([,x])=>x.ms===ms);assert.ok(found,'Expected timer '+ms);timers.delete(found[0]);found[1].fn();},drop(){const old=f.socket;old.readyState=3;old.onclose({code:1006,wasClean:false,reason:''});return old;}};
}
test('brief mobile control loss retains audio and callback lease; resumes without greeting or replay',async()=>{
 const f=recoveryFixture();let opens=0,closes=0;f.channel.onopen=()=>opens++;f.channel.onclose=()=>closes++;
 try{await f.configure();f.open();
  f.socket.receive({type:'event',event:{type:'response.done',controlLease:'lease-a',response:{output:[{type:'function_call',call_id:'a'}]}}});
  f.channel.send(JSON.stringify({type:'response.cancel'}));const old=f.drop();
  assert.equal(f.raw.readyState,'open');assert.equal(closes,0);assert.equal(await f.channel.settle(),false);
  f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:'a',output:'{"saved":true}'}}));
  assert.equal(old.sent.filter(x=>x.event?.item?.call_id==='a').length,0);
  f.fire(250);f.socket.open();assert.equal(f.socket.sent[0].id,'opaque-call');
  f.socket.receive({type:'ready',resumed:true});
  assert.equal(opens,1);assert.deepEqual(f.states,['reconnecting','resumed']);assert.equal(f.sent.length,0);
  assert.equal(f.socket.sent.filter(x=>x.event?.item?.call_id==='a').length,1);
  assert.equal(f.socket.sent.at(-1).lease,'lease-a');
  assert.equal(f.socket.sent.filter(x=>x.event?.type==='response.cancel').length,0);
  old.onclose({code:1008,reason:'invalid_command'});assert.equal(closes,0);
 }finally{f.channel.close();}
});
test('recovery has an absolute deadline, including a replacement socket that never opens',async()=>{
 const f=recoveryFixture();await f.configure();f.open();f.drop();f.fire(250);f.fire(12000);
 assert.equal(f.raw.readyState,'closed');assert.equal(f.disconnects.at(-1).source,'control_recovery_timeout');assert.equal(f.timers.size,0);
});
test('half-open original control retries without taking over or extending recovery deadline',async()=>{
 const f=recoveryFixture();try{await f.configure();f.open();f.drop();f.fire(250);f.socket.open();
  assert.equal(f.socket.sent[0].resume,true);
  f.socket.readyState=3;f.socket.onclose({code:1013,reason:'control_still_attached'});
  assert.equal(f.raw.readyState,'open');assert.equal([...f.timers.values()].filter(x=>x.ms===12000).length,1);
  f.fire(500);f.socket.open();f.socket.receive({type:'ready',resumed:true});assert.deepEqual(f.states,['reconnecting','resumed']);
 }finally{f.channel.close();}
});
test('policy rejection is terminal, with its allowlisted cause preserved',async()=>{
 const f=recoveryFixture();await f.configure();f.open();f.socket.readyState=3;
 f.socket.onclose({code:1008,wasClean:true,reason:'invalid_update'});
 assert.equal(f.raw.readyState,'closed');assert.equal(f.disconnects[0].serverReason,'invalid_update');assert.deepEqual(f.states,[]);
});
test('resume must reauthenticate the existing session; a fresh ready is rejected',async()=>{
 const f=recoveryFixture();await f.configure();f.open();f.drop();f.fire(250);f.socket.open();f.socket.receive({type:'ready'});
 assert.equal(f.raw.readyState,'closed');assert.equal(f.disconnects.at(-1).source,'control_resume_rejected');
});
test('explicit close during recovery stops reconnect and discards unsent work',async()=>{
 const f=recoveryFixture();await f.configure();f.open();const old=f.drop();f.channel.send(JSON.stringify({type:'response.create'}));f.channel.close();
 assert.equal(f.timers.size,0);assert.equal(f.raw.readyState,'closed');assert.equal(old.sent.some(x=>x.event?.type==='response.create'),false);
});
test('recovery preserves an in-flight RPC reply without reissuing the operation',async()=>{
 const f=recoveryFixture();try{await f.configure();f.open();const result=f.channel.flush(),request=f.socket.sent.at(-1);f.drop();f.fire(250);f.socket.open();f.socket.receive({type:'ready',resumed:true});
  f.socket.receive({type:'reply',id:request.id,value:true});assert.equal(await result,true);assert.equal(f.socket.sent.some(x=>x.type==='rpc'),false);
 }finally{f.channel.close();}
});
test('playback, cancellation and boundary RPC stay off the provider data channel',async()=>{
 const f=fixture();try{await f.configure();f.open();assert.deepEqual(f.socket.sent[1],{type:'playback',idle:true,version:4});
  const promise=f.channel.cancelResearch(),request=f.socket.sent.at(-1);assert.equal(request.method,'cancel');f.socket.receive({type:'reply',id:request.id,value:{status:'research_cancelled'}});assert.deepEqual(await promise,{status:'research_cancelled'});
  const controller=new AbortController(),waiting=f.channel.settle({signal:controller.signal});controller.abort();assert.equal(await waiting,false);assert.equal(f.sent.length,0);
 }finally{f.channel.close();}
});
test('lost server control closes audio control with no browser tool fallback',async()=>{
 const f=fixture();let closed=0;f.channel.onclose=()=>closed++;await f.configure();f.open();
 f.socket.readyState=3;f.socket.onclose({code:1000,wasClean:true,reason:'provider_disconnected'});await tick();
 assert.equal(closed,1);assert.equal(f.raw.readyState,'closed');assert.deepEqual(f.sent.map(e=>e.type),['session.close']);
 assert.deepEqual(f.disconnects,[{source:'control_socket_closed',closeCode:1000,wasClean:true,serverReason:'provider_disconnected',controlReady:true,dataChannelState:'open',controlSocketState:3}]);
});
test('feature off preserves the existing local adapter and open event',async()=>{
 const f=fixture();let opened=0;f.channel.onopen=()=>opened++;await f.channel.configure({voiceProvider:'realtime'});f.open();
 f.channel.send(JSON.stringify({type:'response.create'}));assert.equal(opened,1);assert.equal(f.sent[0].type,'response.create');f.channel.close();
});
test('interleaved UI replies retain their original callback leases',async()=>{
 const f=fixture();try{await f.configure();f.open();
  for(const id of ['a','b'])f.socket.receive({type:'event',event:{type:'response.done',controlLease:'lease-'+id,response:{output:[{type:'function_call',call_id:id}]}}});
  for(const id of ['a','b']){
   f.channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:id,output:'{}'}}));assert.equal(f.socket.sent.at(-1).lease,'lease-'+id);
   f.channel.send(JSON.stringify({type:'response.create'}));assert.equal(f.socket.sent.at(-1).lease,'lease-'+id);
  }
 }finally{f.channel.close();}
});
