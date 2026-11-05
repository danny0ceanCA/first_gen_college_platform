// A confirmed spoken selection is an operation, not a single transcript turn.
// Ordinary follow-ups do not revoke it. A different explicit target, closing,
// or the caller's existing session/privacy guards can invalidate the load.
export function voiceInitialScope(){
 let current,tail=Promise.resolve();
 return {
  select(studentId,load){
   if(current?.studentId===studentId)return current.promise;
   const job={studentId};current=job;
   // Invalidate the older target immediately, but allow its configuration task
   // to release the shared update stream before loading the newest selection.
   job.promise=tail.then(()=>current===job?load(()=>current===job):false).then(value=>({accepted:current===job&&value===true,superseded:current!==job})).finally(()=>{if(current===job)current=undefined;});
   tail=job.promise.catch(()=>{});
   return job.promise;
  },
  stop(){current=undefined;},
 };
}
