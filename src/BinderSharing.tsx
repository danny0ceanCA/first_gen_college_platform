import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {Share2,ShieldCheck,X,UserRoundPlus,CheckCircle2} from 'lucide-react';
import CoordinatorConnection from './CoordinatorConnection';
import './BinderSharing.css';
type T=(en:string,es:string)=>string;
type Entry={id:string;topic:string;kind:string;language:string;content:string};
type Grant={id:string;status:string;coordinatorName:string;organizationName:string;topics:string[];expiresAt:string;helpRequested?:boolean;items:Entry[]};
type Status={available:boolean;enabled:boolean;connections:{id:string;coordinatorName:string;organizationName:string}[];grants:Grant[]};
type Preview={previewId:string;studentName:string;coordinatorName:string;organizationName:string;topics:string[];entries:Entry[];expiresAt:string;shareExpiresAt:string};
const topics=[['options','College options','Opciones universitarias'],['transfer','Transfer & courses','Transferencia y cursos'],['costs','Paying for college','Pagar la universidad'],['applications','Applications','Solicitudes']];
const topicName=(id:string,t:T)=>{const topic=topics.find(x=>x[0]===id);return topic?t(topic[1],topic[2]):id;};
async function request(studentId:string,action:string,extra:Record<string,unknown>={}){
 const lease=browserPrivacy.capture({studentId});
 try{
  const res=await apiFetch('/api/binder-sharing',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,studentId,...extra}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(12000)])});
  const data=await res.json();lease.assert();if(!res.ok)throw Object.assign(new Error(data.error||'sharing_unavailable'),{status:res.status});return data;
 }finally{lease.release();}
}
function Review({preview,t,busy,error,onCancel,onPublish}:{preview:Preview;t:T;busy:boolean;error:string;onCancel:()=>void;onPublish:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),cancel=useRef(onCancel);cancel.current=onCancel;
 useEffect(()=>{ref.current?.showModal();const timer=setTimeout(()=>cancel.current(),Math.max(0,Date.parse(preview.expiresAt)-Date.now()));return()=>{clearTimeout(timer);ref.current?.close();};},[preview.expiresAt]);
 return createPortal(<dialog ref={ref} className="binder-share-review" aria-labelledby="share-review-title" onCancel={e=>{e.preventDefault();onCancel();}}>
  <p className="binder-share-eyebrow">{t('Review before sharing','Revisa antes de compartir')}</p>
  <h2 id="share-review-title">{t('Ready to share?','¿Listo para compartir?')}</h2>
  <p><strong>{preview.coordinatorName}</strong> · {preview.organizationName}</p>
  <p>{t('For','Para')} {preview.studentName} · {t('Access ends','El acceso termina')} <time dateTime={preview.shareExpiresAt}>{new Date(preview.shareExpiresAt).toLocaleDateString()}</time></p>
  <p>{t('Only the notes below will be shared for 90 days. This replaces any earlier selection for this coordinator. Family conversations stay private. New notes are shared only when you choose them.','Solo se compartirán las notas de abajo durante 90 días. Esto reemplaza la selección anterior para este coordinador. Las conversaciones familiares permanecen privadas. Las notas nuevas solo se comparten cuando las eliges.')}</p>
  <div className="binder-share-preview-entries">{preview.entries.map(e=><article key={e.id}><small>{topicName(e.topic,t)}</small><p>{e.content}</p></article>)}</div>
  {error&&<p role="alert">{error}</p>}
  <div className="binder-share-actions"><button type="button" className="button outline" disabled={busy} onClick={onCancel}>{error?t('Close review and check sharing','Cerrar revisión y comprobar acceso'):t('Cancel','Cancelar')}</button><button type="button" className="button primary" disabled={busy||!!error} onClick={onPublish}>{busy?t('Publishing…','Publicando…'):t('Share these notes','Compartir estas notas')}</button></div>
 </dialog>,document.body);
}
type SharingView='notes'|'access'|'connect';
function SharingSheet({t,busy,onClose,children}:{t:T;busy:boolean;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return createPortal(<dialog ref={ref} className="binder-share-sheet" aria-labelledby="binder-share-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header className="binder-share-sheet-heading"><div><span className="binder-share-eyebrow">{t('Your binder, your choice','Tu carpeta, tu decisión')}</span><h2 id="binder-share-title">{t('Share your binder','Comparte tu carpeta')}</h2></div><button type="button" className="binder-share-close" disabled={busy} aria-label={t('Close sharing','Cerrar acceso')} onClick={onClose}><X size={20}/></button></header>
  <p className="binder-share-privacy"><ShieldCheck size={19}/>{t('Family conversations always stay private. You choose the notes your coordinator can see.','Las conversaciones familiares siempre son privadas. Tú eliges las notas que puede ver tu coordinador.')}</p>
  {children}
 </dialog>,document.body);
}
export default function BinderSharing({studentId,t,openRequest=0,connectionOpenRequest=0}:{studentId:string;t:T;openRequest?:number;connectionOpenRequest?:number}){
 const [status,setStatus]=useState<Status>(),[open,setOpen]=useState(false),[view,setView]=useState<SharingView>('notes'),[entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState<string[]>([]),[connection,setConnection]=useState(''),[preview,setPreview]=useState<Preview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[entriesLoaded,setEntriesLoaded]=useState(false),[entriesBusy,setEntriesBusy]=useState(false),[entryAttempt,setEntryAttempt]=useState(0);
 const generation=useRef(0),refreshRevision=useRef(0),previewRef=useRef<Preview|undefined>(undefined),channel=useRef<BroadcastChannel|null>(null),connectionRef=useRef('');previewRef.current=preview;connectionRef.current=connection;
 const refresh=useCallback(async()=>{
  const v=generation.current,revision=++refreshRevision.current,next=await request(studentId,'status');
  if(v===generation.current&&revision===refreshRevision.current){
   setStatus(next);
   if(!next.enabled||connectionRef.current&&!next.connections.some((c:Status['connections'][number])=>c.id===connectionRef.current)){
    setPreview(undefined);setEntries([]);setEntriesLoaded(false);setSelected([]);setConnection('');
   }
  }
 },[studentId]);
 const clear=useCallback(()=>{generation.current++;refreshRevision.current++;setPreview(undefined);setEntries([]);setEntriesLoaded(false);setSelected([]);setConnection('');setBusy(false);setEntriesBusy(false);setEntryAttempt(n=>n+1);},[]);
 useEffect(()=>{
  let alive=true;
  const reset=()=>{const old=previewRef.current;clear();setStatus(undefined);if(old)void request(studentId,'cancel',{previewId:old.previewId}).catch(()=>{});};
  const reload=()=>{reset();if(!document.hidden&&navigator.onLine)void refresh().catch(()=>{if(alive)setError(t('Sharing could not be refreshed. Reconnect and try again.','No se pudo actualizar el acceso. Vuelve a conectarte e inténtalo de nuevo.'));});};
  void refresh().catch(()=>{if(alive)setError(t('Sharing could not be loaded. Try again.','No se pudo cargar el acceso. Intenta de nuevo.'));});
  const unsubscribe=browserPrivacy.subscribe(reset);
  const timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void refresh().catch(()=>{if(alive)reset();});},30000);
  const bus=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('origen-binder-sharing'):null;channel.current=bus;if(bus)bus.onmessage=reload;
  window.addEventListener('origen-connections-changed',reload);window.addEventListener('focus',reload);window.addEventListener('online',reload);window.addEventListener('offline',reset);document.addEventListener('visibilitychange',reload);
  return()=>{alive=false;generation.current++;clearInterval(timer);unsubscribe();bus?.close();channel.current=null;window.removeEventListener('origen-connections-changed',reload);window.removeEventListener('focus',reload);window.removeEventListener('online',reload);window.removeEventListener('offline',reset);document.removeEventListener('visibilitychange',reload);const old=previewRef.current;if(old)void request(studentId,'cancel',{previewId:old.previewId}).catch(()=>{});};
 // Copy changes do not restart a private session or dismiss the review.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[studentId,refresh,clear]);
 const changed=()=>{channel.current?.postMessage('changed');window.dispatchEvent(new Event('origen-sharing-changed'));};
 async function perform(action:string,extra:Record<string,unknown>={},work?:(result:unknown)=>void){
  const v=++generation.current;refreshRevision.current++;setBusy(true);setError('');setNotice('');
  try{const result=await request(studentId,action,extra);if(v!==generation.current)return;work?.(result);if(['publish','withdraw','remove-topic','revoke','revoke-all','help'].includes(action)){changed();await refresh();setNotice(action==='publish'?t('Your notes are shared. You can manage access below.','Tus notas están compartidas. Puedes administrar el acceso abajo.'):t('Your sharing selection is updated.','Tu selección para compartir está actualizada.'));}}
  catch(e){if(v===generation.current){if((e as {status?:number}).status===403){clear();setStatus(undefined);}setError((e as Error).message==='sharing_changed'?t('Something changed. Close this review and choose your notes again.','Algo cambió. Cierra esta revisión y elige tus notas de nuevo.'):t('We could not confirm the result. Refresh sharing before trying again.','No pudimos confirmar el resultado. Actualiza el acceso antes de intentar de nuevo.'));}}
  finally{if(v===generation.current)setBusy(false);}
 }
 function cancel(){
  if(busy)return;
  const old=preview;setPreview(undefined);setError('');
  if(old)void perform('cancel',{previewId:old.previewId},result=>{
   if((result as {status:string}).status==='published')setNotice(t('Your notes were shared. Use Stop sharing below if you want to remove access.','Tus notas se compartieron. Usa Dejar de compartir abajo si quieres eliminar el acceso.'));
   void refresh().catch(()=>setError(t('Could not refresh sharing. Check access before trying again.','No se pudo actualizar el acceso. Compruébalo antes de intentar de nuevo.')));
  });
 }
 function show(next:SharingView='notes'){setView(next);setOpen(true);setError('');void refresh().catch(()=>setError(t('Sharing could not be loaded. Try again.','No se pudo cargar el acceso. Intenta de nuevo.')));}
 function close(){if(busy)return;clear();setOpen(false);setError('');setNotice('');}
 useEffect(()=>{if(openRequest)show('access');},[openRequest]);
 useEffect(()=>{if(connectionOpenRequest)show('connect');},[connectionOpenRequest]);
 // The only auto-selection is the recipient when there is exactly one accepted
 // connection. Notes always start unchecked; provenance comes only from the API.
 useEffect(()=>{if(open&&status?.enabled&&status.connections.length===1&&!connection)setConnection(status.connections[0].id);},[open,status,connection]);
 useEffect(()=>{
  if(!open||view!=='notes'||!status?.enabled||!status.connections.length||entriesLoaded)return;
  let current=true;const v=generation.current;setEntriesBusy(true);setError('');
  void request(studentId,'entries').then(result=>{if(current&&v===generation.current){setEntries(result.entries);setEntriesLoaded(true);}}).catch(()=>{if(current&&v===generation.current)setError(t('Your notes could not be loaded. Refresh to try again.','No se pudieron cargar tus notas. Actualiza para intentar de nuevo.'));}).finally(()=>{if(current&&v===generation.current)setEntriesBusy(false);});
  return()=>{current=false;setEntriesBusy(false);};
 },[open,view,status?.enabled,status?.connections.length,entriesLoaded,studentId,entryAttempt]);
 const active=status?.grants.filter(g=>g.status==='active')||[];
 const selectedEntries=entries.filter(e=>selected.includes(e.id));
 const selectedTopics=[...new Set(selectedEntries.map(e=>e.topic))];
 const recipient=status?.connections.find(c=>c.id===connection);
 const connect=<CoordinatorConnection key={studentId} studentId={studentId} t={t} embedded initiallyOpen/>;
 return <section className="binder-sharing" aria-label={t('Binder sharing','Compartir carpeta')}>
  <div className="binder-share-banner"><div className="binder-share-banner-copy"><span className="binder-share-icon"><Share2 size={23} aria-hidden="true"/></span><div><h3>{t('Share your binder','Comparte tu carpeta')}</h3><p>{t('Choose notes for your coordinator. Family conversations stay private.','Elige notas para tu coordinador. Las conversaciones familiares son privadas.')}</p>{active.length>0&&<button type="button" className="binder-share-access-link" onClick={()=>show('access')}>{t(`Shared with ${active.length} ${active.length===1?'coordinator':'coordinators'}`,`Compartida con ${active.length} ${active.length===1?'coordinador':'coordinadores'}`)}</button>}</div></div><button type="button" className="button primary binder-share-launch" aria-haspopup="dialog" onClick={()=>show()}><Share2 size={17} aria-hidden="true"/>{t('Share binder','Compartir carpeta')}</button></div>
  {error&&!open&&<p role="alert">{error}</p>}
  {open&&<SharingSheet t={t} busy={busy} onClose={close}>
   <nav className="binder-share-tabs" aria-label={t('Sharing options','Opciones para compartir')}><button type="button" disabled={busy} aria-pressed={view==='notes'||view==='connect'} onClick={()=>setView('notes')}>{t('Choose notes','Elegir notas')}</button><button type="button" disabled={busy} aria-pressed={view==='access'} onClick={()=>setView('access')}>{t('People with access','Personas con acceso')}{active.length>0&&<span>{active.length}</span>}</button></nav>
   {notice&&<p className="binder-share-success" role="status"><CheckCircle2 size={19}/>{notice}</p>}
   {error&&!preview&&<p className="binder-share-error" role="alert">{error}</p>}
   {!status&&!error&&<p role="status">{t('Checking your sharing options…','Comprobando las opciones para compartir…')}</p>}
   {status&&!status.available&&<p>{t('Sharing is not available for this student profile.','El acceso compartido no está disponible para este perfil de estudiante.')}</p>}
   {status?.available&&!status.enabled&&<p role="status">{t('Sharing is paused. You can still remove access under People with access.','El acceso está en pausa. Aún puedes eliminarlo en Personas con acceso.')}</p>}
   {status?.available&&view==='notes'&&status.enabled&&<>
    {status.connections.length===0?<div className="binder-share-connect"><h3>{t('First, connect with your coordinator','Primero, conecta con tu coordinador')}</h3><p>{t('Enter their code below. Once they accept, you can choose notes to share here.','Escribe su código abajo. Cuando acepte, podrás elegir aquí las notas que quieras compartir.')}</p>{connect}</div>:<>
     {status.connections.length===1?<div className="binder-share-recipient-card"><span>{t('Sharing with','Compartir con')}</span><strong>{recipient?.coordinatorName||status.connections[0].coordinatorName}</strong><small>{recipient?.organizationName||status.connections[0].organizationName}</small></div>:<label className="binder-share-recipient">{t('Share with','Compartir con')}<select aria-label={t('Share with','Compartir con')} value={connection} disabled={busy} onChange={e=>{setConnection(e.target.value);setSelected([]);}}><option value="">{t('Choose a coordinator','Elige un coordinador')}</option>{status.connections.map(c=><option key={c.id} value={c.id}>{c.coordinatorName} · {c.organizationName}</option>)}</select></label>}
     <div className="binder-share-selection-heading"><div><h3>{t('Which notes would you like to share?','¿Qué notas quieres compartir?')}</h3><p>{t('Choose individual notes or select all below.','Elige notas individuales o selecciona todas abajo.')}</p></div>{entries.length>0&&<button type="button" className="text-button" disabled={busy} onClick={()=>setSelected(selected.length?[]:entries.slice(0,50).map(e=>e.id))}>{selected.length?t('Clear selection','Quitar selección'):entries.length>50?t('Select first 50 notes','Seleccionar las primeras 50 notas'):t('Select all notes','Seleccionar todas las notas')}</button>}</div>
     {entriesLoaded&&entries.length===0&&<p className="binder-share-empty">{t('No shareable notes yet. Add a note to your binder or talk with Origen first. Family conversations and details without a clear student-only source stay private.','Todavía no hay notas para compartir. Agrega una nota a tu carpeta o habla con Origen. Las conversaciones familiares y los detalles sin un origen exclusivo del estudiante permanecen privados.')}</p>}
     <div className="binder-share-choices">{topics.map(([topic,en,es])=>{const group=entries.filter(e=>e.topic===topic);return group.length>0&&<fieldset key={topic} disabled={busy}><legend>{t(en,es)}<span>{group.length}</span></legend>{group.map(e=><label key={e.id}><input type="checkbox" disabled={selected.length>=50&&!selected.includes(e.id)} checked={selected.includes(e.id)} onChange={event=>setSelected(event.target.checked?[...selected,e.id]:selected.filter(id=>id!==e.id))}/><span>{e.content}</span></label>)}</fieldset>;})}</div>
     {entries.length>50&&<p className="binder-share-limit">{t('Share up to 50 notes at a time.','Comparte hasta 50 notas a la vez.')}</p>}
     <div className="binder-share-footer"><span aria-live="polite">{selected.length} {selected.length===1?t('note selected','nota seleccionada'):t('notes selected','notas seleccionadas')}</span><button type="button" className="button primary" disabled={busy||selected.length===0||!recipient} onClick={()=>void perform('preview',{connectionId:connection,topics:selectedTopics,entryIds:selected},data=>setPreview(data as Preview))}>{t('Review & share','Revisar y compartir')}<Share2 size={17}/></button></div>
    </>}
    {status.connections.length>0&&<button type="button" className="binder-share-add" disabled={busy} onClick={()=>setView('connect')}><UserRoundPlus size={17}/>{t('Connect another coordinator','Conectar con otro coordinador')}</button>}
   </>}
   {status?.available&&view==='connect'&&<div className="binder-share-connect"><h3>{t('Connect with a coordinator','Conecta con un coordinador')}</h3>{connect}<button type="button" className="text-button" onClick={()=>setView('notes')}>{t('Back to sharing notes','Volver a compartir notas')}</button></div>}
   {status?.available&&view==='access'&&<>
    {status.grants.length===0&&<div className="binder-share-empty"><p>{t('You haven’t shared any notes yet.','Todavía no has compartido notas.')}</p><button type="button" className="button primary" disabled={!status.enabled} onClick={()=>setView('notes')}>{t('Choose notes to share','Elegir notas para compartir')}</button></div>}
    {status.grants.map(g=><article className="binder-share-person" key={g.id}><div className="binder-share-person-heading"><div><h3>{g.coordinatorName}</h3><p>{g.organizationName}</p></div>{g.status==='active'&&<button type="button" className="button outline" disabled={busy} onClick={()=>void perform('revoke',{grantId:g.id})}>{t('Stop sharing','Dejar de compartir')}</button>}</div><p>{g.status==='active'?<>{t('Shared until','Compartida hasta')} {new Date(g.expiresAt).toLocaleDateString(t('en','es'))}</>:t('Access ended','Acceso finalizado')} · {g.items.length} {g.items.length===1?t('note','nota'):t('notes','notas')}</p>
     {g.items.length>0&&<details><summary>{t('See shared notes','Ver notas compartidas')}</summary>{g.items.map(item=><div className="binder-share-current" key={item.id}><p>{item.content}</p><button type="button" className="text-button" disabled={busy} onClick={()=>void perform('withdraw',{grantId:g.id,itemId:item.id})}>{t('Remove note','Quitar nota')}</button></div>)}</details>}
     {g.status==='active'&&<label className="binder-share-help"><input type="checkbox" checked={!!g.helpRequested} disabled={busy||!status.enabled&&!g.helpRequested} onChange={e=>void perform('help',{grantId:g.id,requested:e.target.checked})}/>{t('I’d like help with these notes','Me gustaría recibir ayuda con estas notas')}</label>}
    </article>)}
    {active.length>1&&<button type="button" className="button outline" disabled={busy} onClick={()=>void perform('revoke-all')}>{t('Stop all sharing','Dejar de compartir todo')}</button>}
   </>}
   {(busy||entriesBusy)&&<p role="status">{t('Updating sharing…','Actualizando acceso…')}</p>}
   <button type="button" className="text-button binder-share-refresh" disabled={busy} onClick={()=>{clear();setError('');void refresh().catch(()=>setError(t('Could not refresh sharing.','No se pudo actualizar el acceso.')));}}>{t('Refresh sharing','Actualizar acceso')}</button>
  </SharingSheet>}
  {preview&&<Review preview={preview} t={t} error={error} busy={busy} onCancel={cancel} onPublish={()=>void perform('publish',{previewId:preview.previewId,confirmed:true},()=>{setPreview(undefined);setSelected([]);setView('access');})}/>}
 </section>;
}
