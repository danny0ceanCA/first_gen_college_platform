// Media packets and the event channel are separate from the aggregate peer
// state. This is transport evidence, never proof that the caller heard speech.
export function voiceTransportProbe(pc,channel){
 let previous=new Map();
 return async()=>{
  const report=await pc.getStats(),next=new Map();let mediaProgress=false;
  report.forEach(row=>{
   if(row.type!=='inbound-rtp'||row.isRemote===true||(row.kind??row.mediaType)!=='audio')return;
   if(!Number.isFinite(row.packetsReceived)||!Number.isFinite(row.bytesReceived))return;
   const before=previous.get(row.id);
   if(before&&row.packetsReceived>before.packets&&row.bytesReceived>before.bytes)mediaProgress=true;
   next.set(row.id,{packets:row.packetsReceived,bytes:row.bytesReceived});
  });previous=next;
  return {mediaProgress,controlOpen:channel.readyState==='open'};
 };
}
export function voiceConnectionRecovery(disconnect,{schedule=setTimeout,cancel=clearTimeout,delay=8000,probe,clock=()=>performance.now(),maxRecoveryMs=30000,probeTimeoutMs=1000,onEvent=()=>{}}={}){
 let timer,stopped=false,epoch=0,started=0,state,baseline;
 const clear=()=>{if(timer!==undefined)cancel(timer);timer=undefined;};
 const emit=(stage,extra={})=>{try{onEvent({stage,durationMs:Math.max(0,clock()-started),...extra});}catch{}};
 const finish=reason=>{if(stopped)return;clear();epoch++;stopped=true;emit('ended',{reason});disconnect();};
 const inspect=async()=>{
  let timeout;
  try{return await Promise.race([Promise.resolve().then(probe).catch(()=>null),new Promise(resolve=>{timeout=schedule(()=>resolve(null),probeTimeoutMs);})]);}
  finally{if(timeout!==undefined)cancel(timeout);}
 };
 const check=async(version)=>{
  if(stopped||version!==epoch||state!=='disconnected')return;
  if(!probe){finish('no_transport_evidence');return;}
  if(clock()-started>=maxRecoveryMs){finish('recovery_limit');return;}
  await baseline;
  if(stopped||version!==epoch||state!=='disconnected')return;
  const evidence=await inspect();
  if(stopped||version!==epoch||state!=='disconnected')return;
  if(clock()-started>=maxRecoveryMs){finish('recovery_limit');return;}
  if(evidence?.mediaProgress===true&&evidence.controlOpen===true){
   emit('continued',{reason:'media_progress',mediaProgress:true,controlOpen:true});
   timer=schedule(()=>{timer=undefined;void check(version);},Math.min(2000,maxRecoveryMs-(clock()-started)));
  }else finish(evidence?'transport_stalled':'probe_unavailable');
 };
 return {
  change(next){
   if(stopped)return;
   if(next===state)return;const wasDisconnected=state==='disconnected';state=next;
   if(state==='failed'||state==='closed'){finish(state);}
   else if(state==='disconnected'){
    started=clock();const version=++epoch;emit('started');
    baseline=probe?inspect():undefined;
    timer=schedule(()=>{timer=undefined;void check(version);},delay);
   }else{clear();epoch++;if(wasDisconnected&&state==='connected')emit('recovered');}
  },
  stop(){stopped=true;epoch++;clear();},
 };
}
export function voiceProfile(mode,draft,students,id){
 if(mode==='profile')return draft;
 return id===null?{id:'',name:'',stage:'',interest:'',gpa:'',color:'peach'}:students.find(student=>student.id===id)||draft;
}
