import pg from 'pg';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {projectRecord} from './catalog.mjs';

export const LOCAL_PG={host:'127.0.0.1',port:55480,database:'origen_coa_catalog_local',user:'postgres'};
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function localClient(){
 const client=new pg.Client({...LOCAL_PG,connectionTimeoutMillis:5000});await client.connect();
 try{const {rows:[r]}=await client.query('SELECT current_database() AS db,inet_server_port() AS port,host(inet_server_addr()) AS host');
  if(r.db!==LOCAL_PG.database||r.port!==LOCAL_PG.port||r.host!=='127.0.0.1')throw Error('isolated_catalog_database_required');return client;
 }catch(e){await client.end();throw e;}
}
export async function setupIsolated(){
 // No DATABASE_URL or remote configuration is read by this operator helper.
 const admin=new pg.Client({...LOCAL_PG,database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[LOCAL_PG.database])).rowCount)await admin.query('CREATE DATABASE origen_coa_catalog_local');}
 finally{await admin.end();}
 const c=await localClient();try{
  await c.query(await readFile(new URL('./postgres.sql',import.meta.url),'utf8'));
  await c.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='origen_coa_catalog_readonly') THEN CREATE ROLE origen_coa_catalog_readonly NOLOGIN; END IF; END $$;");
  await c.query('GRANT USAGE ON SCHEMA coa_catalog TO origen_coa_catalog_readonly; GRANT SELECT ON coa_catalog.published TO origen_coa_catalog_readonly');
 }finally{await c.end();}
}
export function readStaging(batchId){
 const db=new DatabaseSync(fileURLToPath(new URL('./.local/uc-coa-staging.sqlite',import.meta.url)),{readOnly:true});
 try{
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(batchId);if(!batch)throw Error('unknown_staging_batch');
  const budgets=db.prepare('SELECT * FROM budget_records WHERE batch_id=? ORDER BY source_row').all(batchId).map(b=>{
   const items=db.prepare('SELECT * FROM cost_items WHERE budget_record_id=? ORDER BY source_row').all(b.id);
   return {key:b.budget_key,scenario:b.scenario_key,campus:JSON.parse(b.raw_json).College,year:JSON.parse(b.raw_json)['Academic year'],bucket:b.bucket,flagged:!!b.flagged,
    total:b.published_cents,sum:b.components_cents,difference:b.difference_cents,
    payload:{raw:JSON.parse(b.raw_json),normalized:JSON.parse(b.normalized_json),issues:JSON.parse(b.issues_json),items:items.map(i=>({key:i.item_key,amount:i.budget_period_cents,rawAmount:i.raw_amount,factor:i.factor,role:i.role,raw:JSON.parse(i.raw_json),issues:JSON.parse(i.issues_json)}))}};
  });return {id:batch.id,hash:batch.source_sha256,version:batch.importer_version,report:JSON.parse(batch.report_json),budgets};
 }finally{db.close();}
}
export async function importBatch(c,batch){
 if(new Set(batch.budgets.map(b=>b.key)).size!==batch.budgets.length)throw Error('duplicate_budget_keys_need_resolution');
 await c.query('BEGIN');try{
  const inserted=await c.query('INSERT INTO coa_catalog.batches(id,source_sha256,importer_version,report) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[batch.id,batch.hash,batch.version,batch.report]);
  if(!inserted.rowCount){const old=(await c.query('SELECT source_sha256,importer_version FROM coa_catalog.batches WHERE id=$1',[batch.id])).rows[0];
   const existing=(await c.query('SELECT budget_key,record_digest FROM coa_catalog.budgets WHERE batch_id=$1',[batch.id])).rows;
   if(old.source_sha256!==batch.hash||old.importer_version!==batch.version||existing.length!==batch.budgets.length||batch.budgets.some(b=>!existing.some(e=>e.budget_key===b.key&&e.record_digest===digest(b.payload))))throw Error('batch_identity_conflict');
   await c.query('COMMIT');return {alreadyImported:true};}
  for(const b of batch.budgets){
   const eligible=b.bucket==='reconciled'&&!b.flagged&&b.total!==null&&Math.abs(b.difference||0)<=1;
   await c.query('INSERT INTO coa_catalog.budgets(batch_id,budget_key,scenario_key,campus,academic_year,bucket,flagged,eligible_for_review,published_cents,components_cents,difference_cents,payload,record_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[batch.id,b.key,b.scenario,b.campus,b.year,b.bucket,b.flagged,eligible,b.total,b.sum,b.difference,b.payload,digest(b.payload)]);
   for(const i of b.payload.items)await c.query('INSERT INTO coa_catalog.items(batch_id,budget_key,item_key,amount_cents,raw_amount,period_factor,role,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batch.id,b.key,i.key,i.amount,i.rawAmount,i.factor,i.role,i]);
  }
  await c.query('COMMIT');return {alreadyImported:false,budgets:batch.budgets.length,items:batch.budgets.reduce((n,b)=>n+b.payload.items.length,0)};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
export async function approveManifest(c,manifest){
 if(manifest.verifiedOfficialSources!==true||!manifest.reviewedBy?.trim()||!manifest.note?.trim()||!Array.isArray(manifest.records)||!manifest.records.length||!Number.isFinite(Date.parse(manifest.validUntil))||Date.parse(manifest.validUntil)<=Date.now())throw Error('explicit_source_review_manifest_required');
 await c.query('BEGIN');try{
  const batch=(await c.query('SELECT source_sha256 FROM coa_catalog.batches WHERE id=$1',[manifest.batchId])).rows[0];if(batch?.source_sha256!==manifest.sourceSha256)throw Error('review_workbook_hash_mismatch');
  for(const r of manifest.records){
   const row=(await c.query('SELECT *,now() AS source_reviewed_at FROM coa_catalog.budgets WHERE batch_id=$1 AND budget_key=$2',[manifest.batchId,r.budgetId])).rows[0];
   if(!row||row.record_digest!==r.recordDigest||!projectRecord(row))throw Error('record_projection_or_source_hold');
   await c.query('INSERT INTO coa_catalog.approvals(batch_id,budget_key,record_digest,reviewed_by,valid_until,review_note) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id,budget_key) DO UPDATE SET reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),valid_until=EXCLUDED.valid_until,review_note=EXCLUDED.review_note,revoked_at=NULL',[manifest.batchId,r.budgetId,r.recordDigest,manifest.reviewedBy,manifest.validUntil,manifest.note]);
  }
  await c.query('COMMIT');return {approved:manifest.records.length};
 }catch(e){await c.query('ROLLBACK');throw e;}
}
export async function prepareReview(c,batchId){
 const batch=(await c.query('SELECT * FROM coa_catalog.batches WHERE id=$1',[batchId])).rows[0];if(!batch)throw Error('unknown_batch');
 const rows=(await c.query('SELECT *,now() AS source_reviewed_at FROM coa_catalog.budgets WHERE batch_id=$1 ORDER BY budget_key',[batchId])).rows;
 const ready=rows.filter(row=>projectRecord(row)),held=rows.filter(row=>!projectRecord(row));
 const directory=new URL('./.local/postgres-review/',import.meta.url);await mkdir(directory,{recursive:true});
 const approved=Number((await c.query('SELECT count(*) AS n FROM coa_catalog.published WHERE batch_id=$1',[batchId])).rows[0].n);
 const report={batchId,sourceSha256:batch.source_sha256,total:rows.length,projectionReady:ready.length,held:held.map(r=>({budgetId:r.budget_key,campus:r.campus,bucket:r.bucket,flagged:r.flagged,issues:r.payload.issues,sourceNotes:r.payload.raw['Scope and exclusions']})),approved,allUnapproved:approved===0};
 const manifest={batchId,sourceSha256:batch.source_sha256,verifiedOfficialSources:false,reviewedBy:'',note:'',validUntil:'',records:ready.map(r=>({budgetId:r.budget_key,recordDigest:r.record_digest}))};
 await writeFile(new URL(batchId+'-readiness.json',directory),JSON.stringify(report,null,2));
 await writeFile(new URL(batchId+'-manifest-template.json',directory),JSON.stringify(manifest,null,2));return {batchId,total:rows.length,projectionReady:ready.length,held:held.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const command=process.argv[2];if(command==='setup-local')await setupIsolated();
 else if(command==='import-local'){
  const c=await localClient();try{console.log(JSON.stringify(await importBatch(c,readStaging(process.argv[3]))));}finally{await c.end();}
 }else if(command==='prepare-review-local'||command==='approve-reviewed-local'){
  const c=await localClient();try{console.log(JSON.stringify(command==='prepare-review-local'?await prepareReview(c,process.argv[3]):await approveManifest(c,JSON.parse(await readFile(process.argv[3],'utf8')))));}finally{await c.end();}
 }else throw Error('Use setup-local, import-local, prepare-review-local, or approve-reviewed-local; all target the isolated database only');
}
