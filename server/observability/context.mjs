import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes} from 'node:crypto';

const storage=new AsyncLocalStorage();
const hex=bytes=>randomBytes(bytes).toString('hex');
export const currentDiagnosticContext=()=>storage.getStore()?.snapshot();
// The mutable pointer is private to one request; every exposed snapshot is frozen.
export function createDiagnosticContext(base={}){
 let frame=Object.freeze({...base,traceId:hex(16),spanId:hex(8)});
 const controller={snapshot:()=>frame,run:work=>storage.run(controller,work),bind(operation){frame=Object.freeze({...frame,operationId:operation.operationId,traceId:operation.traceId});}};
 return Object.freeze(controller);
}
export function withDiagnosticSpan(work){
 const parent=storage.getStore();if(!parent)return work();
 const spanId=hex(8),parentSpanId=parent.snapshot().spanId;
 return storage.run({snapshot:()=>Object.freeze({...parent.snapshot(),spanId,parentSpanId})},work);
}
export const runDiagnosticJob=work=>createDiagnosticContext().run(work);
