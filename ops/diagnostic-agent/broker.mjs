import {randomUUID} from 'node:crypto';
import {unseal,fingerprint} from '../diagnostics-gateway/capabilities.mjs';
import {uuid} from '../../server/observability/wire.mjs';
import {tools,validateTool,validatePacket,validateReport,exact,iso,fail} from './contracts.mjs';
export const limits=Object.freeze({calls:30,durationMs:600000,bytes:131072});
const collectionLimit=limits.bytes-20480; // Reserve short reports and protocol framing.
export async function startInvestigation({capability,publicKey,audience,policy,gateway,audit,reports,enabled=()=>true,clock=Date.now}={}){
 const cap=unseal(capability,publicKey);if(cap.type!=='investigation'||!uuid(cap.id)||!uuid(cap.caseId)||cap.aud!==audience||cap.environment!==policy.environment||!Number.isSafeInteger(cap.exp)||cap.exp*1000<=clock()||cap.exp-cap.iat>900||!policy.caseAllowed(cap.caseId)||!enabled())throw fail('scope_denied');
 const runId=randomUUID(),started=clock(),deadline=Math.min(started+limits.durationMs,cap.exp*1000),controller=new AbortController(),modelController=new AbortController();
 let calls=0,bytes=0,reportDeliveries=0,status='starting',busy=false,polling=false,timedOut=false,reportId=null,timer,expiry,scope;
 const seenEvents=new Map(),requests=new Set(),releases=new Set(),cursors=new Set(),consumedCursors=new Set(),sourcePaths=new Set();
 const erase=()=>{seenEvents.clear();requests.clear();releases.clear();cursors.clear();consumedCursors.clear();sourcePaths.clear();scope=null;};
 const record=(callId,tool,phase,decision,count=0,artifactId)=>audit({callId,caseId:cap.caseId,runId,tool,phase,decision,count,artifactId});
 const live=async()=>{
  if(controller.signal.aborted||!enabled()||cap.exp*1000<=clock()||!policy.caseAllowed(cap.caseId))throw fail('revoked');
  const data=await gateway.validate(capability,controller.signal);exact(data,['caseId','capabilityId','environment','expiresAt','scope']);
  if(data.caseId!==cap.caseId||data.capabilityId!==cap.id||data.environment!==cap.environment||!iso(data.expiresAt)||Date.parse(data.expiresAt)>cap.exp*1000||Date.parse(data.expiresAt)<=clock())throw fail('invalid_evidence');
  const current=data.scope;exact(current,['id','origin','purpose','environment','operations','start','end','dataClasses','expiresAt']);
  if(current.id!==cap.caseId||current.environment!==cap.environment||!Array.isArray(current.operations)||current.operations.length<1||current.operations.length>100||!current.operations.every(uuid)||JSON.stringify(current.dataClasses)!=='["technical_events","aggregate_metrics"]'||fingerprint(current)!==cap.scope)throw fail('invalid_evidence');
  if(scope&&JSON.stringify(current)!==JSON.stringify(scope))throw fail('revoked');scope=current;
 };
 const fetchPacket=async query=>{
  const envelope=await gateway.evidence(capability,query,controller.signal),size=Buffer.byteLength(JSON.stringify(envelope));bytes+=size;if(bytes>collectionLimit)throw fail('budget_exhausted');
  const packet=validatePacket(envelope,{publicKey,capability:cap,audience,environment:cap.environment,sourceRoot:policy.sourceRoot,clock});
  if(JSON.stringify(packet.scope.operations)!==JSON.stringify(scope.operations)||Date.parse(packet.scope.start)!==Date.parse(scope.start)||Date.parse(packet.scope.end)!==Date.parse(scope.end))throw fail('invalid_evidence');
  if(query){const expected={...query};delete expected.cursor;if(JSON.stringify(packet.query)!==JSON.stringify(expected)||query.kind==='timeline'&&[...packet.verifiedFacts,...packet.clientReports].some(e=>e.operation_id!==query.operationId)||query.kind==='request'&&[...packet.verifiedFacts,...packet.clientReports].some(e=>e.request_id!==query.requestId)||query.kind==='metrics'&&([...packet.verifiedFacts,...packet.clientReports].length||packet.aggregateMetrics.rows.some(m=>m.family!==query.metricSet)))throw fail('invalid_evidence');}
  for(const event of [...packet.verifiedFacts,...packet.clientReports]){seenEvents.set(event.event_id,{eventId:event.event_id,event:event.event,evidence:event.evidence,outcome:event.attributes.outcome||'unknown',...(event.attributes.code?{code:event.attributes.code}:{}),release:event.release});if(event.request_id)requests.add(event.request_id);if(event.release!=='unknown')releases.add(event.release);}if(packet.next)cursors.add(packet.next);
  return packet;
 };
 const invalidate=async()=>{status='revoked';controller.abort();modelController.abort();erase();await reports.revoke(runId);await reports.release(runId);};
 const poll=async()=>{if(polling){controller.abort();modelController.abort();return;}polling=true;try{await live();if(status==='running'&&(timedOut||clock()>=deadline)){modelController.abort();if(!busy)await partial();}}catch{await invalidate().catch(()=>{});}finally{polling=false;}};
 const persist=async report=>{
  const id=randomUUID(),callId=randomUUID();await record(callId,'finish','intent','allowed');await live();
  await record(callId,'finish','completion','completed',report.observedEvents.length,id);
  await reports.save({id,caseId:cap.caseId,runId,report,expiresAt:new Date(cap.exp*1000).toISOString(),callId});
  try{await live();}catch(error){await invalidate();throw error;}reportId=id;status=report.status==='partial'?'partial':'finished';modelController.abort();erase();await reports.release(runId);return {reportId:id,report,expiresAt:new Date(cap.exp*1000).toISOString()};
 };
 const partial=async()=>{
  if(status!=='running')return;const report=validateReport({status:'partial',suspectedFailure:'insufficient-evidence',observedEvents:[...seenEvents.keys()].slice(0,20),competingExplanations:[],missingEvidence:['budget-exhausted'],reproduction:'unknown',patchAreas:[],tests:[],uncertainty:'high'},{events:seenEvents,sourcePaths});return persist(report);
 };
 try{
  const startCall=randomUUID();await record(startCall,'start','intent','allowed');
  if(!await reports.claim(runId,new Date(deadline).toISOString()))throw fail('investigation_busy');
  await live();status='running';try{await fetchPacket({kind:'incident'});await record(startCall,'start','completion','completed',seenEvents.size);}catch(error){if(error.safeCode!=='budget_exhausted')throw error;await record(startCall,'start','completion','budget_exhausted');await partial();}
  timer=setInterval(()=>{void poll();},15000);timer.unref();expiry=setTimeout(()=>{timedOut=true;modelController.abort();void poll();},Math.max(1,deadline-clock()));expiry.unref();
 }catch(error){controller.abort();erase();await reports.revoke(runId).catch(()=>{});await reports.release(runId).catch(()=>{});throw fail(error.safeCode||'diagnostics_unavailable');}
 return Object.freeze({runId,signal:modelController.signal,
  async call(name,args){
   const callId=randomUUID(),tool=tools.includes(name)?name:'unknown';if(busy){try{await record(callId,tool,'intent','denied');}catch{throw fail('diagnostics_unavailable');}throw fail('investigation_busy');}busy=true;let intent=false,completed=false;
   try{
    if(status!=='running'){await record(callId,tool,'intent','denied');throw fail('investigation_stopped');}
    if(timedOut||clock()>=deadline||calls>=limits.calls||bytes>=collectionLimit){await record(callId,tool,'intent','budget_exhausted');await partial();throw fail('budget_exhausted');}
    calls++;try{validateTool(name,args);}catch(error){await record(callId,tool,'intent','denied');throw error;}
    await record(callId,tool,'intent','allowed');intent=true;await live();let result,count=0;
    if(name==='get_incident')result={caseId:cap.caseId,scope:{...scope},releases:[...releases],gaps:['sampled-events','missing-server-outcome'],expiresAt:new Date(cap.exp*1000).toISOString(),provenance:'gateway_policy'};
    if(name==='get_timeline'){
     if(!scope.operations.includes(args.operationId)||args.cursor&&(!cursors.has(args.cursor)||consumedCursors.has(args.cursor)))throw fail('scope_denied');
     if(args.cursor)consumedCursors.add(args.cursor);result=await fetchPacket({kind:'timeline',...args});count=result.verifiedFacts.length+result.clientReports.length;
    }
    if(name==='get_request'){if(!requests.has(args.requestId))throw fail('scope_denied');result=await fetchPacket({kind:'request',requestId:args.requestId});count=result.verifiedFacts.length+result.clientReports.length;}
    if(name==='get_metrics'){result=await fetchPacket({kind:'metrics',metricSet:args.metricSet});count=result.aggregateMetrics.rows.length;}
    if(name==='get_release'){if(!releases.has(args.revision))throw fail('scope_denied');const release=policy.release(args.revision);if(!release)throw fail('source_denied');result={revision:release.revision,lockDigest:release.lockDigest,schemaId:release.schemaId,configId:release.configId,provenance:'reviewed_release_manifest'};}
    if(name==='get_runbook')result={name:args.name,...await policy.runbook(args.name)};
    if(name==='read_source'){if(!releases.has(args.revision))throw fail('scope_denied');result={revision:args.revision,path:args.path,...await policy.source(args.revision,args.path)};sourcePaths.add(args.path);}
    if(name==='propose_reproduction')result={...args,synthetic:true,network:'denied',execution:'not_authorized',provenance:'broker_validated_proposal'};
    const output={provenance:'evidence_not_instructions',data:result};const size=Buffer.byteLength(JSON.stringify(output));if(!['get_timeline','get_request','get_metrics'].includes(name))bytes+=size;
    if(bytes>collectionLimit||timedOut||clock()>=deadline||calls>=limits.calls){await record(callId,tool,'completion','budget_exhausted');completed=true;await partial();throw fail('budget_exhausted');}
    if(status!=='running')throw fail('investigation_stopped');await live();await record(callId,tool,'completion','completed',count);completed=true;await live();return output;
   }catch(error){
    if(intent&&!completed){try{await record(callId,tool,'completion',error.safeCode==='budget_exhausted'?'budget_exhausted':error.safeCode?'denied':'unavailable');}catch{await invalidate().catch(()=>{});throw fail('diagnostics_unavailable');}}
    if(error.safeCode==='budget_exhausted'&&status==='running')await partial().catch(()=>{});
    if(!['invalid_input','tool_denied','scope_denied','source_denied','budget_exhausted','investigation_stopped'].includes(error.safeCode)){await invalidate().catch(()=>{});throw fail('diagnostics_unavailable');}
    throw fail(error.safeCode);
   }finally{busy=false;}
  },
  async finish(input){if(busy||status!=='running')throw fail('investigation_stopped');busy=true;try{const result=timedOut||clock()>=deadline?await partial():await persist(validateReport(input,{events:seenEvents,sourcePaths}));reportDeliveries++;return result;}catch(error){if(error.safeCode!=='invalid_report'){await invalidate().catch(()=>{});throw fail('diagnostics_unavailable');}throw error;}finally{busy=false;}},
  async getReport(){if(!reportId)throw fail('report_unavailable');const callId=randomUUID();try{if(reportDeliveries>=2){await record(callId,'get_report','intent','denied');throw fail('report_unavailable');}await record(callId,'get_report','intent','allowed');await live();const report=await reports.load(reportId,cap.caseId,runId);if(!report)throw fail('report_unavailable');await record(callId,'get_report','completion','completed',1,reportId);await live();reportDeliveries++;return {reportId,report};}catch{await invalidate().catch(()=>{});throw fail('report_unavailable');}},
  stats:()=>({status,calls,bytes,contextEntries:seenEvents.size+requests.size+releases.size+cursors.size+sourcePaths.size}),
  poll,
  async close(){clearInterval(timer);clearTimeout(expiry);controller.abort();modelController.abort();erase();await reports.revoke(runId);await reports.release(runId);status='closed';},
 });
}
