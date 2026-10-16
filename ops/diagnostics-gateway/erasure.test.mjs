import test from 'node:test';
import assert from 'node:assert/strict';
import {supportFixture,actor} from './test-fixture.mjs';
import {createInvestigator} from './gateway.mjs';
import {createErasureWorker,replayLedger} from '../observability/erasure-worker.mjs';
import {createAuthority,createEvidenceReader} from './store.mjs';
import {resetSupportAfterRestore} from './reset-after-restore.mjs';
import {diagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
test('closure during a query aborts active context and suppresses its result',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture();let investigator;try{
  const report=await f.report('synthetic-alice',f.refs['synthetic-alice'][0].operationId),grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});
  let release,entered,signal;const started=new Promise(r=>{entered=r;});
  investigator=createInvestigator({...f.options,readEvidence:async(_scope,options)=>{signal=options.signal;entered();await new Promise(r=>{release=r;});return {events:[],metrics:[],truncated:false};}});
  const pending=investigator.evidence(actor(),grant.capability);await started;
  await f.closeCase('synthetic-alice',report.caseId);await investigator.poll();assert.equal(signal.aborted,true);assert.equal(investigator.activeCount(),1); // quarantined until the reader settles
  const rejected=assert.rejects(pending);release();await rejected;assert.equal(investigator.activeCount(),0);
 }finally{investigator?.close();await f.close();}
});
test('independent tombstones survive restored application cases and block old capabilities',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture();try{
  const report=await f.report('synthetic-alice',f.refs['synthetic-alice'][0].operationId),grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});
  await f.closeCase('synthetic-alice',report.caseId);
  const worker=createErasureWorker({application:f.appErasure,telemetry:f.erasure,ledger:f.ledgerWriter});await worker.tick();worker.stop();
  await f.appOwner.query("UPDATE origen_support_cases SET status='open' WHERE id=$1",[report.caseId]);
  // Simulate an old telemetry backup: no local verification can reopen reads.
  await f.erasure.query('SELECT telemetry_block()');await assert.rejects(f.investigator.evidence(actor(),grant.capability));
  await replayLedger(f.erasure,f.ledgerWriter);await assert.rejects(f.investigator.evidence(actor(),grant.capability));await assert.rejects(f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'}));
  const fresh=await f.report('synthetic-bob',f.refs['synthetic-bob'][0].operationId),freshGrant=await f.investigator.issue(actor(),{caseId:fresh.caseId,purpose:'voice'});
  await resetSupportAfterRestore(f.appOwner,f.ledgerOwner,'test');await resetSupportAfterRestore(f.appOwner,f.ledgerOwner,'test');await assert.rejects(f.investigator.evidence(actor(),freshGrant.capability));assert.equal((await f.ledgerOwner.query("SELECT count(*) FROM support_grants WHERE status='active'")).rows[0].count,'0');
 }finally{await f.close();}
});
test('deleted student scopes, delayed ingest, stale erasure views, gateway outage and explicit revocation deny evidence',{skip:!process.env.TELEMETRY_TEST_DATABASE_URL},async()=>{
 const f=await supportFixture();let unavailable;try{
  const ref=f.refs['synthetic-alice'][0],report=await f.report('synthetic-alice',ref.operationId),grant=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});
  const event=diagnosticRecord({event:'api_request',httpStatus:500},{metadata:createMetadata({NODE_ENV:'test'}),operationId:ref.operationId,requestId:ref.requestId,traceId:ref.traceId,endpoint:'api.chat',method:'POST'});
  const authority=createAuthority({application:{query:async()=>{throw Error('PRIVATE connection');}},control:f.supportControl,telemetry:f.query,ledger:f.ledgerReader});unavailable=createInvestigator({...f.options,authority});await assert.rejects(unavailable.evidence(actor(),grant.capability));
  await f.investigator.revoke(actor(),grant.capability);await assert.rejects(f.investigator.evidence(actor(),grant.capability));
  const again=await f.investigator.issue(actor(),{caseId:report.caseId,purpose:'voice'});
  await f.appOwner.query('DELETE FROM origen_students WHERE account_id=(SELECT id FROM origen_accounts WHERE auth0_subject=$1) AND id=$2',['synthetic-alice','student-a']);
  await assert.rejects(f.investigator.evidence(actor(),again.capability));
  await f.appOwner.query("UPDATE origen_telemetry_erasure_outbox SET created_at=now()-interval '61 seconds'");
  const other=await f.report('synthetic-bob',f.refs['synthetic-bob'][0].operationId);await assert.rejects(f.investigator.issue(actor(),{caseId:other.caseId,purpose:'voice'}));
  const worker=createErasureWorker({application:f.appErasure,telemetry:f.erasure,ledger:f.ledgerWriter});await worker.tick();worker.stop();
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[event],metrics:[]})]);
  assert.equal((await f.query.query('SELECT * FROM telemetry_events_live WHERE operation_id=$1',[ref.operationId])).rows.length,0);
  const otherGrant=await f.investigator.issue(actor(),{caseId:other.caseId,purpose:'voice'});assert.equal((await f.investigator.evidence(actor(),otherGrant.capability)).packet.verifiedFacts.length,0);
  await f.appOwner.query('DELETE FROM origen_accounts WHERE auth0_subject=$1',['synthetic-bob']);await assert.rejects(f.investigator.evidence(actor(),otherGrant.capability));
  assert.equal((await createEvidenceReader(f.query)({environment:'test',operations:[ref.operationId],start:new Date(Date.now()-10000),end:new Date()})).events.length,0);
 }finally{unavailable?.close();await f.close();}
});
