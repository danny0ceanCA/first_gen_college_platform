import {randomUUID,createPrivateKey,createPublicKey} from 'node:crypto';
import {fingerprint,hash,newCapability,seal,unseal} from './capabilities.mjs';
import {uuid,environments} from '../../server/observability/wire.mjs';
const denied=()=>Object.assign(new Error('support_unavailable'),{status:403});
export function createInvestigator({authority,readEvidence,signingKey,publicKey,audience,environment,sourceRoot,gatewayRevision,machineSubjects=[],clock=Date.now,pollMs=15000}={}){
 const privateKey=createPrivateKey(signingKey),verificationKey=createPublicKey(publicKey);
 if(privateKey.asymmetricKeyType!=='ed25519'||verificationKey.asymmetricKeyType!=='ed25519'||!audience||!environments.includes(environment)||!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(sourceRoot)||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(gatewayRevision)||pollMs>15000||pollMs<10)throw new Error('support_configuration_invalid');
 if(unseal(seal({test:true},privateKey),verificationKey).test!==true)throw new Error('support_configuration_invalid');
 const active=new Map();let stopped=false,polling=false;
 const identity=actor=>{if(!actor||typeof actor.sub!=='string'||actor.sub.length>255||!Number.isSafeInteger(actor.iat)||actor.iat<=0||actor.iat>clock()/1000+30||!Array.isArray(actor.permissions)||!actor.permissions.includes('observability:investigate'))throw denied();};
 const validScope=scope=>!!scope&&uuid(scope.id)&&scope.environment===environment&&['user_report','system_incident'].includes(scope.origin)&&['sign-in','onboarding','voice','saving','availability'].includes(scope.purpose)&&Array.isArray(scope.operations)&&scope.operations.length>0&&scope.operations.length<=100&&scope.operations.every(uuid)&&new Set(scope.operations).size===scope.operations.length&&Number.isFinite(Date.parse(scope.start))&&Number.isFinite(Date.parse(scope.end))&&Date.parse(scope.end)>Date.parse(scope.start)&&Date.parse(scope.end)-Date.parse(scope.start)<=86400000&&Date.parse(scope.expiresAt)>clock()&&JSON.stringify(scope.dataClasses)==='["technical_events","aggregate_metrics"]';
 const decode=(actor,token,{allowIssuer=false}={})=>{
  identity(actor);const cap=unseal(token,verificationKey);
  if(stopped||cap.type!=='investigation'||!uuid(cap.id)||!uuid(cap.caseId)||!Number.isSafeInteger(cap.iat)||!Number.isSafeInteger(cap.exp)||cap.exp-cap.iat>900||cap.exp<=cap.iat||cap.iat>clock()/1000+30||cap.exp<=clock()/1000||cap.aud!==audience||cap.environment!==environment||cap.recipient!==hash(actor.sub)&&!(allowIssuer&&cap.actor===hash(actor.sub))||!/^[a-f0-9]{64}$/.test(cap.actor)||!Number.isSafeInteger(cap.actorIat)||!allowIssuer&&cap.actor!==hash(actor.sub)&&!machineSubjects.includes(actor.sub))throw denied();return cap;
 };
 const check=async(cap,principal)=>{
  if(stopped||cap.exp<=clock()/1000)throw denied();const started=clock();
  // Every query uses live sources. There is no positive authorization cache.
  await authority.fresh();const scope=await authority.scope(cap.caseId,cap.actor,cap.actorIat);
  if(principal&&hash(principal.sub)!==cap.actor){const recipientScope=await authority.scope(cap.caseId,hash(principal.sub),principal.iat,true);if(!validScope(recipientScope)||fingerprint(recipientScope)!==cap.scope)throw denied();}
  if(!validScope(scope)||fingerprint(scope)!==cap.scope||!await authority.authorized(cap)||clock()-started>60000)throw denied();
  return scope;
 };
 const abort=capId=>{for(const run of active.values())if(run.cap.id===capId)run.controller.abort();};
 const poll=async()=>{if(polling){for(const run of active.values())run.controller.abort();return;}polling=true;try{await Promise.all([...active.values()].map(async run=>{if(run.controller.signal.aborted)return;try{await check(run.cap,run.principal);}catch{run.controller.abort();}}));}finally{polling=false;}};
 const timer=setInterval(()=>{void poll();},pollMs);timer.unref();
 return {
  async validate(actor,token){const cap=decode(actor,token);await authority.audit(cap.caseId,hash(actor.sub),'query','authorized');const scope=await check(cap,actor);await authority.audit(cap.caseId,hash(actor.sub),'query','completed');return {caseId:cap.caseId,capabilityId:cap.id,environment,expiresAt:new Date(cap.exp*1000).toISOString(),scope};},
  async issue(actor,{caseId,purpose,recipient=actor?.sub}={}){
   identity(actor);if(stopped||!uuid(caseId)||typeof recipient!=='string'||!recipient||recipient.length>255||recipient!==actor.sub&&!machineSubjects.includes(recipient))throw denied();
   await authority.audit(caseId,hash(actor.sub),'issue','authorized');await authority.fresh();
   const scope=await authority.scope(caseId,hash(actor.sub),actor.iat,true);
   if(!validScope(scope)||scope.purpose!==purpose)throw denied();
   const cap=newCapability({scope,actor,recipient,audience,clock});await authority.register(cap,scope);await check(cap);
   return {capability:seal(cap,privateKey),expiresAt:new Date(cap.exp*1000).toISOString(),caseId};
  },
  async evidence(actor,token,query){
   const cap=decode(actor,token);await authority.audit(cap.caseId,hash(actor.sub),'query','authorized');const scope=await check(cap,actor);
   let selected;
   if(query!==undefined){
    if(!query||typeof query!=='object'||Array.isArray(query)||!['incident','timeline','request','metrics'].includes(query.kind)||Object.keys(query).some(k=>!['kind','operationId','requestId','cursor','metricSet'].includes(k)))throw denied();
    if(query.kind==='timeline'&&(!scope.operations.includes(query.operationId)||query.requestId!==undefined||query.metricSet!==undefined)||query.kind==='request'&&(!uuid(query.requestId)||query.operationId!==undefined||query.cursor!==undefined||query.metricSet!==undefined)||query.kind==='metrics'&&(!['api','provider','database','job'].includes(query.metricSet)||query.operationId!==undefined||query.requestId!==undefined||query.cursor!==undefined))throw denied();
    if(query.kind==='incident'&&Object.keys(query).length!==1)throw denied();selected={...query};if(query.cursor!==undefined){const cursor=unseal(query.cursor,verificationKey);if(cursor.type!=='timeline_cursor'||cursor.capabilityId!==cap.id||cursor.operationId!==query.operationId||cursor.scope!==cap.scope||cursor.exp<=clock()/1000||!uuid(cursor.eventId)||!Number.isFinite(Date.parse(cursor.receivedAt)))throw denied();selected.after={receivedAt:cursor.receivedAt,eventId:cursor.eventId};delete selected.cursor;}
   }
   if(active.size>=100)throw denied();const id=randomUUID(),controller=new AbortController();active.set(id,{cap,principal:actor,controller});
   try{
    const data=await readEvidence(scope,{signal:controller.signal,query:selected});if(controller.signal.aborted)throw denied();
    await check(cap,actor);if(controller.signal.aborted)throw denied();
    const sources=[...new Set(data.events.map(e=>e.release).filter(r=>/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(r)))].map(revision=>({revision,url:`${sourceRoot}/tree/${revision}`}));
    const next=selected?.kind==='timeline'&&data.next?seal({type:'timeline_cursor',capabilityId:cap.id,scope:cap.scope,operationId:selected.operationId,exp:cap.exp,...data.next},privateKey):null;
    const packet={caseId:cap.caseId,environment,scope:{start:scope.start,end:scope.end,operations:scope.operations},verifiedFacts:data.events.filter(e=>e.evidence==='server_observed'),clientReports:data.events.filter(e=>e.evidence==='client_reported'),aggregateMetrics:{population:'service_environment',rows:data.metrics},sources,hypotheses:[],coverage:{sampling:'best_effort',missingEvents:'unknown',missingOutcomes:'unknown',truncated:data.truncated,unmappedRequests:'excluded',sourceRevisionMissing:data.events.some(e=>!sources.some(s=>s.revision===e.release))},...(selected?{query:{kind:selected.kind,...(selected.operationId?{operationId:selected.operationId}:{}),...(selected.requestId?{requestId:selected.requestId}:{}),...(selected.metricSet?{metricSet:selected.metricSet}:{})},next}:{})};
    const manifest={type:'evidence_manifest',id,caseId:cap.caseId,capabilityId:cap.id,aud:audience,environment,gatewayRevision,keyId:hash(verificationKey.export({format:'der',type:'spki'})),issuedAt:new Date(clock()).toISOString(),expiresAt:new Date(cap.exp*1000).toISOString(),sha256:hash(JSON.stringify(packet)),eventIds:data.events.map(e=>e.event_id),receiptTimes:data.events.map(e=>e.received_at),sources,integrity:'packaging_only'};
    await authority.audit(cap.caseId,hash(actor.sub),'query','completed');await check(cap,actor);if(controller.signal.aborted)throw denied();
    return {packet,manifest:seal(manifest,privateKey)};
   }finally{controller.abort();active.delete(id);}
  },
  async revoke(actor,token){const cap=decode(actor,token,{allowIssuer:true});await authority.audit(cap.caseId,hash(actor.sub),'revoke','authorized');await authority.revoke(cap);abort(cap.id);},
  poll,
  close(){stopped=true;clearInterval(timer);for(const run of active.values())run.controller.abort();active.clear();},
  activeCount:()=>active.size,
 };
}
