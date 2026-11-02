import OutcomeObservations from './OutcomeObservations';
import ReviewResponseChoices from './ReviewResponseChoices';
import RelatedReviewResponse,{type RelatedResponse} from './RelatedReviewResponse';
import type {ReviewResponseReference} from './reviewResponseConnection.mjs';
import type {ActionSeed} from './ActionPlan';
import {useCallback,createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowLeft,NotebookPen,RefreshCw,X} from 'lucide-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useDialogSurface} from './useDialogSurface';
import {useNavigationGuard} from './workspaceNavigation';
import {useBinderNavigationGuard} from './useBinderFollow';
import CoordinatorConnection from './CoordinatorConnection';
import './StudentReviewRequests.css';
import './CoordinatorReviewRequests.css';

type T=(en:string,es:string)=>string;
type Entry={id:string;version:number;topic:string;kind:string;language:string;content:string};
type Recipient={id:string;coordinatorName:string;organizationName:string};
type CoordinatorReview={openedAt:string|null;reviewedAt:string|null;response:null|{version:number;status:'available'|'withdrawn';guidance:string;suggestedAction:string;resourceUrl:string;followUpOn:string|null;updatedAt:string}};
type RequestRecord={outcomeObservationCount?:number;relatedResponse?:RelatedResponse|null;coordinatorReview?:CoordinatorReview;id:string;version:number;studentId:string;status:'draft'|'cancelled'|'submitted'|'withdrawn';originalQuestion:string;proposedClarification:string;kind:string;language:string;createdAt:string;submittedAt:string|null;recipient:{connectionId:string;coordinatorName:string;organizationName:string};entries:{id:string;version:number}[];publication:null|{wording:'original'|'clarification';access:'active'|'unavailable';notification:string;expiresAt:string;openedAt?:string|null;reviewedAt?:string|null;responded?:boolean}};
type Preview={id:string;digest:string;expiresAt:string;accessExpiresAt:string;selection:{kind:string;relatedResponse?:RelatedResponse;question:string;studentName:string;coordinatorName:string;organizationName:string;language:string;entries:Entry[]}};
type Activity=Pick<RequestRecord,'id'|'status'|'recipient'|'publication'|'createdAt'>&{entryId:string};
type List={studentUpdatesEnabled?:boolean;enabled:boolean;available:boolean;deliveryEnabled:boolean;requests:RequestRecord[];nextCursor:string|null;activity:Activity[]};
type Options={connections:Recipient[];entries:Entry[]};
type Form={relatedResponse?:ReviewResponseReference;question:string;connectionId:string;kind:string;entries:{id:string;version:number}[]};
const emptyForm=():Form=>({question:'',connectionId:'',kind:'question',entries:[]});
const topics=[['options','College options','Opciones universitarias'],['transfer','Transfer & courses','Transferencia y cursos'],['costs','Paying for college','Pagar la universidad'],['applications','Applications','Solicitudes']];
const topicName=(id:string,t:T)=>{const x=topics.find(x=>x[0]===id);return x?t(x[1],x[2]):id;};
async function request(studentId:string,action:string,extra:Record<string,unknown>={}){
 const lease=browserPrivacy.capture({studentId});
 try{
  const response=await apiFetch('/api/review-requests',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,studentId,...extra}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(12000)])});
  const result=await response.json();lease.assert();if(!response.ok)throw Object.assign(new Error(result.error||'review_requests_unavailable'),{status:response.status});return result;
 }finally{lease.release();}
}
function statusText(r:Pick<RequestRecord,'status'|'recipient'|'publication'|'coordinatorReview'>,t:T){
 const name=r.recipient.coordinatorName;
 if(r.status==='draft')return t('My private draft — not shared.','Mi borrador privado; no se ha compartido.');
 if(r.status==='cancelled')return t('I cancelled this draft.','Cancelé este borrador.');
 if(r.status==='withdrawn')return t('I withdrew this request.','Retiré esta solicitud.');
 if(r.publication?.access!=='active')return t('I approved this request. Access has ended.','Aprobé esta solicitud. El acceso terminó.');
 if(r.publication.responded)return t(`${name} responded to my request.`,`${name} respondió a mi solicitud.`);
 if(r.publication.reviewedAt)return t(`${name} marked my request reviewed.`,`${name} marcó mi solicitud como revisada.`);
 if(r.publication.openedAt)return t(`${name} opened my request.`,`${name} abrió mi solicitud.`);
 if(r.publication.notification==='delivered')return t(`I asked ${name} to review this. My request was delivered.`,`Le pedí a ${name} que revisara esto. Mi solicitud fue entregada.`);
 if(r.publication.notification==='pending')return t(`I approved this for ${name}. Delivery is pending.`,`Aprobé esta solicitud para ${name}. La entrega está pendiente.`);
 return t(`I approved this for ${name}. Delivery is not confirmed.`,`Aprobé esta solicitud para ${name}. La entrega no está confirmada.`);
}
function useController(studentId:string,language:'en'|'es',t:T,onAction?: (seed:ActionSeed)=>void){
 const [list,setList]=useState<List>(),[options,setOptions]=useState<Options>(),[open,setOpen]=useState(false),[screen,setScreen]=useState<'history'|'compose'|'review'|'connect'>('history');
 const [form,setForm]=useState<Form>(emptyForm),[active,setActive]=useState<RequestRecord>(),[preview,setPreview]=useState<Preview>(),[approved,setApproved]=useState(false),[expired,setExpired]=useState(false);
 const [draftLanguage,setDraftLanguage]=useState(language);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[removeId,setRemoveId]=useState('');
 const [focusId,setFocusId]=useState('');
 const epoch=useRef(0),lock=useRef(false),channel=useRef<BroadcastChannel|null>(null),pendingCreate=useRef<Record<string,unknown>|undefined>(undefined),refreshVersion=useRef(0);
 const state=useRef({open,screen,active});state.current={open,screen,active};
 const refresh=async(append=false)=>{
  const v=epoch.current,rev=++refreshVersion.current;
  const data:List=await request(studentId,'list',append&&list?.nextCursor?{before:list.nextCursor}:{});
  if(v===epoch.current&&rev===refreshVersion.current)setList(old=>append?{...data,requests:[...(old?.requests||[]).filter(r=>!data.requests.some(n=>n.id===r.id)),...data.requests]}:data);
 };
 const clear=()=>{epoch.current++;refreshVersion.current++;lock.current=false;setBusy(false);setOptions(undefined);setPreview(undefined);setApproved(false);setActive(undefined);setForm(emptyForm());pendingCreate.current=undefined;setUncertain(false);setRemoveId('');setFocusId('');};
 useEffect(()=>{
  let alive=true;
  const reload=()=>{if(!document.hidden&&navigator.onLine&&!lock.current)void refresh().catch(()=>{if(alive)setError(t('Could not load review requests. Try refreshing.','No se pudieron cargar las solicitudes. Intenta actualizar.'));});};
  const invalidate=()=>{clear();setScreen('history');reload();};
  const privacy=()=>{clear();setList(undefined);setOpen(false);setError('');setNotice('');};
  const unsubscribe=browserPrivacy.subscribe(privacy);
  const bus=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('origen-review-requests'):null;channel.current=bus;if(bus)bus.onmessage=invalidate;
  const initial=epoch.current;void refresh().catch(()=>{if(alive&&initial===epoch.current&&browserPrivacy.valid())setError(t('Could not load review requests. Try refreshing.','No se pudieron cargar las solicitudes. Intenta actualizar.'));});
  window.addEventListener('origen-connections-changed',invalidate);window.addEventListener('origen-sharing-changed',invalidate);window.addEventListener('origen-review-requests-changed',reload);window.addEventListener('focus',reload);window.addEventListener('online',reload);
  const offline=()=>{setPreview(undefined);setApproved(false);if(state.current.screen==='review')setError(t('Reconnect, then prepare a fresh preview.','Vuelve a conectarte y prepara una vista previa nueva.'));};
  window.addEventListener('offline',offline);
  const timer=setInterval(reload,30000);
  return()=>{alive=false;epoch.current++;refreshVersion.current++;unsubscribe();clearInterval(timer);bus?.close();channel.current=null;window.removeEventListener('origen-connections-changed',invalidate);window.removeEventListener('origen-sharing-changed',invalidate);window.removeEventListener('origen-review-requests-changed',reload);window.removeEventListener('focus',reload);window.removeEventListener('online',reload);window.removeEventListener('offline',offline);};
 },[studentId]);
 useEffect(()=>{setExpired(false);if(!preview)return;const timer=setTimeout(()=>{setExpired(true);setApproved(false);},Math.max(0,Date.parse(preview.expiresAt)-Date.now()));return()=>clearTimeout(timer);},[preview]);
 useEffect(()=>{
  if(!preview?.selection.relatedResponse||!active)return;
  let alive=true,checking=false;const id=active.id,source=preview.selection.relatedResponse.source;
  const discard=()=>{if(!alive)return;setPreview(undefined);setApproved(false);setActive(undefined);setList(undefined);setScreen('history');setError(t('The response reference could not be verified. Open the current response and review a fresh request.','No se pudo verificar la referencia. Abre la respuesta vigente y revisa una solicitud nueva.'));};
  const check=async()=>{if(checking||lock.current)return;if(document.hidden||!navigator.onLine){discard();return;}checking=true;try{const result=await request(studentId,'get',{id});if(alive&&(result.request?.relatedResponse?.availability!=='current'||JSON.stringify(result.request.relatedResponse.source)!==JSON.stringify(source)))discard();}catch{discard();}finally{checking=false;}};
  const timer=setInterval(()=>void check(),5000),resume=()=>void check();window.addEventListener('focus',resume);window.addEventListener('offline',discard);document.addEventListener('visibilitychange',resume);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',resume);window.removeEventListener('offline',discard);document.removeEventListener('visibilitychange',resume);};
 },[preview?.id]);
 const replace=(r:RequestRecord)=>{setActive(r);setList(old=>{
  if(!old)return old;
  const activity=new Map((old.activity||[]).map(a=>[a.entryId,a]));
  for(const e of r.entries){const previous=activity.get(e.id);
   if(!previous||previous.id===r.id||r.createdAt>previous.createdAt||r.createdAt===previous.createdAt&&r.id>previous.id)activity.set(e.id,{entryId:e.id,id:r.id,createdAt:r.createdAt,status:r.status,recipient:r.recipient,publication:r.publication});
  }
  return {...old,requests:[r,...old.requests.filter(x=>x.id!==r.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)),activity:[...activity.values()]};
 });};
 const changed=()=>{channel.current?.postMessage('changed');};
 async function run(work:(v:number)=>Promise<void>){
  if(lock.current)return;lock.current=true;refreshVersion.current++;const v=epoch.current;setBusy(true);setError('');setNotice('');
  try{await work(v);}catch(e){if(v===epoch.current){const code=(e as Error).message;setError(code.endsWith('changed')?t('Something changed. Refresh your requests and prepare a new preview.','Algo cambió. Actualiza tus solicitudes y prepara una vista previa nueva.'):code==='review_request_denied'?t('Access changed. You can still manage your saved requests.','El acceso cambió. Aún puedes administrar tus solicitudes guardadas.'):code==='review_requests_paused'?t('New requests are paused. You can still withdraw or delete saved requests.','Las solicitudes nuevas están en pausa. Aún puedes retirar o eliminar las guardadas.'):t('We could not confirm the result. Refresh your requests before continuing.','No pudimos confirmar el resultado. Actualiza tus solicitudes antes de continuar.'));}}
  finally{if(v===epoch.current){lock.current=false;setBusy(false);}}
 }
 function close(){if(lock.current)return;clear();setOpen(false);setError('');setNotice('');}
 function show(){setFocusId('');setOpen(true);setScreen('history');setError('');void run(async()=>refresh());}
 function showRequest(id:string){setFocusId(id);setOpen(true);setScreen('history');void run(async v=>{const result=await request(studentId,'get',{id});if(v===epoch.current)replace(result.request);});}
 async function compose(seed?:Entry,revision?:RequestRecord,followup?:RequestRecord,update?:{source:ReviewResponseReference;wording:string}){
  const relatedResponse=update?.source||(followup?.coordinatorReview?.response?{kind:'review-response' as const,requestId:followup.id,responseVersion:followup.coordinatorReview.response.version}:revision?.relatedResponse?.source);
  if(revision?.relatedResponse&&!relatedResponse){setError(t('Open the current source response to prepare a new linked request.','Abre la respuesta de origen vigente para preparar una nueva solicitud vinculada.'));return;}
  if(lock.current)return;setFocusId('');setOpen(true);setScreen('compose');setOptions(undefined);setActive(undefined);setPreview(undefined);setApproved(false);pendingCreate.current=undefined;setUncertain(false);setForm(emptyForm());
  await run(async v=>{
   if(update){
    const result=await request(studentId,'get',{id:update.source.requestId});if(v!==epoch.current)return;
    const source:RequestRecord=result.request;
    if(source.publication?.access!=='active'||source.coordinatorReview?.response?.status!=='available'||source.coordinatorReview.response.version!==update.source.responseVersion)throw Error('review_request_source_changed');
    followup=source;
   }
   const next:Options=await request(studentId,'options');if(v!==epoch.current)return;
   const selected=seed&&next.entries.find(e=>e.id===seed.id&&e.version===seed.version);
   const previous=revision?.entries.filter(e=>next.entries.some(n=>n.id===e.id&&n.version===e.version))||[];
   const recipient=followup||revision;
   if(relatedResponse&&!next.connections.some(r=>r.id===recipient?.recipient.connectionId))throw Error('review_request_source_changed');
   setOptions(next);
   setDraftLanguage(revision?.language==='es'?'es':revision?'en':language);
   setForm({...(relatedResponse?{relatedResponse}:{}),question:update?.wording??revision?.originalQuestion??'',kind:update?'student-update':revision?.kind||'question',connectionId:recipient&&next.connections.some(r=>r.id===recipient.recipient.connectionId)?recipient.recipient.connectionId:next.connections.length===1?next.connections[0].id:'',entries:revision?previous:selected?[{id:selected.id,version:selected.version}]:[]});
   if(followup&&!update)setNotice(t('This is a new private question for the same coordinator. Review the earlier question and response reference before approving.','Esta es una pregunta privada nueva para el mismo coordinador. Revisa la pregunta anterior y la referencia a la respuesta antes de aprobar.'));
   if(update)setNotice(t('This starts a private draft for the same coordinator. Choose the exact words to share; approval comes after the preview.','Esto inicia un borrador privado para el mismo coordinador. Elige las palabras exactas que compartirás; la aprobación viene después de la vista previa.'));
   if(revision)setNotice(t('This will be a new draft. Your earlier request stays in your history.','Este será un borrador nuevo. La solicitud anterior permanece en tu historial.'));
   if(revision&&previous.length!==revision.entries.length)setError(t('Some previous notes changed or are unavailable. Choose the current notes you want to include.','Algunas notas anteriores cambiaron o ya no están disponibles. Elige las notas vigentes que quieras incluir.'));
   if(seed&&!selected)setError(t('That note changed or is not available to share. Choose a current note below.','Esa nota cambió o no está disponible para compartir. Elige una nota vigente abajo.'));
  });
 }
 async function prepare(r:RequestRecord,wording:'original'|'clarification'='original'){
  const v=epoch.current;const result=await request(studentId,'preview',{id:r.id,version:r.version,wording});
  if(v!==epoch.current)return;setActive(r);setPreview(result.preview);setApproved(false);setScreen('review');setUncertain(false);
 }
 async function save(review:boolean){await run(async v=>{
  const input=pendingCreate.current||{requestKey:crypto.randomUUID(),connectionId:form.connectionId,origin:'notebook',language:draftLanguage,kind:form.kind,originalQuestion:form.question,proposedClarification:'',entries:form.entries,...(form.relatedResponse?{relatedResponse:form.relatedResponse}:{})};
  pendingCreate.current=input;
  let result;try{result=await request(studentId,'create',input);}catch(e){if([400,403,404,409].includes((e as {status:number}).status))pendingCreate.current=undefined;throw e;}
  if(v!==epoch.current)return;pendingCreate.current=undefined;replace(result.request);changed();
  setScreen('history');setForm(emptyForm());
  if(review)await prepare(result.request);else{setScreen('history');setForm(emptyForm());setNotice(t('I saved a private draft. Nothing has been shared.','Guardé un borrador privado. No se ha compartido nada.'));}
 });}
 async function check(){if(!active)return;await run(async v=>{const result=await request(studentId,'get',{id:active.id});if(v!==epoch.current)return;replace(result.request);setUncertain(false);if(result.request.status!=='draft'){setScreen('history');setPreview(undefined);setApproved(false);}else setNotice(t('This is still a private draft. Review it before approving again.','Sigue siendo un borrador privado. Revísalo antes de aprobar de nuevo.'));});}
 async function submit(){if(!active||!preview||!approved||expired||uncertain)return;await run(async v=>{
  try{
   const result=await request(studentId,'submit',{id:active.id,version:active.version,previewId:preview.id,digest:preview.digest,confirmed:true});if(v!==epoch.current)return;
   replace(result.request);setPreview(undefined);setApproved(false);setScreen('history');setForm(emptyForm());changed();setNotice(statusText(result.request,t));
  }catch(e){if(v===epoch.current){setApproved(false);
   if([400,403,404,409].includes((e as {status:number}).status)){setPreview(undefined);setScreen('history');setError(t('This preview is no longer valid. Refresh and review the draft again, or write a revised request.','Esta vista previa ya no es válida. Actualiza y revisa el borrador de nuevo o escribe una solicitud revisada.'));}
   else{setUncertain(true);setError(t('Approval could not be confirmed. Check the saved request before trying again.','No se pudo confirmar la aprobación. Comprueba la solicitud guardada antes de intentar de nuevo.'));}
  }return;}
 });}
 async function manage(r:RequestRecord,action:'cancel'|'withdraw'|'remove'){await run(async v=>{
  const result=await request(studentId,action,{id:r.id,version:r.version});if(v!==epoch.current)return;
  if(action==='remove'){setList(old=>old?{...old,requests:old.requests.filter(x=>x.id!==r.id),activity:(old.activity||[]).filter(x=>x.id!==r.id)}:old);setActive(undefined);setFocusId('');void refresh().catch(()=>{});}else replace(result.request);
  setRemoveId('');setPreview(undefined);setScreen('history');changed();setNotice(action==='remove'?t('I deleted this request. My original notes are still in my binder.','Eliminé esta solicitud. Mis notas originales siguen en mi carpeta.'):statusText(result.request,t));
 });}
 useBinderNavigationGuard(open||busy);
 useNavigationGuard(open&&(!!form.question.trim()||form.entries.length>0||!!preview),{locked:busy,onLeave:close});
 const staleResponse=(id:string)=>{setList(old=>old?{...old,requests:old.requests.map(r=>r.id===id?{...r,coordinatorReview:r.coordinatorReview?{...r.coordinatorReview,response:null}:undefined}:r)}:old);void refresh().catch(()=>{});};
 const beginAction=onAction?(seed:ActionSeed)=>{close();onAction(seed);}:undefined;
 return {staleResponse,beginAction,studentId,language,t,list,options,open,screen,form,active,preview,approved,expired,busy,error,notice,uncertain,removeId,focusId,pending:!!pendingCreate.current,setRemoveId,setForm,setApproved,setScreen,setPreview,refresh,run,compose,show,showRequest,close,save,prepare,submit,check,manage};
}
type Controller=ReturnType<typeof useController>;
const Context=createContext<Controller|null>(null);
function ScopedProvider({studentId,language,t,children,onAction}:{studentId:string;language:'en'|'es';t:T;children:ReactNode;onAction?:(seed:ActionSeed)=>void}){const value=useController(studentId,language,t,onAction);return <Context.Provider value={value}>{children}</Context.Provider>;}
export function StudentReviewRequestsProvider(props:{studentId:string;language:'en'|'es';t:T;children:ReactNode;onAction?:(seed:ActionSeed)=>void}){
 const {user}=useAuth0();return <ScopedProvider key={`${user?.sub}:${props.studentId}`} {...props}/>;
}
export function StudentReviewRequestEntry({note}:{note:Entry&{status:string;origin:string;summaryId:string|null}}){
 const c=useContext(Context);if(!c)return null;
 const recent=c.list?.activity?.find(r=>r.entryId===note.id);
 const eligible=note.status==='saved'&&note.origin==='user'&&!note.summaryId;
 return <>{c.list?.enabled&&eligible&&<button type="button" className="text-button" disabled={c.busy} onClick={()=>void c.compose(note)}>{c.t('Ask my coordinator','Consultar a mi coordinador')}</button>}{recent&&<button type="button" className="review-request-margin" onClick={()=>c.showRequest(recent.id)}>{statusText(recent,c.t)}</button>}</>;
}
export function StudentReviewRequests({openRequest}:{openRequest?:{id:string;sequence:number}}={}){
 const c=useContext(Context);
 useEffect(()=>{if(c&&openRequest)c.showRequest(openRequest.id);},[openRequest?.sequence]);if(!c||!c.list?.enabled&&!c.list?.requests.length&&!c.open&&!c.error)return null;
 const {t}=c;
 return <section className="student-review-requests" aria-label={t('My review requests','Mis solicitudes de revisión')}>
  <div className="review-request-banner"><NotebookPen size={23} aria-hidden="true"/><div><h3>{t('A question for my coordinator','Una pregunta para mi coordinador')}</h3><p>{t('Keep track of what you ask, in your own words.','Guarda lo que preguntas, con tus propias palabras.')}</p></div><button type="button" className="button outline" aria-haspopup="dialog" onClick={c.show}>{t('My requests','Mis solicitudes')}{!!c.list?.requests.length&&<span aria-hidden="true"> · {c.list.requests.length}{c.list.nextCursor?'+':''}</span>}</button>{c.list?.enabled&&<button type="button" className="button primary" aria-haspopup="dialog" onClick={()=>void c.compose()}>{t('Write a request','Escribir una solicitud')}</button>}</div>
  {c.error&&!c.open&&<p role="status">{c.error}</p>}{c.open&&<RequestSheet c={c}/>}
 </section>;
}
function StudentUpdateDisclosure({t}:{t:T}){return <p className="review-request-context">{t('Student-reported update · Not institution-verified. This is a separate copy. Private edits or deletion won’t change it. To correct it, approve a revised draft; you can withdraw the earlier request.','Actualización reportada por mí · No verificada por la institución. Esta es una copia separada. Los cambios privados no la modifican ni la eliminan. Para corregirla, aprueba un borrador revisado; puedes retirar la solicitud anterior.')}</p>;}
export function StudentUpdateShare({source,wording='',disabled=false}:{source?:ReviewResponseReference|null;wording?:string;disabled?:boolean}){
 const c=useContext(Context);if(!c?.list?.studentUpdatesEnabled||!source)return null;
 return <button type="button" className="text-button" disabled={disabled||c.busy} onClick={()=>void c.compose(undefined,undefined,undefined,{source,wording})}>{c.t('Share an update','Compartir una actualización')}</button>;
}
function RequestSheet({c}:{c:Controller}){
 const {t,screen,form,preview,active,busy:requestBusy}=c;
 const [evidenceEdit,setEvidenceEdit]=useState<string|null>(null);
 const evidenceChanged=useCallback((id:string,state:{dirty:boolean;locked:boolean})=>setEvidenceEdit(old=>state.dirty||state.locked?id:old===id?null:old),[]);
 const busy=requestBusy||!!evidenceEdit;
 const discard=()=>screen!=='compose'||!form.question.trim()&&!form.entries.length||window.confirm(t('Leave this unsaved request? Any draft already saved stays in My requests.','¿Salir de esta solicitud sin guardar? Los borradores ya guardados permanecen en Mis solicitudes.'));
 const {ref,dismiss,dialogProps}=useDialogSurface({onDismiss:c.close,blocked:busy,beforeDismiss:discard});
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus({preventScroll:true});ref.current?.scrollTo({top:0,behavior:'instant'});},[screen,preview?.id]);
 const [visible,setVisible]=useState(5),[topic,setTopic]=useState('costs');
 const date=(value:string)=>new Date(value).toLocaleString(c.language==='es'?'es-US':'en-US',{dateStyle:'medium',timeStyle:'short'});
 const canSave=!!form.question.trim()&&!!form.connectionId&&form.entries.length<=20&&!busy&&!!c.options&&!!c.list?.enabled&&(form.kind!=='student-update'||!!c.list?.studentUpdatesEnabled);
 const historyRows=c.focusId?(c.list?.requests||[]).filter(r=>r.id===c.focusId):(c.list?.requests||[]).slice(0,visible);
 return createPortal(<dialog ref={ref} {...dialogProps} className="review-request-sheet" data-mobile-sheet aria-labelledby="review-request-title">
  <header><div><span className="review-request-eyebrow">{t('IN MY BINDER','EN MI CARPETA')}</span><h2 id="review-request-title" ref={heading} tabIndex={-1}>{screen==='review'?t('Review before approving','Revisa antes de aprobar'):screen==='compose'?t('What would I like reviewed?','¿Qué quiero que revisen?'):screen==='connect'?t('My coordinator connections','Mis conexiones con coordinadores'):t('My review requests','Mis solicitudes de revisión')}</h2></div><button type="button" className="review-request-close" disabled={busy} aria-label={t('Close requests','Cerrar solicitudes')} onClick={()=>void dismiss()}><X size={21}/></button></header>
  {screen!=='history'&&<button type="button" className="text-button" disabled={busy} onClick={()=>{if(!discard())return;c.setPreview(undefined);c.setApproved(false);c.setScreen('history');void c.run(async()=>c.refresh());}}><ArrowLeft size={16}/>{t('My requests','Mis solicitudes')}</button>}
  {c.error&&<p role="alert" className="review-request-error">{c.error}</p>}{c.notice&&<p role="status" className="review-request-notice">{c.notice}</p>}
  {screen==='history'&&<>
   {c.focusId&&<button className="text-button" disabled={busy} onClick={c.show}>{t('All my requests','Todas mis solicitudes')}</button>}
   <div className="review-request-actions"><button className="text-button" disabled={busy} onClick={()=>void c.run(async()=>c.refresh())}><RefreshCw size={15}/>{t('Refresh requests','Actualizar solicitudes')}</button>{c.list?.enabled&&<button className="button primary" disabled={busy} onClick={()=>void c.compose()}>{t('Write a request','Escribir una solicitud')}</button>}</div>
   {!c.list?.enabled&&<p>{t('New requests are paused. Your saved requests remain here to manage.','Las solicitudes nuevas están en pausa. Puedes administrar aquí las guardadas.')}</p>}
   {!c.list?.deliveryEnabled&&<p className="review-request-context">{t('Coordinator delivery is paused. New approvals stay queued. Check each request’s status below for earlier deliveries.','La entrega al coordinador está en pausa. Las nuevas aprobaciones quedan en espera. Consulta abajo el estado de cada solicitud para ver las entregas anteriores.')}</p>}
   {!c.list?.requests.length&&<p className="review-request-empty">{t('No requests yet. Start with one question.','Todavía no hay solicitudes. Comienza con una pregunta.')}</p>}
   <div className="review-request-history">{historyRows.map(r=><article key={r.id}>
    {r.kind==='student-update'&&<StudentUpdateDisclosure t={t}/>}
    <p className="review-request-writing" lang={r.language}>{r.publication?.wording==='clarification'?r.proposedClarification:r.originalQuestion}</p>
    <RelatedReviewResponse value={r.relatedResponse} t={t} onOpen={c.showRequest}/>
    <p className="review-request-recipient">{r.recipient.coordinatorName} · {r.recipient.organizationName}</p><p className="review-request-journal">{statusText(r,t)}</p><time dateTime={r.submittedAt||r.createdAt}>{date(r.submittedAt||r.createdAt)}</time>
    {r.coordinatorReview?.response&&<section className="review-request-response" aria-label={t('Coordinator response','Respuesta del coordinador')}>
     <h3>{t('My coordinator’s response','La respuesta de mi coordinador')}</h3>
     {r.coordinatorReview.response.status==='withdrawn'?<p>{t('My coordinator withdrew this response.','Mi coordinador retiró esta respuesta.')}</p>:<>
      <p>{r.coordinatorReview.response.guidance}</p>
      {r.coordinatorReview.response.suggestedAction&&<><h4>{t('Suggested next action','Próxima acción sugerida')}</h4><p>{r.coordinatorReview.response.suggestedAction}</p></>}
      {r.coordinatorReview.response.resourceUrl&&<a href={r.coordinatorReview.response.resourceUrl} target="_blank" rel="noopener noreferrer">{t('Open the shared resource','Abrir el recurso compartido')}</a>}
      {r.coordinatorReview.response.followUpOn&&<p>{t('Suggested follow-up date','Fecha sugerida para seguimiento')}: <time dateTime={r.coordinatorReview.response.followUpOn}>{new Date(r.coordinatorReview.response.followUpOn+'T00:00:00Z').toLocaleDateString(t('en','es'),{timeZone:'UTC'})}</time></p>}
      <p>{t('Any next step I choose stays private. Discussing this does not report an outcome.','Cualquier próximo paso que elija es privado. Hablar de esto no informa un resultado.')}</p>
      <ReviewResponseChoices studentId={c.studentId} source={{kind:'review-response',requestId:r.id,responseVersion:r.coordinatorReview.response.version}} question={r.originalQuestion} suggestedAction={r.coordinatorReview.response.suggestedAction} t={t} onAction={c.beginAction} onTalk={c.close} onStale={()=>c.staleResponse(r.id)} onFollowUp={()=>void c.compose(undefined,undefined,r)}/>
      <StudentUpdateShare source={{kind:'review-response',requestId:r.id,responseVersion:r.coordinatorReview.response.version}} disabled={busy}/>
      <small>{t('Updated','Actualizada')} {date(r.coordinatorReview.response.updatedAt)}</small>
     </>}
    </section>}
    {!!r.outcomeObservationCount&&<OutcomeObservations studentId={c.studentId} requestId={r.id} language={c.language} blocked={requestBusy||!!evidenceEdit&&evidenceEdit!==r.id} onStateChange={evidenceChanged}/>}
    <div className="review-request-actions">{r.status==='draft'&&<>{c.list?.enabled&&<button className="button outline" disabled={busy} onClick={()=>void c.run(async()=>c.prepare(r))}>{t('Review draft','Revisar borrador')}</button>}<button className="text-button" disabled={busy} onClick={()=>void c.manage(r,'cancel')}>{t('Cancel draft','Cancelar borrador')}</button></>}{r.status==='submitted'&&<button className="button outline" disabled={busy} onClick={()=>void c.manage(r,'withdraw')}>{t('Withdraw request','Retirar solicitud')}</button>}<button className="text-button" disabled={busy} onClick={()=>c.setRemoveId(r.id)}>{t('Delete request','Eliminar solicitud')}</button></div>
    {c.list?.enabled&&<button className="text-button" disabled={busy} onClick={()=>void c.compose(undefined,r)}>{t('Write revised draft','Escribir borrador revisado')}</button>}
    {c.removeId===r.id&&<div className="review-request-remove"><p>{t('Delete this request and its shared copy? Your original notes will stay in your binder.','¿Eliminar esta solicitud y su copia compartida? Tus notas originales seguirán en tu carpeta.')}</p><button className="button outline" disabled={busy} onClick={()=>c.setRemoveId('')}>{t('Keep request','Conservar solicitud')}</button><button className="button primary" disabled={busy} onClick={()=>void c.manage(r,'remove')}>{t('Confirm deletion','Confirmar eliminación')}</button></div>}
   </article>)}</div>
   {!c.focusId&&(visible<(c.list?.requests.length||0)||c.list?.nextCursor)&&<button className="button outline" disabled={busy} onClick={()=>{if(visible<(c.list?.requests.length||0))setVisible(n=>n+5);else void c.run(async()=>{await c.refresh(true);setVisible(n=>n+5);});}}>{t('Older requests','Solicitudes anteriores')}</button>}
  </>}
  {screen==='connect'&&<CoordinatorConnection studentId={c.studentId} t={t} embedded initiallyOpen/>}
  {screen==='compose'&&<>
   {form.kind==='student-update'&&<StudentUpdateDisclosure t={t}/>}
   <p>{t('Write your question, concern, or request for review. You will see exactly what will be shared before approving.','Escribe tu pregunta, inquietud o solicitud de revisión. Verás exactamente qué se compartirá antes de aprobar.')}</p>
   {!c.options&&<p role="status">{busy?t('Loading coordinators and notes…','Cargando coordinadores y notas…'):t('Your choices could not be loaded. Go back to your requests and try again.','No se pudieron cargar las opciones. Vuelve a tus solicitudes e intenta de nuevo.')}</p>}
   {c.options?.connections.length===0&&<aside><p>{t('First, connect with a coordinator and wait for them to accept.','Primero, conecta con un coordinador y espera a que acepte.')}</p><button className="button outline" onClick={()=>c.setScreen('connect')}>{t('Manage connections','Administrar conexiones')}</button></aside>}
   {!!c.options?.connections.length&&<form onSubmit={e=>{e.preventDefault();void c.save(true);}}>
    <fieldset disabled={busy||c.pending} className="review-request-fields"><label>{t('My coordinator','Mi coordinador')}<select required disabled={!!form.relatedResponse} value={form.connectionId} onChange={e=>c.setForm({...form,connectionId:e.target.value})}><option value="">{t('Choose a coordinator','Elige un coordinador')}</option>{c.options.connections.map(r=><option key={r.id} value={r.id}>{r.coordinatorName} · {r.organizationName}</option>)}</select></label>
    <label>{t('Request type','Tipo de solicitud')}<select disabled={form.kind==='student-update'} value={form.kind} onChange={e=>c.setForm({...form,kind:e.target.value})}><option value="question">{t('Question','Pregunta')}</option><option value="concern">{t('Concern','Inquietud')}</option><option value="review">{t('Review','Revisión')}</option>{form.kind==='student-update'&&<option value="student-update">{t('Student-reported update','Actualización reportada por mí')}</option>}</select></label>
    <label>{t('In my own words','Con mis propias palabras')}<textarea required maxLength={2000} rows={4} value={form.question} onChange={e=>c.setForm({...form,question:e.target.value})}/></label><small>{form.question.length}/2000</small>
    <details className="review-request-note-picker" open={form.entries.length>0||undefined}><summary>{t('Supporting notes (optional)','Notas de apoyo (opcional)')} · {form.entries.length}/20</summary>
     <p>{t('Choose saved notes you wrote. Only the checked notes will be included, in their original language.','Elige notas guardadas que escribiste. Solo se incluirán las marcadas, en su idioma original.')}</p>
     <label>{t('Topic','Tema')}<select value={topic} onChange={e=>setTopic(e.target.value)}>{topics.map(([id,en,es])=><option key={id} value={id}>{t(en,es)}</option>)}</select></label>
     {form.entries.length>0&&<div className="review-request-selected">{form.entries.map(e=><button type="button" key={e.id} onClick={()=>c.setForm({...form,entries:form.entries.filter(x=>x.id!==e.id)})}>{t('Remove note','Quitar nota')}: {c.options?.entries.find(x=>x.id===e.id)?.content.slice(0,70)} <X size={13}/></button>)}</div>}
     <div className="review-request-note-choices">{c.options.entries.filter(e=>e.topic===topic).map(e=><label key={e.id}><input type="checkbox" checked={form.entries.some(x=>x.id===e.id)} disabled={form.entries.length>=20&&!form.entries.some(x=>x.id===e.id)} onChange={event=>c.setForm({...form,entries:event.target.checked?[...form.entries,{id:e.id,version:e.version}]:form.entries.filter(x=>x.id!==e.id)})}/><span lang={e.language}>{e.content}</span></label>)}{!c.options.entries.some(e=>e.topic===topic)&&<p>{t('No eligible written notes in this topic. You can still ask your question without notes.','No hay notas escritas disponibles en este tema. Aún puedes hacer tu pregunta sin notas.')}</p>}</div>
    </details></fieldset>
    {c.pending&&<p role="status">{t('The save result is uncertain. Retry with the same draft to avoid a duplicate.','No se pudo confirmar si se guardó. Reintenta con el mismo borrador para evitar duplicados.')}</p>}
    <div className="review-request-actions"><button type="button" className="button outline" disabled={!canSave} onClick={()=>void c.save(false)}>{t('Save private draft','Guardar borrador privado')}</button><button type="submit" className="button primary" disabled={!canSave}>{busy?t('Preparing…','Preparando…'):c.pending?t('Retry this draft','Reintentar este borrador'):t('Preview request','Ver solicitud')}</button></div>
   </form>}
  </>}
  {screen==='review'&&preview&&active&&<>
   <div className="review-request-recipient-card"><span>{t('For','Para')}</span><strong>{preview.selection.coordinatorName}</strong><span>{preview.selection.organizationName}</span><small>{t('Student','Estudiante')}: {preview.selection.studentName}</small></div>
   <p className="review-request-writing review-request-question" lang={preview.selection.language}>{preview.selection.question}</p>
   {preview.selection.kind==='student-update'&&<StudentUpdateDisclosure t={t}/>}
   <RelatedReviewResponse value={preview.selection.relatedResponse} t={t}/>
   {active.proposedClarification&&<div className="review-request-actions"><button className="text-button" disabled={busy||c.uncertain} onClick={()=>void c.run(async()=>c.prepare(active,'original'))}>{t('Use my original words','Usar mis palabras originales')}</button><button className="text-button" disabled={busy||c.uncertain} onClick={()=>void c.run(async()=>c.prepare(active,'clarification'))}>{t('Preview proposed wording','Ver la redacción propuesta')}</button></div>}
   <button className="text-button" disabled={busy||c.uncertain} onClick={()=>void c.compose(undefined,active)}>{t('Edit before sharing','Editar antes de compartir')}</button>
   <h3>{t('Notes included','Notas incluidas')}</h3>{!preview.selection.entries.length&&<p>{preview.selection.relatedResponse?t('No notes attached. The response reference above is included.','Sin notas adjuntas. Se incluye la referencia a la respuesta que aparece arriba.'):t('Only my question. No notes attached.','Solo mi pregunta. Sin notas adjuntas.')}</p>}
   {preview.selection.entries.map(e=><article className="review-request-preview-note" key={e.id}><small>{topicName(e.topic,t)}</small><p lang={e.language}>{e.content}</p></article>)}
   <p>{t('Access ends','El acceso termina')} <time dateTime={preview.accessExpiresAt}>{date(preview.accessExpiresAt)}</time>. {t('You can withdraw earlier. Your other notes and conversations stay private.','Puedes retirar el acceso antes. Tus otras notas y conversaciones siguen privadas.')}</p>
   {!c.list?.deliveryEnabled&&<p className="review-request-context">{t('Approving saves this request in the queue. Your coordinator will not receive it until delivery becomes available.','Al aprobar, esta solicitud queda en espera. Tu coordinador no la recibirá hasta que la entrega esté disponible.')}</p>}
   {c.expired?<p role="status">{t('This preview expired. Prepare a fresh preview before approving.','Esta vista previa venció. Prepara una nueva antes de aprobar.')}</p>:<p className="review-request-expiry">{t('Preview valid until','Vista previa válida hasta')} {date(preview.expiresAt)}</p>}
   <label className="review-request-approval"><input type="checkbox" checked={c.approved} disabled={busy||c.expired||c.uncertain} onChange={e=>c.setApproved(e.target.checked)}/><span>{preview.selection.kind==='student-update'?t('I approve this exact update, these notes and this response reference for this coordinator.','Apruebo esta actualización exacta, estas notas y esta referencia a la respuesta para este coordinador.'):preview.selection.relatedResponse?t('I approve this exact question, these notes and this response reference for this coordinator.','Apruebo esta pregunta exacta, estas notas y esta referencia a la respuesta para este coordinador.'):t('I approve this exact question and these notes for this coordinator.','Apruebo esta pregunta exacta y estas notas para este coordinador.')}</span></label>
   <div className="review-request-actions">{c.uncertain?<button className="button primary" disabled={busy} onClick={()=>void c.check()}>{t('Check saved request','Comprobar solicitud guardada')}</button>:c.expired?<button className="button primary" disabled={busy} onClick={()=>void c.run(async()=>c.prepare(active))}>{t('Prepare new preview','Preparar nueva vista previa')}</button>:<button className="button primary" disabled={busy||!c.approved} onClick={()=>void c.submit()}>{busy?t('Saving approval…','Guardando aprobación…'):t('Approve request','Aprobar solicitud')}</button>}<button className="button outline" disabled={busy||c.uncertain} onClick={()=>{c.setPreview(undefined);c.setApproved(false);c.setScreen('history');}}>{t('Keep as private draft','Conservar como borrador privado')}</button></div>
  </>}
  {screen==='review'&&!preview&&<button className="button outline" disabled={busy} onClick={()=>c.setScreen('history')}>{t('Return to my requests','Volver a mis solicitudes')}</button>}
 </dialog>,document.body);
}
