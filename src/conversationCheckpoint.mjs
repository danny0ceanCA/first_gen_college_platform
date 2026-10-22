// Memory-only transport buffer. The server acknowledgement is the durability
// boundary; an attempted request, local timer or provider response is not one.
export function conversationCheckpoint({post,epoch,contextRevision,onState=()=>{},delayMs=2000}){
 let latest,acked=0,sequence=0,running,timer,closed=false,ending=false,mode,studentId,id;
 const flush=()=>{
  clearTimeout(timer);
  if(running)return running.then(()=>latest&&acked<latest.sequence?flush():undefined);
  if(closed||!latest||acked===latest.sequence)return Promise.resolve();
  const current=latest;
  running=(async()=>{
   onState('saving');
   const result=await post({action:'checkpoint',epoch,contextRevision,...current});
   if(closed)return;
   if(result.sequence!==current.sequence||!result.acknowledged)throw new Error('checkpoint_not_acknowledged');
   acked=current.sequence;onState(result.status==='review'?'review':latest.sequence===acked?'protected':'saving');
  })().catch(error=>{if(!closed)onState('failed');throw error;}).finally(()=>{running=undefined;});
  return running.then(()=>latest&&acked<latest.sequence?flush():undefined);
 };
 return {
  update(body){
   if(closed||ending)return;
   if(!id){id=body.id;mode=body.mode;studentId=body.studentId;}
   if(body.id!==id||body.studentId!==studentId)throw new Error('checkpoint_scope_changed');
   latest={id,sequence:++sequence,body:JSON.parse(JSON.stringify({...body,mode}))};
   onState('saving');clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),delayMs);
  },
  flush,
  async finish(){ending=true;await flush();if(closed||!latest)return;const result=await post({action:'finalize',id,sequence:acked});if(!closed)onState(result.status==='complete'?'complete':result.status==='review'?'review':'pending');return result;},
  stop(){closed=true;clearTimeout(timer);latest=undefined;},
  get id(){return id;},
 };
}
