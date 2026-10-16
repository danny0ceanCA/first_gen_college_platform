import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {diagnosticRecord,createMetadata} from '../../server/observability/event-schema.mjs';
import {readEvents,readMetrics,assertFreshStore} from './store.mjs';
import {replayLedger,createErasureWorker} from './erasure-worker.mjs';
import {assertErasureWorker} from '../../server/telemetry-erasure-grants.mjs';
import {checkHealth} from './health.mjs';
import {assertTelemetryRole} from './config.mjs';
import {assertTelemetryLifecycle} from '../../server/observability/operations.mjs';
const enabled={skip:!process.env.TELEMETRY_TEST_DATABASE_URL};
const metadata=createMetadata({NODE_ENV:'test'}),event=context=>diagnosticRecord({event:'summary.save.finished',outcome:'completed'},{metadata,...context});
const ingest=(f,events=[],metrics=[])=>f.ingest.query('SELECT telemetry_ingest($1::jsonb)',[JSON.stringify({schemaVersion:1,events,metrics})]);
test('expiry is enforced before cleanup, dedupe spans partitions, queries are capped and retention drops old partitions',enabled,async()=>{
 const f=await fixture();try{
  const row=event();await ingest(f,[row]);
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),tomorrowOfYesterday=new Date(`${yesterday}T00:00:00.000Z`);tomorrowOfYesterday.setUTCDate(tomorrowOfYesterday.getUTCDate()+1);const part='telemetry_events_'+yesterday.replaceAll('-','');
  await f.owner.query(`CREATE TABLE ${part} PARTITION OF telemetry_events FOR VALUES FROM ('${yesterday}T00:00:00Z') TO ('${tomorrowOfYesterday.toISOString()}')`);await f.owner.query('INSERT INTO telemetry_partitions VALUES($1,$2)',[part,tomorrowOfYesterday]);
  await f.owner.query('UPDATE telemetry_events SET received_at=$1 WHERE event_id=$2',[`${yesterday}T12:00:00Z`,row.eventId]);await ingest(f,[row]);assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_events')).rows[0].count),1);
  await f.owner.query("UPDATE telemetry_events SET expires_at=now()-interval '1 second'");assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test'})).events.length,0);await f.retention.query('SELECT telemetry_maintain()');assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_events')).rows[0].count),0);
  for(let i=0;i<3;i++)await ingest(f,Array.from({length:i===2?5:100},()=>event()));const first=await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test'});assert.equal(first.events.length,200);assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test',before:first.next})).events.length,5);
  const oldDate=new Date(Date.now()-16*86400000).toISOString().slice(0,10),oldPart='telemetry_events_'+oldDate.replaceAll('-',''),end=new Date(`${oldDate}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
  await f.owner.query(`CREATE TABLE ${oldPart} PARTITION OF telemetry_events FOR VALUES FROM ('${oldDate}T00:00:00Z') TO ('${end.toISOString()}')`);await f.owner.query('INSERT INTO telemetry_partitions VALUES($1,$2)',[oldPart,end]);await f.retention.query('SELECT telemetry_maintain()');assert.equal((await f.owner.query('SELECT to_regclass($1) AS relation',[oldPart])).rows[0].relation,null);
  await assert.rejects(f.ingest.query('SELECT telemetry_maintain()'));await assert.rejects(f.query.query('SELECT telemetry_erase(\'[]\',0)'));await assert.rejects(f.retention.query('SELECT * FROM telemetry_events'));
  await assertTelemetryRole(f.health,'health');await assert.rejects(f.health.query('SELECT * FROM telemetry_events_live'));assert.deepEqual((await checkHealth({telemetry:f.health,ledger:f.ledgerReader})).reasons,['canary_stale']);await ingest(f,[diagnosticRecord({event:'telemetry.canary'},{metadata})]);assert.equal((await checkHealth({telemetry:f.health,ledger:f.ledgerReader})).healthy,true);
 }finally{await f.close();}
});
test('minute metrics are idempotent, histograms merge, missing sequences remain unknown and raw intervals expire',enabled,async()=>{
 const f=await fixture();try{
  const interval=new Date(Math.floor(Date.now()/60000)*60000-60000).toISOString(),instanceId=randomUUID();
  const metric=(sequence,count)=>({schemaVersion:1,instanceId,sequence,interval,environment:'test',service:'origen-api',family:'api',operation:'api.chat',outcome:'completed',count,sumMs:count*10,buckets:[count,0,0,0,0,0,0,0,0,0,0],coverage:'complete'});
  const frames=[metric(1,5),metric(2,7)];await ingest(f,[],frames);await ingest(f,[],frames);await f.retention.query('SELECT telemetry_maintain()');await f.retention.query('SELECT telemetry_maintain()');
  const hour=new Date(interval);hour.setUTCMinutes(0);let rows=(await readMetrics(f.query,f.ledgerReader,{environment:'test',hour:hour.toISOString()})).metrics;assert.equal(Number(rows[0].count),12);assert.equal(Number(rows[0].buckets[0]),12);
  await ingest(f,[],[metric(4,2)]);await f.retention.query('SELECT telemetry_maintain()');rows=(await readMetrics(f.query,f.ledgerReader,{environment:'test',hour:hour.toISOString()})).metrics;assert.equal(Number(rows[0].count),14);assert.equal(rows[0].coverage,'unknown');
  await f.owner.query("UPDATE telemetry_metric_intervals SET received_at=now()-interval '25 hours'");await f.retention.query('SELECT telemetry_maintain()');assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_metric_intervals')).rows[0].count),0);assert.equal(Number((await f.owner.query('SELECT count FROM telemetry_hourly_metrics')).rows[0].count),14);
 }finally{await f.close();}
});
test('independent erasure ledger prevents late arrivals and restored rows from reopening before replay',enabled,async()=>{
 const f=await fixture();try{
  const operationId=randomUUID(),row=event({operationId});await ingest(f,[row]);const saved=(await f.owner.query('SELECT * FROM telemetry_events')).rows[0];
  await f.ledgerWriter.query('SELECT ledger_append($1::jsonb)',[JSON.stringify([{kind:'operation',reference:operationId}])]);await assert.rejects(assertFreshStore(f.query,f.ledgerReader));await replayLedger(f.erasure,f.ledgerWriter);assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_events')).rows[0].count),0);
  await ingest(f,[event({operationId})]);assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_events')).rows[0].count),0);
  // A backup restore is owner work: emulate old rows and missing local markers.
  await f.owner.query('TRUNCATE telemetry_erased');await f.erasure.query('SELECT telemetry_block()');const columns=Object.keys(saved);await f.owner.query(`INSERT INTO telemetry_events(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(saved));
  assert.equal((await f.query.query('SELECT * FROM telemetry_events_live')).rows.length,0);await assert.rejects(readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test'}));await replayLedger(f.erasure,f.ledgerWriter);assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'recent',environment:'test'})).events.length,0);
  await assert.rejects(readEvents(f.query,{query:async()=>{throw Error('ledger unavailable');}},{kind:'recent',environment:'test'}));
 }finally{await f.close();}
});
test('account/student cascades transactionally capture only opaque references and a restricted worker propagates erasure',enabled,async()=>{
 const f=await fixture({application:true});try{
  await assertErasureWorker(f.appErasure);await assertErasureWorker(f.appHealth,{healthOnly:true});await assertTelemetryLifecycle(f.appRuntime);await assert.rejects(f.appHealth.query("SELECT origen_telemetry_outbox_ack('{}'::uuid[])"));await assert.rejects(f.appRuntime.query('SELECT * FROM origen_telemetry_erasure_outbox'));await assert.rejects(f.appErasure.query('SELECT * FROM origen_accounts'));
  const account=(await f.appOwner.query("INSERT INTO origen_accounts(auth0_subject,first_name) VALUES('PRIVATE_AUTH0','PRIVATE_NAME') RETURNING id")).rows[0].id;
  await f.appOwner.query("INSERT INTO origen_students(account_id,id,name) VALUES($1,'PRIVATE_STUDENT','PRIVATE_NAME')",[account]);
  const operationId=randomUUID(),requestId=randomUUID(),traceId=randomBytes(16).toString('hex');
  await f.appOwner.query("INSERT INTO origen_diagnostic_operations(operation_id,account_id,student_id,kind,client_operation_id,trace_id) VALUES($1,$2,'PRIVATE_STUDENT','summary',$3,$4)",[operationId,account,randomUUID(),traceId]);
  await f.appOwner.query('INSERT INTO origen_diagnostic_request_refs SELECT $1,account_id,operation_id,expires_at FROM origen_diagnostic_operations WHERE operation_id=$2',[requestId,operationId]);await ingest(f,[event({operationId,requestId,traceId})]);
  await f.appOwner.query('BEGIN');await f.appOwner.query('DELETE FROM origen_accounts WHERE id=$1',[account]);await f.appOwner.query('ROLLBACK');assert.equal(Number((await f.appOwner.query('SELECT count(*) FROM origen_telemetry_erasure_outbox')).rows[0].count),0);
  await f.appOwner.query("DELETE FROM origen_students WHERE account_id=$1 AND id='PRIVATE_STUDENT'",[account]);const refs=(await f.appErasure.query('SELECT * FROM origen_telemetry_outbox_batch()')).rows;assert.equal(refs.length,3);assert.ok(!JSON.stringify(refs).includes('PRIVATE'));assert.ok(!JSON.stringify(refs).includes(account));
  const worker=createErasureWorker({application:f.appErasure,telemetry:f.erasure,ledger:f.ledgerWriter});assert.equal((await worker.tick()).delivered,3);assert.equal((await readEvents(f.query,f.ledgerReader,{kind:'operation',reference:operationId,environment:'test'})).events.length,0);assert.equal((await f.appErasure.query('SELECT * FROM origen_telemetry_outbox_batch()')).rows.length,0);
  await ingest(f,[event({requestId})]);assert.equal(Number((await f.owner.query('SELECT count(*) FROM telemetry_events')).rows[0].count),0);
 }finally{await f.close();}
});
