import OutcomeObservations from './OutcomeObservations';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useNavigationGuard,confirmWorkspaceNavigation} from './workspaceNavigation';
import CoordinatorSectionHeader from './CoordinatorSectionHeader';
import CoordinatorStudentAvatar from './CoordinatorStudentAvatar';
import StaffVerification,{getStaffAccessToken,staffVerificationErrors} from './StaffVerification';
import './CoordinatorReviewRequests.css';
import RelatedReviewResponse,{type RelatedResponse} from './RelatedReviewResponse';
type T=(en:string,es:string)=>string;
type ResponseRecord={version:number;status:'available'|'withdrawn';guidance:string;suggestedAction:string;resourceUrl:string;followUpOn:string|null;updatedAt:string};
type Row={outcomeReviewEnabled?:boolean;outcomeObservationCount?:number;relatedResponse?:RelatedResponse;id:string;publicationId:string;studentName:string;kind:string;submittedAt:string;expiresAt:string;openedAt:string|null;reviewedAt:string|null;responseStatus?:string;response?:ResponseRecord|null;question?:string;language?:string;entries?:{id:string;content:string;language:string;topic:string}[]};
type Form={guidance:string;suggestedAction:string;resourceUrl:string;followUpOn:string};
const empty=():Form=>({guidance:'',suggestedAction:'',resourceUrl:'',followUpOn:''});
const formFor=(r?:ResponseRecord|null):Form=>r?.status==='available'?{guidance:r.guidance,suggestedAction:r.suggestedAction,resourceUrl:r.resourceUrl,followUpOn:r.followUpOn||''}:empty();
export default function CoordinatorReviewRequests({organizationId,t,es,refreshVersion=0,openRequest,onDirtyChange,request:provided}:{organizationId:string;t:T;es:boolean;refreshVersion?:number;openRequest?:{id:string;sequence:number};onDirtyChange?:(value:boolean)=>void;request?:(input:Record<string,unknown>)=>Promise<any>}){
 const {getAccessTokenSilently}=useAuth0();
 const [list,setList]=useState<{enabled:boolean;requests:Row[];nextCursor:string|null}>(),[active,setActive]=useState<Row>(),[form,setForm]=useState<Form>(empty),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[expanded,setExpanded]=useState(false);
 const [evidenceState,setEvidenceState]=useState({dirty:false,locked:false});
 const evidenceChanged=useCallback((_id:string,state:{dirty:boolean;locked:boolean})=>setEvidenceState(old=>old.dirty===state.dirty&&old.locked===state.locked?old:state),[]);
 const epoch=useRef(0),loadVersion=useRef(0),locked=useRef(false),activeId=useRef(''),formDirty=useRef(false),heading=useRef<HTMLHeadingElement>(null),operation=useRef<Record<string,unknown>|undefined>(undefined);
 const dirty=!!active&&JSON.stringify(form)!==JSON.stringify(formFor(active.response));formDirty.current=dirty;
 const activeRef=useRef(active);activeRef.current=active;
 useNavigationGuard(dirty||uncertain||evidenceState.dirty,{locked:busy||evidenceState.locked});
 useEffect(()=>{onDirtyChange?.(dirty||uncertain||evidenceState.dirty);return()=>onDirtyChange?.(false);},[dirty,uncertain,evidenceState.dirty,onDirtyChange]);
 async function request(input:Record<string,unknown>){
  if(provided)return provided(input);
  const lease=browserPrivacy.capture();try{
   const token=await getStaffAccessToken(()=>getAccessTokenSilently());lease.assert();
   const r=await apiFetch('/api/coordinator-review-requests',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(10000)])});
   const result=await r.json();lease.assert();if(!r.ok)throw Object.assign(new Error(result.error||'review_unavailable'),{status:r.status});return result;
  }finally{lease.release();}
 }
 const requestRef=useRef(request);requestRef.current=request;
 function clear(){epoch.current++;loadVersion.current++;locked.current=false;activeId.current='';operation.current=undefined;setActive(undefined);setForm(empty());setList(undefined);setBusy(false);setUncertain(false);setNotice('');}
 async function load(id=activeId.current,before?:string,replaceDraft=false){
  if(!browserPrivacy.valid()||document.hidden||!navigator.onLine)return;
  const v=epoch.current,n=++loadVersion.current;
  // Private content has a bounded verification window even if a fetch hangs.
  const deadline=setTimeout(()=>{if(v===epoch.current&&n===loadVersion.current){clear();setError('review_unavailable');}},5000);
  try{
   const result=await requestRef.current({action:id?'read':'list',organizationId,...(id?{id}:before?{before}:{})});
   if(v!==epoch.current||n!==loadVersion.current)return;
   if(id){
    if(!replaceDraft&&formDirty.current&&(activeRef.current?.response?.version||0)!==(result.response?.version||0)){setUncertain(true);setError('review_changed');}
    setActive(result);if(replaceDraft||!formDirty.current){setForm(formFor(result.response));operation.current=undefined;}if(Date.parse(result.expiresAt)<=Date.now()){clear();setError('review_unavailable');return;}
   }
   else setList(old=>before?{...result,requests:[...(old?.requests||[]).filter(r=>!result.requests.some((x:Row)=>x.id===r.id)),...result.requests]}:result);
   if(replaceDraft){setUncertain(false);setError('');}else if(!operation.current&&!formDirty.current&&!uncertain)setError('');
   return true;
  }catch(e){if(v===epoch.current&&n===loadVersion.current){clear();setError((e as Error).message);}}
  finally{clearTimeout(deadline);}
 }
 const loadRef=useRef(load);loadRef.current=load;
 useEffect(()=>{
  clear();void loadRef.current('');
  const pause=()=>{clear();setError('');},resume=()=>{if(document.hidden||!navigator.onLine)pause();else void loadRef.current();};
  const stop=browserPrivacy.subscribe(pause);const timer=setInterval(()=>{if(!locked.current)void loadRef.current();},15000);
  window.addEventListener('blur',pause);window.addEventListener('focus',resume);window.addEventListener('offline',pause);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{epoch.current++;loadVersion.current++;stop();clearInterval(timer);window.removeEventListener('blur',pause);window.removeEventListener('focus',resume);window.removeEventListener('offline',pause);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
 },[organizationId]);
 useEffect(()=>{if(!locked.current)void loadRef.current();},[refreshVersion]);
 useEffect(()=>{if(!openRequest)return;clear();activeId.current=openRequest.id;setExpanded(true);void loadRef.current(openRequest.id);},[openRequest?.sequence]);
 useEffect(()=>{
  if(!active)return;let timer:ReturnType<typeof setTimeout>;
  // Thirty-day grants exceed the browser's signed 32-bit timeout limit.
  const arm=()=>{const remaining=Date.parse(active.expiresAt)-Date.now();if(remaining<=0){clear();setError('review_unavailable');}else timer=setTimeout(arm,Math.min(remaining,2147483647));};
  arm();return()=>clearTimeout(timer);
 },[active?.id,active?.expiresAt]);
 useEffect(()=>{if(active){heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'nearest'});}},[active?.id]);
 function open(id:string){if(locked.current||!confirmWorkspaceNavigation())return;epoch.current++;operation.current=undefined;setUncertain(false);setActive(undefined);setForm(empty());activeId.current=id;setExpanded(true);void load(id);}
 function back(){if(locked.current||!confirmWorkspaceNavigation())return;clear();void load('');}
 async function write(action:'review'|'respond'|'withdraw-response'){
  if(locked.current||!active||uncertain)return;
  const v=epoch.current;locked.current=true;loadVersion.current++;setBusy(true);setError('');setNotice('');
  const body={action,organizationId,id:active.id,publicationId:active.publicationId,...(action==='review'?{}:{version:active.response?.version||0,operationId:crypto.randomUUID(),...(action==='respond'?form:{})})};operation.current=body;
  try{
   const result=await requestRef.current(body);if(v!==epoch.current)return;
   operation.current=undefined;setUncertain(false);
   if(action==='review')setActive(result);else{setActive(old=>old?{...old,response:result.response}:old);setForm(formFor(result.response));}
   setNotice(action==='review'?t('Marked reviewed. No student outcome was recorded.','Marcada como revisada. No se registró un resultado del estudiante.'):action==='respond'?t('Response saved in the student’s binder. This does not mean they have read it or acted on it.','Respuesta guardada en la carpeta del estudiante. Esto no significa que la haya leído o que haya actuado.'):t('Your response was withdrawn.','Retiraste tu respuesta.'));
  }catch(e){if(v===epoch.current){const status=(e as {status?:number}).status;if(!status||status>=500){setUncertain(true);setError('outcome_unknown');}else{clear();setError((e as Error).message);}}}
  finally{if(v===epoch.current){locked.current=false;setBusy(false);}}
 }
 async function check(){
  if(locked.current||!active)return;const v=epoch.current;locked.current=true;setBusy(true);
  try{if(await load(active.id,undefined,true))setNotice(t('Showing the latest saved record. Check it before submitting again.','Se muestra el registro guardado más reciente. Revísalo antes de volver a enviar.'));}
  finally{if(v===epoch.current){locked.current=false;setBusy(false);}}
 }
 const state=(r:Row)=>r.response?.status==='available'||r.responseStatus==='available'?t('Responded','Con respuesta'):r.reviewedAt?t('Reviewed','Revisada'):r.openedAt?t('Opened','Abierta'):t('New request','Solicitud nueva');
 if(list?.enabled===false&&!active&&!error)return null;
 return <section className="coordinator-card coordinator-review-requests" aria-busy={busy}>
  <CoordinatorSectionHeader title={t('Student review requests','Solicitudes de revisión')} description={t('Questions and notes each student explicitly approved for you.','Preguntas y notas que cada estudiante aprobó compartir contigo.')} actions={<button className="button outline" disabled={busy} onClick={()=>{if(active){back();return;}if(!confirmWorkspaceNavigation())return;setExpanded(!expanded);void load('');}}>{active?t('All requests','Todas las solicitudes'):expanded?t('Collapse requests','Ocultar solicitudes'):t('View requests','Ver solicitudes')}{!active&&list?` · ${list.requests.length}${list.nextCursor?'+':''}`:''}</button>}/>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators"/>:<p role="alert">{error==='review_changed'?t('This response changed in another session. Check the saved record before continuing.','Esta respuesta cambió en otra sesión. Comprueba el registro guardado antes de continuar.'):uncertain?t('The save result is uncertain. Check the saved record before continuing.','No se pudo confirmar el resultado. Comprueba el registro guardado antes de continuar.'):t('This request changed or access could not be verified. Refresh to check again.','La solicitud cambió o no se pudo verificar el acceso. Actualiza para comprobarlo.')} <button className="text-button" disabled={busy} onClick={()=>void (uncertain?check():load(''))}>{uncertain?t('Check saved response','Comprobar respuesta guardada'):t('Refresh requests','Actualizar solicitudes')}</button></p>)}
  {notice&&<p role="status">{notice}</p>}
  {expanded&&!active&&list&&<div className="coordinator-review-list">{!list.requests.length&&<p>{t('No approved requests are available yet.','Todavía no hay solicitudes aprobadas disponibles.')}</p>}{list.requests.map(r=><button className="coordinator-review-row" key={r.id} onClick={()=>open(r.id)}><CoordinatorStudentAvatar name={r.studentName}/><span><strong>{r.studentName}</strong><small>{state(r)} · {new Date(r.submittedAt).toLocaleDateString(es?'es':'en')}</small></span><span aria-hidden="true">→</span></button>)}{list.nextCursor&&<button className="button outline" onClick={()=>void load('',list.nextCursor!)}>{t('Older requests','Solicitudes anteriores')}</button>}</div>}
  {active&&<div className="coordinator-review-detail">
   <h3 ref={heading} tabIndex={-1}>{active.studentName} · {state(active)}</h3>
   {active.kind==='student-update'&&<p className="coordinator-review-meta">{t('Student-reported update · Not institution-verified. This is the wording the student approved sharing. Delivery and review do not verify completion or resolution.','Actualización reportada por el estudiante · No verificada por la institución. Esta es la redacción que el estudiante aprobó compartir. La entrega y revisión no verifican que la acción se completó o que el asunto se resolvió.')}</p>}
     <p className="coordinator-review-question" lang={active.language}>{active.question}</p>
   <RelatedReviewResponse value={active.relatedResponse} t={t} onOpen={open}/>
   <h4>{t('Notes the student included','Notas que incluyó el estudiante')}</h4>{!active.entries?.length&&<p>{active.relatedResponse?t('No additional notes were included.','No se incluyeron notas adicionales.'):t('The student shared only this question.','El estudiante compartió solo esta pregunta.')}</p>}
   {active.entries?.map(n=><p key={n.id} className="coordinator-review-note" lang={n.language}>{n.content}</p>)}
   <p className="coordinator-review-context">{t('Access ends','El acceso termina')} {new Date(active.expiresAt).toLocaleDateString(es?'es':'en')}. {t('Other notes and conversations remain private.','Las demás notas y conversaciones siguen privadas.')}</p>
   {!active.reviewedAt&&<button className="button outline" disabled={busy||uncertain||evidenceState.dirty||evidenceState.locked} onClick={()=>void write('review')}>{t('Mark reviewed','Marcar como revisada')}</button>}
   {active.response?.status==='withdrawn'?<p>{t('This response was withdrawn. It cannot be republished by retrying.','Esta respuesta fue retirada. No puede volver a publicarse al reintentar.')}</p>:<form onSubmit={e=>{e.preventDefault();void write('respond');}}>
    <h4>{t('My response to this request','Mi respuesta a esta solicitud')}</h4>
    <fieldset disabled={busy||uncertain||evidenceState.dirty||evidenceState.locked}>
     <label>{t('Guidance','Orientación')}<textarea required maxLength={2000} value={form.guidance} onChange={e=>setForm({...form,guidance:e.target.value})}/></label>
     <label>{t('Suggested next action (optional)','Próxima acción sugerida (opcional)')}<textarea maxLength={1000} value={form.suggestedAction} onChange={e=>setForm({...form,suggestedAction:e.target.value})}/></label>
     <label>{t('Resource link (optional)','Enlace de referencia (opcional)')}<input type="url" placeholder="https://" maxLength={2000} value={form.resourceUrl} onChange={e=>setForm({...form,resourceUrl:e.target.value})}/></label>
     <label>{t('Suggested follow-up date (optional)','Fecha sugerida para seguimiento (opcional)')}<input type="date" value={form.followUpOn} onChange={e=>setForm({...form,followUpOn:e.target.value})}/></label>
     <p>{t('The date is a suggestion. It does not schedule a reminder or mark an action complete.','La fecha es una sugerencia. No programa un recordatorio ni marca una acción como completada.')}</p>
     <button className="button primary" disabled={!form.guidance.trim()||!dirty}>{active.response?t('Save revised response','Guardar respuesta revisada'):t('Share response with student','Compartir respuesta con estudiante')}</button>
     {active.response?.status==='available'&&<button type="button" className="text-button" onClick={()=>{if(window.confirm(t('Withdraw this response from the student’s binder?','¿Retirar esta respuesta de la carpeta del estudiante?')))void write('withdraw-response');}}>{t('Withdraw response','Retirar respuesta')}</button>}
    </fieldset>
   </form>}
   {(active.outcomeReviewEnabled||!!active.outcomeObservationCount)&&<OutcomeObservations staff organizationId={organizationId} requestId={active.id} publicationId={active.publicationId} question={active.question} entries={active.entries} language={es?'es':'en'} blocked={busy||uncertain||dirty} onStateChange={evidenceChanged}/>}
  </div>}
 </section>;
}
