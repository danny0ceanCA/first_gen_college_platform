import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {publishCatalogSnapshot} from './publication.mjs';
import {projectRecord} from './catalog.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {sourceIsCurrent} from '../../src/researchSourceValidity.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';

test('published catalog requires explicit enablement and never silently uses local credentials',async()=>{
 await assert.rejects(createProductionCatalogProvider({}),/not_enabled/);
 await assert.rejects(createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true'}),/database_required/);
});

test('production publication parity on isolated PostgreSQL',async t=>{
 if(process.env.COA_PRODUCTION_PARITY_TEST!=='true'){t.skip('explicit isolated database test required');return;}
 const name='origen_coa_prod_parity_'+process.pid;
 const admin=new pg.Client({host:'127.0.0.1',port:55480,user:'postgres',database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const c=new pg.Client({host:'127.0.0.1',port:55480,user:'postgres',database:name});await c.connect();
 let provider;
 try{
  await c.query(await readFile(new URL('../../server/migrations/126_cost_catalog_publication.sql',import.meta.url),'utf8'));
  const snapshot=JSON.parse(await readFile(process.env.COA_PARITY_SNAPSHOT,'utf8'));
  const publication=await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-test',note:'User-authorized caveated snapshot parity rehearsal.'});
  assert.equal(publication.records,491);
  const again=await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-test',note:'Idempotency check.'});assert.equal(again.alreadyPublished,true);
  const rows=(await c.query('SELECT * FROM coa_catalog.production_published ORDER BY budget_key')).rows;
  assert.equal(rows.length,snapshot.budgets.length);
  assert.equal(Number((await c.query('SELECT count(*) FROM coa_catalog.items')).rows[0].count),5278);
  assert.equal(Number((await c.query('SELECT count(*) FROM coa_catalog.published')).rows[0].count),0,'caveated publication never creates independent-review approvals');
  for(const language of ['en','es'])await t.test(language+': all records retain totals, details, provenance and limitations',()=>{
   for(const row of rows){
    const original=snapshot.budgets.find(b=>b.budget_key===row.budget_key);
    assert.deepEqual(row.payload,original.payload);assert.equal(row.record_digest,original.record_digest);
    const result=projectRecord(row,language,{allowTesting:true});assert.ok(result,row.budget_key);
    assert.equal(result.voiceBrief.findings[0].status,'partial');
    assert.equal(result.voiceBrief.findings[0].budget.total,row.published_cents==null?null:Number(row.published_cents)/100);
    for(const s of result.sources){assert.equal(s.catalogValidity.kind,'published_catalog');assert.ok(sourceIsCurrent(s));assert.equal(sourceIsCurrent(s,Date.parse(s.catalogValidity.validUntil)),false);}
    assert.doesNotMatch(result.text,/local testing|pruebas locales/);
    if(row.bucket==='discrepancy')assert.match(result.voiceBrief.qualification,language==='es'?/no coinciden/:/do not reconcile/);
   }
  });
  provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:`postgresql://origen_research_worker@127.0.0.1:55480/${name}`});
  for(const language of ['en','es'])await t.test(language+': read-only production adapter supplies the full same comparison to the table',async()=>{
   const input={mode:'finance',language,institution:'UC Berkeley; UC Davis; UC Merced',question:language==='es'?'Costo de asistencia 2026-27 para residentes de California que alquilan fuera del campus.':'2026-27 California resident cost of attendance renting off campus.'};
   const result=await provider.lookup(input);assert.equal(result.catalogPublication,'production');
   assert.deepEqual(result.voiceBrief.findings.map(f=>f.budget.total),[49692,44760,41834]);
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});visual.trackResearch('parity',input.question);
   visual.receiveResearch({id:'published',query:{requestKey:'parity',...input},...input,status:'completed',result});
   const table=events.find(e=>e.type==='origen.visual.research');assert.ok(table?.present);assert.equal(table.report.table.columns.length,3);
   assert.ok(result.voiceBrief.findings.every(f=>f.budget.components.some(c=>c.key==='transportation')));
  });
  await t.test('reader cannot see drafts or modify data; publication is immutable',async()=>{
   const r=new pg.Client({host:'127.0.0.1',port:55480,user:'origen_research_worker',database:name});await r.connect();
   try{await assert.rejects(r.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);await assert.rejects(r.query('DELETE FROM coa_catalog.production_releases'),/permission denied/);}finally{await r.end();}
   await assert.rejects(c.query('UPDATE coa_catalog.production_releases SET note=note'),/immutable/);
   const bad=structuredClone(snapshot);bad.publication.records[0].digest='0'.repeat(64);await assert.rejects(publishCatalogSnapshot(c,bad,{releasedBy:'test',note:'invalid'}),/invalid_catalog_snapshot/);
  });
 }finally{await provider?.close();await c.end();}
});
