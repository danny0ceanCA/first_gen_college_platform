import pg from 'pg';
import {createProductionCatalogProvider as createCostProvider} from '../cost-catalog/production-provider.mjs';
import {createNursingLookup} from './lookup.mjs';

// Compose with the established UC/CSU provider. No new Live tool or model call.
export async function createProductionCatalogProvider(env,{Pool=pg.Pool,now=Date.now}={}){
 const costs=await createCostProvider(env,{Pool});
 // Role identity and read-only settings are already checked by the shared
 // provider. A second catalog pool would exceed the production role's limit.
 let lookup,discovering,retryAt=0;
 const discover=()=>{
  if(lookup||now()<retryAt)return Promise.resolve(lookup);
  if(!discovering)discovering=(async()=>{
   try{
    const campuses=(await costs.query('SELECT DISTINCT campus FROM nursing_catalog.production_budgets ORDER BY campus')).rows.map(r=>r.campus);
    if(campuses.length)lookup=createNursingLookup({query:costs.query,campuses});
   }catch{/* An unavailable nursing publication must not disable UC/CSU. */}
   if(!lookup)retryAt=now()+30000;
   return lookup;
  })().finally(()=>{discovering=undefined;});
  return discovering;
 };
 await discover();
 return {lookup:async(input,options)=>await (await discover())?.(input,options)||await costs.lookup(input,options),close:costs.close};
}
