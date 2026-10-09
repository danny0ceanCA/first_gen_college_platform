let tokenProvider:(()=>Promise<string|undefined>)|undefined;
export function setAPITokenProvider(provider:typeof tokenProvider){tokenProvider=provider;}
export function onboardingTransport(subject:string|undefined,getToken:()=>Promise<string|undefined>){
 return async(body:{attemptId:string;events:unknown[]})=>{
  const token=await getToken();
  if(!token)throw Object.assign(new Error('tracking_authentication_required'),{status:401});
  let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
  if(!subject||tokenSubject!==subject)throw Object.assign(new Error('tracking_account_changed'),{code:'tracking_account_changed'});
  const response=await apiFetch('/api/onboarding-events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),keepalive:true,signal:AbortSignal.timeout(10000)});
  if(!response.ok){const retry=response.headers.get('Retry-After'),seconds=retry===null?NaN:Number(retry);throw Object.assign(new Error('tracking_failed'),{status:response.status,retryAfterMs:Number.isFinite(seconds)?seconds*1000:retry?Math.max(0,Date.parse(retry)-Date.now()):undefined});}
 };
}
export async function apiFetch(path:string,options:RequestInit={}){
 const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
 const headers=new Headers(options.headers);
 if(headers.has('Authorization')){/* Keep the original live-session account through cleanup. */}
 else if(tokenProvider){const token=await tokenProvider();if(!token)throw new Error('Sign in to use Origen AI.');headers.set('Authorization',`Bearer ${token}`);}
 else throw new Error('Sign in to use Origen AI.');
 return fetch(`${base}${path}`,{...options,headers});
}
