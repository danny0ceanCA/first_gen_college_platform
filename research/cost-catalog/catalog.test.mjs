import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {localClient,readStaging,importBatch,approveManifest,digest} from './postgres.mjs';
import {createCostCatalog,projectRecord,createCostComparison,createCatalogResearchAdapter} from './catalog.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {validatedResearchFindings} from '../../src/researchFindings.mjs';
import {researchContextPackets} from '../../src/liveResearchContext.mjs';
import {decodedResearchContext} from '../../src/researchContext.fixture.mjs';

const scope={academicYear:'2026-27',studentLevel:'Undergraduate',program:'Fictional test program',cohort:'2026-27',residency:'California resident',housing:'renting',enrollment:'Full time'};
function fixture(){
 const id='fictional-'+randomUUID(),campuses=['UC Berkeley','UC Davis','UC Merced'];
 return {id,hash:'fictional-source-'+id,version:'fixture-v1',report:{fictional:true},budgets:campuses.map((campus,n)=>{
  const raw={'College':campus,'Academic year':'2026-27','Student level':'Undergraduate','Program / degree':'Fictional test program','Normalized cohort key':'2026-27','Entering cohort / applies to':'2026-27','Residency':'California resident','Enrollment':'Full time','Housing':'Off-campus apartment','Budget period':'Academic year','Currency':'USD','Official source URL':'https://'+['financialaid.berkeley.edu','financialaid.ucdavis.edu','financialaid.ucmerced.edu'][n]+'/fictional-test','Scope and exclusions':'Fictional test only. Insurance is additional.'};
  const values=[['Tuition and mandatory fees',12000+n*1000],['Housing',10000],['Food',8000]];
  const items=values.map(([category,amount],i)=>({key:`${n}-${i}`,amount:amount*100,rawAmount:String(amount),factor:'1',role:'Included component',raw:{Category:category,'Original source label':category,'Conditions / notes':''},issues:{invalid:[],review:[]}}));
  return {key:'TEST-'+n,scenario:JSON.stringify([campus,...Object.values(scope)]),campus,year:'2026-27',bucket:'reconciled',flagged:false,total:(30000+n*1000)*100,sum:(30000+n*1000)*100,difference:0,payload:{raw,normalized:{housing:'renting'},issues:{invalid:[],review:[]},items}};
 })};
}

test('off by default: no query, research, session event or model call',async()=>{
 const c=createCostCatalog({query:()=>{throw Error('must_not_query');}});
 assert.equal((await c.plan({campuses:['Berkeley'],scope})).enabled,false);
});

test('PostgreSQL catalog, approved read path and existing research/table contracts',async t=>{
 if(process.env.COA_LOCAL_PG_TEST!=='true'){t.skip('explicit isolated local PostgreSQL test required');return;}
 const c=await localClient(),batch=fixture(),metrics=[];
 try{
  await t.test('all supplied records and amounts round-trip to PostgreSQL without approval',async()=>{
   const actual=readStaging('7ea7c8a958e457a8e8819fab9cd7309c0bb9b7430eda6141018a2193171f17c7');await importBatch(c,actual);
   const totals=(await c.query('SELECT count(*)::int AS n,sum(published_cents)::text AS amount FROM coa_catalog.budgets WHERE batch_id=$1',[actual.id])).rows[0];
   assert.equal(totals.n,488);assert.equal(BigInt(totals.amount),actual.budgets.reduce((n,b)=>n+BigInt(b.total||0),0n));
   assert.equal((await c.query('SELECT count(*)::int AS n FROM coa_catalog.items WHERE batch_id=$1',[actual.id])).rows[0].n,5254);
   assert.equal((await c.query('SELECT count(*)::int AS n FROM coa_catalog.published WHERE batch_id=$1',[actual.id])).rows[0].n,0);
   assert.equal((await importBatch(c,actual)).alreadyImported,true);
  });
  await importBatch(c,batch);
  const catalog=createCostCatalog({enabled:true,query:c.query.bind(c),emit:e=>metrics.push(e)});
  await t.test('unapproved records stay unavailable; unknown scope does not guess',async()=>{
   assert.deepEqual((await catalog.plan({campuses:['Berkeley'],scope})).hits,[]);
   await assert.rejects(approveManifest(c,{records:[]}),/explicit_source_review/);
  });
  const manifest={batchId:batch.id,sourceSha256:batch.hash,verifiedOfficialSources:true,reviewedBy:'AUTOMATED FICTIONAL TEST',note:'Fictional fixture only; not an official cost approval',validUntil:new Date(Date.now()+3600000).toISOString(),records:batch.budgets.map(b=>({budgetId:b.key,recordDigest:digest(b.payload)}))};
  await t.test('approval is hash-bound; failed review is atomic',async()=>{
   await assert.rejects(approveManifest(c,{...manifest,sourceSha256:'wrong'}),/hash_mismatch/);
   await assert.rejects(approveManifest(c,{...manifest,records:[manifest.records[0],{...manifest.records[1],recordDigest:'wrong'}]}));
   assert.equal((await c.query('SELECT count(*)::int AS n FROM coa_catalog.approvals WHERE batch_id=$1',[batch.id])).rows[0].n,0);
   await approveManifest(c,manifest);
  });
  for(const language of ['en','es'])await t.test(`${language}: three-college comparison feeds the same totals, components and citations to existing table and context`,async()=>{
   const r=await catalog.plan({campuses:['Berkeley','UC Davis','UC Merced'],scope,language});assert.equal(r.hits.length,3);assert.deepEqual(r.needsResearch,[]);
   const findings=validatedResearchFindings(r.result);assert.equal(findings.length,3);assert.deepEqual(findings.map(f=>f.budget.total),[30000,31000,32000]);
   assert.ok(findings.every(f=>f.budget.components.length===3&&f.qualification.includes('Insurance is additional')));
   const emitted=[],v=voiceVisualCards({emit:e=>emitted.push(e)}),question='Compare UC Berkeley, UC Davis and UC Merced total cost of attendance for renting off campus.';
   v.trackResearch('test',question);v.receiveResearch({id:'catalog-test',query:{requestKey:'test',question,language},question,status:'completed',result:r.result});
   const table=emitted.find(e=>e.type==='origen.visual.research');assert.ok(table);assert.equal(table.present,true);assert.equal(table.report.table.columns.length,3);
   assert.ok(table.report.table.rows.some(row=>row.aspect==='total_budget'&&row.cells.every(Boolean)));
   const packets=researchContextPackets({question,language,result:r.result},'catalog');assert.ok(packets.every(p=>Buffer.byteLength(p)<=480));
   const context=decodedResearchContext(packets.map(JSON.parse));assert.ok(context.findings.every(f=>!f.answer.includes('12,000')),'existing quiet context supplies the concise total while retaining the detailed budget');
  });
  await t.test('housing changes miss instead of silently reusing rent; missing campuses leave known results available',async()=>{
   const r=await catalog.plan({campuses:['Berkeley','UC Irvine'],scope});assert.equal(r.hits.length,1);assert.deepEqual(r.needsResearch,['UC Irvine']);assert.ok(r.result);
   const changed=await catalog.plan({campuses:['Berkeley'],scope:{...scope,housing:'with_family'}});assert.equal(changed.hits.length,0);
   const ambiguous=await catalog.plan({campuses:['Berkeley'],scope:{academicYear:'2026-27'}});assert.equal(ambiguous.clarifications.length,1);assert.equal(ambiguous.result,null);
  });
  for(const language of ['en','es'])await t.test(`${language}: growing comparisons preserve prior campuses and research only a missing campus`,async()=>{
   const comparison=createCostComparison({catalog,scope,language});
   assert.equal((await comparison.update({add:['Berkeley','Davis']})).hits.length,2);
   const added=await comparison.update({add:['Merced']});assert.equal(added.hits.length,3);assert.deepEqual(comparison.snapshot().campuses,['UC Berkeley','UC Davis','UC Merced']);
   const calls=[],adapter=createCatalogResearchAdapter({catalog,research:async request=>{calls.push(request.campuses);throw Error('simulated source outage');}});
   const work=await adapter.start({campuses:['Berkeley','Davis','UC Irvine'],scope,language});assert.equal(work.initial.hits.length,2);
   const done=await work.completion;assert.deepEqual(calls,[['UC Irvine']]);assert.equal(done.result.voiceBrief.findings.length,2);assert.deepEqual(done.failedCampuses,['UC Irvine']);
   const changed=await comparison.update({scopeChanges:{housing:'with_family'}});assert.equal(changed.result,null);assert.equal(changed.needsResearch.length,3);
  });
  await t.test('flagged actual records cannot be approved by the review helper',async()=>{
   const actual=(await c.query("SELECT * FROM coa_catalog.budgets WHERE batch_id=$1 AND flagged LIMIT 1",['7ea7c8a958e457a8e8819fab9cd7309c0bb9b7430eda6141018a2193171f17c7'])).rows[0];
   await assert.rejects(approveManifest(c,{...manifest,batchId:actual.batch_id,sourceSha256:'c895318ac9a88d8e0530d62916b106dd5a7e63dedbc43763b986d672195b8902',records:[{budgetId:actual.budget_key,recordDigest:actual.record_digest}]}),/source_hold/);
  });
  await t.test('mutually exclusive orientation charges stay outside the total and never become an added sum',async()=>{
   const row={...batch.budgets[0],published_cents:batch.budgets[0].total,source_reviewed_at:new Date()};row.payload=structuredClone(row.payload);
   for(const [name,amount]of [['Freshman orientation',300],['Transfer orientation',100]])row.payload.items.push({amount:amount*100,role:'Additional (outside total)',raw:{Category:'Mandatory fees','Original source label':name,'Conditions / notes':'Mutually exclusive orientation alternatives.'}});
   const result=projectRecord(row);assert.ok(result);assert.equal(result.voiceBrief.findings[0].budget.total,30000);assert.match(result.text,/Freshman orientation/);assert.match(result.text,/Transfer orientation/);
   row.payload.raw['Scope and exclusions']='SOURCE CONFLICT: coverage months disagree with the living amount.';assert.equal(projectRecord(row),null);
  });
  await t.test('source retrieval errors produce a fallback plan, not a failed call or waiting announcement',async()=>{
   const failed=createCostCatalog({enabled:true,query:async()=>{throw Error('offline');}});const r=await failed.plan({campuses:['Berkeley'],scope});assert.deepEqual(r.needsResearch,['UC Berkeley']);assert.equal(r.result,null);
  });
  await t.test('correction batches append; existing source records cannot be mutated',async()=>{
   await assert.rejects(c.query('UPDATE coa_catalog.budgets SET published_cents=1 WHERE batch_id=$1',[batch.id]),/immutable/);
   const tampered=structuredClone(batch);tampered.budgets[0].payload.raw.Housing='changed';await assert.rejects(importBatch(c,tampered),/identity_conflict/);
   const broken=fixture();broken.budgets[1].payload.items[0].key=broken.budgets[0].payload.items[0].key;await assert.rejects(importBatch(c,broken));
   assert.equal((await c.query('SELECT count(*)::int AS n FROM coa_catalog.batches WHERE id=$1',[broken.id])).rows[0].n,0);
  });
  await t.test('runtime reader can only select published records and cannot write or inspect drafts',async()=>{
   await c.query('SET ROLE origen_coa_catalog_readonly');try{
    assert.ok((await c.query('SELECT * FROM coa_catalog.published')).rows.length>=3);
    await assert.rejects(c.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);
    await assert.rejects(c.query('INSERT INTO coa_catalog.approvals DEFAULT VALUES'),/permission denied/);
   }finally{await c.query('RESET ROLE');}
  });
  await t.test('expired reviews stay unavailable; explicit re-review renews them with retained audit evidence',async()=>{
   await c.query("UPDATE coa_catalog.approvals SET reviewed_at=now()-interval '2 days',valid_until=now()-interval '1 day' WHERE batch_id=$1",[batch.id]);
   assert.equal((await catalog.plan({campuses:['Berkeley'],scope})).hits.length,0);
   await approveManifest(c,manifest);
   assert.equal((await catalog.plan({campuses:['Berkeley'],scope})).hits.length,1);
   const events=(await c.query("SELECT * FROM coa_catalog.approval_events WHERE after_record->>'batch_id'=$1",[batch.id])).rows;
   assert.equal(events.length,9);
   assert.ok(events.some(e=>e.operation==='UPDATE'&&e.before_record&&e.after_record));
   await assert.rejects(c.query('DELETE FROM coa_catalog.approvals WHERE batch_id=$1',[batch.id]),/immutable/);
   await assert.rejects(c.query("DELETE FROM coa_catalog.approval_events WHERE after_record->>'batch_id'=$1",[batch.id]),/immutable/);
  });
  await t.test('revocation immediately removes a previously approved result',async()=>{
   await c.query('UPDATE coa_catalog.approvals SET revoked_at=now() WHERE batch_id=$1',[batch.id]);
   assert.equal((await catalog.plan({campuses:['Berkeley'],scope})).hits.length,0);
  });
  console.log(JSON.stringify({catalogQueryTimingSamples:metrics.map(m=>m.durationMs),evidence:'isolated PostgreSQL and existing result/table builders; not voice playback'}));
 }finally{
  await c.query('UPDATE coa_catalog.approvals SET revoked_at=now() WHERE batch_id=$1',[batch.id]);await c.end();
 }
});

test('late catalog completions cannot replace a more recent comparison',async()=>{
 const resolvers=[],comparison=createCostComparison({scope,catalog:{plan:()=>new Promise(resolve=>resolvers.push(resolve))}});
 const old=comparison.update({add:['Berkeley']}),latest=comparison.update({add:['Davis']});
 resolvers[1]({result:{id:'latest'}});await latest;resolvers[0]({result:{id:'old'}});assert.equal((await old).superseded,true);assert.equal(comparison.snapshot().result.id,'latest');
});
