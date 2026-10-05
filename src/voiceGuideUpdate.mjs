// Change instructions/tools on the existing channel; never close audio for a topic change.
export function voiceGuideUpdate(send,{schedule=setTimeout,cancel=clearTimeout}={}){
 let pending;
 return {
  update(session){
   if(pending)return Promise.reject(new Error('guide_update_busy'));
   return new Promise((resolve,reject)=>{
    const eventId=crypto.randomUUID();
    pending={eventId,session,resolve,reject,timer:schedule(()=>{pending=undefined;reject(new Error('guide_update_timeout'));},10000)};
    try{send({type:'session.update',event_id:eventId,session});}catch(error){cancel(pending.timer);pending=undefined;reject(error);}
   });
  },
  event(event){
   if(!pending)return false;
   const failed=event.type==='error'&&event.error?.event_id===pending.eventId;
   const accepted=event.type==='session.updated'&&event.session?.instructions===pending.session.instructions;
   if(!failed&&!accepted)return false;
   const job=pending;pending=undefined;cancel(job.timer);
   if(failed)job.reject(new Error('guide_update_rejected'));else job.resolve();
   return true;
  },
  stop(){if(pending){cancel(pending.timer);pending.reject(new Error('guide_update_stopped'));pending=undefined;}}
 };
}
