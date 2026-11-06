import {studentLiveChannel} from './studentLiveChannel.mjs';

const serverCloseReasons=new Set(['closed','expired','provider_disconnected','attach_timeout','control_failed','invalid_provider_event','permission_changed','update_failed','server_shutdown','authentication_required','rate_limited','invalid_message','control_unavailable','invalid_update','invalid_command','control_busy','control_backpressure','resume_buffer_exceeded','resume_timeout']);

// WebRTC remains the audio transport. When negotiated, all application/provider
// control travels through the authenticated API sideband owner instead.
export function studentVoiceChannel(raw,options={}){
 const local=studentLiveChannel(raw,options),handlers={},pending=new Map(),callLeases=new Map(),remaining=new Map(),completed=[];
 let remote=false,socket,closed=false,ready=false,primaryOpen=raw.readyState==='open',opened=false,lease,telemetry,handshake;
 const schedule=options.schedule||setTimeout,cancel=options.cancel||clearTimeout;
 let recovering=false,retryTimer,recoveryTimer,retryCount=0;
 const outbox=[];let outboxBytes=0;
 const emit=(key,value)=>handlers[key]?.(value);
 const open=()=>{if(!opened&&primaryOpen&&(!remote||ready)){opened=true;emit('onopen',{});}};
 const fail=(source,details={})=>{
  if(closed)return;
  options.onDisconnect?.({source,...details,controlReady:ready,dataChannelState:raw.readyState,controlSocketState:socket?.readyState});
  close();emit('onclose',{});
 };
 local.onopen=()=>{primaryOpen=true;open();};
 local.onclose=event=>fail(event?.type==='session.closed'?'provider_session_closed':'rtc_data_channel_closed');
 local.onmessage=event=>{if(!remote)emit('onmessage',event);};
 function post(message){if(socket?.readyState!==1)throw Error('voice_control_unavailable');socket.send(JSON.stringify(message));}
 // Only commands not yet handed to a socket may be sent after recovery. Never
 // replay a sent tool output, write, or response request whose receipt is unknown.
 function sendEvent(message){
  if(closed)return false;
  if(recovering){const text=JSON.stringify(message),bytes=new TextEncoder().encode(text).length;
   if(outbox.length>=64||outboxBytes+bytes>256*1024){fail('control_recovery_overflow');return false;}
   outbox.push(text);outboxBytes+=bytes;return true;
  }
  try{post(message);return true;}catch{fail('control_event_send_failed');return false;}
 }
 function close(){if(closed)return;closed=true;clearInterval(telemetry);clearTimeout(handshake);cancel(retryTimer);cancel(recoveryTimer);outbox.length=0;outboxBytes=0;for(const item of pending.values())item.resolve(false);pending.clear();
  if(remote&&raw.readyState==='open')raw.send(JSON.stringify({type:'session.close',event_id:crypto.randomUUID()}));
  if(socket?.readyState===1)post({type:'close'});socket?.close();local.close();
 }
 function rpc(method,{signal,isCurrent=()=>true,timeoutMs=15000}={}){
  if(signal?.aborted||!isCurrent()||closed||recovering)return Promise.resolve(false);
  const id=crypto.randomUUID();return new Promise(resolve=>{
   let timer;const abort=()=>finish(false);
   const finish=value=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);resolve(!signal?.aborted&&isCurrent()?value:false);};
   pending.set(id,{resolve:finish});timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});
   try{post({type:'rpc',id,method});}catch{finish(false);fail('control_rpc_send_failed');}
  });
 }
 async function configure(data,{token,url,WebSocketClass=globalThis.WebSocket}={}){
  if(data.voiceControl?.protocol!=='server-v1'){local.configure(data);return;}
  remote=true;if(!token||!url)throw Error('voice_control_unavailable');
  const address=new URL('/api/voice-control',url);address.protocol=address.protocol==='https:'?'wss:':'ws:';
  await new Promise((resolve,reject)=>{
   const abort=source=>{reject(Error('voice_control_unavailable'));fail(source);};
   handshake=setTimeout(()=>abort('control_handshake_timeout'),10000);
   const recover=()=>{
    if(!recovering){recovering=true;retryCount=0;clearInterval(telemetry);
     options.onRecovery?.({state:'reconnecting'});
     recoveryTimer=schedule(()=>fail('control_recovery_timeout'),12000);
    }
    cancel(retryTimer);retryTimer=schedule(connect,Math.min(2000,250*2**retryCount++));
   };
   const report=()=>{if(recovering||closed)return;try{post({type:'playback',idle:options.isPlaybackIdle?.()===true,version:options.getPlaybackVersion?.()||0});}catch{fail('control_playback_send_failed');}};
   const connect=()=>{
    if(closed)return;
    let current;try{current=new WebSocketClass(address.href);socket=current;}catch{if(recovering)recover();else abort('control_socket_error');return;}
    current.onopen=()=>{if(closed||socket!==current)return;try{post({type:'authenticate',id:data.voiceControl.id,token,...(recovering?{resume:true}:{})});}catch{abort('control_socket_error');}};
    // A browser error is followed by close. Its close code decides whether the
    // authenticated call can resume; never retry a policy/authentication rejection.
    current.onerror=()=>{if(!ready&&!recovering)abort('control_socket_error');};
    current.onclose=event=>{
     if(closed||socket!==current)return;
     if(recovering&&event.code===1013&&event.reason==='control_still_attached'&&raw.readyState==='open'){recover();return;}
     if(ready&&event.code===1006&&raw.readyState==='open'){recover();return;}
     if(!ready)reject(Error('voice_control_unavailable'));
     fail('control_socket_closed',{closeCode:event.code,wasClean:event.wasClean,serverReason:serverCloseReasons.has(event.reason)?event.reason:undefined});
    };
    current.onmessage=message=>{
    if(closed||socket!==current)return;
    try{
     const packet=JSON.parse(message.data);
     if(packet.type==='ready'){clearTimeout(handshake);
      if(recovering&&packet.resumed!==true){abort('control_resume_rejected');return;}
      const resumed=recovering;ready=true;recovering=false;cancel(retryTimer);cancel(recoveryTimer);
      clearInterval(telemetry);telemetry=setInterval(report,500);report();
      while(outbox.length){current.send(outbox[0]);outbox.shift();}outboxBytes=0;
      if(resumed)options.onRecovery?.({state:'resumed'});
      resolve();open();
     }else if(packet.type==='event'){
      if(packet.event.controlLease){lease=packet.event.controlLease;const calls=(packet.event.response?.output||[]).filter(item=>item.type==='function_call');remaining.set(lease,calls.length);for(const item of calls)callLeases.set(item.call_id,lease);}
      Promise.resolve(emit('onmessage',{data:JSON.stringify(packet.event)})).catch(()=>fail('control_event_handler_failed'));
     }else if(packet.type==='reply')pending.get(packet.id)?.resolve(packet.value);
    }catch{abort('control_message_failed');}
    };
   };
   connect();
  });
 }
 return new Proxy(local,{get(target,key){
  if(key==='configure')return configure;if(key==='close')return close;
  if(key==='cancelResearch')return ()=>remote?rpc('cancel'):Promise.resolve(false);
  if(key==='send')return text=>{if(!remote)return local.send(text);const event=JSON.parse(text);let owner=lease;
   if(event.item?.type==='function_call_output'){
    owner=callLeases.get(event.item.call_id);if(!owner)return false;callLeases.delete(event.item.call_id);
    const count=(remaining.get(owner)||0)-1;remaining.set(owner,count);if(!count)completed.push(owner);
   }else if(event.type==='response.create'&&completed.length){owner=completed.shift();remaining.delete(owner);}
   return sendEvent({type:'event',event,lease:owner});
  };
  if(['settle','prepareClose','flush'].includes(key))return options=>remote?rpc(key,options):local[key](options);
  if(key in handlers)return handlers[key];return Reflect.get(target,key,target);
 },set(target,key,value){if(['onmessage','onopen','onclose'].includes(key)){handlers[key]=value;return true;}return Reflect.set(target,key,value,target);}});
}
