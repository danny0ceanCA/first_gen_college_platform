import {browserPrivacy} from './browserPrivacy.mjs';
type Diagnostic={kind:'voice'|'summary';studentId:string|null;hint:string};
type APIOptions=RequestInit&{diagnostic?:Diagnostic};
let receipts=0;
function reportReceipt(path:string,status:number,token:string|null,diagnostic:Diagnostic,base:string){
 if(!token||receipts>=2||path==='/api/voice-diagnostics')return;
 const lease=browserPrivacy.capture({studentId:diagnostic.studentId});if(!lease.valid()){lease.release();return;}
 receipts++;
 void fetch(`${base}/api/voice-diagnostics`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json','X-Origen-Operation':diagnostic.hint},body:JSON.stringify({event:'operation_response_received',operationKind:diagnostic.kind,studentId:diagnostic.studentId,status:status<400?'completed':'failed'}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(3000)])}).catch(()=>{}).finally(()=>{receipts--;lease.release();});
}
let tokenProvider:(()=>Promise<string|undefined>)|undefined;
export function setAPITokenProvider(provider:typeof tokenProvider){tokenProvider=provider;}
export function onboardingTransport(subject:string|undefined,getToken:()=>Promise<string|undefined>){
 return async(body:{attemptId:string;events:unknown[]})=>{
  const token=await getToken();
  if(!token)throw Object.assign(new Error('tracking_authentication_required'),{status:401});
  let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
  if(!subject||tokenSubject!==subject)throw Object.assign(new Error('tracking_account_changed'),{code:'tracking_account_changed'});
  const response=await apiFetch('/api/onboarding-events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Origen-Operation':body.attemptId},body:JSON.stringify(body),keepalive:true,signal:AbortSignal.timeout(10000)});
  if(!response.ok){const retry=response.headers.get('Retry-After'),seconds=retry===null?NaN:Number(retry);throw Object.assign(new Error('tracking_failed'),{status:response.status,retryAfterMs:Number.isFinite(seconds)?seconds*1000:retry?Math.max(0,Date.parse(retry)-Date.now()):undefined});}
 };
}
export async function apiFetch(path:string,options:APIOptions={}){
 const lease=browserPrivacy.capture();
 try{
 lease.assert();
 const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
 const headers=new Headers(options.headers);
 const {diagnostic,...requestOptions}=options;
 if(!headers.has('X-Origen-Operation'))headers.set('X-Origen-Operation',diagnostic?.hint||crypto.randomUUID());
 if(headers.has('Authorization')){/* Keep the original live-session account through cleanup. */}
 else if(tokenProvider){const token=await tokenProvider();if(!token)throw new Error('Sign in to use Origen AI.');headers.set('Authorization',`Bearer ${token}`);}
 else throw new Error('Sign in to use Origen AI.');
 lease.assert();
 const response=await fetch(`${base}${path}`,{...requestOptions,headers,signal:options.signal?AbortSignal.any([options.signal,lease.signal]):lease.signal});
 if(response.status===403){const data=await response.clone().json().catch(()=>null);if(data?.error==='permission_required')browserPrivacy.stop('eligibility_changed');}
 lease.assert();if(diagnostic)reportReceipt(path,response.status,headers.get('Authorization'),diagnostic,base);return response;
 }finally{lease.release();}
}
