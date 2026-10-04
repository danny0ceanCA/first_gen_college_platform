// Keep each segment's captured target, token and transcript in its own job.
// Jobs stay in memory only; never persist transcripts or tokens in browser storage.
export function summarySaveQueue(){
 const jobs=new Map();let running;
 return {
  add(id,save){if(!jobs.has(id))jobs.set(id,save);},
  get size(){return jobs.size;},
  flush(){
   if(running)return running;
   running=(async()=>{const failures=[];for(const [id,save] of jobs){try{await save();jobs.delete(id);}catch(error){failures.push(error);}}if(failures.length)throw new AggregateError(failures,'Some summaries could not be saved');})().finally(()=>{running=undefined;});
   return running;
  },
 };
}
