import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
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
  <h2 id="share-review-title">{t('Your selected pages','Tus páginas seleccionadas')}</h2>
  <p><strong>{preview.coordinatorName}</strong> · {preview.organizationName}</p>
  <p>{t('For','Para')} {preview.studentName} · {t('Access ends','El acceso termina')} <time dateTime={preview.shareExpiresAt}>{new Date(preview.shareExpiresAt).toLocaleDateString()}</time></p>
  <p>{t('Only these entries are included. New notes and edits stay private until you review and publish again. You can stop sharing at any time.','Solo se incluyen estas notas. Las notas nuevas y los cambios permanecen privados hasta que revises y publiques de nuevo. Puedes dejar de compartir cuando quieras.')}</p>
  <div className="binder-share-preview-entries">{preview.entries.map(e=><article key={e.id}><small>{topicName(e.topic,t)}</small><p>{e.content}</p></article>)}</div>
  {error&&<p role="alert">{error}</p>}
  <div className="binder-share-actions"><button type="button" className="button outline" disabled={busy} onClick={onCancel}>{error?t('Close review and check sharing','Cerrar revisión y comprobar acceso'):t('Cancel','Cancelar')}</button><button type="button" className="button primary" disabled={busy||!!error} onClick={onPublish}>{busy?t('Publishing…','Publicando…'):t('Publish these entries','Publicar estas notas')}</button></div>
 </dialog>,document.body);
}
export default function BinderSharing({studentId,t,openRequest=0}:{studentId:string;t:T;openRequest?:number}){
 const [status,setStatus]=useState<Status>(),[open,setOpen]=useState(false),[entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState<string[]>([]),[chosenTopics,setTopics]=useState<string[]>([]),[connection,setConnection]=useState(''),[preview,setPreview]=useState<Preview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const generation=useRef(0),refreshRevision=useRef(0),previewRef=useRef<Preview|undefined>(undefined),channel=useRef<BroadcastChannel|null>(null);previewRef.current=preview;
 const refresh=useCallback(async()=>{const v=generation.current,revision=++refreshRevision.current;const next=await request(studentId,'status');if(v===generation.current&&revision===refreshRevision.current){setStatus(next);if(!next.enabled){setPreview(undefined);setEntries([]);setSelected([]);setTopics([]);setConnection('');}}},[studentId]);
 const clear=useCallback(()=>{generation.current++;refreshRevision.current++;setPreview(undefined);setEntries([]);setSelected([]);setTopics([]);setConnection('');setBusy(false);},[]);
 useEffect(()=>{
  let alive=true;
  const reset=()=>{const old=previewRef.current;clear();setStatus(undefined);if(old)void request(studentId,'cancel',{previewId:old.previewId}).catch(()=>{});};
  const reload=()=>{reset();if(!document.hidden&&navigator.onLine)void refresh().catch(()=>{if(alive)setError(t('Sharing could not be refreshed. Reconnect and try again.','No se pudo actualizar el acceso. Vuelve a conectarte e inténtalo de nuevo.'));});};
  void refresh().catch(()=>{});
  const unsubscribe=browserPrivacy.subscribe(()=>reset());
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
  try{const result=await request(studentId,action,extra);if(v!==generation.current)return;work?.(result);if(['publish','withdraw','remove-topic','revoke','revoke-all','help'].includes(action)){changed();await refresh();setNotice(t('Your sharing selection is updated.','Tu selección para compartir está actualizada.'));}}
  catch(e){if(v===generation.current){if((e as {status?:number}).status===403){clear();setStatus(undefined);}setError((e as Error).message==='sharing_changed'?t('Something changed. Close this review and choose your entries again.','Algo cambió. Cierra esta revisión y elige tus notas de nuevo.'):t('We could not confirm the result. Refresh sharing before trying again.','No pudimos confirmar el resultado. Actualiza el acceso antes de intentar de nuevo.'));}}
  finally{if(v===generation.current)setBusy(false);}
 }
 function cancel(){
  // Escape and the preview-expiry timer must respect an in-flight publication too.
  if(busy)return;
  const old=preview;setPreview(undefined);setError('');
  if(old)void perform('cancel',{previewId:old.previewId},result=>{
   if((result as {status:string}).status==='published')setNotice(t('Your entries were published. Use Stop sharing below if you want to remove access.','Tus notas se publicaron. Usa Dejar de compartir abajo si quieres eliminar el acceso.'));
   void refresh().catch(()=>setError(t('Could not refresh sharing. Check access before trying again.','No se pudo actualizar el acceso. Compruébalo antes de intentar de nuevo.')));
  });
 }
 const visible=entries.filter(e=>chosenTopics.includes(e.topic));
 useEffect(()=>{if(openRequest){setOpen(true);void refresh().catch(()=>{});}},[openRequest]);
 if(!status?.available)return error?<p role="status">{error}<button type="button" className="text-button" onClick={()=>{setError('');void refresh().catch(()=>{});}}>{t('Refresh sharing','Actualizar acceso')}</button></p>:null;
 return <section className="binder-sharing" aria-label={t('Binder sharing','Compartir carpeta')}>
  <div className="binder-share-heading"><div><span className="binder-share-eyebrow">{t('Your binder, your choice','Tu carpeta, tu decisión')}</span><h3>{t('Share with a coordinator','Compartir con un coordinador')}</h3></div><button type="button" className="button outline" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void refresh().catch(()=>{});}}>{open?t('Close sharing','Cerrar acceso'):t('People with access','Personas con acceso')}</button></div>
  {open&&<><p>{t('Choose only what you want this coordinator to see. Eligible conversation details include their attribution and uncertainty. Whole summaries, family-origin details and unsupported sources stay private.','Elige solo lo que quieres que vea este coordinador. Los detalles elegibles de conversaciones incluyen su origen e incertidumbre. Los resúmenes completos, detalles familiares y fuentes no respaldadas permanecen privados.')}</p>
   {!status.enabled&&<p role="status">{t('Sharing is paused. You can still remove access below.','El acceso está en pausa. Aún puedes eliminarlo aquí.')}</p>}
   {status.grants.length===0&&<p>{t('No binder entries have been shared.','No se han compartido notas de la carpeta.')}</p>}
   {status.grants.map(g=><article className="binder-share-person" key={g.id}><h4>{g.coordinatorName}</h4><p>{g.organizationName} · {g.status==='active'?t('Published selection','Selección publicada'):t('Access ended or unavailable','Acceso finalizado o no disponible')}</p><p>{t('Expires','Vence')}: {new Date(g.expiresAt).toLocaleDateString()}</p>
    {g.items.map(item=><div className="binder-share-current" key={item.id}><p>{item.content}</p><button type="button" className="text-button" disabled={busy} onClick={()=>void perform('withdraw',{grantId:g.id,itemId:item.id})}>{t('Remove entry','Quitar nota')}</button></div>)}
    {g.status==='active'&&<><p>{t('Ask this coordinator for help with your published selection. This request resets when you publish a new selection.','Pide ayuda a este coordinador con tu selección publicada. La solicitud se reinicia cuando publicas una nueva selección.')}</p><label><input type="checkbox" checked={!!g.helpRequested} disabled={busy||!status.enabled&&!g.helpRequested} onChange={e=>void perform('help',{grantId:g.id,requested:e.target.checked})}/>{t('I would like help with these shared notes','Me gustaría recibir ayuda con estas notas compartidas')}</label><div className="binder-share-actions">{g.topics.map(topic=><button type="button" className="button outline" key={topic} disabled={busy} onClick={()=>void perform('remove-topic',{grantId:g.id,topic})}>{t('Remove','Quitar')} {topicName(topic,t)}</button>)}</div><button type="button" className="text-button" disabled={busy} onClick={()=>void perform('revoke',{grantId:g.id})}>{t('Stop sharing with this person','Dejar de compartir con esta persona')}</button></>}
   </article>)}
   {status.grants.length>0&&<button type="button" className="button outline" disabled={busy} onClick={()=>void perform('revoke-all')}>{t('Stop all sharing','Dejar de compartir todo')}</button>}
   {status.enabled&&status.connections.length===0&&<p>{t('Connect with a coordinator first. After they accept, you can choose what to share.','Conecta primero con un coordinador. Cuando acepte, podrás elegir qué compartir.')}</p>}
   {status.enabled&&status.connections.length>0&&<div className="binder-share-compose"><h4>{t('Choose a new sharing selection','Elige una nueva selección')}</h4><label className="binder-share-recipient">{t('Coordinator','Coordinador')}<select value={connection} disabled={busy} onChange={e=>{setConnection(e.target.value);setSelected([]);setTopics([]);setEntries([]);if(e.target.value)void perform('entries',{},data=>setEntries((data as {entries:Entry[]}).entries));}}><option value="">{t('Choose a coordinator','Elige un coordinador')}</option>{status.connections.map(c=><option key={c.id} value={c.id}>{c.coordinatorName} · {c.organizationName}</option>)}</select></label>
    {connection&&<><fieldset disabled={busy}><legend>{t('Choose topics','Elige los temas')}</legend><button type="button" className="text-button" onClick={()=>{setTopics(topics.map(x=>x[0]));setSelected([]);}}>{t('All eligible topics','Todos los temas elegibles')}</button><div className="binder-share-topics">{topics.map(([id,en,es])=><label key={id}><input type="checkbox" checked={chosenTopics.includes(id)} onChange={e=>{setTopics(e.target.checked?[...chosenTopics,id]:chosenTopics.filter(x=>x!==id));setSelected(selected.filter(note=>entries.find(x=>x.id===note)?.topic!==id));}}/>{t(en,es)}</label>)}</div></fieldset>
     <p>{t('Select the exact entries below, including any attribution and uncertainty shown. Publishing replaces your previous selection for this coordinator and starts a new 90-day period.','Selecciona las notas exactas, incluido su origen e incertidumbre. Al publicar, se reemplaza tu selección anterior para este coordinador y comienza un nuevo período de 90 días.')}</p>
     {chosenTopics.length>0&&visible.length===0&&<p>{t('No eligible entries in these topics yet. You can write a personal binder note. Conversation details with missing origin evidence, sensitive content or source changes stay private.','Aún no hay notas elegibles en estos temas. Puedes escribir una nota personal. Los detalles sin evidencia de origen, con contenido sensible o cambios en la fuente permanecen privados.')}</p>}
     <div className="binder-share-choices">{visible.map(e=><label key={e.id}><input type="checkbox" disabled={busy||selected.length>=50&&!selected.includes(e.id)} checked={selected.includes(e.id)} onChange={event=>setSelected(event.target.checked?[...selected,e.id]:selected.filter(id=>id!==e.id))}/><span><small>{topicName(e.topic,t)}</small><span>{e.content}</span></span></label>)}</div>
     <button type="button" className="button primary" disabled={busy||selected.length===0} onClick={()=>void perform('preview',{connectionId:connection,topics:chosenTopics,entryIds:selected},data=>setPreview(data as Preview))}>{t('Review selected entries','Revisar notas seleccionadas')} ({selected.length}/50)</button>
    </>}
   </div>}
   {error&&!preview&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<button type="button" className="text-button" disabled={busy} onClick={()=>{clear();setError('');void refresh().catch(()=>setError(t('Could not refresh sharing.','No se pudo actualizar el acceso.')));}}>{t('Refresh sharing','Actualizar acceso')}</button>
  </>}
  {preview&&<Review preview={preview} t={t} error={error} busy={busy} onCancel={cancel} onPublish={()=>void perform('publish',{previewId:preview.previewId,confirmed:true},()=>{setPreview(undefined);setSelected([]);setEntries([]);setConnection('');})}/>}
 </section>;
}
