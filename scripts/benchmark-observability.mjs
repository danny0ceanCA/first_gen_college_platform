import {createServer} from 'node:http';
import {once} from 'node:events';
import {instrumentRequest} from '../server/api-logging.mjs';
import {createBoundedWriter} from '../server/observability/logger.mjs';
import {diagnosticRecord} from '../server/observability/event-schema.mjs';
import {providerOperation,databaseOperation} from '../server/observability/dependencies.mjs';

// Synthetic, localhost-only comparison. No database, provider or customer data.
const percentile=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length*0.95)];
const results=[];
for(const concurrency of [1,10,25]){
 const measurements=[];
 for(const enabled of [false,true]){
  const durations=[],request=async()=>new Response('{}'),database={connect:async()=>({query:async()=>({rowCount:1}),release(){}})};
  const provider=enabled?providerOperation('summary.generate',request,{log:()=>{}}):request;
  const server=createServer((req,res)=>{const started=performance.now();const ctx=enabled?instrumentRequest(req,res,()=>{}):null;const respond=async()=>{await (await provider('synthetic',{})).json();const client=enabled?await databaseOperation(database,'history.save',{log:()=>{}}):await database.connect();await client.query('BEGIN');await client.query('COMMIT');client.release();res.end('ok');durations.push(performance.now()-started);};if(ctx)void ctx.run(respond);else void respond();});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/api/chat`;let next=0;
  try{await Promise.all(Array.from({length:concurrency},async()=>{while(next++<1000){const response=await fetch(url);await response.text();}}));measurements.push(percentile(durations));}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
 results.push({concurrency,requestsPerMode:1000,offP95Ms:measurements[0],onP95Ms:measurements[1],addedP95Ms:measurements[1]-measurements[0]});
}
const sink=createBoundedWriter(()=>new Promise(()=>{}));
for(let i=0;i<10000;i++)void sink(JSON.stringify(diagnosticRecord({event:'db.operation.finished',operation:'history.save',outcome:'completed',durationMs:1}))+'\n');
globalThis.gc?.();const before=process.memoryUsage().rss;
for(let i=0;i<10000;i++)void sink(JSON.stringify(diagnosticRecord({event:'db.operation.finished',operation:'history.save',outcome:'completed',durationMs:1}))+'\n');
globalThis.gc?.();const queue=sink.stats(),rssDeltaBytes=process.memoryUsage().rss-before;await sink.close();
process.stdout.write(JSON.stringify({results,saturatedSink:{...queue,rssDeltaBytes},limits:'Short synthetic saturation check; not a ten-minute outage or staging hardware benchmark.'},null,2)+'\n');
