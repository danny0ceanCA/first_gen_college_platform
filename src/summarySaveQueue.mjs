// Keep each segment's captured target, token and transcript in its own job.
// Jobs stay in memory only; never persist transcripts or tokens in browser storage.
export function summarySaveQueue(){
 const jobs=new Map();let running;
 return {
  add(id,save){if(!jobs.has(id))jobs.set(id,save);},
  get size(){return jobs.size;},
  flush(){
   if(running)return running;
   running=(async()=>{for(const [id,save] of jobs){await save();jobs.delete(id);}})().finally(()=>{running=undefined;});
   return running;
  },
 };
}
