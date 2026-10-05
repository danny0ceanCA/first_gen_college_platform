// Change instructions/tools on the existing channel; never close audio for a topic change.
export function voiceGuideUpdate(send,{schedule=setTimeout,cancel=clearTimeout}={}){
 let pending;
 const expired=new Map(),owned=new Set();
 return {
  update(session,onApplied=()=>{}){
   if(pending)return Promise.reject(new Error('guide_update_busy'));
   return new Promise((resolve,reject)=>{
    const eventId=crypto.randomUUID();
    owned.add(eventId);if(owned.size>32)owned.delete(owned.values().next().value);
    pending={eventId,session,resolve,reject,onApplied,timer:schedule(()=>{const job=pending;pending=undefined;expired.set(eventId,job);if(expired.size>8)expired.delete(expired.keys().next().value);reject(new Error('guide_update_timeout'));},10000)};
    try{send({type:'session.update',event_id:eventId,session});}catch(error){cancel(pending.timer);pending=undefined;reject(error);}
   });
  },
  event(event){
   if(event.type==='error'&&owned.has(event.error?.event_id)&&pending?.eventId!==event.error.event_id){expired.delete(event.error.event_id);return true;}
   if(event.type==='session.updated')for(const [id,job] of expired){if(event.session?.instructions===job.session.instructions){expired.delete(id);job.onApplied();return true;}}
   if(!pending)return false;
   const failed=event.type==='error'&&event.error?.event_id===pending.eventId;
   const accepted=event.type==='session.updated'&&event.session?.instructions===pending.session.instructions;
   if(!failed&&!accepted)return false;
   const job=pending;pending=undefined;cancel(job.timer);
   if(failed)job.reject(new Error('guide_update_rejected'));else {job.onApplied();job.resolve();}
   return true;
  },
  stop(){if(pending){cancel(pending.timer);pending.reject(new Error('guide_update_stopped'));pending=undefined;}expired.clear();owned.clear();}
 };
}
