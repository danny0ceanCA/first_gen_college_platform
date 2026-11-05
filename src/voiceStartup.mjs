import {withRequestDeadline} from './requestDeadline.mjs';

// Start only after the microphone button is pressed. Audio permission and
// authenticated context preparation overlap; no microphone preflight on mount.
export async function voiceStartup({getToken,getMedia,prepare,signal,timeoutMs=30000}){
 const failure=new AbortController(),combined=signal?AbortSignal.any([signal,failure.signal]):failure.signal;
 combined.throwIfAborted();
 const preparationAbort=new AbortController(),preparationSignal=AbortSignal.any([combined,preparationAbort.signal]);
 let stream,prepared,pending;
 const stop=()=>stream?.getTracks().forEach(track=>track.stop());
 const media=Promise.resolve().then(()=>{combined.throwIfAborted();return getMedia();}).then(value=>{
  stream=value;if(combined.aborted){stop();combined.throwIfAborted();}return value;
 });
 const credentials=withRequestDeadline(getToken,{signal:combined,timeoutMs:10000}).then(token=>{
  if(prepare&&!combined.aborted)pending=Promise.resolve().then(()=>{preparationSignal.throwIfAborted();return prepare(token,preparationSignal);}).then(value=>{if(!preparationSignal.aborted)prepared=value;}).catch(()=>{});
  return token;
 });
 const joined=Promise.all([credentials,media]);joined.catch(()=>{});
 try{
  const [token,audio]=await withRequestDeadline(()=>joined,{signal:combined,timeoutMs});
  return {token,stream:audio,prepared:()=>prepared,async waitForPrepared(timeoutMs=250){
   combined.throwIfAborted();
   if(prepared||!pending)return prepared;
   try{await withRequestDeadline(()=>pending,{signal:combined,timeoutMs});}
   catch{preparationAbort.abort();combined.throwIfAborted();}
   return prepared;
  }};
 }catch(error){failure.abort(error);stop();throw error;}
}
