import {createTestLogin,useTestLogin} from '../../server/fixtures/postgres-test-login.mjs';
import {closeTestPool} from '../../server/fixtures/postgres-test-pool.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {supportFixture,actor} from '../diagnostics-gateway/test-fixture.mjs';
import {agentFixture} from './test-fixture.mjs';
import {migrateAudit,grantAgentRole,assertAgentRole,auditWriter,reportStore} from './audit.mjs';
import {loadPolicy} from './policy.mjs';
import {startInvestigation} from './broker.mjs';
import {hash} from '../diagnostics-gateway/capabilities.mjs';
import {diagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
async function auditFixture(){
 const suffix=randomUUID().replaceAll('-',''),name=`ag_${suffix}`,admin=new pg.Pool({connectionString:process.env.TELEMETRY_TEST_DATABASE_URL,max:1}),pools=[],roles=[];let owner;
 const close=async()=>{await Promise.all(pools.map(closeTestPool));await closeTestPool(owner);await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);for(const role of roles)await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();};
 try{await admin.query(`CREATE DATABASE ${name}`);const url=new URL(process.env.TELEMETRY_TEST_DATABASE_URL);url.pathname='/'+name;owner=new pg.Pool({connectionString:url.href,max:1});await migrateAudit(owner);const result={owner,close};
  for(const purpose of ['audit','reports','retention']){const role=`ag_${purpose}_${suffix}`;roles.push(role);await createTestLogin(admin,role);await grantAgentRole(owner,role,purpose);const endpoint=new URL(url);useTestLogin(endpoint,role);const pool=new pg.Pool({connectionString:endpoint.href,max:2});pools.push(pool);await assertAgentRole(pool,purpose);result[purpose]=pool;}
  return result;
 }catch(error){await close();throw error;}
}
test('independent audit is append-only; report operations cannot alter audit and global leases serialize runs',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await auditFixture();try{const append=auditWriter(f.audit),store=reportStore(f.reports),caseId=randomUUID(),runId=randomUUID(),callId=randomUUID();
  await append({callId,caseId,runId,tool:'get_incident',phase:'intent',decision:'allowed'});await append({callId,caseId,runId,tool:'get_incident',phase:'completion',decision:'completed',count:1});
  await assert.rejects(append({callId,caseId,runId,tool:'get_incident',phase:'completion',decision:'completed'}),{code:'23505'});
  for(const pool of [f.audit,f.reports])for(const sql of ['SELECT * FROM agent_audit','DELETE FROM agent_audit','UPDATE agent_audit SET result_count=0','SELECT agent_expire()'])await assert.rejects(pool.query(sql),{code:'42501'});
  assert.equal(await store.claim(runId,new Date(Date.now()+590000)),true);assert.equal(await store.claim(randomUUID(),new Date(Date.now()+590000)),false);await store.release(runId);assert.equal(await store.claim(randomUUID(),new Date(Date.now()+590000)),true);
  await assert.rejects(store.save({id:randomUUID(),caseId,runId,report:{status:'diagnosis'},expiresAt:new Date(Date.now()+600000),callId}));
  await f.retention.query('SELECT agent_expire()');assert.equal((await f.owner.query('SELECT count(*) FROM agent_audit')).rows[0].count,'2');
 }finally{await f.close();}
});
test('real gateway pagination is signed, operation-bound, revocable and consumable by the audited broker',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture(),local=await agentFixture(),audit=await auditFixture();let broker;try{
  const ref=f.refs['synthetic-alice'][0],report=await f.report('synthetic-alice',ref.operationId),grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'}),metadata=createMetadata({NODE_ENV:'test',APPLICATION_REVISION:local.revision});
  const events=Array.from({length:205},()=>diagnosticRecord({event:'summary.save.finished',outcome:'failed',code:'operation_failed'},{metadata,operationId:ref.operationId,requestId:ref.requestId}));
  for(let i=0;i<events.length;i+=100)await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:events.slice(i,i+100),metrics:[]})]);
  const first=await f.investigator.evidence(actor(),grant.capability,{kind:'timeline',operationId:ref.operationId});assert.equal(first.packet.verifiedFacts.length,200);assert.ok(first.packet.next);
  const second=await f.investigator.evidence(actor(),grant.capability,{kind:'timeline',operationId:ref.operationId,cursor:first.packet.next});assert.equal(second.packet.verifiedFacts.length,5);assert.equal(second.packet.next,null);assert.equal(new Set([...first.packet.verifiedFacts,...second.packet.verifiedFacts].map(e=>e.event_id)).size,205);
  const other=f.refs['synthetic-alice'][1];await assert.rejects(f.investigator.evidence(actor(),grant.capability,{kind:'timeline',operationId:other.operationId,cursor:first.packet.next}));
  const regrant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});await assert.rejects(f.investigator.evidence(actor(),regrant.capability,{kind:'timeline',operationId:ref.operationId,cursor:first.packet.next}));
  // A smaller second student case proves actual packets survive the independent
  // broker validator without consuming its entire telemetry allowance at start.
  const otherReport=await f.report('synthetic-alice',other.operationId),otherGrant=await f.investigator.issue(actor(),{caseId:otherReport.caseId,purpose:'voice'});
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[diagnosticRecord({event:'summary.save.finished',outcome:'failed',code:'operation_failed'},{metadata,operationId:other.operationId,requestId:other.requestId})],metrics:[]})]);
  local.manifest.caseIds=[otherReport.caseId];await writeFile(local.policyFile,JSON.stringify(local.manifest));const policy=await loadPolicy({policyFile:local.policyFile,expectedDigest:hash(JSON.stringify(local.manifest)),agentWorkspace:local.workspace});
  const wire=value=>JSON.parse(JSON.stringify(value)),gateway={validate:async cap=>wire(await f.investigator.validate(actor(),cap)),evidence:async(cap,query)=>wire(await f.investigator.evidence(actor(),cap,query))};
  broker=await startInvestigation({capability:otherGrant.capability,publicKey:f.options.publicKey,audience:f.options.audience,policy,gateway,audit:auditWriter(audit.audit),reports:reportStore(audit.reports)});
  const timeline=await broker.call('get_timeline',{operationId:other.operationId});const id=timeline.data.verifiedFacts[0].event_id;
  const saved=await broker.finish({status:'diagnosis',suspectedFailure:'storage-failure',observedEvents:[id],competingExplanations:['connection-failure'],missingEvidence:['missing-client-receipt'],reproduction:'summary-save-failure',patchAreas:[],tests:['voice-summary'],uncertainty:'medium'});assert.equal(saved.report.observedFacts[0].eventId,id);assert.equal((await broker.getReport()).report.suspectedFailure,'storage-failure');
  await f.closeCase('synthetic-alice',otherReport.caseId);await broker.poll();await assert.rejects(broker.getReport());assert.equal((await audit.owner.query('SELECT count(*) FROM agent_reports')).rows[0].count,'0');assert.ok(Number((await audit.owner.query('SELECT count(*) FROM agent_audit')).rows[0].count)>=8);
 }finally{await broker?.close();await audit.close();await local.close();await f.close();}
});
