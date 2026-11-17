import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionCatalogProvider} from './production-provider.mjs';

const env={ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:'postgresql://fixture.invalid/catalog'};
function fixture({failure=false,absent=false}={}){
 let discovery=0,ended=0;
 const pools=[];
 class Pool{
  constructor(options){pools.push(options);}
  async query(sql){
   if(sql.includes('current_user'))return {rows:[{role:'origen_research_worker',readonly:'on'}]};
   if(sql.includes('FROM coa_catalog.production_published LIMIT'))return {rows:[{available:1}]};
   if(sql.includes('DISTINCT campus')){
    discovery++;
    if(failure&&discovery===1)throw Object.assign(Error('connection_limit'),{code:'53300'});
    return {rows:absent&&discovery===1?[]:[{campus:'Example College'}]};
   }
   if(sql.includes('production_budgets WHERE'))return {rows:[{budget_id:'NUR-0001',campus:'Example College',batch_id:'fixture',payload:{id:'NUR-0001',
    values:{College:'Example College','Program / degree':'Nursing','Academic year':'2026-27','Budget period':'Program',
     'Official source URL':'https://example.edu/nursing','Source checked':'2026-11-15'},
    normalized:{source_verified:false,automatic_production_permission:false,published_cents:10000,caveated_decisions:[]}}}]};
   if(sql.includes('production_items'))return {rows:[]};
   throw Error('unexpected_query');
  }
  async end(){ended++;}
 }
 return {Pool,pools,get discovery(){return discovery;},get ended(){return ended;}};
}
const request={mode:'finance',institution:'Example College',question:'Nursing reference NUR-0001',language:'en'};

test('nursing and UC/CSU share one verified read-only catalog connection',async()=>{
 const f=fixture(),provider=await createProductionCatalogProvider(env,{Pool:f.Pool});
 try{
  assert.equal(f.pools.length,1);assert.equal(f.pools[0].max,1);
  assert.equal(f.pools[0].options,'-c default_transaction_read_only=on');
  const result=await provider.lookup(request);
  assert.equal(result.nursingCatalog.recordId,'NUR-0001');assert.equal(result.nursingCatalog.pending,true);
 }finally{await provider.close();}
 assert.equal(f.ended,1);
});

for(const problem of ['failure','absent'])test(`${problem}: nursing discovery retries without disabling the established provider`,async()=>{
 let time=1000;
 const f=fixture({[problem]:true}),provider=await createProductionCatalogProvider(env,{Pool:f.Pool,now:()=>time});
 try{
  assert.equal(f.discovery,1);
  assert.equal(await provider.lookup(request),null);
  assert.equal(f.discovery,1,'failed discovery is throttled');
  assert.equal(await provider.lookup({mode:'admissions',question:'Admissions'}),null);
  time+=30001;
  const results=await Promise.all([provider.lookup(request),provider.lookup(request)]);
  assert.ok(results.every(r=>r?.nursingCatalog.recordId==='NUR-0001'));
  assert.equal(f.discovery,2,'concurrent lookups share one rediscovery');assert.equal(f.pools.length,1);
 }finally{await provider.close();}
 assert.equal(f.ended,1);
});
