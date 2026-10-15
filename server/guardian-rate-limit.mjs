// Capability budgets are independent of transport peers (which may be a shared
// proxy). Invalid traffic has its own peer budget. Never retain raw tokens or
// trust caller-supplied forwarding headers. Each map is bounded and expires.
export function createGuardianRateLimit({clock=()=>Date.now(),maxEntries=4096,maxConcurrent=2}={}){
 const capabilities=new Map(),invalidPeers=new Map();
 let active=0;
 const charge=(buckets,key)=>{
  const now=clock();
  for(const [k,v] of buckets)if(v.reset<=now)buckets.delete(k);
  let budget=buckets.get(key);
  if(!budget){
   if(buckets.size>=maxEntries)buckets.delete(buckets.keys().next().value);
   budget={count:0,reset:now+60000};
  }
  buckets.delete(key);buckets.set(key,budget);
  if(++budget.count>30)throw Object.assign(new Error('rate_limited'),{status:429});
 };
 return {
  capability:hash=>charge(capabilities,hash),invalid:peer=>charge(invalidPeers,peer),
  // Unknown random tokens need an indexed lookup to distinguish them from
  // legitimate fresh links. Bound database occupancy without a waiting queue;
  // invalid traffic must not consume the entire shared connection pool.
  async lookup(work){
   if(active>=maxConcurrent)throw Object.assign(new Error('permission_unavailable'),{status:503});
   active++;
   try{return await work();}finally{active--;}
  },
 };
}
