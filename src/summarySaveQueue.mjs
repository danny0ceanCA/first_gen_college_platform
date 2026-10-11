// Keep each segment's captured target, token and transcript in its own job.
// Jobs stay in memory only; never persist transcripts or tokens in browser storage.
export function summarySaveQueue(){
 const jobs=new Map(),removed=new Set();let running,closed=false;
 const remove=id=>{removed.add(id);jobs.get(id)?.controller.abort();jobs.delete(id);};
 return {
  add(id,save){if(!closed&&!removed.has(id)&&!jobs.has(id))jobs.set(id,{save,controller:new AbortController()});},
  remove,
  clear(){closed=true;for(const id of jobs.keys())remove(id);},
  get size(){return jobs.size;},
  flush(){
   if(running)return running;
   running=(async()=>{const failures=[];for(const [id,job] of jobs){if(closed||job.controller.signal.aborted)continue;try{await job.save(job.controller.signal);jobs.delete(id);}catch(error){if(error?.name==='AbortError'&&error?.message==='privacy_session_ended')remove(id);else if(!closed&&!job.controller.signal.aborted)failures.push(error);}}if(failures.length)throw new AggregateError(failures,'Some summaries could not be saved');})().finally(()=>{running=undefined;});
   return running;
  },
 };
}
