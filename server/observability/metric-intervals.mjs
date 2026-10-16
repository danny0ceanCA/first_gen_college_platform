export function createMetricIntervals(metadata,{clock=Date.now}={}){
 let previous=new Map(),sequence=0,last=clock();
 return snapshot=>{
  const now=clock(),interval=new Date(Math.floor(last/60000)*60000).toISOString();
  const complete=now-last>=55000&&now-last<=65000&&last%60000<1000&&now%60000<1000;const next=new Map(),frames=[];
  for(const row of snapshot.series){const key=JSON.stringify([row.family,row.operation,row.outcome]),old=previous.get(key);next.set(key,row);const count=row.count-(old?.count||0);if(count<=0)continue;
   frames.push({schemaVersion:1,instanceId:metadata.instanceId,sequence:++sequence,interval,environment:metadata.environment,service:metadata.service,family:row.family,operation:row.operation,outcome:row.outcome,count,sumMs:Math.max(0,row.sumMs-(old?.sumMs||0)),buckets:row.buckets.map((n,i)=>Math.max(0,n-(old?.buckets[i]||0))),coverage:old&&complete?'complete':'partial'});
  }
  previous=next;last=now;return frames;
 };
}
