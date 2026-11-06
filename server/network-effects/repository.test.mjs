import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createNetworkEffectsRepository,migrateNetworkEffects } from './repository.mjs';
import { demoSources,demoExtraction } from '../../research/network-effects/fixtures.mjs';
import { openStore } from '../../research/network-effects/store.mjs';
import { createPGlitePool } from './pglite-test-pool.mjs';
import { assertNetworkRole } from './database.mjs';
import { runNetworkExtraction } from './worker.mjs';

// An actual PostgreSQL engine in an isolated process; no production URL or credential.
// Optional runtime lives under ignored .local, keeping the application dependency tree untouched.
const toWire = value => ({...value,items:value.items.map(({kind,status,...item})=>({...item,classification:`${kind}:${status}`}))});
const runtime=process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE
  ?pathToFileURL(process.env.NETWORK_EFFECTS_TEST_PGLITE_MODULE)
  :new URL('../../research/network-effects/.local/pg-test-runtime/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url);
const available=existsSync(runtime);
const PGlite=available?(await import(runtime.href)).PGlite:null;
const pgTest=(name,fn)=>test(name,{skip:!available&&'Install the isolated PGlite test runtime to execute PostgreSQL integration checks.'},fn);

async function setup(t,{clock=()=>Date.now()}={}) {
  const db=new PGlite();
  // PGlite is a single database connection. Serialize acquired clients to preserve
  // transaction boundaries; SQL (including locks and constraints) runs in PostgreSQL.
  const pool=createPGlitePool(db);
  await migrateNetworkEffects(pool);
  const repository=createNetworkEffectsRepository(pool,{clock});
  t.after(()=>db.close());
  return {db,pool,repository};
}
const source=(id,text,overrides={})=>({id,version:1,accountId:'test-family',studentId:'test-student',reporter:'student',language:'en',kind:'summary',recordedAt:'2026-11-01T10:00:00.000Z',text,synthetic:true,...overrides});
const observation=(input,status,overrides={})=>({schemaVersion:1,items:[{key:'result',episodeKey:'enrollment-confirmation',topic:'enrollment',barrier:null,kind:'outcome',status,statement:input.text,quote:input.text,reportedBy:input.reporter,language:input.language,occurredAt:null,linksTo:null,corrects:null,...overrides}]});
async function importRecord(repository,input,extraction,version='local-snapshot-v1') {
  const queued=await repository.ingest(input,version);
  if(queued.status==='completed')return queued;
  const job=await repository.claim({jobId:queued.id});assert.ok(job);
  await repository.complete(job,extraction,5);return job;
}

pgTest('PostgreSQL migration is explicit, repeatable, isolated from application data and denies PUBLIC privileges',async t=>{
  const {pool}=await setup(t);
  await pool.query("CREATE TABLE public.operational_sentinel (id text PRIMARY KEY, body text); INSERT INTO public.operational_sentinel VALUES ('live', 'unchanged')");
  await migrateNetworkEffects(pool);
  assert.deepEqual((await pool.query('SELECT * FROM public.operational_sentinel')).rows,[{id:'live',body:'unchanged'}]);
  const tableNames=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='origen_network_effects' ORDER BY tablename")).rows.map(r=>r.tablename);
  for(const name of ['sources','source_versions','jobs','items','reviews','supersessions','invalidations','episodes','evaluations','budgets','budget_reservations'])assert.ok(tableNames.includes(name));
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM information_schema.triggers WHERE trigger_schema='public'")).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) acl WHERE n.nspname='origen_network_effects' AND acl.grantee=0")).rows[0].n,0);
});

pgTest('PostgreSQL preserves the isolated store projections for the bilingual synthetic fixture',async t=>{
  const {repository}=await setup(t),local=openStore({path:':memory:'});t.after(()=>local.close());
  const records=demoSources().map(input=>({source:input,extraction:demoExtraction(input)}));
  local.importRecords(records);
  for(const record of records)await importRecord(repository,record.source,record.extraction);
  const state=await repository.state();
  const sorted=episodes=>episodes.sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(sorted(state.episodes),sorted(local.state().episodes));
  assert.deepEqual(state.metrics,local.state().metrics);
  assert.equal(state.sourceHistory.length,15);
  const overview=await repository.overview();assert.equal(overview.metrics.activeJobs,0);assert.equal(overview.metrics.items,state.metrics.items);
  const repeated=await repository.ingest(records[0].source,'local-snapshot-v1');assert.equal(repeated.status,'completed');
  assert.equal((await repository.listJobs({pageSize:100})).total,15);
});

pgTest('PostgreSQL contexts and references never cross account, sibling, or family-wide boundaries',async t=>{
  const {repository}=await setup(t);
  const a=source('student-a','I received confirmation.');await importRecord(repository,a,observation(a,'positive'));
  const scopes=[{accountId:'other-family'},{studentId:'sibling'},{studentId:null}];
  for(let index=0;index<scopes.length;index++) {
    const other=source(`other-${index}`,'I am still waiting.',scopes[index]);
    const context=await repository.contextFor(other);assert.equal(context.existingItems.length,0);
    const queued=await repository.ingest(other),job=await repository.claim({jobId:queued.id});
    await assert.rejects(()=>repository.complete(job,observation(other,'pending',{linksTo:'student-a@1#result'})),{code:'unknown_item_reference'});
    assert.equal((await repository.contextFor(other)).episodes.length,0);
    await repository.complete(job,observation(other,'pending'));
  }
  const context=await repository.contextFor(a);assert.equal(context.existingItems.length,1);assert.equal(context.existingItems[0].sourceId,a.id);
  assert.equal((await repository.state()).episodes.length,4);
});

pgTest('PostgreSQL source versions and extractor generations reject stale completion and replay without cancelling newer work',async t=>{
  const {repository}=await setup(t),input=source('generation','I received confirmation.');
  const old=await repository.ingest(input,'extractor-1'),oldJob=await repository.claim({jobId:old.id});
  const next=await repository.ingest(input,'extractor-2');
  assert.equal((await repository.ingest(input,'extractor-1')).status,'obsolete');
  const nextJob=await repository.claim({jobId:next.id});assert.ok(nextJob);
  await assert.rejects(()=>repository.complete(oldJob,observation(input,'positive')),{code:'stale_job_lease'});
  await repository.complete(nextJob,observation(input,'positive'));
  await assert.rejects(()=>repository.ingest({...input,text:'Different text with unchanged version.'}),{code:'source_version_conflict'});
  await assert.rejects(()=>repository.ingest({...input,accountId:'another-family'}),{code:'source_scope_changed'});
  const newer={...input,version:2,text:'Actually, I am still waiting.',recordedAt:'2026-11-02T10:00:00.000Z'};
  const queued=await repository.ingest(newer);assert.equal((await repository.state()).episodes[0].outcomeState,'unknown');
  await assert.rejects(()=>repository.ingest(input),{code:'stale_source_version'});
  await repository.complete(await repository.claim({jobId:queued.id}),observation(newer,'pending'));
  const state=await repository.state();assert.equal(state.episodes[0].outcomeState,'pending');assert.equal(state.sourceHistory.length,2);
});

pgTest('PostgreSQL source deletion permanently suppresses corrected evidence and invalidates stale reviews',async t=>{
  const {repository}=await setup(t);
  const initial=source('confirmed','I received confirmation.');
  const correction=source('correction','Actually it was only an acknowledgment.',{recordedAt:'2026-11-02T10:00:00.000Z'});
  await importRecord(repository,initial,observation(initial,'positive'));
  const first=(await repository.state()).episodes[0];
  await repository.review({episodeId:first.id,expectedRevision:first.revision,decision:'reviewed',note:'Synthetic reviewer note'},'admin-test');
  await importRecord(repository,correction,observation(correction,'pending',{corrects:'confirmed@1#result'}));
  await assert.rejects(()=>repository.review({episodeId:first.id,expectedRevision:first.revision,decision:'reviewed'}),{code:'stale_review'});
  await repository.deleteSource(correction.id);
  const removed=(await repository.getEpisode(first.id)).episode;
  assert.equal(removed.outcomeState,'unknown');assert.equal(removed.reviewState,'needs-review');
  assert.equal(removed.items[0].state,'superseded');assert.equal((await repository.getEpisode(first.id)).reviews.length,0);
  await assert.rejects(()=>repository.ingest({...correction,version:2}),{code:'source_deleted'});
  assert.equal((await repository.state()).sourceHistory.length,1);
  const later=source('later-confirmed','The office confirmed it today.',{recordedAt:'2026-11-04T10:00:00.000Z'});
  await importRecord(repository,later,observation(later,'positive'));
  const resolved=(await repository.getEpisode(first.id)).episode;
  assert.equal(resolved.outcomeState,'positive');assert.equal(resolved.reviewState,'unreviewed');
  assert.equal(resolved.items.find(item=>item.sourceId===initial.id).state,'superseded');
});

pgTest('PostgreSQL leases reject late workers, retries stay bounded, and diagnostics exclude provider content',async t=>{
  let time=Date.parse('2026-11-05T12:00:00.000Z');
  const {repository}=await setup(t,{clock:()=>time}),input=source('lease-source','I am waiting for confirmation.');
  const queued=await repository.ingest(input),first=await repository.claim({jobId:queued.id,leaseMs:100});
  time+=101;const second=await repository.claim({jobId:queued.id,leaseMs:100});assert.equal(second.attempts,2);
  await assert.rejects(()=>repository.complete(first,observation(input,'pending')),{code:'stale_job_lease'});
  await assert.rejects(()=>repository.recordJobDiagnostic(first,{model:'test-model'}),{code:'stale_job_lease'});
  const diagnostic=await repository.recordJobDiagnostic(second,{responseId:'resp_demo',model:'test-model',usage:{inputTokens:100,outputTokens:20},durationMs:42,outcome:'completed',candidate:{private:'do not store'},errorCode:'private_provider_message'});
  assert.ok(!Object.hasOwn(diagnostic,'candidate'));assert.equal(diagnostic.errorCode,null);
  assert.equal(await repository.failure({...second,attempts:0},new Error('Provider body must not be stored'),{maxAttempts:2,retryDelayMs:0}),'failed');
  assert.equal((await repository.listJobs({status:'failed'})).items[0].error,'extraction_failed');
  assert.equal((await repository.listJobs({status:'failed'})).items[0].diagnostic.usage.inputTokens,100);
  await repository.retry(queued.id);const final=await repository.claim({jobId:queued.id});assert.equal(final.attempts,1);
  await repository.complete(final,observation(input,'pending'));
  await assert.rejects(()=>repository.retry(queued.id),{code:'job_not_retryable'});
  const lowerCap=source('lower-attempt-cap','I am waiting.');await repository.ingest(lowerCap);
  const lowerJob=await repository.claim();await repository.failure(lowerJob,{code:'provider_timeout'},{maxAttempts:3,retryDelayMs:0});
  assert.equal(await repository.claim({maxAttempts:1}),null);
  assert.equal((await repository.listJobs({status:'failed'})).items[0].attempts,1);
});

pgTest('PostgreSQL Admin pagination and filtering preserve bilingual evidence and revision reviews',async t=>{
  const {repository}=await setup(t);
  for(const input of demoSources())await importRecord(repository,input,demoExtraction(input));
  const all=await repository.listEpisodes({pageSize:2});assert.equal(all.items.length,2);assert.ok(all.total>2);
  assert.ok(all.items.every(item=>!Object.hasOwn(item,'items')&&item.itemCount>0));
  const spanish=await repository.listEpisodes({language:'es',topic:'finding_help'});assert.equal(spanish.total,1);
  const detail=await repository.getEpisode(spanish.items[0].id);assert.ok(detail.sourceHistory.length>1);
  const reviewed=await repository.review({episodeId:detail.episode.id,expectedRevision:detail.episode.revision,decision:'reviewed',note:'  checked  '},'admin-123');
  assert.equal(reviewed.episode.reviewState,'reviewed');assert.equal(reviewed.reviews[0].note,'checked');
  assert.equal((await repository.listEpisodes({status:'reviewed'})).total,1);
  assert.equal((await repository.listEpisodes({query:"' OR true --"})).total,0);
  await assert.rejects(()=>repository.listEpisodes({query:'a'.repeat(121)}),{code:'invalid_query'});
  await assert.rejects(()=>repository.listEpisodes({pageSize:1000}),{code:'invalid_network_pagination'});
  await assert.rejects(()=>repository.listJobs({status:'invented'}),{code:'invalid_job_status'});
  assert.equal((await repository.listSources({pageSize:3})).items.length,3);
});

pgTest('PostgreSQL evaluation reports are durable, idempotent and conflict checked',async t=>{
  const {repository,pool}=await setup(t),id=randomUUID(),report={configuration:{model:'offline-test'},status:'passed',metrics:{evidencePrecision:1},summary:{cases:12}};
  assert.equal((await repository.recordEvaluation(report,{id,actor:'admin'})).replayed,false);
  assert.equal((await repository.recordEvaluation(report,{id,actor:'admin'})).replayed,true);
  await assert.rejects(()=>repository.recordEvaluation({...report,status:'failed'},{id}),{code:'evaluation_conflict'});
  assert.deepEqual((await createNetworkEffectsRepository(pool).getEvaluation(id)).report,report);
  const summaries=await repository.listEvaluations();assert.equal(summaries.total,1);assert.equal(summaries.items[0].summary.cases,12);assert.equal(summaries.items[0].model,'offline-test');
  assert.equal((await repository.overview()).metrics.evaluations,1);
});

pgTest('PostgreSQL budget ledger enforces a durable immutable cap across retries and repository restarts',async t=>{
  const {repository,pool}=await setup(t);
  const reserve=(id,amount=0.6)=>repository.reserveBudget({budgetId:'test-cap',limitUsd:1,reservationId:id,amountUsd:amount});
  const claims=await Promise.all([reserve('call-a'),reserve('call-b')]);assert.equal(claims.filter(r=>r.accepted).length,1);
  assert.equal((await reserve('call-a')).duplicate,true);
  await assert.rejects(()=>repository.reserveBudget({budgetId:'test-cap',limitUsd:2,reservationId:'call-c',amountUsd:0.5}),{code:'budget_limit_conflict'});
  await assert.rejects(()=>repository.reserveBudget({limitUsd:1,reservationId:'invalid',amountUsd:0.1}),{code:'invalid_budget_identity'});
  await repository.settleBudget({reservationId:'call-a',actualUsd:0.2});
  assert.equal((await reserve('call-b')).accepted,true);
  const restarted=createNetworkEffectsRepository(pool);
  assert.equal((await restarted.reserveBudget({budgetId:'test-cap',limitUsd:1,reservationId:'call-d',amountUsd:0.21})).accepted,false);
  await assert.rejects(()=>restarted.settleBudget({reservationId:'call-b',actualUsd:0.7}),{code:'reservation_exceeded'});
  await assert.rejects(()=>restarted.settleBudget({reservationId:'call-a',actualUsd:0.1}),{code:'settlement_conflict'});
  assert.equal((await restarted.reserveBudget({budgetId:'test-cap',limitUsd:1,reservationId:'call-e',amountUsd:0.2})).accepted,true);
});

pgTest('PostgreSQL restricted worker and Admin roles can only operate on their evidence tables',async t=>{
  const {repository,pool}=await setup(t);
  await pool.query('CREATE TABLE public.operational_sentinel (id text)');
  await pool.query(await readFile(new URL('../../research/network-effects/postgres/002_roles.sql',import.meta.url),'utf8'));
  await assert.rejects(()=>assertNetworkRole(pool),/restricted_network_role_required/);
  await pool.query('SET ROLE origen_network_worker');
  await assertNetworkRole(pool);
  const input=source('restricted-source','I received confirmation.');
  await importRecord(repository,input,observation(input,'positive'));
  await assert.rejects(()=>pool.query("INSERT INTO public.operational_sentinel VALUES ('forbidden')"),{code:'42501'});
  await assert.rejects(()=>pool.query('CREATE TABLE origen_network_effects.forbidden (id text)'),{code:'42501'});
  await pool.query('RESET ROLE');await pool.query('SET ROLE origen_network_admin');
  await assertNetworkRole(pool,'origen_network_admin');
  const episode=(await repository.listEpisodes()).items[0];
  assert.equal((await repository.review({episodeId:episode.id,expectedRevision:episode.revision,decision:'reviewed'},'test-admin')).episode.reviewState,'reviewed');
  await assert.rejects(()=>repository.ingest(source('forbidden-source','This must not be stored.')),{code:'42501'});
  await assert.rejects(()=>pool.query("DELETE FROM origen_network_effects.sources WHERE id='restricted-source'"),{code:'42501'});
  await assert.rejects(()=>pool.query("INSERT INTO public.operational_sentinel VALUES ('forbidden')"),{code:'42501'});
  await pool.query('RESET ROLE');
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM public.operational_sentinel')).rows[0].n,0);
  assert.equal((await repository.listSources()).total,1);
});

pgTest('PostgreSQL worker runs structured extraction, budgets and diagnostics through Admin review without a provider call',async t=>{
  const {repository,pool}=await setup(t);
  await pool.query(await readFile(new URL('../../research/network-effects/postgres/002_roles.sql',import.meta.url),'utf8'));
  await pool.query('SET ROLE origen_network_worker');
  const first=source('worker-english','I sent the application and I am waiting for confirmation.');
  const second=source('worker-spanish','Envié la solicitud y todavía espero la confirmación.',{language:'es'});
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');
    const request=JSON.parse(options.body),payload=JSON.parse(request.input),input=[first,second].find(item=>item.text===payload.source.text);
    assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.ok(!request.tools);
    assert.equal(JSON.parse(request.input).source.text,input.text);
    return {ok:true,json:async()=>({id:`resp_fixture_${calls}`,model:request.model,status:'completed',usage:{input_tokens:200,output_tokens:100},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(request.text.format.name==='college_navigation_verification_edits'
        ? {obstacles:[],decision:'keep',issues:[],edits:[],additions:[]} : toWire(observation(input,'pending')))}]}]})};
  };
  await repository.ingest(first);
  const settings={apiKey:'test-only-key-never-sent',budgetId:'pipeline-cap',capUsd:0.03,fetcher};
  assert.equal((await runNetworkExtraction(repository,settings)).status,'completed');
  // A fresh repository sees the same durable evidence, remaining cap and request records.
  const restarted=createNetworkEffectsRepository(pool);await restarted.ingest(second);
  assert.equal((await runNetworkExtraction(restarted,settings)).status,'completed');assert.ok(calls>=3&&calls<=4);
  const jobs=(await restarted.listJobs()).items;
  assert.ok(jobs.every(job=>job.diagnostic?.outcome==='completed'&&job.diagnostic.usage.inputTokens===200&&Number.isInteger(job.durationMs)));
  const ledger=(await pool.query('SELECT count(*)::integer AS calls,sum(charged_micros)::integer AS charged,bool_and(settled) AS settled FROM origen_network_effects.budget_reservations')).rows[0];
  assert.equal(ledger.calls,calls);assert.equal(ledger.settled,true);assert.ok(ledger.charged<30000);
  await assert.rejects(()=>restarted.reserveBudget({budgetId:'pipeline-cap',limitUsd:0.04,reservationId:'cap-must-not-grow',amountUsd:0.01}),{code:'budget_limit_conflict'});
  await pool.query('RESET ROLE');await pool.query('SET ROLE origen_network_admin');await assertNetworkRole(pool,'origen_network_admin');
  const detail=await restarted.getEpisode((await restarted.listEpisodes({language:'es'})).items[0].id);
  assert.equal(detail.episode.outcomeState,'pending');assert.equal(detail.sourceHistory.length,2);
  assert.equal((await restarted.review({episodeId:detail.episode.id,expectedRevision:detail.episode.revision,decision:'reviewed'},'test-reviewer')).episode.reviewState,'reviewed');
  await pool.query('RESET ROLE');
});
