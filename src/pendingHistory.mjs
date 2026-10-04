// Leave an item queued until the server confirms its idempotent save.
export async function flushPendingHistory(pending,studentIds,save){
 for(const item of pending.values()){
  if(item.studentId!==null&&!studentIds.has(item.studentId))continue;
  await save(item);
  if(pending.get(item.id)===item)pending.delete(item.id);
 }
}
