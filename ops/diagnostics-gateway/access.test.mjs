import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {SignJWT,createLocalJWKSet} from 'jose';
import {keys,actor,supportFixture} from './test-fixture.mjs';
import {createInvestigator} from './gateway.mjs';
import {hash,unseal} from './capabilities.mjs';
import {createGatewayHandler,gatewayAuthenticator} from './service.mjs';
import {assertTelemetryRole} from '../observability/config.mjs';
import {createSystemIncident} from './create-incident.mjs';
export function unitFixture(){
 const crypto=keys(),scope={id:randomUUID(),origin:'user_report',purpose:'voice',environment:'test',operations:[randomUUID()],start:new Date(Date.now()-1000).toISOString(),end:new Date(Date.now()+1000).toISOString(),dataClasses:['technical_events','aggregate_metrics'],expiresAt:new Date(Date.now()+86400000).toISOString()},grants=new Map(),state={scope,available:true,allowed:true,audits:[],now:Date.now()};
 const authority={async fresh(){if(!state.available)throw Error('PRIVATE error');},async scope(id){return id===state.scope?.id?state.scope:null;},async register(cap){grants.set(cap.id,cap);},async authorized(cap){return state.allowed&&grants.has(cap.id);},async revoke(cap){grants.delete(cap.id);},async audit(...args){if(state.auditDown)throw Error();state.audits.push(args);}};
 const event={event_id:randomUUID(),received_at:new Date().toISOString(),event_time:new Date().toISOString(),release:'a'.repeat(40),operation_id:scope.operations[0],event:'dependency.finished',evidence:'server_observed',attributes:{outcome:'failed',samplingProbability:1}};
 const options={authority,readEvidence:async()=>({events:[event,{...event,event_id:randomUUID(),evidence:'client_reported'}],metrics:[],truncated:false}),...crypto,audience:'support',environment:'test',sourceRoot:'https://github.com/example/origen',gatewayRevision:'c'.repeat(40),machineSubjects:['synthetic-machine'],clock:()=>state.now};
 return {state,scope,crypto,options,investigator:createInvestigator(options)};
}
test('real JWT verification requires the dedicated audience, issuer, expiry and RS256 signature',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),env={AUTH0_DOMAIN:'synthetic.example',AUTH0_AUDIENCE:'application',DIAGNOSTICS_AUDIENCE:'support'},authenticate=gatewayAuthenticator(env,createLocalJWKSet({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256'}]}));
 const token=(aud='support',iss='https://synthetic.example/',expiry='1m')=>new SignJWT({sub:'synthetic',permissions:['observability:investigate']}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
 assert.equal((await authenticate(await token())).sub,'synthetic');await assert.rejects(authenticate(await token('application')));await assert.rejects(authenticate(await token('support','https://foreign.example/')));await assert.rejects(authenticate(await token('support','https://synthetic.example/','-1m')));await assert.rejects(authenticate('forged'));
 assert.throws(()=>gatewayAuthenticator({...env,DIAGNOSTICS_AUDIENCE:'application'}));
});
test('capabilities bind audience, actor, environment, exact case scope, expiry and immutable signed packets',async()=>{
 const f=unitFixture(),staff=actor();try{
  await assert.rejects(f.investigator.issue({...staff,permissions:['read:users']},{caseId:f.scope.id,purpose:'voice'}));
  await assert.rejects(f.investigator.issue(staff,{caseId:randomUUID(),purpose:'voice'}));
  await assert.rejects(f.investigator.issue(staff,{caseId:f.scope.id,purpose:'saving'}));
  const grant=await f.investigator.issue(staff,{caseId:f.scope.id,purpose:'voice'}),cap=unseal(grant.capability,f.crypto.publicKey);assert.ok(cap.exp-cap.iat<=900);
  await assert.rejects(f.investigator.evidence({...staff,sub:'other'},grant.capability));
  await assert.rejects(f.investigator.evidence(staff,grant.capability.slice(0,-3)+'abc'));
  const packet=await f.investigator.evidence(staff,grant.capability),manifest=unseal(packet.manifest,f.crypto.publicKey);
  assert.equal(manifest.sha256,hash(JSON.stringify(packet.packet)));assert.equal(manifest.integrity,'packaging_only');assert.equal(packet.packet.verifiedFacts.length,1);assert.equal(packet.packet.clientReports.length,1);assert.deepEqual(packet.packet.hypotheses,[]);assert.ok(packet.packet.sources[0].url.endsWith('/tree/'+'a'.repeat(40)));assert.equal(manifest.eventIds.length,2);
  const other=createInvestigator({...f.options,audience:'another'});try{await assert.rejects(other.evidence(staff,grant.capability));}finally{other.close();}
  f.state.scope={...f.scope,operations:[randomUUID()]};await assert.rejects(f.investigator.evidence(staff,grant.capability));f.state.scope=f.scope;
  f.state.auditDown=true;await assert.rejects(f.investigator.evidence(staff,grant.capability));f.state.auditDown=false;
  f.state.available=false;await assert.rejects(f.investigator.evidence(staff,grant.capability));f.state.available=true;
  f.state.now+=901000;await assert.rejects(f.investigator.evidence(staff,grant.capability));
 }finally{f.investigator.close();}
});
test('machine grants require recipient proof; revoke denies reuse and no result crosses cases',async()=>{
 const f=unitFixture(),staff=actor();try{
  const grant=await f.investigator.issue(staff,{caseId:f.scope.id,purpose:'voice',recipient:'synthetic-machine'});
  await assert.rejects(f.investigator.evidence(staff,grant.capability));const machine={...staff,sub:'synthetic-machine'};
  assert.equal((await f.investigator.evidence(machine,grant.capability)).packet.caseId,f.scope.id);
  await f.investigator.revoke(staff,grant.capability);await assert.rejects(f.investigator.evidence(machine,grant.capability));
  const next=await f.investigator.issue(staff,{caseId:f.scope.id,purpose:'voice'});f.state.scope=null;await assert.rejects(f.investigator.evidence(staff,next.capability));
 }finally{f.investigator.close();}
});
test('gateway refuses plaintext, delegated recipients outside its registry, and rate limits unknown lookups',async()=>{
 let calls=0;const handler=createGatewayHandler({investigator:{async issue(){calls++;throw Error('PRIVATE');}},authenticate:async()=>actor()});
 const call=async({encrypted=true,input={caseId:randomUUID(),purpose:'voice'},url='/v1/capabilities'}={})=>{const req=Object.assign((async function*(){yield Buffer.from(JSON.stringify(input));})(),{socket:{encrypted},method:'POST',url,headers:{authorization:'Bearer synthetic','content-type':'application/json'}}),res={writeHead(status){this.status=status;},end(body){this.body=body;}};await handler(req,res);return res;};
 assert.equal((await call({encrypted:false})).status,426);assert.equal((await call({input:{caseId:randomUUID(),purpose:'voice',recipient:'unknown-machine'}})).status,403);assert.equal(calls,0);
 for(let i=0;i<29;i++){const result=await call();assert.equal(result.status,403);assert.ok(!result.body.includes('PRIVATE'));}assert.equal((await call()).status,429);assert.equal(calls,29);
});
test('real roles and scoped reads exclude foreign accounts, another student and events outside the window',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture();try{
  await assertTelemetryRole(f.supportControl,'support');await assert.rejects(f.supportControl.query('SELECT * FROM support_grants'),{code:'42501'});
  const supportRole=(await f.supportControl.query('SELECT current_user AS name')).rows[0].name;assert.match(supportRole,/^[a-z0-9_]+$/);await f.ledgerOwner.query(`GRANT SELECT(actor_hash) ON support_grants TO "${supportRole}"`);await assert.rejects(assertTelemetryRole(f.supportControl,'support'));await f.ledgerOwner.query(`REVOKE SELECT(actor_hash) ON support_grants FROM "${supportRole}"`);await assertTelemetryRole(f.supportControl,'support');
  const a=f.refs['synthetic-alice'][0],other=f.refs['synthetic-alice'][1],b=f.refs['synthetic-bob'][0],report=await f.report('synthetic-alice',a.operationId);
  const {diagnosticRecord,createMetadata}=await import('../../server/observability/event-schema.mjs');const metadata=createMetadata({NODE_ENV:'test',RENDER_GIT_COMMIT:'b'.repeat(40)});
  const events=[a,other,b].map(op=>diagnosticRecord({event:'api_request',httpStatus:200},{metadata,operationId:op.operationId,requestId:op.requestId,traceId:op.traceId,endpoint:'api.chat',method:'POST'}));
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events,metrics:[]})]);
  const grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'}),result=await f.investigator.evidence(actor(),grant.capability);
  assert.equal(result.packet.verifiedFacts.length,1);assert.equal(result.packet.verifiedFacts[0].operation_id,a.operationId);assert.equal(result.packet.clientReports.length,0);
  const incident=await createSystemIncident(f.appOwner,f.query,{environment:'test',purpose:'voice',operations:[a.operationId],start:new Date(Date.now()-60000).toISOString(),end:new Date().toISOString()});
  const incidentGrant=await f.investigator.issue(actor(),{caseId:incident.caseId,purpose:'voice'});assert.equal((await f.investigator.evidence(actor(),incidentGrant.capability)).packet.verifiedFacts.length,1);
  await assert.rejects(createSystemIncident(f.appOwner,f.query,{environment:'test',purpose:'voice',operations:[randomUUID()],start:new Date(Date.now()-60000).toISOString(),end:new Date().toISOString()}));
  await assert.rejects(f.supportControl.query('SELECT * FROM ledger_scopes'),{code:'42501'});
  const controlRole=(await f.supportControl.query('SELECT current_user AS name')).rows[0].name;await f.ledgerOwner.query("UPDATE ledger_scopes SET environment='staging' WHERE role_name=$1",[controlRole]);await assert.rejects(f.investigator.evidence(actor(),grant.capability));await f.ledgerOwner.query("UPDATE ledger_scopes SET environment='test' WHERE role_name=$1",[controlRole]);
  await f.as('synthetic-alice',()=>f.permission.account('synthetic-alice',{action:'withdraw'}));await assert.rejects(f.investigator.evidence(actor(),incidentGrant.capability));assert.equal((await f.appOwner.query('SELECT status FROM origen_support_cases WHERE id=$1',[incident.caseId])).rows[0].status,'closed');
  const otherReport=await f.report('synthetic-bob',b.operationId),otherGrant=await f.investigator.issue(actor(),{caseId:otherReport.caseId,purpose:'voice'});
  await f.appOwner.query("INSERT INTO origen_staff_access_controls(subject_hash,blocked) VALUES($1,true)",[hash(actor().sub)]);
  await assert.rejects(f.investigator.evidence(actor(),otherGrant.capability));
 }finally{await f.close();}
});
