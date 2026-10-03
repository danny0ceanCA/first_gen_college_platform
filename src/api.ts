let tokenProvider:(()=>Promise<string|undefined>)|undefined;
export function setAPITokenProvider(provider:typeof tokenProvider){tokenProvider=provider;}
export async function apiFetch(path:string,options:RequestInit={}){
 const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');
 const headers=new Headers(options.headers);
 if(headers.has('Authorization')){/* Keep the original live-session account through cleanup. */}
 else if(tokenProvider){const token=await tokenProvider();if(!token)throw new Error('Sign in to use Origen AI.');headers.set('Authorization',`Bearer ${token}`);}
 else if(base)throw new Error('Sign in to use Origen AI.');
 return fetch(`${base}${path}`,{...options,headers});
}
