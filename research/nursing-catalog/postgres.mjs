import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localClient} from '../cost-catalog/postgres.mjs';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const cents=v=>v===null||Number.isSafeInteger(v)&&v>=0;
const representations=new Set(['Recorded scalar amount','Published range','Published lower bound','Published upper bound','Unpriced or variable']);

export function validateBatch(b){
 if(!/^[a-f0-9]{64}$/.test(b.id)||!/^origen-nursing-local-v24\.1-/.test(b.version)||![b.source_workbook_sha256,b.source_archive_sha256,b.adapter_fingerprint].every(x=>/^[a-f0-9]{64}$/.test(x)))throw Error('invalid_nursing_batch_identity');
 if(!b.budgets?.length||!b.items?.length||b.report?.pending!==true||b.report.source_verified!==false||b.report.live_eligible!==false)throw Error('pending_nursing_batch_required');
 const budgets=new Map(),items=new Map(),refs=new Set();
 for(const r of b.budgets){
  if(!r.id||budgets.has(r.id)||r.raw['Budget ID']!==r.id||r.values['Budget ID']!==r.id)throw Error('duplicate_or_invalid_budget');
  if(r.normalized.source_verified!==false||r.normalized.production_status!=='Not approved'||r.normalized.automatic_production_permission!==false||r.values['Automatic production permission']!==false||r.values['Production status']!=='Not approved')throw Error('nursing_budget_must_remain_pending');
  budgets.set(r.id,r);
 }
 for(const r of b.items){
  if(!r.id||items.has(r.id)||r.raw['Cost item ID']!==r.id||!budgets.has(r.budget_id)||r.values['Budget ID']!==r.budget_id)throw Error('duplicate_or_orphan_item');
  const n=r.normalized,lo=n.published_lower_bound_cents,hi=n.published_upper_bound_cents;
  if(n.source_verified!==false||n.bounds_automatically_additive!==false||!representations.has(n.value_representation)||![n.source_scalar_cents,n.budget_period_cents,lo,hi].every(cents))throw Error('invalid_nursing_item_values');
  const kind=n.value_representation;
  if(kind==='Published range'&&(lo===null||hi===null||lo>hi)||kind==='Published lower bound'&&(lo===null||hi!==null)||kind==='Published upper bound'&&(lo!==null||hi===null)||['Recorded scalar amount','Unpriced or variable'].includes(kind)&&(lo!==null||hi!==null)||kind!=='Recorded scalar amount'&&(n.source_scalar_cents!==null||n.budget_period_cents!==null))throw Error('invalid_nursing_bounds');
  items.set(r.id,r);
 }
 for(const d of b.decisions){
  if(refs.has(d.reference)||!budgets.has(d.budget_id)||d.item_id&&items.get(d.item_id)?.budget_id!==d.budget_id)throw Error('duplicate_or_orphan_decision');
  if(d.normalized.live_eligible!==false||d.companion.production_eligible!==false||d.normalized.reference!==d.reference||!d.normalized.required_caveat)throw Error('unsafe_nursing_decision');
  refs.add(d.reference);
 }
 if(b.report.budgets!==budgets.size||b.report.items!==items.size||b.report.supporting_sheets!==Object.keys(b.evidence).length||b.report.v24.decision_count!==refs.size)throw Error('nursing_report_count_mismatch');
 return b;
}

export async function readExport(id){
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('full_nursing_batch_hash_required');
 const b=validateBatch(JSON.parse(await readFile(new URL(`./.local/${id}.json`,import.meta.url),'utf8')));
 if(b.id!==id)throw Error('nursing_export_identity_mismatch');
 for(const [digest,extension] of [[b.source_workbook_sha256,'.xlsx'],[b.source_archive_sha256,'.zip']]){
  const bytes=await readFile(new URL(`./.local/sources/${digest}${extension}`,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('nursing_source_snapshot_hash_mismatch');
 }
 return b;
}

async function insertRows(c,table,columns,rows){
 for(let offset=0;offset<rows.length;offset+=25){
  const part=rows.slice(offset,offset+25),values=part.flatMap(row=>row.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v));
  const placeholders=part.map((_,i)=>`(${columns.map((_,j)=>'$'+(i*columns.length+j+1)).join(',')})`).join(',');
  await c.query(`INSERT INTO nursing_catalog.${table}(${columns.join(',')}) VALUES ${placeholders}`,values);
 }
}

export async function setup(c){
 await c.query(await readFile(new URL('./postgres.sql',import.meta.url),'utf8'));
 const versions=(await c.query('SELECT version FROM nursing_catalog.metadata')).rows;
 if(versions.length!==1||versions[0].version!=='nursing-local-v1')throw Error('unrecognized_nursing_catalog_schema');
}

// Caller owns the transaction; used by the local operator and rollback tests.
export async function writeBatch(c,b){
 validateBatch(b);
 const digest=hash(b),old=(await c.query('SELECT payload_digest FROM nursing_catalog.batches WHERE id=$1',[b.id])).rows[0];
 if(old){
  if(old.payload_digest!==digest)throw Error('nursing_batch_identity_conflict');
  const checks=await verifyBatch(c,b);
  return {alreadyImported:true,...checks};
 }
 await insertRows(c,'batches',['id','source_workbook_sha256','source_archive_sha256','importer_version','adapter_fingerprint','payload_digest','source_archive_filename','report','companions','manifest'],[[b.id,b.source_workbook_sha256,b.source_archive_sha256,b.version,b.adapter_fingerprint,digest,b.source_archive_filename??'synthetic-test',b.report,b.companions,b.manifest]]);
 await insertRows(c,'budgets',['batch_id','budget_id','source_row','campus','program','pathway','academic_year_raw','academic_year_display','academic_year_key','academic_year_status','cohort','residency','housing','enrollment','budget_period','currency','source_url','cost_coverage','bucket','published_cents','components_cents','difference_cents','payload','record_digest'],b.budgets.map(r=>{
  const v=r.values,n=r.normalized;
  return [b.id,r.id,r.row,v.College,v['Program / degree'],v['Nursing pathway'],v['Academic year'],n.academic_year_display,n.academic_year,n.academic_year_status,v['Normalized cohort key'],v.Residency,v.Housing,v.Enrollment,v['Budget period'],v.Currency,v['Official source URL'],v['Cost coverage'],r.bucket,n.published_cents,n.components_cents,n.difference_cents,r,hash(r)];
 }));
 await insertRows(c,'items',['batch_id','item_id','budget_id','source_row','original_label','category_raw','category_candidate','category_mapping_status','role_raw','role_normalized','amount_period','source_url','value_representation','source_scalar_cents','source_scalar_status','budget_period_cents','lower_bound_cents','upper_bound_cents','bound_extraction_basis','caveated_handling','fresh_range_verification','payload','record_digest'],b.items.map(r=>{
  const v=r.values,n=r.normalized;
  return [b.id,r.id,r.budget_id,r.row,v['Original source label'],v.Category,n.category,n.category_mapping_status,v['Relationship to total'],n.role,v['Amount period'],n.source_url,n.value_representation,n.source_scalar_cents,n.source_scalar_status,n.budget_period_cents,n.published_lower_bound_cents,n.published_upper_bound_cents,n.bound_extraction_basis,n.caveated_handling,n.fresh_range_verification,r,hash(r)];
 }));
 await insertRows(c,'decisions',['batch_id','reference','budget_id','item_id','treatment','suggested_wording','required_caveat','still_unresolved','source_url','normalized','companion','record_digest'],b.decisions.map(d=>[b.id,d.reference,d.budget_id,d.item_id,d.normalized.treatment,d.normalized.suggested_wording,d.normalized.required_caveat,d.normalized.still_unresolved,d.normalized.source_url,d.normalized,d.companion,hash(d)]));
 await insertRows(c,'evidence',['batch_id','sheet_name','rows','record_digest'],Object.entries(b.evidence).map(([name,rows])=>[b.id,name,rows,hash(rows)]));
 return {alreadyImported:false,...await verifyBatch(c,b)};
}

export async function verifyBatch(c,b){
 const stored=(await c.query('SELECT * FROM nursing_catalog.batches WHERE id=$1',[b.id])).rows[0];
 if(!stored||stored.payload_digest!==hash(b)||hash(stored.report)!==hash(b.report)||hash(stored.companions)!==hash(b.companions)||hash(stored.manifest)!==hash(b.manifest))throw Error('nursing_batch_round_trip_mismatch');
 for(const [table,key,records] of [['budgets','budget_id',b.budgets],['items','item_id',b.items]]){
  const rows=(await c.query(`SELECT ${key} id,payload,record_digest FROM nursing_catalog.${table} WHERE batch_id=$1`,[b.id])).rows;
  const expected=new Map(records.map(r=>[r.id,hash(r)]));
  if(rows.length!==expected.size||rows.some(r=>hash(r.payload)!==expected.get(r.id)||r.record_digest!==expected.get(r.id)))throw Error('nursing_record_round_trip_mismatch');
 }
 const evidence=(await c.query('SELECT sheet_name,rows,record_digest FROM nursing_catalog.evidence WHERE batch_id=$1',[b.id])).rows;
 if(evidence.length!==Object.keys(b.evidence).length||evidence.some(r=>hash(r.rows)!==hash(b.evidence[r.sheet_name])||r.record_digest!==hash(r.rows)))throw Error('nursing_evidence_round_trip_mismatch');
 const decisions=(await c.query('SELECT reference,normalized,companion,record_digest FROM nursing_catalog.decisions WHERE batch_id=$1',[b.id])).rows;
 const dmap=new Map(b.decisions.map(d=>[d.reference,d]));
 if(decisions.length!==dmap.size||decisions.some(r=>hash(r.normalized)!==hash(dmap.get(r.reference)?.normalized)||hash(r.companion)!==hash(dmap.get(r.reference)?.companion)||r.record_digest!==hash(dmap.get(r.reference))))throw Error('nursing_decision_round_trip_mismatch');
 for(const table of ['budgets','items']){
  if(Number((await c.query(`SELECT count(*) n FROM nursing_catalog.${table} WHERE batch_id=$1 AND (review_state<>'pending' OR source_verified OR live_eligible)`,[b.id])).rows[0].n))throw Error('unsafe_nursing_database_state');
 }
 const budgetMismatch=await c.query(`SELECT count(*) n FROM nursing_catalog.budgets WHERE batch_id=$1 AND (
  published_cents IS DISTINCT FROM (payload->'normalized'->>'published_cents')::bigint OR
  components_cents IS DISTINCT FROM (payload->'normalized'->>'components_cents')::bigint OR
  difference_cents IS DISTINCT FROM (payload->'normalized'->>'difference_cents')::bigint OR
  academic_year_raw IS DISTINCT FROM payload->'values'->>'Academic year' OR
  academic_year_key IS DISTINCT FROM payload->'normalized'->>'academic_year' OR
  academic_year_display IS DISTINCT FROM payload->'normalized'->>'academic_year_display' OR
  campus IS DISTINCT FROM payload->'values'->>'College' OR
  budget_period IS DISTINCT FROM payload->'values'->>'Budget period' OR automatic_production_permission)`,[b.id]);
 const itemMismatch=await c.query(`SELECT count(*) n FROM nursing_catalog.items WHERE batch_id=$1 AND (
  source_scalar_cents IS DISTINCT FROM (payload->'normalized'->>'source_scalar_cents')::bigint OR
  budget_period_cents IS DISTINCT FROM (payload->'normalized'->>'budget_period_cents')::bigint OR
  lower_bound_cents IS DISTINCT FROM (payload->'normalized'->>'published_lower_bound_cents')::bigint OR
  upper_bound_cents IS DISTINCT FROM (payload->'normalized'->>'published_upper_bound_cents')::bigint OR
  value_representation IS DISTINCT FROM payload->'normalized'->>'value_representation' OR
  role_raw IS DISTINCT FROM payload->'values'->>'Relationship to total' OR
  role_normalized IS DISTINCT FROM payload->'normalized'->>'role' OR
  amount_period IS DISTINCT FROM payload->'values'->>'Amount period' OR bounds_automatically_additive)`,[b.id]);
 if(Number(budgetMismatch.rows[0].n)||Number(itemMismatch.rows[0].n))throw Error('nursing_typed_field_round_trip_mismatch');
 return {budgets:b.budgets.length,items:b.items.length,decisions:decisions.length,supportingSheets:evidence.length,pending:true,liveEligible:0};
}

export async function coaSnapshot(c){
 const snapshot={};
 for(const table of ['batches','budgets','items','approvals','approval_events','test_releases']){
  snapshot[table]=(await c.query(`SELECT count(*) n,md5(string_agg(d,'' ORDER BY d)) digest FROM (SELECT md5(row_to_json(t)::text) d FROM coa_catalog.${table} t) x`)).rows[0];
 }
 snapshot.testing=(await c.query('SELECT batch_id,budget_key FROM coa_catalog.testing_published ORDER BY batch_id,budget_key')).rows;
 return snapshot;
}

export async function importLocal(id){
 const batch=await readExport(id),c=await localClient();
 try{
  const before=await coaSnapshot(c);
  await c.query('BEGIN');
  try{
   await setup(c);const result=await writeBatch(c,batch);
   const after=await coaSnapshot(c);if(hash(before)!==hash(after))throw Error('existing_coa_catalog_changed');
   await c.query('COMMIT');
   const receipt={batchId:id,...result,existingCoaCatalogUnchanged:true,sourceWorkbookSha256:batch.source_workbook_sha256,sourceArchiveSha256:batch.source_archive_sha256};
   await writeFile(new URL(`./.local/${id}-postgres-receipt.json`,import.meta.url),JSON.stringify(receipt,null,2)+'\n');
   return receipt;
  }catch(error){await c.query('ROLLBACK');throw error;}
 }finally{await c.end();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv[2]!=='import-local')throw Error('Use import-local <full-batch-id>; isolated pending nursing data only');
 console.log(JSON.stringify(await importLocal(process.argv[3])));
}
