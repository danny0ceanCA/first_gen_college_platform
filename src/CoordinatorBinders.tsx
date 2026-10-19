import {GuidancePanel} from './CoordinatorGuidance';
import {useEffect,useRef,useState} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import './CoordinatorBinders.css';
type Entry={id:string;topic:string;kind:string;language:string;content:string};
type Binder={id:string;studentName:string;publicationId:string;version:number;publishedAt:string;expiresAt:string;topics:string[];isNew:boolean;helpRequested:boolean;entries?:Entry[]};
type Listing={binders:Binder[];counts:{all:number;new:number;help:number};nextCursor:string|null};
type T=(en:string,es:string)=>string;
const topics=[['summary','Summary','Resumen'],['options','College options','Opciones universitarias'],['transfer','Transfer & courses','Transferencia y cursos'],['costs','Paying for college','Pagar la universidad'],['applications','Applications','Solicitudes']];
export default function CoordinatorBinders({organizationId,request,feedbackRequest,t,es,openRequest}:{organizationId:string;openRequest?:{grantId:string;sequence:number};request:(input:Record<string,unknown>)=>Promise<any>;feedbackRequest?:(input:Record<string,unknown>)=>Promise<any>;t:T;es:boolean}){
 const [listing,setListing]=useState<Listing>(),[binder,setBinder]=useState<Binder>(),[view,setView]=useState('all'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[cursor,setCursor]=useState<string|null>(null),[topic,setTopic]=useState('summary'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const version=useRef(0),activeId=useRef<string|undefined>(undefined),requestRef=useRef(request);requestRef.current=request;
 const clear=()=>{version.current++;setListing(undefined);setBinder(undefined);setBusy(false);};
 async function load(id=activeId.current,nextCursor=cursor,background=false){
  if(!browserPrivacy.valid()){clear();return;}
  const v=++version.current;if(!background){setBusy(true);setBinder(undefined);setListing(undefined);}setError('');
  const deadline=background?setTimeout(()=>{if(v===version.current){clear();setError('binder_read_unavailable');}},5000):undefined;
  try{
   const [list,detail]=await Promise.all([requestRef.current({action:'list',organizationId,view,search:query,cursor:nextCursor}),id?requestRef.current({action:'read',organizationId,grantId:id}):Promise.resolve(undefined)]);
   if(v!==version.current)return;setListing(list);setBinder(detail);if(detail)setTopic(current=>current==='summary'||detail.topics.includes(current)?current:'summary');
  }catch(e){if(v===version.current){setError((e as Error).message);setListing(undefined);setBinder(undefined);}}
  finally{clearTimeout(deadline);if(v===version.current)setBusy(false);}
 }
 useEffect(()=>{
  activeId.current=undefined;setTopic('summary');void load(undefined);
  const resume=()=>{clear();if(!document.hidden&&navigator.onLine)void load();};
  const pause=()=>clear();
  const unsubscribe=browserPrivacy.subscribe(()=>{activeId.current=undefined;clear();});
  const bus=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('origen-binder-sharing'):null;if(bus)bus.onmessage=resume;
  const timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void load(activeId.current,cursor,true);else clear();},25000);
  window.addEventListener('focus',resume);window.addEventListener('blur',pause);window.addEventListener('online',resume);window.addEventListener('offline',pause);document.addEventListener('visibilitychange',resume);
  return()=>{version.current++;clearInterval(timer);unsubscribe();bus?.close();window.removeEventListener('focus',resume);window.removeEventListener('blur',pause);window.removeEventListener('online',resume);window.removeEventListener('offline',pause);document.removeEventListener('visibilitychange',resume);};
 // Only route/filter changes start a new scoped session; language changes preserve it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[organizationId,view,query,cursor]);
 useEffect(()=>{if(openRequest){activeId.current=openRequest.grantId;setTopic('summary');void load(openRequest.grantId,null);}},[openRequest?.sequence]);
 useEffect(()=>{if(!binder)return;const timer=setTimeout(()=>{clear();setError('binder_unavailable');},Math.max(0,Math.min(2147483647,Date.parse(binder.expiresAt)-Date.now())));return()=>clearTimeout(timer);},[binder]);
 async function reviewed(){if(!binder)return;const v=++version.current;setBusy(true);try{await requestRef.current({action:'review',organizationId,grantId:binder.id,publicationId:binder.publicationId});if(v===version.current)await load();}catch(e){if(v===version.current){clear();setError((e as Error).message);}}finally{if(v===version.current)setBusy(false);}}
 const label=(id:string)=>{const x=topics.find(x=>x[0]===id);return x?t(x[1],x[2]):id;};
 const date=(v:string)=>new Date(v).toLocaleString(es?'es':'en',{dateStyle:'medium',timeStyle:'short'});
 const entries=binder?.entries||[];
 return <section className="coordinator-card coordinator-binders" aria-label={t('Shared binders','Carpetas compartidas')}>
  <div className="coordinator-binders-heading"><div><span className="eyebrow">{t('SHARED WITH YOU','COMPARTIDO CONTIGO')}</span><h2>{t('Student binders','Carpetas de estudiantes')}</h2></div><button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh binders','Actualizar carpetas')}</button></div>
  <p>{t('Students choose the pages you can see. A connection alone does not share their binder.','Los estudiantes eligen las páginas que puedes ver. Una conexión por sí sola no comparte su carpeta.')}</p>
  <div className="coordinator-binder-views" aria-label={t('Binder views','Vistas de carpetas')}>{[['all','Shared binders','Carpetas compartidas'],['new','New updates','Novedades'],['help','Help requested','Ayuda solicitada']].map(([id,en,sp])=><button type="button" key={id} aria-pressed={view===id} onClick={()=>{activeId.current=undefined;clear();setCursor(null);setView(id);if(view===id&&cursor===null)void load(undefined,null);}}>{t(en,sp)}{listing&&<span>{listing.counts[id as keyof Listing['counts']]}</span>}</button>)}</div>
  <form className="coordinator-binder-search" onSubmit={e=>{e.preventDefault();activeId.current=undefined;clear();setCursor(null);setQuery(search.trim());if(query===search.trim()&&cursor===null)void load(undefined,null);}}><label>{t('Find a shared binder by name','Buscar una carpeta por nombre')}<input type="search" maxLength={80} value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="button outline" type="submit">{t('Search','Buscar')}</button></form>
  {busy&&<p role="status">{t('Checking shared access…','Comprobando el acceso…')}</p>}
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators"/>:<p role="alert">{error==='coordinator_sharing_unavailable'?t('Binder viewing is paused. Refresh when access is available.','La vista de carpetas está en pausa. Actualiza cuando esté disponible.'):error==='binder_unavailable'?t('This shared view is no longer available. Sharing may have ended or expired. Return to shared binders to refresh.','Esta vista ya no está disponible. El acceso pudo finalizar o vencer. Vuelve a las carpetas para actualizar.'):t('Access could not be verified. Shared content has been cleared. Refresh or sign in again.','No se pudo verificar el acceso. Se borró el contenido compartido de esta vista. Actualiza o inicia sesión de nuevo.')}<button className="text-button" onClick={()=>{activeId.current=undefined;setCursor(null);void load(undefined,null);}}>{t('Return to shared binders','Volver a las carpetas')}</button></p>)}
  {listing&&!binder&&<><div className="coordinator-binder-list">{listing.binders.map(b=><button type="button" key={b.id} onClick={()=>{activeId.current=b.id;setTopic('summary');void load(b.id);}}><strong>{b.studentName}</strong><span>{b.topics.map(label).join(' · ')}</span><small>{t('Published','Publicado')} {date(b.publishedAt)}</small><span className="coordinator-binder-badges">{b.isNew&&<em>{t('New publication','Nueva publicación')}</em>}{b.helpRequested&&<em>{t('Help requested','Ayuda solicitada')}</em>}</span><span>{t('Open shared binder →','Abrir carpeta compartida →')}</span></button>)}</div>{listing.binders.length===0&&<p>{t('No shared binders match this view. Students must publish a selection before it appears here.','No hay carpetas para esta vista. Los estudiantes deben publicar una selección para que aparezca aquí.')}</p>}<div className="coordinator-binder-pagination">{cursor&&<button className="button outline" onClick={()=>setCursor(null)}>{t('First page','Primera página')}</button>}{listing.nextCursor&&<button className="button outline" onClick={()=>setCursor(listing.nextCursor)}>{t('Next page','Página siguiente')}</button>}</div></>}
  {binder&&<div className="coordinator-shared-binder">
   <button className="text-button" onClick={()=>{activeId.current=undefined;void load(undefined);}}>{t('← All shared binders','← Todas las carpetas compartidas')}</button>
   <header><span className="eyebrow">{t('SHARED BINDER','CARPETA COMPARTIDA')}</span><h3>{binder.studentName}</h3><p>{t('Only the entries this student has shared are shown.','Solo se muestran las notas que este estudiante ha compartido.')}</p><small>{t('Published','Publicado')} {date(binder.publishedAt)} · {t('Version','Versión')} {binder.version}<br/>{t('Access ends','El acceso termina')} {date(binder.expiresAt)}</small>{binder.helpRequested&&<p className="coordinator-help-request">{t('This student has asked for help with this published selection.','Este estudiante ha pedido ayuda con esta selección publicada.')}</p>}</header>
   <nav className="notebook-topics coordinator-publication-topics" aria-label={t('Shared binder topics','Temas compartidos')}>{topics.filter(([id])=>id==='summary'||binder.topics.includes(id)).map(([id,en,sp])=><button type="button" className={`notebook-topic${topic===id?' active':''}`} aria-pressed={topic===id} key={id} onClick={()=>setTopic(id)}>{t(en,sp)}{id!=='summary'&&<small>{entries.filter(e=>e.topic===id).length}</small>}</button>)}</nav>
   <section className="notebook-panel coordinator-publication-page" aria-label={label(topic)}>
    <h4>{label(topic)}</h4>
    {topic==='summary'?<><p>{t('A guide to this published selection. Open a topic to read the shared notes.','Una guía de esta selección publicada. Abre un tema para leer las notas compartidas.')}</p><ul className="coordinator-publication-digest">{binder.topics.map(id=><li key={id}><button className="text-button" onClick={()=>setTopic(id)}>{label(id)} <span>{entries.filter(e=>e.topic===id).length} {t('shared entries','notas compartidas')} →</span></button></li>)}</ul></>:<>{entries.filter(e=>e.topic===topic).map(e=><article className="coordinator-published-note" key={e.id} lang={e.language}><p>{e.content}</p></article>)}{!entries.some(e=>e.topic===topic)&&<p>{t('No entries are currently shared in this topic. They may have been edited or withdrawn.','No hay notas compartidas en este tema. Pueden haberse editado o retirado.')}</p>}</>}
    <button type="button" className="button outline" disabled={busy||!binder.isNew} onClick={()=>void reviewed()}>{binder.isNew?t('Mark this publication reviewed','Marcar esta publicación como revisada'):t('Publication reviewed','Publicación revisada')}</button>
    {feedbackRequest&&<GuidancePanel key={binder.id+':'+binder.publicationId} organizationId={organizationId} grantId={binder.id} publicationId={binder.publicationId} topic={topic} entries={entries} request={feedbackRequest} t={t}/>}
   </section>
  </div>}
 </section>;
}
