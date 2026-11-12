import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {publishCatalogSnapshot} from '../research/cost-catalog/publication.mjs';

export async function exportLocalCatalog(){
 const client=new pg.Client({host:'127.0.0.1',port:55480,database:'origen_coa_catalog_local',user:'postgres'});
 await client.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const release=(await client.query('SELECT * FROM coa_catalog.test_releases WHERE valid_until>now() ORDER BY released_at DESC,batch_id LIMIT 1')).rows[0];
  if(!release)throw Error('local_publication_required');
  const batch=(await client.query('SELECT * FROM coa_catalog.batches WHERE id=$1',[release.batch_id])).rows[0];
  const budgets=(await client.query("SELECT * FROM coa_catalog.budgets WHERE batch_id=$1 AND bucket<>'invalid' ORDER BY budget_key",[batch.id])).rows;
  const items=(await client.query('SELECT * FROM coa_catalog.items WHERE batch_id=$1 AND budget_key=ANY($2::text[]) ORDER BY item_key',[batch.id,budgets.map(b=>b.budget_key)])).rows;
  await client.query('COMMIT');
  return {version:1,batch,budgets,items,sourceReviewedAt:release.released_at,validUntil:release.valid_until,reviewEvidence:release.evidence,
   publication:{basis:'user_authorized_with_caveats',records:budgets.map(b=>({key:b.budget_key,digest:b.record_digest}))}};
 }finally{await client.end();}
}

export async function publishToDatabase(url,snapshot,{expectedDatabase,releasedBy,note}={}){
 if(!expectedDatabase)throw Error('expected_database_required');
 const client=new pg.Client({connectionString:url,connectionTimeoutMillis:10000});await client.connect();
 try{
  const identity=(await client.query('SELECT current_database() AS name')).rows[0];
  if(identity.name!==expectedDatabase)throw Error('catalog_database_mismatch');
  return await publishCatalogSnapshot(client,snapshot,{releasedBy,note});
 }finally{await client.end();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [mode,path]=process.argv.slice(2);
 if(mode==='export-local'){
  const snapshot=await exportLocalCatalog();await writeFile(path,JSON.stringify(snapshot));
  console.log(JSON.stringify({records:snapshot.budgets.length,items:snapshot.items.length,validUntil:snapshot.validUntil}));
 }else if(mode==='publish'&&process.env.MIGRATION_DATABASE_URL){
  const snapshot=JSON.parse(await readFile(path,'utf8'));
  console.log(JSON.stringify(await publishToDatabase(process.env.MIGRATION_DATABASE_URL,snapshot,{expectedDatabase:process.env.CATALOG_EXPECTED_DATABASE,releasedBy:process.env.CATALOG_RELEASED_BY,note:process.env.CATALOG_RELEASE_NOTE})));
 }else throw Error('export_local_or_configured_publish_required');
}
