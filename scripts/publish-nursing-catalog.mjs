// Operator only. Verified Origen production target; secrets never leave memory.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createDatabase} from '../server/database.mjs';
import {readExport,writeBatch,verifyBatch,hash} from '../research/nursing-catalog/postgres.mjs';
import {createNursingLookup} from '../research/nursing-catalog/lookup.mjs';

const target={workspace:'tea-ctn17nbv2p9s73ffqo5g',database:'dpg-db0806hsrm7s73efcupg-a',name:'origen_edu_database',worker:'srv-dbm1dfec6qcc73fm5ko0',repo:'https://github.com/danny0ceanCA/first_gen_college_platform'};
const validUntil='2026-12-17T00:00:00.000Z';
const [mode,id]=process.argv.slice(2);
let stage='configuration',pool;
async function api(path){
 const r=await fetch('https://api.render.com/v1/'+path,{headers:{Authorization:`Bearer ${process.env.RENDER_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('render_'+r.status);return r.json();
}
async function costFingerprint(c){
 const rows=(await c.query('SELECT batch_id,budget_key,record_digest FROM coa_catalog.production_published ORDER BY batch_id,budget_key')).rows;
 return {records:rows.length,digest:hash(rows)};
}
try{
 if(!process.env.RENDER_API_KEY||!['inspect','publish','verify'].includes(mode))throw Error('configured_operator_required');
 const batch=await readExport(id);
 stage='target_verification';
 const [db,connection,worker]=await Promise.all([api(`postgres/${target.database}`),api(`postgres/${target.database}/connection-info`),api(`services/${target.worker}`)]);
 if(db.id!==target.database||db.owner?.id!==target.workspace||db.databaseName!==target.name||db.status!=='available'||worker.ownerId!==target.workspace||worker.repo!==target.repo||worker.branch!=='main')throw Error('production_target_mismatch');
 const url=new URL(connection.externalConnectionString);
 if(!url.hostname.startsWith(target.database+'.')||decodeURIComponent(url.pathname)!=='/'+target.name)throw Error('external_database_target_mismatch');
 pool=createDatabase({DATABASE_URL:url.href,NODE_ENV:'production'},undefined,{max:1});
 const c=await pool.connect();
 let released=false;
 try{
  const identity=(await c.query('SELECT current_database() name,current_user role,pg_database_size(current_database()) bytes')).rows[0];
  if(identity.name!==target.name||identity.role!==decodeURIComponent(url.username))throw Error('production_database_identity_mismatch');
  const before=await costFingerprint(c);
  if(mode==='inspect'){
   const mismatch=[];
   for(const row of (await c.query('SELECT name,checksum FROM origen_schema_migrations ORDER BY name')).rows){
    let sql;try{sql=(await readFile(new URL('../server/migrations/'+row.name,import.meta.url),'utf8')).replaceAll('\r\n','\n');}catch{mismatch.push({name:row.name,reason:'missing_local_file'});continue;}
    if(createHash('sha256').update(sql).digest('hex')!==row.checksum)mismatch.push({name:row.name,reason:'checksum_mismatch'});
   }
   console.log(JSON.stringify({database:identity.name,bytes:identity.bytes,existingCostCatalog:before,nursingBatch:id,records:batch.budgets.length,items:batch.items.length,worker:worker.id,migrationMismatches:mismatch}));
  }else{
   if(mode==='publish'){
    stage='nursing_schema_migration';
    // Add only the independent nursing migration. Do not rewrite or replay
    // unrelated applied migrations (121 has a pre-existing checksum mismatch).
    c.release();released=true;
    const publisher=await pool.connect();
    try{
     const migration='129_nursing_catalog_publication.sql';
     const sql=(await readFile(new URL('../server/migrations/'+migration,import.meta.url),'utf8')).replaceAll('\r\n','\n');
     const checksum=createHash('sha256').update(sql).digest('hex');
     await publisher.query('BEGIN');
     try{
      await publisher.query('SELECT pg_advisory_xact_lock(728419,1)');
      const applied=(await publisher.query('SELECT checksum FROM origen_schema_migrations WHERE name=$1',[migration])).rows[0];
      if(applied&&applied.checksum!==checksum)throw Error('nursing_applied_migration_checksum_mismatch');
      if(!applied){await publisher.query(sql);await publisher.query('INSERT INTO origen_schema_migrations(name,checksum) VALUES($1,$2)',[migration,checksum]);}
      await publisher.query('COMMIT');
     }catch(error){await publisher.query('ROLLBACK');throw error;}
     await publisher.query('BEGIN');
     try{
      await publisher.query('SELECT pg_advisory_xact_lock(728419,129)');
      stage='pending_data_import';const result=await writeBatch(publisher,batch);
      stage='caveated_publication';const release=hash({version:1,batchId:id,validUntil});
      await publisher.query('INSERT INTO nursing_catalog.production_releases(id,batch_id,valid_until,released_by,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[release,id,validUntil,'Daniel: production live-answer availability authorized in chat','All nursing records available as caveated research. Original source-review state remains pending/unverified; conflicts, bounds and unknown prices retained.']);
      const after=await costFingerprint(publisher);if(hash(before)!==hash(after))throw Error('existing_cost_publication_changed');
      await publisher.query('COMMIT');
      const receipt={release,batchId:id,...result,validUntil,existingCostCatalogUnchanged:true,sourceApprovalChanged:false};
      await writeFile(new URL(`../research/nursing-catalog/.local/${id}-production-receipt.json`,import.meta.url),JSON.stringify(receipt,null,2)+'\n');
      console.log(JSON.stringify(receipt));
     }catch(error){await publisher.query('ROLLBACK');throw error;}
    }finally{publisher.release();}
   }else{
    stage='production_verification';
    const result=await verifyBatch(c,batch);
    const views=(await c.query('SELECT (SELECT count(*) FROM nursing_catalog.production_budgets) budgets,(SELECT count(*) FROM nursing_catalog.production_items) items,(SELECT count(*) FROM nursing_catalog.production_decisions) decisions')).rows[0];
    stage='restricted_worker_verification';
    const env=new Map();let cursor='';
    for(let page=0;page<10;page++){
     const entries=await api(`services/${target.worker}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
     for(const {envVar} of entries)env.set(envVar.key,envVar.value);
     if(entries.length<100)break;cursor=entries.at(-1)?.cursor;if(!cursor)throw Error('invalid_worker_environment_page');
    }
    if(env.get('ORIGEN_COST_CATALOG')!=='true')throw Error('production_cost_catalog_not_enabled');
    const workerUrl=new URL(env.get('RESEARCH_WORKER_DATABASE_URL'));
    if(decodeURIComponent(workerUrl.username)!=='origen_research_worker'||decodeURIComponent(workerUrl.pathname)!=='/'+target.name||!workerUrl.hostname.startsWith(target.database))throw Error('research_worker_database_target_mismatch');
    const externalWorker=new URL(url);externalWorker.username=workerUrl.username;externalWorker.password=workerUrl.password;
    const workerPool=createDatabase({DATABASE_URL:externalWorker.href,NODE_ENV:'production'},undefined,{max:1});
    const reader=await workerPool.connect();await reader.query('BEGIN READ ONLY');
    try{
     const access=(await reader.query("SELECT current_user role,(SELECT count(*) FROM nursing_catalog.production_budgets) records,has_table_privilege(current_user,'nursing_catalog.budgets','SELECT') raw_access")).rows[0];
     if(Number(access.records)!==1016||access.raw_access)throw Error('nursing_worker_publication_access_mismatch');
     const campuses=(await reader.query('SELECT DISTINCT campus FROM nursing_catalog.production_budgets ORDER BY campus')).rows.map(r=>r.campus);
     const lookup=createNursingLookup({query:reader.query.bind(reader),campuses});
     for(const language of ['en','es']){
      const lmc=await lookup({mode:'finance',institution:'Los Medanos College',question:'Nursing reference NUR-0547',language});
      const bls=await lookup({mode:'finance',institution:'Cal State Los Angeles',question:'Nursing NUR-0042 BLS certification cost',language});
      if(!lmc?.text.includes('5,369')||!lmc.text.includes('5,321')||!bls?.voiceBrief.answer.includes('$40–$60')||bls.voiceBrief.status!=='partial')throw Error('production_nursing_lookup_rehearsal_failed');
     }
     console.log(JSON.stringify({verified:true,...result,views,workerReadOnlyView:true,workerCatalogEnabled:true,bilingualLookupVerified:true,existingCostCatalog:before}));
    }finally{await reader.query('ROLLBACK');reader.release();await workerPool.end();}
   }
  }
 }finally{if(!released)c.release();}
}catch(error){console.error(JSON.stringify({failed:true,stage,code:error.message?.startsWith('Applied database migration was changed')?'applied_migration_checksum_mismatch':error.safeCode||error.code||error.message?.match(/^[a-z0-9_]+$/)?.[0]||'operator_failed'}));process.exitCode=1;}
finally{await pool?.end();}
