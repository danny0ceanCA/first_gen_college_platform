// Development-only bridge for a local UI using the deployed API. The deployed
// endpoints authorize every read with the user's bearer token; no DB/admin
// credentials or browser-supplied note text are used. Nothing is saved remotely.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {createTopicRecapHandler} from './topic-recap.mjs';
import {withRequestDeadline} from '../src/requestDeadline.mjs';
export function createProxyRecapHandler(env,request=fetch){
 const target=new URL(env.DEV_API_PROXY_TARGET);
 if(target.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(target.hostname))throw new Error('invalid_dev_api_target');
 const credentials=new AsyncLocalStorage();
 const handler=createTopicRecapHandler(null,env,request,{
  identity:req=>/^Bearer \S{1,16000}$/.test(req.headers.authorization||'')?createHash('sha256').update(req.headers.authorization).digest('hex'):null,
  load:async(_subject,input)=>{
   const read=path=>withRequestDeadline(async signal=>{
    const response=await request(new URL(path,target),{method:'POST',redirect:'error',headers:{Authorization:credentials.getStore(),'Content-Type':'application/json'},body:JSON.stringify({action:'load',studentId:input.studentId}),signal});
    if(!response.ok)throw Object.assign(new Error('recap_source_unavailable'),{status:response.status});
    return response.json();
   },{timeoutMs:10000});
   const [notes,memory]=await Promise.all([read('/api/topic-notes'),read('/api/student-memory')]);
   if(!Array.isArray(notes.notes)||!Array.isArray(memory.memories))throw new Error('recap_source_unavailable');
   return {...notes,...memory};
  },
 });
 return (req,res,next)=>credentials.run(req.headers.authorization,()=>handler(req,res,next));
}
