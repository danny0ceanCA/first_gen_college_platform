import {endpoints} from './event-catalog.mjs';
export const latencyBuckets=Object.freeze([50,100,250,500,1000,2500,5000,15000,45000,90000]);
export const providerLatencyBuckets=Object.freeze(latencyBuckets.slice(4));
export const dependencyOperations=Object.freeze(['summary.generate','summary.overview','summary.review','notes.generate','voice.negotiate','finance.lookup','admissions.lookup','chat.respond','history.read','history.save','history.delete','notes.list','notes.save','permission.read','permission.hangup']);
export const jobNames=Object.freeze(['permission-data','diagnostic-maps','metrics','invites','private-summaries','privacy-events','inquiries','outreach','guidance','progress','report-snapshots','quality','onboarding','admin-reviews','privacy-alerts','permission-supervisor']);
const outcomes=new Set(['completed','failed','cancelled','unknown','skipped-lock']);
export function createMetrics(){
 const series=new Map(),gauges=new Map();
 return Object.freeze({
  observe(family,operation,outcome,durationMs){
   if(!['api','provider','database','job'].includes(family)||!outcomes.has(outcome)||!Number.isFinite(durationMs)||durationMs<0)return;
   const allowed=family==='api'?[...endpoints,'unknown_route']:family==='job'?jobNames:dependencyOperations;
   if(!allowed.includes(operation))return;
   const key=JSON.stringify([family,operation,outcome]);let row=series.get(key);
   if(!row){const bounds=family==='provider'?providerLatencyBuckets:latencyBuckets;row={family,operation,outcome,count:0,sumMs:0,bounds,buckets:Array(bounds.length+1).fill(0)};series.set(key,row);}
   const bucket=row.bounds.findIndex(bound=>durationMs<=bound);row.count++;row.sumMs+=Math.min(durationMs,600000);row.buckets[bucket<0?row.bounds.length:bucket]++;
  },
  gauge(name,value){if(['rssBytes','heapBytes','eventLoopDelayMs','poolTotal','poolIdle','poolWaiting','queueDepth','queueDropped','hangupBacklog','hangupOldestMs','staleAttempts'].includes(name)&&Number.isFinite(value)&&value>=0)gauges.set(name,Math.min(value,Number.MAX_SAFE_INTEGER));},
  snapshot(){return {series:[...series.values()].map(row=>({...row,buckets:[...row.buckets]})),gauges:Object.fromEntries(gauges)};},
 });
}
export const metrics=createMetrics();
