import {Auth0Context,useAuth0,type Auth0ContextInterface} from '@auth0/auth0-react';
import {useEffect,useMemo,useRef,useState} from 'react';
import {apiFetch,setAPITokenProvider} from './api';
import {onboardingRecovery} from './onboardingRecovery.mjs';
import {FamilyProvider,useFamily} from './FamilyStore';
import {ConversationHistoryProvider} from './ConversationHistory';
import Welcome from './Welcome';
import {type StudentProfile} from './planning';

type Init={subject:string;firstName:string;role?:'parent'|'student';language:'en'|'es'};
type NativeWindow=Window&{ReactNativeWebView?:{postMessage:(message:string)=>void};origenNativeReply?:(message:{id:string;value?:unknown;error?:boolean})=>void};
const pending=new Map<string,{resolve:(value:unknown)=>void;reject:()=>void}>();
function send(message:unknown){
 const bridge=(window as NativeWindow).ReactNativeWebView;
 if(bridge){bridge.postMessage(JSON.stringify(message));return;}
 if(window.parent!==window&&document.referrer){window.parent.postMessage(message,new URL(document.referrer).origin);return;}
 throw new Error('Native onboarding is unavailable.');
}
function request(type:string,payload?:unknown):Promise<unknown>{
 return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Please try again.'));},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:()=>{clearTimeout(timer);reject(new Error('Please try again.'));}});try{send({id,type,payload});}catch{pending.get(id)?.reject();pending.delete(id);}});
}
async function token(){const value=await request('token');if(typeof value!=='string'||!value)throw new Error('Sign in again.');return value;}

/** Reuses the actual registration screen inside the trusted native WebView. Tokens stay in memory. */
export default function NativeWelcome(){
 const base=useAuth0();const [init,setInit]=useState<Init>();const [error,setError]=useState(false);
 useEffect(()=>{
  const host=window as NativeWindow;
  host.origenNativeReply=message=>{const job=pending.get(message.id);if(!job)return;pending.delete(message.id);if(message.error)job.reject();else job.resolve(message.value);};
  const receive=(event:MessageEvent)=>{if(document.referrer&&event.source===window.parent&&event.origin===new URL(document.referrer).origin&&event.data&&typeof event.data.id==='string')host.origenNativeReply?.(event.data);};
  window.addEventListener('message',receive);
  let active=true;
  void request('ready').then(value=>{const data=value as Init;if(!data||typeof data.subject!=='string'||typeof data.firstName!=='string'||!['en','es'].includes(data.language))throw new Error();if(active){setAPITokenProvider(data.subject?token:undefined);setInit(data);}}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;window.removeEventListener('message',receive);delete host.origenNativeReply;for(const job of pending.values())job.reject();pending.clear();setAPITokenProvider(undefined);};
 },[]);
 const auth=useMemo(()=>({...base,isLoading:false,isAuthenticated:!!init?.subject,user:init?.subject?{sub:init.subject}:undefined,getAccessTokenSilently:token as Auth0ContextInterface['getAccessTokenSilently']}),[base,init]);
 if(!init)return <main className="welcome-conversation"><p role={error?'alert':'status'}>{error?'Could not connect. Close and reopen onboarding. / No se pudo conectar. Cierra y vuelve a abrir.':'Opening Origen… / Abriendo Origen…'}</p></main>;
 return <Auth0Context.Provider value={auth}><FamilyProvider previewStudents={[]}><ConversationHistoryProvider><NativeStory init={init}/></ConversationHistoryProvider></FamilyProvider></Auth0Context.Provider>;
}
function NativeStory({init}:{init:Init}){
 const family=useFamily();const [language,setLanguage]=useState(init.language);const loaded=useRef(false);
 const completion=useRef<{firstName:string;role:'parent'|'student';student?:StudentProfile;language:'en'|'es'}|undefined>(undefined);
 const [finishError,setFinishError]=useState(false);
 const close=async()=>{try{
  // Finish deferred onboarding memory before the native host closes this screen.
  const student=completion.current?.student;
  if(family.cloud&&student){
   const recovery=onboardingRecovery(localStorage,`origen.onboarding-summaries.${init.subject}`);
   for(const [id,record] of Object.entries(recovery.read<Record<string,{studentId:string}>>({}))){
    if(record.studentId!==student.id)continue;
    const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,defer:false})});
    if(!response.ok)throw new Error('Could not save your conversation. Please try again.');
    recovery.removeEntry(id);
   }
  }
await request('complete',completion.current);send({id:crypto.randomUUID(),type:'closed'});}catch{setFinishError(true);}};
 if(!family.loading&&!family.error)loaded.current=true;
 if(family.loading||(family.error&&!loaded.current))return <main className="welcome-conversation"><p role="status">{family.error?'Could not load your account. / No se pudo cargar tu cuenta.':'Loading your account… / Cargando tu cuenta…'}</p>{family.error&&<button onClick={family.reload}>Retry / Reintentar</button>}</main>;
 return <>{finishError&&<p role="alert">Could not open home. / No se pudo abrir el inicio. <button onClick={()=>void close()}>Retry / Reintentar</button></p>}<Welcome onComplete={()=>void close()} cloud={family.cloud} initialName={init.firstName} initialRole={init.role} language={language} setLanguage={setLanguage} complete={async(firstName,role,student,options)=>{
  if(!await family.completeOnboarding(firstName,role,student))return false;
  completion.current={firstName,role,student,language};if(!options?.keepOpen)await close();return true;
 }}/></>;
}
