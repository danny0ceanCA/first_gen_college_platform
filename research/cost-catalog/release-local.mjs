import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localClient} from './postgres.mjs';

export async function releaseForLocalTesting(client,{batchId,evidence,validUntil,reviewer}){
 if(!reviewer?.trim()||Date.parse(validUntil)<=Date.now()||!Number.isFinite(Date.parse(validUntil)))throw Error('local_test_release_review_required');
 await client.query('BEGIN');
 try{
  const batch=(await client.query('SELECT source_sha256 FROM coa_catalog.batches WHERE id=$1',[batchId])).rows[0];
  if(!batch||batch.source_sha256!==evidence.sourceSha256)throw Error('test_release_workbook_hash_mismatch');
  const budgets=(await client.query('SELECT budget_key,campus FROM coa_catalog.budgets WHERE batch_id=$1',[batchId])).rows;
  const seen=new Set();
  for(const row of evidence.reviewNotes||[]){
   const id=row.values?.['Budget ID'],record=budgets.find(r=>r.budget_key===id);
   if(!record||seen.has(id)||record.campus!==row.values.Campus)throw Error('review_note_identity_mismatch');
   seen.add(id);
  }
  const previous=(await client.query('SELECT evidence FROM coa_catalog.test_releases WHERE batch_id=$1',[batchId])).rows[0];
  if(previous){
   if(JSON.stringify(previous.evidence)!==JSON.stringify(JSON.parse(JSON.stringify(evidence)))){
    // PostgreSQL jsonb normalizes object-key order; compare through jsonb.
    const equal=(await client.query('SELECT evidence=$2::jsonb AS equal FROM coa_catalog.test_releases WHERE batch_id=$1',[batchId,evidence])).rows[0]?.equal;
    if(!equal)throw Error('test_release_evidence_conflict');
   }
   await client.query('COMMIT');return {alreadyReleased:true};
  }
  await client.query('INSERT INTO coa_catalog.test_releases(batch_id,evidence,valid_until,released_by,note) VALUES($1,$2,$3,$4,$5)',[batchId,evidence,validUntil,reviewer,'User authorized local testing with explicit caveats. Workbook review claims are retained as claims, not automatic official verification. Missing amounts stay null. Production approval is unchanged.']);
  await client.query('COMMIT');return {released:budgets.length,reviewNotes:seen.size,productionApprovals:0};
 }catch(error){await client.query('ROLLBACK');throw error;}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const client=await localClient();try{
  await client.query(await readFile(new URL('./testing.sql',import.meta.url),'utf8'));
  const evidence=JSON.parse(await readFile(process.argv[3],'utf8'));
  console.log(JSON.stringify(await releaseForLocalTesting(client,{batchId:process.argv[2],evidence,reviewer:'Daniel: local testing authorized in chat',validUntil:new Date(Date.now()+30*86400000).toISOString()})));
 }finally{await client.end();}
}
