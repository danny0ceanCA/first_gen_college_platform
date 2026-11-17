import pg from 'pg';
import {createProductionCatalogProvider as createCostProvider} from '../cost-catalog/production-provider.mjs';
import {createNursingLookup} from './lookup.mjs';

// Compose with the established UC/CSU provider. No new Live tool or model call.
export async function createProductionCatalogProvider(env,{Pool=pg.Pool}={}){
 const costs=await createCostProvider(env,{Pool});
 const pool=new Pool({connectionString:env.RESEARCH_WORKER_DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:1500,query_timeout:2000,options:'-c default_transaction_read_only=on'});
 let lookup;
 try{
  const identity=(await pool.query("SELECT current_user role,current_setting('transaction_read_only') readonly")).rows[0];
  if(identity.role!=='origen_research_worker'||identity.readonly!=='on')throw Error('readonly_nursing_worker_required');
  const campuses=(await pool.query('SELECT DISTINCT campus FROM nursing_catalog.production_budgets ORDER BY campus')).rows.map(r=>r.campus);
  if(campuses.length)lookup=createNursingLookup({query:pool.query.bind(pool),campuses});
 }catch{/* Pending/absent/expired nursing publication never disables UC/CSU. */}
 return {lookup:async(input,options)=>await lookup?.(input,options)||await costs.lookup(input,options),close:async()=>{await pool.end();await costs.close();}};
}
