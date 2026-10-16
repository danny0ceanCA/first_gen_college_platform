import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fixture} from './fixture.mjs';
import {diagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
import {assertTelemetryRole} from './config.mjs';
import {collectSnapshot,monitorOnce} from './monitor.mjs';
import {evaluate} from './alerts.mjs';
import {readEvents,assertFreshStore} from './store.mjs';
import {replayLedger} from './erasure-worker.mjs';
const enabled={skip:!process.env.TELEMETRY_TEST_DATABASE_URL};
test('real monitor role returns aggregate-only evidence and cannot read logs or erase records',enabled,async()=>{
 const f=await fixture({application:true});try{
  await assertTelemetryRole(f.monitor,'monitor');await assert.rejects(f.monitor.query('SELECT * FROM telemetry_events_live'));await assert.rejects(f.monitor.query('SELECT * FROM telemetry_events'));await assert.rejects(f.monitor.query("SELECT telemetry_erase('[]',0)"));
  const metadata=createMetadata({NODE_ENV:'test',RENDER_GIT_COMMIT:'a'.repeat(40)}),events=[diagnosticRecord({event:'telemetry.canary'},{metadata})];
  for(let i=0;i<20;i++)events.push(diagnosticRecord({event:'api_request',httpStatus:i<2?500:200},{metadata}));
  for(let i=0;i<3;i++)events.push(diagnosticRecord({event:'summary.save.finished',outcome:'failed',code:'storage_unavailable'},{metadata}));
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events,metrics:[]})]);
  const s=await collectSnapshot({telemetry:f.monitor,ledger:f.ledgerReader,application:f.appHealth});assert.equal(s.health.length,0);assert.equal(s.rows[0].apiRequests,20);assert.equal(s.rows[0].apiErrors,2);assert.equal(s.rows[0].summaryFailures,3);assert.ok(!JSON.stringify(s).includes(events[0].eventId));assert.deepEqual(evaluate(s).map(r=>r.family),['api-errors','summary-persistence']);
  await f.owner.query("UPDATE telemetry_events SET expires_at=now()-interval '1 second' WHERE event='summary.save.finished'");assert.equal((await f.monitor.query('SELECT telemetry_monitor_snapshot() AS s')).rows[0].s[0].summaryFailures,0);
  for(let i=0;i<3;i++)await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[diagnosticRecord({event:'permission.supervisor.finished',outcome:'failed',backlog:1,oldestMs:31000},{metadata})],metrics:[]})]);
  assert.equal((await f.monitor.query('SELECT telemetry_monitor_snapshot() AS s')).rows[0].s[0].supervisorFailures,3);
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[diagnosticRecord({event:'permission.supervisor.finished',outcome:'completed',backlog:0,oldestMs:0},{metadata})],metrics:[]})]);
  const recovered=(await f.monitor.query('SELECT telemetry_monitor_snapshot() AS s')).rows[0].s[0];assert.equal(recovered.supervisorFailures,0);assert.equal(recovered.hangupOldestMs,0);
  const role=(await f.monitor.query('SELECT current_user AS name')).rows[0].name;
  await f.owner.query("UPDATE telemetry_scopes SET environment='production' WHERE role_name=$1",[role]);assert.equal((await f.monitor.query('SELECT telemetry_monitor_snapshot() AS s')).rows[0].s.length,0);
 }finally{await f.close();}
});
test('real one-shot monitor persists deduplication and keeps unhealthy status after the first alert',enabled,async()=>{
 const f=await fixture({application:true}),parent=await realpath(tmpdir()),root=await mkdtemp(join(parent,'origen-monitor-state-'));
 try{
  const metadata=createMetadata({NODE_ENV:'test'});await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[diagnosticRecord({event:'telemetry.canary'},{metadata})],metrics:[]})]);
  const options={telemetry:f.monitor,ledger:f.ledgerReader,application:f.appHealth,stateFile:join(root,'state.json'),environment:'test'},now=Date.now();
  const first=await monitorOnce({...options,now});assert.equal(first.healthy,true);assert.equal(first.unconfiguredSignals.length,4);
  await f.owner.query("UPDATE telemetry_control SET last_expiry_at=now()-interval '3 hours'");
  const next=await monitorOnce({...options,now:now+60000});assert.equal(next.healthy,false);assert.equal(next.alerts[0].family,'expiry-deletion');
  const repeated=await monitorOnce({...options,now:now+120000});assert.equal(repeated.healthy,false);assert.equal(repeated.alerts.length,0);assert.equal(repeated.state.incidents[0].id,next.alerts[0].incidentId);
 }finally{await f.close();const actual=await realpath(root);assert.equal(dirname(actual),parent);assert.ok(actual.includes('origen-monitor-state-'));await rm(actual,{recursive:true,force:true});}
});
test('real restore/deletion exercise blocks reads during ledger outage, replay erases restored data and expiry hides old rows',enabled,async()=>{
 const f=await fixture();try{
  const operationId=randomUUID(),event=diagnosticRecord({event:'summary.save.finished',outcome:'completed'},{metadata:createMetadata({NODE_ENV:'test'}),operationId});
  await f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events:[event],metrics:[]})]);
  await f.ledgerWriter.query('SELECT ledger_append($1::jsonb)',[JSON.stringify([{kind:'operation',reference:operationId}])]);await assert.rejects(assertFreshStore(f.monitor,f.ledgerReader));
  const outage=await collectSnapshot({telemetry:f.monitor,ledger:{query:async()=>{throw Error('synthetic unavailable');}}});assert.ok(outage.health.includes('telemetry_unavailable'));assert.equal(outage.rows.length,0);
  await f.erasure.query('SELECT telemetry_block()');assert.equal((await f.monitor.query('SELECT telemetry_monitor_snapshot() AS s')).rows[0].s.length,0);
  await replayLedger(f.erasure,f.ledgerWriter);assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'operation',reference:operationId,environment:'test'})).events.length,0);
  await f.owner.query("UPDATE telemetry_control SET last_expiry_at=now()-interval '3 hours'");const stale=await collectSnapshot({telemetry:f.monitor,ledger:f.ledgerReader});assert.ok(stale.health.includes('expiry_stale'));assert.ok(evaluate(stale).some(r=>r.family==='expiry-deletion'));
 }finally{await f.close();}
});
