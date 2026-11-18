import pg from 'pg';
import {createProductionCatalogProvider as createCostProvider} from '../cost-catalog/production-provider.mjs';
import {createNursingLookup,isNursingCatalogRequest,canUseNursingCatalog} from './lookup.mjs';

// Compose with the established UC/CSU provider. No new Live tool or model call.
export async function createProductionCatalogProvider(env,{Pool=pg.Pool,now=Date.now}={}){
 const costs=await createCostProvider(env,{Pool});
 // Role identity and read-only settings are already checked by the shared
 // provider. A second catalog pool would exceed the production role's limit.
 let lookup,discovering,retryAt=0;
 const discover=()=>{
  // Publications can add campuses without deploying code. Cache only an
  // in-flight discovery; successful inventories must be fresh on each request.
  if(now()<retryAt)return Promise.resolve(lookup);
  if(!discovering)discovering=(async()=>{
   try{
    const campuses=(await costs.query('SELECT DISTINCT campus FROM nursing_catalog.production_budgets ORDER BY campus')).rows.map(r=>r.campus);
    lookup=campuses.length?createNursingLookup({query:costs.query,campuses,now}):undefined;
    retryAt=campuses.length?0:now()+30000;
   }catch{retryAt=now()+30000;/* An unavailable nursing publication must not disable UC/CSU. */}
   return lookup;
  })().finally(()=>{discovering=undefined;});
  return discovering;
 };
 await discover();
 return {lookup:async(input,options)=>{
  // A miss or outage is not evidence that a general undergraduate budget
  // applies to nursing. Returning null keeps the ordinary research path.
  if(!isNursingCatalogRequest(input))return costs.lookup(input,options);
  if(!canUseNursingCatalog(input))return null;
  return await (await discover())?.(input,options)||null;
 },close:costs.close};
}
