import {motionDuration,motionEasing,prefersReducedMotion} from './motion';
import {GuidancePanel} from './CoordinatorGuidance';
import CoordinatorStudentAvatar from './CoordinatorStudentAvatar';
import {useArrivalPending} from './arrivalReadiness';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {flushSync} from 'react-dom';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useNavigationState,useNavigationGuard,navigateWorkspace,confirmWorkspaceNavigation,navigationEnum,navigationText} from './workspaceNavigation';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import {BookOpen, Compass, GraduationCap, Wallet, FilePenLine, Check, RefreshCw, X} from 'lucide-react';
import './PersonalBinder.css';
import './TopicNotebook.css';
import './CoordinatorBinders.css';
type Entry={id:string;topic:string;kind:string;language:string;content:string};
type Binder={id:string;studentName:string;publicationId:string;version:number;publishedAt:string;expiresAt:string;topics:string[];isNew:boolean;helpRequested:boolean;helpRequestId?:string;helpResolved?:boolean;message?:string;entries?:Entry[]};
type Listing={binders:Binder[];counts:{all:number;new:number;help:number};nextCursor:string|null};
type T=(en:string,es:string)=>string;
const topics=[['summary','Summary','Resumen'],['options','College options','Opciones universitarias'],['transfer','Transfer & courses','Transferencia y cursos'],['costs','Paying for college','Pagar la universidad'],['applications','Applications','Solicitudes']];
export default function CoordinatorBinders({organizationId,request,feedbackRequest,t,es,openRequest,refreshVersion=0,onDirtyChange}:{organizationId:string;openRequest?:{grantId:string;sequence:number};refreshVersion?:number;onDirtyChange?:(dirty:boolean)=>void;request:(input:Record<string,unknown>)=>Promise<any>;feedbackRequest?:(input:Record<string,unknown>)=>Promise<any>;t:T;es:boolean}){
 const navKey=`coordinator.binders.${organizationId}`;
 const [listing,setListing]=useState<Listing>(),[binder,setBinder]=useState<Binder>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const listingScope=useRef<{query:string;cursor:string|null}|undefined>(undefined);
 useArrivalPending(!listing&&!binder&&!error);
 const [search,setSearch]=useNavigationState(navKey+'.search','',navigationText),[query,setQuery]=useNavigationState(navKey+'.query','',navigationText);
 const [cursor,setCursor]=useNavigationState<string|null>(navKey+'.cursor',null,(v):v is string|null=>v===null||navigationText(v));
 const [topic,setTopic]=useNavigationState<string>(navKey+'.topic','summary',navigationEnum('summary','options','transfer','costs','applications'));
 const [grantId,setGrantId]=useNavigationState(navKey+'.grant','',navigationText);
 const [origin,setOrigin]=useNavigationState<{id:string;x:number;y:number}|null>(navKey+'.origin',null,(v):v is {id:string;x:number;y:number}|null=>v===null||!!v&&typeof v==='object'&&'id' in v&&navigationText(v.id)&&'x' in v&&Number.isFinite(v.x)&&'y' in v&&Number.isFinite(v.y));
 const [screen,setScreen]=useState<'list'|'binder'>(grantId?'binder':'list');
 const [hasDraft,setHasDraft]=useState(false);
 useNavigationGuard(hasDraft);
 const dirty=useRef(false);
 const scene=useRef<HTMLElement>(null),sceneAnimation=useRef<Animation|null>(null),sceneEpoch=useRef(0),leaving=useRef(false);
 const listOrigin=useRef<{id:string;x:number;y:number}|undefined>(origin||undefined);
 const listHeading=useRef<HTMLHeadingElement>(null),returningToList=useRef(false);
 const binderHeading=useRef<HTMLHeadingElement>(null),binderShell=useRef<HTMLDivElement>(null);
 const toolbar=useRef<HTMLDivElement>(null),pageHeading=useRef<HTMLHeadingElement>(null),revealDivider=useRef(false);
 const seenRefresh=useRef(refreshVersion);
 const onDraftChange=useCallback((value:boolean)=>{dirty.current=value;setHasDraft(value);onDirtyChange?.(value);},[onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 const canLeave=()=>confirmWorkspaceNavigation();
 const changeTopic=(next:string,reveal=false)=>{if(next!==topic&&navigationEnum('summary','options','transfer','costs','applications')(next))navigateWorkspace(()=>{revealDivider.current=reveal;setTopic(next);});};
 useLayoutEffect(()=>{
  const bar=toolbar.current,shell=binderShell.current;if(!bar||!shell)return;
  const measure=()=>shell.style.setProperty('--shared-toolbar-height',`${bar.getBoundingClientRect().height}px`);
  measure();const observer=new ResizeObserver(measure);observer.observe(bar);return()=>observer.disconnect();
 },[screen,error]);
 useLayoutEffect(()=>{
  if(!revealDivider.current)return;revealDivider.current=false;
  pageHeading.current?.focus({preventScroll:true});
  pageHeading.current?.scrollIntoView({block:'start',behavior:'instant'});
 },[topic]);
 const version=useRef(0),activeId=useRef<string|undefined>(undefined),requestRef=useRef(request);requestRef.current=request;
 const cancelScene=()=>{sceneEpoch.current++;sceneAnimation.current?.cancel();sceneAnimation.current=null;leaving.current=false;if(scene.current){scene.current.inert=false;delete scene.current.dataset.binderTransition;}};
 const clear=()=>{cancelScene();version.current++;setListing(undefined);setBinder(undefined);setBusy(false);};
 // Keep the outgoing view until it has faded, then reposition and reveal the
 // incoming view. No cloned paper or private-content snapshots survive a clear.
 async function transitionScene(direction:'opening'|'closing',commit:()=>void){
  if(leaving.current)return;
  const el=scene.current;
  if(!el||document.hidden||prefersReducedMotion()){cancelScene();commit();return;}
  const current=getComputedStyle(el),opacity=current.opacity,transform=current.transform;
  cancelScene();const epoch=sceneEpoch.current;leaving.current=true;
  el.dataset.binderTransition=direction;el.dataset.binderScene='true';el.inert=true;
  const outgoing=el.animate([{opacity,transform},{opacity:0,transform:direction==='opening'?'translateY(-6px) scale(.995)':'translateY(10px) scale(.99)'}],{duration:motionDuration('exit'),easing:motionEasing('exit'),fill:'forwards'});
  sceneAnimation.current=outgoing;
  await outgoing.finished.catch(()=>{});
  if(epoch!==sceneEpoch.current||!el.isConnected)return;
  if(!browserPrivacy.valid()){clear();return;}
  el.inert=false;
  // Layout effects restore scroll and focus while the outgoing fade is at zero.
  flushSync(commit);
  const incoming=el.animate([{opacity:0,transform:direction==='opening'?'translateY(16px) scale(.992)':'translateY(-8px) scale(1.004)'},{opacity:1,transform:'none'}],{duration:motionDuration('binder')-motionDuration('exit'),easing:motionEasing()});
  outgoing.cancel();sceneAnimation.current=incoming;leaving.current=false;
  await incoming.finished.catch(()=>{});
  if(epoch===sceneEpoch.current){sceneAnimation.current=null;delete el.dataset.binderTransition;}
 }
 useEffect(()=>cancelScene,[]);
 function openBinder(id:string){
  if(leaving.current)return;
  listOrigin.current={id,x:window.scrollX,y:window.scrollY};
  setOrigin(listOrigin.current);
  void transitionScene('opening',()=>{navigateWorkspace(()=>{activeId.current=id;setTopic('summary');setGrantId(id);},{from:{x:listOrigin.current!.x,y:listOrigin.current!.y,focus:`[data-binder-id="${CSS.escape(id)}"]`}});});
 }
 function closeBinder(){
  if(leaving.current||!canLeave())return;
  version.current++;
  void transitionScene('closing',()=>{navigateWorkspace(()=>{dirty.current=false;activeId.current=undefined;returningToList.current=true;setScreen('list');setBinder(undefined);setTopic('summary');setGrantId('');},{guard:false});});
 }
 useLayoutEffect(()=>{
  if(screen!=='list'||!listing||!returningToList.current)return;
  returningToList.current=false;
  const origin=listOrigin.current,card=origin?scene.current?.querySelector<HTMLButtonElement>(`[data-binder-id="${CSS.escape(origin.id)}"]`):null;
  if(card&&origin){card.focus({preventScroll:true});window.scrollTo({left:origin.x,top:origin.y,behavior:'instant'});}
  else{listHeading.current?.focus({preventScroll:true});listHeading.current?.scrollIntoView({block:'start',behavior:'instant'});}
 },[screen,listing]);
 useLayoutEffect(()=>{
  if(screen!=='binder')return;
  binderHeading.current?.focus({preventScroll:true});
  binderShell.current?.scrollIntoView({block:'start',behavior:'instant'});
 },[screen]);
 async function load(id=activeId.current,nextCursor=cursor,background=false){
  if(!browserPrivacy.valid()){clear();return;}
  const v=++version.current;setScreen(id?'binder':'list');if(!background){setBusy(true);if(!id||binder?.id!==id)setBinder(undefined);}setError('');
  // A same-scope refresh can keep its verified view for the existing five-second
  // revalidation window. Privacy events, failures and expiry still clear it.
  const deadline=background||binder||listing?setTimeout(()=>{if(v===version.current){clear();setError('binder_read_unavailable');}},5000):undefined;
  try{
   const result=await requestRef.current(id?{action:'read',organizationId,grantId:id}:{action:'list',organizationId,view:'all',search:query,cursor:nextCursor});
   if(v!==version.current)return;if(id){setBinder(result);setTopic(current=>current==='summary'||result.topics.includes(current)?current:'summary');}else{listingScope.current={query,cursor:nextCursor};setListing(result);}
  }catch(e){if(v===version.current){cancelScene();setError((e as Error).message);setListing(undefined);setBinder(undefined);}}
  finally{clearTimeout(deadline);if(v===version.current)setBusy(false);}
 }
 useEffect(()=>{
  activeId.current=grantId||undefined;listOrigin.current=origin||undefined;void load(activeId.current);
  const resume=()=>{clear();if(!document.hidden&&navigator.onLine)void load();};
  const pause=()=>clear();
  const unsubscribe=browserPrivacy.subscribe(()=>{activeId.current=undefined;setScreen('list');clear();});
  const bus=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('origen-binder-sharing'):null;if(bus)bus.onmessage=resume;
  const timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void load(activeId.current,cursor,true);else clear();},25000);
  window.addEventListener('focus',resume);window.addEventListener('blur',pause);window.addEventListener('online',resume);window.addEventListener('offline',pause);document.addEventListener('visibilitychange',resume);
  return()=>{version.current++;clearInterval(timer);unsubscribe();bus?.close();window.removeEventListener('focus',resume);window.removeEventListener('blur',pause);window.removeEventListener('online',resume);window.removeEventListener('offline',pause);document.removeEventListener('visibilitychange',resume);};
 // Only route/filter changes start a new scoped session; language changes preserve it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[organizationId,query,cursor,grantId]);
 useEffect(()=>{if(seenRefresh.current!==refreshVersion){seenRefresh.current=refreshVersion;void load(activeId.current,cursor,true);}},[refreshVersion]);
 useEffect(()=>{if(openRequest)navigateWorkspace(()=>{setGrantId(openRequest.grantId);setTopic('summary');setCursor(null);});},[openRequest?.sequence]);
 useEffect(()=>{if(!binder)return;const timer=setTimeout(()=>{clear();setError('binder_unavailable');},Math.max(0,Math.min(2147483647,Date.parse(binder.expiresAt)-Date.now())));return()=>clearTimeout(timer);},[binder]);
 async function reviewed(){if(!binder)return;const v=++version.current;setBusy(true);try{await requestRef.current({action:'review',organizationId,grantId:binder.id,publicationId:binder.publicationId});if(v===version.current)await load();}catch(e){if(v===version.current){clear();setError((e as Error).message);}}finally{if(v===version.current)setBusy(false);}}
 const label=(id:string)=>{const x=topics.find(x=>x[0]===id);return x?t(x[1],x[2]):id;};
 const date=(v:string)=>new Date(v).toLocaleString(es?'es':'en',{dateStyle:'medium',timeStyle:'short'});
 const entries=binder?.entries||[];
 const staleListing=listingScope.current?.query!==query||listingScope.current?.cursor!==cursor;
 return <section ref={scene} className="coordinator-card coordinator-binders" aria-label={t('Shared binders','Carpetas compartidas')} aria-busy={busy}>
  {screen==='list'&&<><div className="coordinator-binders-heading"><div><span className="eyebrow">{t('SHARED WITH YOU','COMPARTIDO CONTIGO')}</span><h2 ref={listHeading} tabIndex={-1}>{t('Student binders','Carpetas de estudiantes')}</h2></div><button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh binders','Actualizar carpetas')}</button></div>
  <p>{t('Students choose the pages you can see. A connection alone does not share their binder.','Los estudiantes eligen las páginas que puedes ver. Una conexión por sí sola no comparte su carpeta.')}</p>
  <div className="coordinator-binder-list-tools"><span role="status">{listing?`${listing.counts.all} ${listing.counts.all===1?t('shared binder','carpeta compartida'):t('shared binders','carpetas compartidas')}`:error?t('Shared binders','Carpetas compartidas'):t('Loading shared binders…','Cargando carpetas compartidas…')}</span></div>
  <form className="coordinator-binder-search" onSubmit={e=>{e.preventDefault();if(busy)return;if(query===search.trim()&&cursor===null){void load(undefined,null);return;}navigateWorkspace(()=>{setCursor(null);setQuery(search.trim());setGrantId('');});}}><label>{t('Find a shared binder by name','Buscar una carpeta por nombre')}<input type="search" maxLength={80} value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="button outline" type="submit" disabled={busy}>{t('Search','Buscar')}</button>{query&&<button type="button" className="text-button" disabled={busy} onClick={()=>navigateWorkspace(()=>{setSearch('');setQuery('');setCursor(null);})}>{t('Clear search','Borrar búsqueda')}</button>}</form>
  </>}
  <span className="binder-loading-announcement" role="status">{busy?t('Checking shared access…','Comprobando el acceso…'):''}</span>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators"/>:<p role="alert">{error==='coordinator_sharing_unavailable'?t('Binder viewing is paused. Refresh when access is available.','La vista de carpetas está en pausa. Actualiza cuando esté disponible.'):error==='binder_changed'?t('This request changed. Refresh the binder before trying again.','Esta solicitud cambió. Actualiza la carpeta antes de intentar de nuevo.'):error==='binder_unavailable'?t('This shared view is no longer available. Sharing may have ended or expired. Return to shared binders to refresh.','Esta vista ya no está disponible. El acceso pudo finalizar o vencer. Vuelve a las carpetas para actualizar.'):t('Access could not be verified. Shared content has been cleared. Refresh or sign in again.','No se pudo verificar el acceso. Se borró el contenido compartido de esta vista. Actualiza o inicia sesión de nuevo.')}<button className="text-button" onClick={()=>{navigateWorkspace(()=>{setGrantId('');setCursor(null);},{guard:false});if(!grantId)void load(undefined,null);}}>{t('Return to shared binders','Volver a las carpetas')}</button></p>)}
  {screen==='list'&&<div className="coordinator-binder-results">{!listing&&!error&&<div className="coordinator-binder-list" aria-hidden="true"><div className="binder-card-placeholder"><i/><i/><i/><i/></div></div>}{listing&&<><div className="coordinator-binder-list">{listing.binders.map((b,index)=><button type="button" key={b.id} style={{'--binder-arrival-delay':`${Math.min(index,5)*35}ms`} as CSSProperties} data-binder-id={b.id} disabled={staleListing} onClick={()=>openBinder(b.id)}><span className="binder-card-identity"><CoordinatorStudentAvatar name={b.studentName}/><strong>{b.studentName}</strong></span><span>{b.topics.map(label).join(' · ')}</span><small>{t('Published','Publicado')} {date(b.publishedAt)}</small><span className="coordinator-binder-badges">{b.isNew&&<em>{t('New publication','Nueva publicación')}</em>}{b.helpRequested&&<em>{t('Help requested','Ayuda solicitada')}</em>}</span><span>{t('Open shared binder →','Abrir carpeta compartida →')}</span></button>)}</div>{listing.binders.length===0&&<p>{t('No shared binders match this view. Students must publish a selection before it appears here.','No hay carpetas para esta vista. Los estudiantes deben publicar una selección para que aparezca aquí.')}</p>}<div className="coordinator-binder-pagination">{cursor&&<button className="button outline" disabled={busy} onClick={()=>navigateWorkspace(()=>setCursor(null))}>{t('First page','Primera página')}</button>}{listing.nextCursor&&<button className="button outline" disabled={busy} onClick={()=>navigateWorkspace(()=>setCursor(listing.nextCursor))}>{t('Next page','Página siguiente')}</button>}</div></>}</div>}
  {screen==='binder'&&!error&&<div ref={binderShell} className={`coordinator-shared-binder personal-binder${!binder?' shared-binder-placeholder':''}`}>
   <div ref={toolbar} className="shared-binder-toolbar">
    <button type="button" className="button outline shared-binder-close" onClick={closeBinder}><X size={18} aria-hidden="true"/>{t('Close binder','Cerrar carpeta')}</button>
    <div className="shared-binder-identity">{binder?<><CoordinatorStudentAvatar name={binder.studentName}/><strong title={binder.studentName}>{binder.studentName}</strong></>:<span role="status">{t('Opening shared binder…','Abriendo carpeta compartida…')}</span>}</div>
    <label className="shared-binder-divider"><span>{t('Divider','Sección')}</span><select aria-label={t('Current divider','Sección actual')} value={topic} disabled={!binder} onChange={e=>changeTopic(e.target.value,true)}>{topics.filter(([id])=>id==='summary'||binder?.topics.includes(id)).map(([id,en,sp])=><option key={id} value={id}>{t(en,sp)}</option>)}</select></label>
    <button className="text-button shared-binder-refresh" aria-label={t('Refresh binder','Actualizar carpeta')} title={t('Refresh binder','Actualizar carpeta')} disabled={busy||!binder} onClick={()=>{if(canLeave())void load();}}><RefreshCw size={18} aria-hidden="true"/></button>
   </div>
   <header className="shared-binder-heading">{binder&&<CoordinatorStudentAvatar name={binder.studentName}/>}<div><span className="eyebrow">{t('SHARED BINDER','CARPETA COMPARTIDA')}</span><h3 ref={binderHeading} tabIndex={-1}>{binder?binder.studentName:<><span className="binder-loading-announcement">{t('Opening shared binder…','Abriendo carpeta compartida…')}</span><i className="shared-binder-name-placeholder" aria-hidden="true"/></>}</h3></div></header>
   {!binder&&<div className="binder-pages shared-binder-loading-paper" aria-hidden="true"><div className="shared-binder-placeholder-tabs"><i/><i/><i/><i/></div><div className="shared-binder-placeholder-paper"><i/><i/><i/></div></div>}
   {binder&&<div className="shared-binder-reading" key={binder.id}>
   {binder.message&&<aside className="coordinator-student-message"><strong>{t('A note from the student','Una nota del estudiante')}</strong><p>{binder.message}</p></aside>}
   <div className="binder-pages shared-binder-pages">
    <div className="binder-rings" aria-hidden="true"><i/><i/><i/></div>
    <div className="binder-topline"><span><BookOpen size={16} aria-hidden="true"/>{t('Shared pages','Páginas compartidas')} · {entries.length} {t('entries','notas')}</span>{binder.helpRequested&&<span className="shared-help-label">{t('Help requested','Ayuda solicitada')}</span>}</div>
    <nav className="notebook-topics coordinator-publication-topics" aria-label={t('Shared binder topics','Temas compartidos')} role="tablist">{topics.filter(([id])=>id==='summary'||binder.topics.includes(id)).map(([id,en,sp])=>{const Icon=({summary:BookOpen,options:Compass,transfer:GraduationCap,costs:Wallet,applications:FilePenLine})[id]||BookOpen;return <button type="button" className={`notebook-topic divider-${id}`} role="tab" aria-selected={topic===id} aria-controls="shared-binder-page" id={`shared-tab-${id}`} key={id} onClick={()=>changeTopic(id)} onKeyDown={e=>{const available=topics.filter(([id])=>id==='summary'||binder.topics.includes(id));const index=available.findIndex(([key])=>key===id);const next=e.key==='ArrowRight'?available[(index+1)%available.length]:e.key==='ArrowLeft'?available[(index+available.length-1)%available.length]:e.key==='Home'?available[0]:e.key==='End'?available[available.length-1]:null;if(next){e.preventDefault();if(navigateWorkspace(()=>setTopic(next[0])))document.getElementById(`shared-tab-${next[0]}`)?.focus();}}} tabIndex={topic===id?0:-1}><span className="notebook-tab-icon"><Icon size={19} aria-hidden="true"/></span><span><strong>{t(en,sp)}</strong><small>{id==='summary'?t('Shared contents','Contenido compartido'):`${entries.filter(e=>e.topic===id).length} ${t('entries','notas')}`}</small></span></button>;})}</nav>
    <section className={`notebook-panel coordinator-publication-page divider-${topic}`} id="shared-binder-page" role="tabpanel" aria-labelledby={`shared-tab-${topic}`} tabIndex={0}>
     <div className="notebook-panel-heading"><div><span className="shared-page-kicker">{binder.studentName} · {t('Shared selection','Selección compartida')}</span><h3 ref={pageHeading} tabIndex={-1} className="shared-divider-heading">{label(topic)}</h3></div></div>
     {topic==='summary'?<div className="shared-notebook-overview">{binder.topics.map(id=>{const shared=entries.filter(e=>e.topic===id);return shared.length>0&&<section className={`shared-notebook-topic divider-${id}`} key={id}><h4><button className="text-button" onClick={()=>changeTopic(id,true)}>{label(id)} <span aria-hidden="true">→</span></button></h4>{shared.map(e=><p className="notebook-note-content" lang={e.language} key={e.id}>{e.content}</p>)}</section>;})}{entries.length===0&&<p>{t('No entries are currently shared.','No hay notas compartidas actualmente.')}</p>}</div>:!feedbackRequest&&entries.filter(e=>e.topic===topic).map(e=><article className="coordinator-published-note notebook-note" key={e.id} lang={e.language}><p className="notebook-note-content">{e.content}</p></article>)}
     {topic!=='summary'&&!entries.some(e=>e.topic===topic)&&<p>{t('No entries are currently shared in this topic. They may have been edited or withdrawn.','No hay notas compartidas en este tema. Pueden haberse editado o retirado.')}</p>}
     {feedbackRequest&&topic!=='summary'&&<GuidancePanel key={binder.id+':'+binder.publicationId+':'+topic} organizationId={organizationId} grantId={binder.id} publicationId={binder.publicationId} topic={topic} entries={entries} request={feedbackRequest} t={t} paper onDraftChange={onDraftChange}/>}
     <footer className="shared-paper-footer"><span>{t('Only the student’s shared selection','Solo la selección compartida del estudiante')}</span><button type="button" className="text-button" disabled={busy||!binder.isNew} onClick={()=>{if(canLeave())void reviewed();}}><Check size={15} aria-hidden="true"/>{binder.isNew?t('Mark reviewed','Marcar como revisado'):t('Reviewed','Revisado')}</button></footer>
    </section>
   </div>
   </div>}
  </div>}
 </section>;
}
