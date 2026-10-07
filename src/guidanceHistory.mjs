// Only accept server-issued attribution. Preview calls never supply it.
export function guidanceHistory(post){
 let current,logicalSession,segments=[],sequence=0,queue=Promise.resolve();
 return {
  reset(){current=undefined;logicalSession=undefined;segments=[];sequence=0;},
  resetScope(){current=undefined;segments=[];},
  accept(value){if(value?.sessionId&&value?.segmentId){if(logicalSession!==value.sessionId){segments=[];sequence=0;}logicalSession=value.sessionId;current={sessionId:value.sessionId,segmentId:value.segmentId};if(!segments.includes(value.segmentId))segments.push(value.segmentId);}},
  current(){return current&&{...current};},
  attribution(){return current&&{sessionId:current.sessionId,segmentIds:[...segments]};},
  event(name,payload={}){if(!current)return;const body={eventId:crypto.randomUUID(),sessionId:current.sessionId,segmentId:current.segmentId,sequence:++sequence,occurredAt:new Date().toISOString(),name,payload};queue=queue.catch(()=>{}).then(()=>post(body));return queue;},
 };
}
