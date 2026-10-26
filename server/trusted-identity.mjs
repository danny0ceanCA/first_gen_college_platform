import {createHash} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});

// Called only after API bearer-token verification. Cache verified profile
// attributes briefly, never staff permissions, MFA, or organization access.
export function createTrustedIdentityLookup({now=Date.now,ttlMs=60000,maxEntries=1000}={}){
 const caches=new WeakMap();
 return async(req,env,fetcher=fetch)=>{
  const domain=env.AUTH0_DOMAIN,subject=req.origenIdentity?.sub,authorization=req.headers.authorization;
  if(!domain||!/^[a-z0-9.-]+$/i.test(domain))throw fail(503,'identity_verification_unavailable');
  if(!subject||typeof authorization!=='string'||!/^Bearer \S+$/i.test(authorization))throw fail(403,'invitation_email_required');
  let cache=caches.get(fetcher);if(!cache){cache=new Map();caches.set(fetcher,cache);}
  const time=now(),key=createHash('sha256').update(JSON.stringify([domain,subject,authorization])).digest('hex');
  for(const [id,entry] of cache)if(entry.expiresAt<=time)cache.delete(id);
  const hit=cache.get(key);if(hit)return hit.promise;
  const tokenExpiry=Number.isFinite(req.origenIdentity.exp)?req.origenIdentity.exp*1000:Infinity;
  const entry={expiresAt:Math.min(time+ttlMs,tokenExpiry),promise:undefined};
  entry.promise=(async()=>{
   let response;
   try{response=await fetcher(`https://${domain}/userinfo`,{headers:{Authorization:authorization},signal:AbortSignal.timeout(8000)});}
   catch{throw fail(503,'identity_verification_unavailable');}
   if(!response.ok){
    if(response.status===401||response.status===403)throw fail(403,'invitation_email_required');
    throw fail(503,'identity_verification_unavailable');
   }
   let identity;try{identity=await response.json();}catch{throw fail(503,'identity_verification_unavailable');}
   if(!identity||typeof identity!=='object'||typeof identity.sub!=='string')throw fail(503,'identity_verification_unavailable');
   if(identity.sub!==subject)throw fail(403,'invitation_email_required');
   // Unverified profiles must be fetched again after the user verifies email.
   if(identity.email_verified!==true||typeof identity.email!=='string'||!identity.email.trim()){
    if(cache.get(key)===entry)cache.delete(key);
   }
   return Object.freeze(identity);
  })().catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
  if(entry.expiresAt>time){
   while(cache.size>=maxEntries)cache.delete(cache.keys().next().value);
   cache.set(key,entry);
  }
  return entry.promise;
 };
}

export const trustedIdentity=createTrustedIdentityLookup();
