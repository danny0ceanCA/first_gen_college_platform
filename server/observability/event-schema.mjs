import {randomUUID} from 'node:crypto';
import {clientEvents,clientCodes,clientFields,clientSchemas,serverEvents,enumFields,numericFields,endpoints} from './event-catalog.mjs';
import {technicalCodes} from './error-codes.mjs';
import {responseCodes} from './response-codes.mjs';

const browserRecords=new WeakSet(),records=new WeakSet();
const codes=new Set([...technicalCodes,...responseCodes,...clientCodes]);
const instanceId=randomUUID(),metadataRecords=new WeakSet();
export const MAX_EVENT_BYTES=4096;
// Read own data properties only: untrusted getters/prototypes never run here.
const value=(input,key)=>{
 if(!input||typeof input!=='object'||Array.isArray(input))return undefined;
 return Object.getOwnPropertyDescriptor(input,key)?.value;
};
export function safeCode(code){return codes.has(code)?code:undefined;}
export function createMetadata(env=process.env){
 const revision=env.RENDER_GIT_COMMIT||env.APPLICATION_REVISION||env.GITHUB_SHA;
 const result=Object.freeze({service:'origen-api',environment:['production','staging','test','development'].includes(env.NODE_ENV)?env.NODE_ENV:'development',release:typeof revision==='string'&&/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(revision)?revision.toLowerCase():'unknown',instanceId});
 metadataRecords.add(result);return result;
}
const defaults=createMetadata();
function attributes(input,keys,out,browser=false){
 for(const key of keys){
  const v=value(input,key);
  if(key==='code'){if(typeof v==='string')out.code=(browser?clientCodes.includes(v)&&v:safeCode(v))||'other';}
  else if(Object.hasOwn(enumFields,key)){if(enumFields[key].includes(v))out[key]=v;}
  else if(Object.hasOwn(numericFields,key)&&Number.isFinite(v)&&v>=0){
   if(key==='httpStatus'&&(v<100||v>599||!Number.isInteger(v)))continue;
   out[key]=Math.min(numericFields[key],key==='samplingProbability'?v:Math.round(v));
  }
 }
 return out;
}
export function clientDiagnosticRecord(input){
 const event=value(input,'event');
 const out=attributes(input,clientFields,{event:clientEvents.includes(event)?event:'unknown_client_event'},true);
 // Client identifiers are deliberately absent. Ownership correlation is phase 2.
 browserRecords.add(out);return Object.freeze(out);
}
export function diagnosticRecord(input,context={}){
 if(input&&records.has(input))return input;
 let event=value(input,'event');if(typeof event!=='string')event=undefined;
 const browser=!!input&&browserRecords.has(input)||!Object.hasOwn(serverEvents,event)&&clientEvents.includes(event);
 const spec=browser?clientSchemas[event]:Object.hasOwn(serverEvents,event)?serverEvents[event]:serverEvents.diagnostic_rejected;
 const recognized=browser||Object.hasOwn(serverEvents,event);
 if(!recognized)event='diagnostic_rejected';
 const metadata=metadataRecords.has(context.metadata)?context.metadata:defaults;
 const out={schemaVersion:1,eventId:randomUUID(),time:new Date().toISOString(),...metadata,event,level:spec.level,producer:browser?'browser':'server',evidence:browser?'client_reported':'server_observed'};
 attributes(input,spec.fields,out,browser);
 if(!recognized)out.reason='unknown_event';
 if(!browser&&out.outcome==='failed')out.level='error';
 if(['api_request','api_aborted'].includes(event)&&out.httpStatus)out.level=out.httpStatus>=500?'error':out.httpStatus>=400?'warn':'info';
 // Only server-created request context may provide correlation/route fields.
 if(typeof context.requestId==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(context.requestId))out.requestId=context.requestId;
 if(endpoints.includes(context.endpoint)||context.endpoint==='unknown_route')out.endpoint=context.endpoint;
 if(enumFields.method.includes(context.method))out.method=context.method;
 if(typeof context.operationId==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(context.operationId))out.operationId=context.operationId;
 for(const [key,length] of [['traceId',32],['spanId',16],['parentSpanId',16]])if(typeof context[key]==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(context[key]))out[key]=context[key];
 if(Buffer.byteLength(JSON.stringify(out))>MAX_EVENT_BYTES)throw new Error('diagnostic_record_too_large');
 records.add(out);return Object.freeze(out);
}
