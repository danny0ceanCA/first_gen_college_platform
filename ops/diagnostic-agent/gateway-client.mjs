import {fail} from './contracts.mjs';
export function gatewayClient({url,token,fetcher=fetch}){
 const base=new URL(url);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof token!=='string'||token.length>8192)throw fail('configuration_invalid');
 const post=async(endpoint,input,signal)=>{
  const response=await fetcher(new URL(endpoint,base),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',cache:'no-store',body:JSON.stringify(input),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json'))throw fail('gateway_unavailable');
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>262144)throw fail('budget_exhausted');chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 };
 return {validate:(capability,signal)=>post('/v1/validate',{capability},signal),evidence:(capability,query,signal)=>post('/v1/evidence',{capability,...(query?{query}:{})},signal)};
}
