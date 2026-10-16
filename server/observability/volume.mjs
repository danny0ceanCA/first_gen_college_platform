// Shared by all stdout loggers in one process. No IDs or content in group keys.
export function createVolumeGate({clock=Date.now,limit=3000,reserved=100}={}){
 let minute=Math.floor(clock()/60000),used=0,dropped=0;const groups=new Map();
 return {
  drain(){const current=Math.floor(clock()/60000);if(current===minute)return [];minute=current;used=0;const result=[...groups.values()];groups.clear();return result;},
  accept(record){
   const privileged=['telemetry.gap','telemetry.aggregate','runtime.health.observed','telemetry.canary'].includes(record.event);
   if(used<(privileged?limit:limit-reserved)){used++;return true;}
   dropped++;if(record.level==='error'||record.level==='warn'){
    const key=JSON.stringify([record.event,record.endpoint,record.code]);const group=groups.get(key);
    if(group)group.occurrenceCount++;else if(groups.size<Math.max(0,reserved-20))groups.set(key,{sourceEvent:record.event,endpoint:record.endpoint,code:record.code,occurrenceCount:1});
   }return false;
  },
  stats:()=>({volumeDropped:dropped,volumeUsed:used}),
 };
}
