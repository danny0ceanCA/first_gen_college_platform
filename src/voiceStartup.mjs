import {withRequestDeadline} from './requestDeadline.mjs';

// Start only after the microphone button is pressed. Audio permission and
// authenticated context preparation overlap; no microphone preflight on mount.
export async function voiceStartup({getToken,getMedia,prepare,signal,timeoutMs=30000}){
 const failure=new AbortController(),combined=signal?AbortSignal.any([signal,failure.signal]):failure.signal;
 combined.throwIfAborted();
 let stream,prepared;
 const stop=()=>stream?.getTracks().forEach(track=>track.stop());
 const media=Promise.resolve().then(()=>{combined.throwIfAborted();return getMedia();}).then(value=>{
  stream=value;if(combined.aborted){stop();combined.throwIfAborted();}return value;
 });
 const credentials=withRequestDeadline(getToken,{signal:combined,timeoutMs:10000}).then(token=>{
  if(prepare&&!combined.aborted)void Promise.resolve().then(()=>{combined.throwIfAborted();return prepare(token,combined);}).then(value=>{if(!combined.aborted)prepared=value;}).catch(()=>{});
  return token;
 });
 const joined=Promise.all([credentials,media]);joined.catch(()=>{});
 try{
  const [token,audio]=await withRequestDeadline(()=>joined,{signal:combined,timeoutMs});
  return {token,stream:audio,prepared:()=>prepared};
 }catch(error){failure.abort(error);stop();throw error;}
}
