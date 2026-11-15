import pg from 'pg';
import {createLocalCostLookup} from './local-provider.mjs';

// Uses the existing restricted worker credential and a separate read-only pool.
// Only the publication view is granted; no draft or student-table access.
export async function createProductionCatalogProvider(env,{Pool=pg.Pool}={}){
 if(env.ORIGEN_COST_CATALOG!=='true')throw Error('production_catalog_not_enabled');
 if(!env.RESEARCH_WORKER_DATABASE_URL)throw Error('research_worker_database_required');
 const pool=new Pool({connectionString:env.RESEARCH_WORKER_DATABASE_URL,max:2,
  connectionTimeoutMillis:3000,statement_timeout:1500,query_timeout:2000,
  options:'-c default_transaction_read_only=on'});
 try{
  const identity=(await pool.query("SELECT current_user AS role, current_setting('transaction_read_only') AS readonly")).rows[0];
  if(identity.role!=='origen_research_worker'||identity.readonly!=='on')throw Error('readonly_catalog_worker_required');
  // Readiness needs one published row, not a full scan and count of every
  // campus release on the small production database.
  const readiness=(await pool.query('SELECT 1 AS available FROM coa_catalog.production_published LIMIT 1')).rows[0];
  if(!readiness?.available)throw Error('published_catalog_required');
 }catch(error){await pool.end();throw error;}
 return {lookup:createLocalCostLookup({query:pool.query.bind(pool),publication:'production'}),close:()=>pool.end()};
}
