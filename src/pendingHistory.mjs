// Leave an item queued until the server confirms its idempotent save.
export async function flushPendingHistory(pending,studentIds,save){
 const failures=[];
 for(const item of pending.values()){
  if(item.studentId!==null&&!studentIds.has(item.studentId))continue;
  try{await save(item);
   if(pending.get(item.id)===item)pending.delete(item.id);
  }catch(error){failures.push(error);}
 }
 if(failures.length)throw new AggregateError(failures,'Some summaries could not be saved');
}
