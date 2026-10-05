import {conversationIsActive} from './liveConversation.mjs';
import {apiFetch} from './api';
import {onboardingRecovery} from './onboardingRecovery.mjs';
import {MessageCircle,ChevronDown,Trash2} from 'lucide-react';
import './ConversationHistory.css';
import {useAuth0} from '@auth0/auth0-react';
import {createContext,useContext,useEffect,useRef,useState,useCallback,type ReactNode} from 'react';
import {useFamily} from './FamilyStore';
import {flushPendingHistory} from './pendingHistory.mjs';
export type ConversationMemory={id:string;studentId:string|null;date:string;mode:string;summary:string;sources:{title:string;url:string;checkedAt:string}[]};
type Overview={summary:string;sources:ConversationMemory['sources'];date:string|null};
type Store={clear:(studentId:string|null,mode?:string)=>Promise<void>;overview:(studentId:string|null,mode:string|undefined,language:'en'|'es')=>Promise<Overview>;items:ConversationMemory[];cloud:boolean;loading:boolean;error:boolean;reload:()=>void;add:(item:ConversationMemory)=>Promise<void>;remove:(id:string)=>Promise<void>};
const Context=createContext<Store|null>(null);
export function useConversationHistory(){const store=useContext(Context);if(!store)throw new Error('ConversationHistoryProvider is required');return store;}
export function ConversationHistoryProvider({children}:{children:ReactNode}){
 const {isAuthenticated,user}=useAuth0();
 return <AccountConversationHistory key={isAuthenticated&&user?.sub?user.sub:'preview'}>{children}</AccountConversationHistory>;
}
function AccountConversationHistory({children}:{children:ReactNode}){
 const {isAuthenticated,user,getAccessTokenSilently}=useAuth0();const family=useFamily();const cloud=isAuthenticated&&!!user?.sub;
 const key=`${cloud?`origen.user.${user!.sub}`:'camino'}.conversations.v1`;
 const read=():ConversationMemory[]=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
 const overviewCache=useRef(new Map<string,Promise<Overview>>());
 const [pendingStorage]=useState(()=>onboardingRecovery(localStorage,key+'.pending'));
 const pending=useRef(new Map<string,ConversationMemory>(pendingStorage.read<ConversationMemory[]>([]).map(item=>[item.id,item])));
 const persistPending=()=>{if(!pendingStorage.write([...pending.current.values()]))throw new Error('draft_storage_unavailable');};
 const [items,setItems]=useState<ConversationMemory[]>(()=>cloud?[]:read());const [loading,setLoading]=useState(cloud),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 async function request(path:string,body:unknown,keepalive=false){const token=await getAccessTokenSilently();if(!token)throw new Error("authentication_required");let subject;try{subject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}if(!user?.sub||subject!==user.sub)throw new Error('history_account_changed');const base=(import.meta.env.VITE_API_URL||'').replace(/\/$/,'');const response=await fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),keepalive});const data=await response.json() as {items:ConversationMemory[];summary?:string};if(!response.ok||(path==='/api/conversation-history'&&!Array.isArray(data.items)))throw new Error('history_unavailable');return data;}
 useEffect(()=>{
  if(!cloud||family.loading||family.error)return;let active=true;setLoading(true);setError(false);
  void(async()=>{try{let data=await request('/api/conversation-history',{action:'load'});
   const recovery=onboardingRecovery(localStorage,`origen.onboarding-summaries.${user!.sub}`);const records=recovery.read<Record<string,ConversationMemory&{turns:unknown;language:string}>>({});
   for(const [id,record] of Object.entries(records)){
    if(conversationIsActive(id))continue;
    if(record.studentId!==null&&!family.students.some(student=>student.id===record.studentId))continue;
    if(!data.items.some(item=>item.id===id)){const result=await request('/api/conversation-summary',{...record,defer:false});if(typeof result.summary!=='string')throw new Error('summary_unavailable');data=await request('/api/conversation-history',{action:'save',item:{...record,summary:result.summary}});}
    recovery.removeEntry(id);
   }
   const legacy=read().filter(item=>item.studentId===null||family.students.some(student=>student.id===item.studentId)).slice(-100);if(legacy.length)data=await request('/api/conversation-history',{action:'import',items:legacy});await flushPendingHistory(pending.current,new Set(family.students.map(student=>student.id)),async item=>{data=await request('/api/conversation-history',{action:'save',item});});persistPending();if(active)setItems([...data.items,...[...pending.current.values()].filter(item=>!data.items.some(saved=>saved.id===item.id))]);}catch{if(active)setError(true);}finally{if(active)setLoading(false);}})();
  return()=>{active=false;};
 },[cloud,key,family.loading,family.error,family.students.map(s=>s.id).join('|'),attempt]);
 const write=(next:ConversationMemory[])=>{localStorage.setItem(key,JSON.stringify(next));setItems(next);};
 useEffect(()=>{
  if(cloud)return;
  let active=true;
  void(async()=>{
   const recovery=onboardingRecovery(localStorage,'origen.onboarding-summaries.preview');
   const records=recovery.read<Record<string,ConversationMemory&{turns:unknown;language:string}>>({});
   for(const [id,record] of Object.entries(records)){
    if(conversationIsActive(id))continue;
    if(record.studentId!==null&&!family.students.some(student=>student.id===record.studentId))continue;
    if(!read().some(item=>item.id===id)){
     const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record,defer:false})});
     const result=await response.json();if(!response.ok||typeof result.summary!=='string')throw new Error('summary_unavailable');
     if(!active)return;write([...read().filter(item=>item.id!==id),{id:record.id,studentId:record.studentId,date:record.date,mode:record.mode,summary:result.summary,sources:record.sources}]);
    }
    recovery.removeEntry(id);
   }
  })().catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[cloud,family.students.map(student=>student.id).join('|'),attempt]);

 const overview=useCallback(async(studentId:string|null,mode:string|undefined,language:'en'|'es')=>{
  const selected=items.filter(item=>item.studentId===studentId&&(!mode||item.mode===mode)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id)).slice(-100);
  const cacheKey=JSON.stringify([studentId,mode,language,selected]);
  const cached=overviewCache.current.get(cacheKey);if(cached)return cached;
  const job=(async()=>{
   const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'overview',studentId,mode,language,...(cloud?{}:{items:selected})})});
   const data=await response.json();if(!response.ok||typeof data.summary!=='string'||!Array.isArray(data.sources))throw new Error('summary_unavailable');return data as Overview;
  })();
  overviewCache.current.set(cacheKey,job);if(overviewCache.current.size>40)overviewCache.current.delete(overviewCache.current.keys().next().value!);
  try{return await job;}catch(error){overviewCache.current.delete(cacheKey);throw error;}
 },[items,cloud]);
 return <Context.Provider value={{clear:async(studentId,mode)=>{if(cloud){const data=await request('/api/conversation-history',{action:'clear',studentId,mode});for(const [id,item] of pending.current){if(item.studentId===studentId&&(!mode||item.mode===mode))pending.current.delete(id);}persistPending();setItems(previous=>[...previous.filter(item=>item.studentId!==studentId),...data.items]);}else write(read().filter(item=>item.studentId!==studentId||(mode&&item.mode!==mode)));},overview,items,cloud,loading,error,reload:()=>setAttempt(n=>n+1),add:async item=>{if(cloud){pending.current.set(item.id,item);persistPending();if(item.studentId===null||family.students.some(student=>student.id===item.studentId)){try{const data=await request('/api/conversation-history',{action:'save',item});pending.current.delete(item.id);persistPending();setItems([...data.items,...[...pending.current.values()].filter(queued=>!data.items.some(saved=>saved.id===queued.id))]);}catch(cause){setError(true);throw cause;}}else setAttempt(n=>n+1);}else write([...read().filter(x=>x.id!==item.id),item]);},remove:async id=>{if(cloud){const data=await request('/api/conversation-history',{action:'delete',id});setItems(data.items);}else write(read().filter(x=>x.id!==id));}}}>{children}</Context.Provider>;
}
export default function ConversationHistory({studentId,mode,t}:{studentId:string|null;mode?:string;t:(a:string,b:string)=>string}){
 const {clear:clearHistory,overview,cloud,loading,error:loadError,reload}=useConversationHistory();
 const [open,setOpen]=useState(false),[result,setResult]=useState<Overview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[deleting,setDeleting]=useState(false);
 const language=t('en','es') as 'en'|'es';
 useEffect(()=>{
  if(!open||loading||loadError||deleting)return;
  let active=true;setResult(null);setError(false);setBusy(true);
  void overview(studentId,mode,language).then(value=>{if(active)setResult(value);}).catch(()=>{if(active)setError(true);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[open,loading,loadError,deleting,overview,studentId,mode,language,attempt]);
 const clear=async()=>{
  if(deleting||!window.confirm(t('Delete the saved discussions behind this summary? Origen will no longer use them as context.','¿Eliminar las conversaciones guardadas de este resumen? Origen dejará de usarlas como contexto.')))return;
  setDeleting(true);try{await clearHistory(studentId,mode);}catch{setError(true);}finally{setDeleting(false);}
 };
 return <details className="conversation-history" onToggle={event=>setOpen(event.currentTarget.open)}><summary className="history-toggle"><span className="history-icon"><MessageCircle size={17} aria-hidden="true"/></span><span className="history-label">{studentId===null?t('Family discussion summary','Resumen de conversaciones familiares'):mode==='planning'?t('Your planning summary','Tu resumen de planificación'):t('Conversation summary','Resumen de conversaciones')}</span><ChevronDown size={17} className="history-chevron" aria-hidden="true"/></summary><div className="history-content">
  <p className="small-text muted">{cloud?t('One summary of your latest saved discussions. Origen remembers your conversations.','Un resumen de tus conversaciones guardadas más recientes. Origen recuerda lo conversado.'):t('One summary of the discussions saved in this browser preview.','Un resumen de las conversaciones guardadas en esta vista previa.')}</p>
  {(loading||busy)&&<p className="small-text muted" role="status">{t('Updating your summary…','Actualizando tu resumen…')}</p>}
  {loadError&&<p role="alert">{t('History could not be loaded.','No se pudo cargar el historial.')} <button className="text-button" onClick={reload}>{t('Try again','Intentar de nuevo')}</button></p>}
  {error&&<p role="alert">{t('Could not update the summary. Your saved discussions are still available.','No se pudo actualizar el resumen. Tus conversaciones siguen guardadas.')} <button className="text-button" onClick={()=>setAttempt(value=>value+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
  {!loading&&!busy&&!loadError&&!error&&result&&(result.summary?<article className="history-entry history-overview"><p className="history-summary">{result.summary}</p>{result.date&&<small>{t('Latest discussion: ','Última conversación: ')}{new Date(result.date).toLocaleDateString()}</small>}{result.sources.length>0&&<details className="history-sources"><summary>{t('Sources discussed','Fuentes consultadas')}</summary>{result.sources.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}</details>}<button disabled={deleting} className="text-button history-delete" onClick={()=>void clear()}><Trash2 size={13} aria-hidden="true"/>{deleting?t('Deleting…','Eliminando…'):t('Delete saved discussions','Eliminar conversaciones guardadas')}</button></article>:<div className="history-empty"><strong>{t('Your story, in one place','Tu historia, en un solo lugar')}</strong><p>{t('After you talk with Origen, one summary will bring your discussions together here.','Después de hablar con Origen, un resumen reunirá aquí tus conversaciones.')}</p></div>)}
 </div></details>;
}
