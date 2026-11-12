import {createHash} from 'node:crypto';
export const publicationDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Immutable public cost data only. Local source release dates and limitations
// survive promotion; publication never pretends a website was checked today.
export async function publishCatalogSnapshot(client,snapshot,{releasedBy,note}={}){
 if(!releasedBy?.trim()||!note?.trim()||snapshot.version!==1||snapshot.budgets.length!==snapshot.publication.records.length||
  snapshot.budgets.some(b=>b.batch_id!==snapshot.batch.id||b.bucket==='invalid'||!snapshot.publication.records.some(r=>r.key===b.budget_key&&r.digest===b.record_digest))||
  new Set(snapshot.budgets.map(b=>b.budget_key)).size!==snapshot.budgets.length||
  !Number.isFinite(Date.parse(snapshot.validUntil))||Date.parse(snapshot.validUntil)<=Date.now())throw Error('invalid_catalog_snapshot');
 const release=publicationDigest(snapshot);
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(728419,126)');
  const prior=(await client.query('SELECT id FROM coa_catalog.production_releases WHERE id=$1',[release])).rows[0];
  if(prior){await client.query('COMMIT');return {release,alreadyPublished:true,records:snapshot.budgets.length};}
  const batch=snapshot.batch;
  const existingBatch=(await client.query('SELECT source_sha256,importer_version FROM coa_catalog.batches WHERE id=$1',[batch.id])).rows[0];
  if(existingBatch&&(existingBatch.source_sha256!==batch.source_sha256||existingBatch.importer_version!==batch.importer_version))throw Error('catalog_batch_conflict');
  await client.query('INSERT INTO coa_catalog.batches(id,source_sha256,importer_version,imported_at,report) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[batch.id,batch.source_sha256,batch.importer_version,batch.imported_at,batch.report]);
  const conflicts=(await client.query('SELECT b.budget_key FROM coa_catalog.budgets b JOIN jsonb_populate_recordset(NULL::coa_catalog.budgets,$1::jsonb) n USING(batch_id,budget_key) WHERE b.record_digest<>n.record_digest OR b.payload<>n.payload',[JSON.stringify(snapshot.budgets)])).rows;
  if(conflicts.length)throw Error('catalog_record_conflict');
  for(let i=0;i<snapshot.budgets.length;i+=50)await client.query('INSERT INTO coa_catalog.budgets SELECT * FROM jsonb_populate_recordset(NULL::coa_catalog.budgets,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(snapshot.budgets.slice(i,i+50))]);
  for(let i=0;i<snapshot.items.length;i+=250)await client.query('INSERT INTO coa_catalog.items SELECT * FROM jsonb_populate_recordset(NULL::coa_catalog.items,$1::jsonb) ON CONFLICT DO NOTHING',[JSON.stringify(snapshot.items.slice(i,i+250))]);
  await client.query('INSERT INTO coa_catalog.production_releases(id,batch_id,released_by,note,source_reviewed_at,valid_until,review_evidence,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[release,batch.id,releasedBy,note,snapshot.sourceReviewedAt,snapshot.validUntil,snapshot.reviewEvidence,snapshot.publication]);
  await client.query('INSERT INTO coa_catalog.production_release_records(release_id,batch_id,budget_key,record_digest) SELECT $1,$2,r.key,r.digest FROM jsonb_to_recordset($3::jsonb) AS r(key text,digest text)',[release,batch.id,JSON.stringify(snapshot.publication.records)]);
  await client.query('COMMIT');return {release,alreadyPublished:false,records:snapshot.budgets.length,items:snapshot.items.length};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
