import {notifyMemoryContext} from './memoryContext.mjs';
import {conversationIsActive} from './liveConversation.mjs';
import {apiFetch} from './api';
import {ErrorReference} from './ErrorReference';
import {apiFailure,diagnosticHint} from './diagnosticClient.mjs';
import {privateRecovery} from './privateRecovery';
import {browserPrivacy} from './browserPrivacy.mjs';
import {MessageCircle,Trash2} from 'lucide-react';
import './ConversationHistory.css';
import {useAuth0} from '@auth0/auth0-react';
import {createContext,useContext,useEffect,useRef,useState,useCallback,useId,type ReactNode} from 'react';
import {useFamily} from './FamilyStore';
import {flushPendingHistory} from './pendingHistory.mjs';
import BinderSummary from './BinderSummaryReader';
export type ConversationMemory={id:string;studentId:string|null;date:string;mode:string;summary:string;sources:{title:string;url:string;checkedAt:string}[]};
type Overview={summary:string;sources:ConversationMemory['sources'];date:string|null};
type Store={clear:(studentId:string|null,mode?:string)=>Promise<void>;overview:(studentId:string|null,mode:string|undefined,language:'en'|'es',presentation?:'basic'|'complete')=>Promise<Overview>;items:ConversationMemory[];cloud:boolean;loading:boolean;error:boolean;reload:()=>void;add:(item:ConversationMemory)=>Promise<void>;remove:(id:string)=>Promise<void>};
const Context=createContext<Store|null>(null);
export function useConversationHistory(){const store=useContext(Context);if(!store)throw new Error('ConversationHistoryProvider is required');return store;}
export function ConversationHistoryProvider({children}:{children:ReactNode}){
 const {isAuthenticated,user}=useAuth0();
 return <AccountConversationHistory key={isAuthenticated&&user?.sub?user.sub:'preview'}>{children}</AccountConversationHistory>;
}
function AccountConversationHistory({children}:{children:ReactNode}){
 const {isAuthenticated,user,getAccessTokenSilently}=useAuth0();const family=useFamily();const cloud=isAuthenticated&&!!user?.sub;
 const [privacyLease]=useState(()=>browserPrivacy.capture());
 const key=`${cloud?`origen.user.${user!.sub}`:'camino'}.conversations.v1`;
 const read=():ConversationMemory[]=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
 const overviewCache=useRef(new Map<string,Promise<Overview>>());
 const [pendingStorage]=useState(()=>privateRecovery(key+'.pending'));
 const pending=useRef(new Map<string,ConversationMemory>(pendingStorage.read<ConversationMemory[]>([]).map(item=>[item.id,item])));
 const persistPending=()=>{if(!pendingStorage.write([...pending.current.values()]))throw new Error('draft_storage_unavailable');};
 const [items,setItems]=useState<ConversationMemory[]>(()=>cloud?[]:read());const [loading,setLoading]=useState(cloud),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 async function request(path:string,body:Record<string,unknown>,keepalive=false){privacyLease.assert();const lease=browserPrivacy.capture(body.action==='save'?body.item as ConversationMemory:path==='/api/conversation-summary'?body:undefined);try{const token=await getAccessTokenSilently();if(!token)throw new Error("authentication_required");let subject;try{subject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}if(!user?.sub||subject!==user.sub)throw new Error('history_account_changed');privacyLease.assert();lease.assert();const item=body.item as ConversationMemory|undefined;const summaryTarget=(item?item.studentId:body.studentId) as string|null|undefined;const summaryKey=item?.id||(typeof body.id==='string'?body.id:undefined);const response=await apiFetch(path,{...(summaryKey&&summaryTarget!==undefined?{diagnostic:{kind:'summary' as const,studentId:summaryTarget,hint:diagnosticHint('summary',summaryTarget,summaryKey)}}:{}),method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),keepalive,signal:lease.signal});const data=await response.json() as {items:ConversationMemory[];summary?:string};privacyLease.assert();lease.assert();if(!response.ok||(path==='/api/conversation-history'&&!Array.isArray(data.items)))throw apiFailure(response,'history_unavailable');return data;}finally{lease.release();}}
 useEffect(()=>browserPrivacy.subscribe(event=>{
  if(event.type==='end'){pending.current.clear();overviewCache.current.clear();setItems([]);return;}
  for(const [id,item] of pending.current)if(browserPrivacy.matches(event.target!,item))pending.current.delete(id);
  persistPending();overviewCache.current.clear();setItems(previous=>previous.filter(item=>!browserPrivacy.matches(event.target!,item)));
 }),[]);
 useEffect(()=>{
  if(!cloud||family.loading||family.error)return;let active=true;setLoading(true);setError(false);
  void(async()=>{try{let data=await request('/api/conversation-history',{action:'load'});
   const recovery=privateRecovery(`origen.onboarding-summaries.${user!.sub}`);const records=recovery.read<Record<string,ConversationMemory&{turns:unknown;language:string}>>({});
   for(const [id,record] of Object.entries(records)){
    if(conversationIsActive(id))continue;
    if(record.studentId!==null&&!family.students.some(student=>student.id===record.studentId))continue;
    if(!active)return;
    if(!data.items.some(item=>item.id===id)){try{const result=await request('/api/conversation-summary',{...record,defer:false});if(typeof result.summary!=='string')throw new Error('summary_unavailable');if(!active)return;data=await request('/api/conversation-history',{action:'save',item:{...record,summary:result.summary}});}catch(error){if((error as {status?:number}).status!==410)throw error;}}
    recovery.removeEntry(id);
   }
   if(!active)return;const legacy=read().filter(item=>item.studentId===null||family.students.some(student=>student.id===item.studentId)).slice(-100);if(legacy.length)data=await request('/api/conversation-history',{action:'import',items:legacy});await flushPendingHistory(pending.current,new Set(family.students.map(student=>student.id)),async item=>{privacyLease.assert();if(!active)throw new Error('history_unmounted');try{data=await request('/api/conversation-history',{action:'save',item});}catch(error){if((error as {status?:number}).status!==410)throw error;}});privacyLease.assert();persistPending();if(active)setItems([...data.items,...[...pending.current.values()].filter(item=>!data.items.some(saved=>saved.id===item.id))]);}catch{if(active&&privacyLease.valid())setError(true);}finally{if(active)setLoading(false);}})();
  return()=>{active=false;};
 },[cloud,key,family.loading,family.error,family.students.map(s=>s.id).join('|'),attempt]);
 const write=(next:ConversationMemory[])=>{localStorage.setItem(key,JSON.stringify(next));setItems(next);};
 useEffect(()=>{
  if(cloud)return;
  let active=true;
  void(async()=>{
   const recovery=privateRecovery('origen.onboarding-summaries.preview');
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

 const overview=useCallback(async(studentId:string|null,mode:string|undefined,language:'en'|'es',presentation:'basic'|'complete'='complete')=>{
  const selected=items.filter(item=>item.studentId===studentId&&(!mode||item.mode===mode)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id)).slice(-100);
  const cacheKey=JSON.stringify([studentId,mode,language,presentation,selected]);
  const cached=overviewCache.current.get(cacheKey);if(cached)return cached;
  const job=(async()=>{
   const lease=browserPrivacy.capture({studentId,mode});
   try{
    privacyLease.assert();lease.assert();
    const body={action:'overview',studentId,mode,language,presentation,...(cloud?{}:{items:selected})};
    let data:Overview;
    if(cloud)data=await request('/api/conversation-summary',body) as unknown as Overview;
    else{const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:lease.signal});if(!response.ok)throw new Error('summary_unavailable');data=await response.json();}
    privacyLease.assert();lease.assert();
    if(typeof data.summary!=='string'||!Array.isArray(data.sources))throw new Error('summary_unavailable');return data;
   }finally{lease.release();}
  })();
  overviewCache.current.set(cacheKey,job);if(overviewCache.current.size>40)overviewCache.current.delete(overviewCache.current.keys().next().value!);
  try{return await job;}catch(error){overviewCache.current.delete(cacheKey);throw error;}
 },[items,cloud]);
 return <Context.Provider value={{clear:async(studentId,mode)=>{privacyLease.assert();browserPrivacy.forget({studentId,mode});if(user?.sub)notifyMemoryContext(user.sub,studentId);if(cloud){const data=await request('/api/conversation-history',{action:'clear',studentId,mode});setItems(previous=>[...previous.filter(item=>item.studentId!==studentId),...data.items]);}else write(read().filter(item=>item.studentId!==studentId||(mode&&item.mode!==mode)));},overview,items,cloud,loading,error,reload:()=>setAttempt(n=>n+1),add:async item=>{privacyLease.assert();if(cloud){pending.current.set(item.id,item);persistPending();if(item.studentId===null||family.students.some(student=>student.id===item.studentId)){try{const data=await request('/api/conversation-history',{action:'save',item});pending.current.delete(item.id);persistPending();setItems([...data.items,...[...pending.current.values()].filter(queued=>!data.items.some(saved=>saved.id===queued.id))]);}catch(cause){if((cause as {status?:number}).status===410){pending.current.delete(item.id);persistPending();return;}if(privacyLease.valid())setError(true);throw cause;}}else setAttempt(n=>n+1);}else write([...read().filter(x=>x.id!==item.id),item]);},remove:async id=>{privacyLease.assert();browserPrivacy.forget({id});const removed=items.find(item=>item.id===id);if(removed&&user?.sub)notifyMemoryContext(user.sub,removed.studentId);if(cloud){const data=await request('/api/conversation-history',{action:'delete',id});setItems(data.items);}else write(read().filter(x=>x.id!==id));}}}>{children}</Context.Provider>;
}
export default function ConversationHistory({studentId,mode,t,title,basic=false,flowing=false,binder=false}:{studentId:string|null;mode?:string;title?:string;basic?:boolean;flowing?:boolean;binder?:boolean;t:(a:string,b:string)=>string}){
 const {clear:clearHistory,overview,cloud,loading,error:loadError,reload}=useConversationHistory();
 const section=useRef<HTMLElement>(null),headingId=useId();
 const [visible,setVisible]=useState(false),[result,setResult]=useState<Overview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[attempt,setAttempt]=useState(0),[deleting,setDeleting]=useState(false);
 const [errorReference,setErrorReference]=useState<string|undefined>();
 const language=t('en','es') as 'en'|'es';
 useEffect(()=>{
  if(!section.current)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)));
  observer.observe(section.current);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!visible||loading||loadError||deleting)return;
  let active=true;setResult(null);setError(false);setErrorReference(undefined);setBusy(true);
  void overview(studentId,mode,language,basic?'basic':'complete').then(value=>{if(active)setResult(value);}).catch(error=>{if(active){setError(true);setErrorReference(error?.errorReference);}}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[visible,loading,loadError,deleting,overview,studentId,mode,language,basic,attempt]);
 const clear=async()=>{
  if(deleting||!window.confirm(t('Delete the saved discussions behind this summary? Notes created from these discussions will also be deleted. Notes you wrote separately actions you accepted into your plan, and separately saved sheets will remain. Origen will no longer use these discussions as context.','¿Eliminar las conversaciones guardadas de este resumen? También se eliminarán las notas creadas a partir de ellas. Las notas que escribiste por separado las acciones que aceptaste en tu plan y las hojas guardadas por separado se conservarán. Origen dejará de usar estas conversaciones como contexto.')))return;
  setDeleting(true);try{await clearHistory(studentId,mode);}catch(error){setError(true);setErrorReference((error as {errorReference?:string})?.errorReference);}finally{setDeleting(false);}
 };
 return <section ref={section} className={`conversation-history${binder?' binder-conversation-history':''}`} aria-labelledby={headingId}><h3 id={headingId} className="history-heading"><span className="history-icon"><MessageCircle size={17} aria-hidden="true"/></span><span className="history-label">{title??(studentId===null?t('Family discussion summary','Resumen de conversaciones familiares'):mode==='planning'?t('Your planning summary','Tu resumen de planificación'):t('Conversation summary','Resumen de conversaciones'))}</span></h3><div className="history-content">
  <p className="small-text muted">{basic?t('One overview across your binder topics. Each topic has the detailed key points.','Un resumen de los temas de tu carpeta. Los puntos clave detallados están en cada tema.'):cloud?t('One summary of your latest saved discussions. Origen remembers your conversations.','Un resumen de tus conversaciones guardadas más recientes. Origen recuerda lo conversado.'):t('One summary of the discussions saved in this browser preview.','Un resumen de las conversaciones guardadas en esta vista previa.')}</p>
  {(loading||busy)&&<p className="small-text muted" role="status">{t('Updating your summary…','Actualizando tu resumen…')}</p>}
  {loadError&&<p role="alert">{t('History could not be loaded.','No se pudo cargar el historial.')} <button className="text-button" onClick={reload}>{t('Try again','Intentar de nuevo')}</button></p>}
  {error&&<p role="alert"><ErrorReference reference={errorReference} language={language}/>{t('Could not update the summary. Your saved discussions are still available.','No se pudo actualizar el resumen. Tus conversaciones siguen guardadas.')} <button className="text-button" onClick={()=>setAttempt(value=>value+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
  {!loading&&!busy&&!loadError&&!error&&result&&(result.summary?<article className="history-entry history-overview">{binder?<BinderSummary summary={result.summary} language={language} t={t}/>:<p className={`history-summary${flowing?' history-summary-flowing':''}`} role={flowing?undefined:'region'} aria-label={flowing?undefined:t('Conversation summary. Scroll to read more.','Resumen de conversaciones. Desplázate para leer más.')} tabIndex={flowing?undefined:0}>{result.summary}</p>}<details className="history-discussion-details"><summary>{t('Discussion details','Detalles de las conversaciones')}</summary>{result.date&&<small>{t('Latest discussion: ','Última conversación: ')}{new Date(result.date).toLocaleDateString()}</small>}{result.sources.length>0&&<details className="history-sources"><summary>{t('Sources discussed','Fuentes consultadas')}</summary>{result.sources.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}</details>}<button disabled={deleting} className="text-button history-delete" onClick={()=>void clear()}><Trash2 size={13} aria-hidden="true"/>{deleting?t('Deleting…','Eliminando…'):t('Delete saved discussions','Eliminar conversaciones guardadas')}</button></details></article>:<div className="history-empty"><strong>{t('Your story, in one place','Tu historia, en un solo lugar')}</strong><p>{t('After you talk with Origen, one summary will bring your discussions together here.','Después de hablar con Origen, un resumen reunirá aquí tus conversaciones.')}</p></div>)}
 </div></section>;
}
