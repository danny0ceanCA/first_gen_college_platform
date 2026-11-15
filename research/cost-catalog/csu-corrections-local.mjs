// Hardcoded loopback rehearsal. Does not load application environment files or
// remote credentials. The publication functions below target this local DB only.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {prepareCsuCorrections} from '../../scripts/prepare-csu-corrections.mjs';
import {exportLocalCatalog} from '../../scripts/promote-coa-catalog.mjs';
import {publishCatalogSnapshot,publicationDigest} from './publication.mjs';
import {readStaging} from './postgres.mjs';
import {csuPublicationSnapshot} from './csu-publication.mjs';
import {projectRecord} from './catalog.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {verifyMixedCatalog} from './csu-rehearsal.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';

export async function rehearseCsuCorrections(directory){
 const {snapshot,receipt}=await prepareCsuCorrections(directory),uc=await exportLocalCatalog();
 assert.equal(uc.budgets.length,491);assert.ok(uc.budgets.every(b=>b.campus.startsWith('UC')));
 const original=csuPublicationSnapshot(readStaging(receipt.baseBatchId,'csu-coa-staging.sqlite'),{reviewedAt:snapshot.sourceReviewedAt,validUntil:snapshot.validUntil});
 const name='origen_csu_corrections_20261115',local={host:'127.0.0.1',port:55480,user:'postgres',connectionTimeoutMillis:3000};
 const admin=new pg.Client({...local,database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const c=new pg.Client({...local,database:name});await c.connect();let provider;
 try{
  const identity=(await c.query('SELECT current_database() db,inet_server_port() port,host(inet_server_addr()) host')).rows[0];
  assert.deepEqual(identity,{db:name,port:55480,host:'127.0.0.1'});
  await c.query(await readFile(new URL('../../server/migrations/126_cost_catalog_publication.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../../server/migrations/128_cost_catalog_campus_releases.sql',import.meta.url),'utf8'));
  await publishCatalogSnapshot(c,uc,{releasedBy:'isolated-local-test',note:'UC baseline preserved.'});
  await publishCatalogSnapshot(c,original,{releasedBy:'isolated-local-test',note:'Original 583 CSU baseline.'});
  const before=(await c.query("SELECT budget_key,record_digest FROM coa_catalog.production_published WHERE campus LIKE 'UC%' ORDER BY budget_key")).rows;
  const baselineCsus=(await c.query("SELECT budget_key,record_digest FROM coa_catalog.production_published WHERE campus NOT LIKE 'UC%' ORDER BY budget_key")).rows;
  await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-local-test',note:'24 scoped corrections; 212 still held; local only.'});
  assert.equal((await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-local-test',note:'Idempotence test.'})).alreadyPublished,true);
  const after=(await c.query("SELECT budget_key,record_digest FROM coa_catalog.production_published WHERE campus LIKE 'UC%' ORDER BY budget_key")).rows;
  assert.deepEqual(after,before,'every UC payload remains byte/digest identical');
  const csu=(await c.query("SELECT * FROM coa_catalog.production_published WHERE campus NOT LIKE 'UC%' ORDER BY budget_key")).rows;
  assert.equal(csu.length,607);
  for(const b of baselineCsus)assert.equal(csu.find(r=>r.budget_key===b.budget_key)?.record_digest,b.record_digest,'prior CSU value preserved');
  for(const hold of receipt.held)assert.ok(!csu.some(r=>r.budget_key===hold.budgetId),'held record absent: '+hold.budgetId);
  const projections=[];
  for(const language of ['en','es'])for(const key of receipt.newlyAvailable){
   const row=csu.find(r=>r.budget_key===key),expected=snapshot.budgets.find(r=>r.budget_key===key);
   assert.deepEqual(row.payload,expected.payload,'PostgreSQL round trip preserves raw/projection/provenance');
   const now=Date.parse(snapshot.sourceReviewedAt)+2*86400000,result=projectRecord(row,language,{allowTesting:true,now});assert.ok(result,key);
   assert.equal(Math.round(result.voiceBrief.findings[0].budget.total*100),Number(row.published_cents));
   assert.equal(projectRecord(row,language,{allowTesting:true,now:Date.parse(snapshot.validUntil)+1}),null,'expired review fails closed');
   projections.push({language,budgetId:key,total:Number(row.published_cents)/100});
  }
  provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:`postgresql://origen_research_worker@127.0.0.1:55480/${name}`});
  const mixed=await verifyMixedCatalog(provider);
  for(const language of ['en','es']){
   const question=language==='en'?'California resident 2026-27 undergraduate cost of attendance living with family.':'Costo de asistencia 2026-27 de pregrado residente de California viviendo con familiares.';
   const result=await provider.lookup({mode:'finance',language,institution:'San Francisco State',question});assert.ok(result);
   assert.equal(result.voiceBrief.findings[0].budget.total,27736);
   assert.equal(result.voiceBrief.findings[0].budget.components.find(c=>c.key==='housing_and_food').amount,11826);
  }
  const reader=new pg.Client({...local,user:'origen_research_worker',database:name});await reader.connect();
  try{await assert.rejects(reader.query('SELECT * FROM coa_catalog.budgets'),/permission denied/);await assert.rejects(reader.query('UPDATE coa_catalog.production_releases SET note=note'),/permission denied/);}finally{await reader.end();}
  const report={database:name,snapshotDigest:publicationDigest(snapshot),ucRecords:491,csuBefore:583,csuAfter:607,newlyAvailable:24,held:212,
   unchangedUcDigest:publicationDigest(after),unchangedPriorCsuRecords:baselineCsus.length,projections,mixed,modelCalls:0,productionChanged:false,at:new Date().toISOString()};
  await writeFile(join(directory,'rehearsal.json'),JSON.stringify(report,null,2)+'\n');
  return report;
 }finally{await provider?.close();await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('local-output-directory required');
 const r=await rehearseCsuCorrections(resolve(process.argv[2]));
 console.log(JSON.stringify({database:r.database,csu:r.csuAfter,uc:r.ucRecords,held:r.held,projections:r.projections.length,mixedStages:r.mixed.length,modelCalls:0,productionChanged:false}));
}
