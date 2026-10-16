import {diagnosticRecord,clientDiagnosticRecord,createMetadata,MAX_EVENT_BYTES} from './event-schema.mjs';
import {dependencyOperations,jobNames,latencyBuckets,providerLatencyBuckets} from './metrics.mjs';
import {endpoints} from './event-catalog.mjs';
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export const environments=Object.freeze(['production','staging','test','development']);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>'value'in d);
export function validateWireEvent(input){
 if(!plain(input)||input.schemaVersion!==1||!uuid(input.eventId)||!uuid(input.instanceId)||!environments.includes(input.environment)||typeof input.time!=='string'||!Number.isFinite(Date.parse(input.time))||new Date(input.time).toISOString()!==input.time)throw new Error('invalid_telemetry_event');
 const metadata=createMetadata({NODE_ENV:input.environment,APPLICATION_REVISION:input.release});
 const reconstructed=diagnosticRecord(input.producer==='browser'?clientDiagnosticRecord(input):input,{...input,metadata});
 const canonical={...reconstructed,eventId:input.eventId,time:input.time,instanceId:input.instanceId};
 if(Object.keys(input).length!==Object.keys(canonical).length||Object.entries(canonical).some(([key,value])=>!Object.hasOwn(input,key)||input[key]!==value)||Buffer.byteLength(JSON.stringify(canonical))>MAX_EVENT_BYTES)throw new Error('invalid_telemetry_event');
 return Object.freeze(canonical);
}
export function validateMetric(input){
 const keys=['schemaVersion','instanceId','sequence','interval','environment','service','family','operation','outcome','count','sumMs','buckets','coverage'];
 if(!plain(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.schemaVersion!==1||!uuid(input.instanceId)||!Number.isSafeInteger(input.sequence)||input.sequence<1||!environments.includes(input.environment)||input.service!=='origen-api'||!['api','provider','database','job'].includes(input.family)||!['completed','failed','cancelled','unknown','skipped-lock'].includes(input.outcome)||!['complete','partial'].includes(input.coverage))throw new Error('invalid_telemetry_metric');
 const allowed=input.family==='api'?[...endpoints,'unknown_route']:input.family==='job'?jobNames:dependencyOperations;
 const bounds=input.family==='provider'?providerLatencyBuckets:latencyBuckets;
 if(!allowed.includes(input.operation)||!Number.isSafeInteger(input.count)||input.count<0||input.count>10000000||!Number.isFinite(input.sumMs)||input.sumMs<0||input.sumMs>6000000000000||!Array.isArray(input.buckets)||input.buckets.length!==bounds.length+1||input.buckets.some(n=>!Number.isSafeInteger(n)||n<0)||input.buckets.reduce((a,b)=>a+b,0)!==input.count||typeof input.interval!=='string'||new Date(input.interval).toISOString()!==input.interval||Date.parse(input.interval)%60000!==0)throw new Error('invalid_telemetry_metric');
 return Object.freeze({...input,buckets:Object.freeze([...input.buckets])});
}
