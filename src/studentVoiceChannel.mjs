import {studentLiveChannel} from './studentLiveChannel.mjs';

const serverCloseReasons=new Set(['closed','expired','provider_disconnected','attach_timeout','control_failed','invalid_provider_event','permission_changed','update_failed','server_shutdown']);

// WebRTC remains the audio transport. When negotiated, all application/provider
// control travels through the authenticated API sideband owner instead.
export function studentVoiceChannel(raw,options={}){
 const local=studentLiveChannel(raw,options),handlers={},pending=new Map(),callLeases=new Map(),remaining=new Map(),completed=[];
 let remote=false,socket,closed=false,ready=false,primaryOpen=raw.readyState==='open',opened=false,lease,telemetry,handshake;
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
 function close(){if(closed)return;closed=true;clearInterval(telemetry);clearTimeout(handshake);for(const item of pending.values())item.resolve(false);pending.clear();
  if(remote&&raw.readyState==='open')raw.send(JSON.stringify({type:'session.close',event_id:crypto.randomUUID()}));
  if(socket?.readyState===1)post({type:'close'});socket?.close();local.close();
 }
 function rpc(method,{signal,isCurrent=()=>true,timeoutMs=15000}={}){
  if(signal?.aborted||!isCurrent()||closed)return Promise.resolve(false);
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
  socket=new WebSocketClass(address.href);
  await new Promise((resolve,reject)=>{
   const abort=source=>{reject(Error('voice_control_unavailable'));fail(source);};
   handshake=setTimeout(()=>abort('control_handshake_timeout'),10000);
   socket.onopen=()=>post({type:'authenticate',id:data.voiceControl.id,token});
   socket.onerror=()=>abort('control_socket_error');
   socket.onclose=event=>{
    if(!ready)reject(Error('voice_control_unavailable'));
    fail('control_socket_closed',{closeCode:event.code,wasClean:event.wasClean,serverReason:serverCloseReasons.has(event.reason)?event.reason:undefined});
   };
   socket.onmessage=message=>{
    try{
     const packet=JSON.parse(message.data);
     if(packet.type==='ready'){clearTimeout(handshake);ready=true;
      const report=()=>{try{post({type:'playback',idle:options.isPlaybackIdle?.()===true,version:options.getPlaybackVersion?.()||0});}catch{fail('control_playback_send_failed');}};
      telemetry=setInterval(report,500);report();resolve();open();
     }else if(packet.type==='event'){
      if(packet.event.controlLease){lease=packet.event.controlLease;const calls=(packet.event.response?.output||[]).filter(item=>item.type==='function_call');remaining.set(lease,calls.length);for(const item of calls)callLeases.set(item.call_id,lease);}
      Promise.resolve(emit('onmessage',{data:JSON.stringify(packet.event)})).catch(()=>fail('control_event_handler_failed'));
     }else if(packet.type==='reply')pending.get(packet.id)?.resolve(packet.value);
    }catch{abort('control_message_failed');}
   };
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
   post({type:'event',event,lease:owner});
  };
  if(['settle','prepareClose','flush'].includes(key))return options=>remote?rpc(key,options):local[key](options);
  if(key in handlers)return handlers[key];return Reflect.get(target,key,target);
 },set(target,key,value){if(['onmessage','onopen','onclose'].includes(key)){handlers[key]=value;return true;}return Reflect.set(target,key,value,target);}});
}
