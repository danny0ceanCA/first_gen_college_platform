import {OutcomeEvidence} from './OutcomeEvidence.tsx';
import {StudentUpdateShare} from './StudentReviewRequests';
import type {ReviewResponseReference} from './reviewResponseConnection.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useNavigationGuard} from './workspaceNavigation';
import {useBinderNavigationGuard} from './useBinderFollow';
import {privateUpdateReadback,reportLabels,type PrivateUpdatePayload,type PrivateUpdatePreview} from './followUpConversation.mjs';
import type {FollowUpTarget} from './studentFollowUp.mjs';
import './StudentFollowUp.css';
type T=(en:string,es:string)=>string;
type Saved={id:string;version:number;response_state:PrivateUpdatePayload['report']['responseState'];reported_action:PrivateUpdatePayload['report']['reportedAction'];reported_outcome:PrivateUpdatePayload['report']['reportedOutcome'];detail:string;helpfulness:PrivateUpdatePayload['report']['helpfulness'];occurred_on:string|null;time_zone:string;recorded_at:string};
type Data={enabled:boolean;canSave:boolean;planVersion:number;reports:Saved[]};
const blank=():PrivateUpdatePayload=>({report:{responseState:'answered',reportedAction:'unknown',reportedOutcome:'unknown',detail:'',helpfulness:null,occurredOn:null,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},planStatus:null});
export function PrivateFollowUpUpdates({studentId,target,planVersion,language,t,source,blocked=false}:{studentId:string;target:FollowUpTarget;planVersion:number;source?:ReviewResponseReference|null;language:'en'|'es';t:T;blocked?:boolean}){
 const [data,setData]=useState<Data|null>(null),[open,setOpen]=useState(false),[draft,setDraft]=useState<PrivateUpdatePayload|null>(null),[preview,setPreview]=useState<PrivateUpdatePreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [outcomeEditing,setOutcomeEditing]=useState<string|null>(null);
 const outcomeLock=useCallback((id:string,editing:boolean)=>setOutcomeEditing(current=>editing?id:current===id?null:current),[]);
 const epoch=useRef(0),active=useRef(false),lock=useRef(false),review=useRef<HTMLDivElement>(null),labels=reportLabels[language];
 useBinderNavigationGuard(busy||!!draft||!!preview);
 useNavigationGuard(!!draft||!!preview,{locked:busy,onLeave:()=>{setDraft(null);setPreview(null);}});
 async function request(body:Record<string,unknown>,path='/api/student-follow-up-report'){
  const lease=browserPrivacy.capture({studentId});try{const response=await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({...body,studentId}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(8000)])});const result=await response.json();lease.assert();if(!response.ok)throw Error('private_update_unavailable');return result;}finally{lease.release();}
 }
 async function load(){
  if(!active.current||lock.current)return;const n=++epoch.current;
  if(document.hidden||!navigator.onLine){setData(null);setPreview(null);return;}
  try{const result=await request({action:'load',target});if(active.current&&n===epoch.current){setData(result);if(!result.enabled||!result.canSave||result.planVersion!==planVersion){setPreview(null);setDraft(null);}}}
  catch{if(active.current&&n===epoch.current){setData(null);setPreview(null);}}
 }
 useEffect(()=>{
  active.current=true;setData(null);setPreview(null);setDraft(null);setError('');setNotice('');void load();
  const refresh=()=>{setPreview(null);void load();},clear=()=>{epoch.current++;setData(null);setPreview(null);},privacy=()=>{clear();setDraft(null);setNotice('');setError('');};
  const unsubscribe=browserPrivacy.subscribe(privacy),timer=setInterval(()=>{if(open)void load();},10000);
  window.addEventListener('origen-follow-up-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',refresh);
  return()=>{active.current=false;epoch.current++;unsubscribe();clearInterval(timer);window.removeEventListener('origen-follow-up-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',refresh);};
 },[studentId,target.planId,target.stepId,planVersion,language,open]);
 useEffect(()=>{if(preview)review.current?.focus({preventScroll:true});},[preview?.id]);
 async function run(body:Record<string,unknown>,path?:string){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const n=++epoch.current;
  try{const result=await request(body,path);if(!active.current||n!==epoch.current)return;
   if(body.action==='prepare')setPreview(result.preview);
   else{setPreview(null);setDraft(null);setNotice(body.action==='delete-report'?t('I deleted this private update. My action progress is unchanged.','Eliminé esta actualización privada. El progreso de mi acción no cambió.'):result.status==='superseded'?t('That update has changed. Review the current saved version.','Esa actualización cambió. Revisa la versión guardada actual.'):t('Saved privately. Nothing was shared with my coordinator.','Guardado de forma privada. No se compartió nada con mi coordinador.'));const saved=await request({action:'load',target});if(!active.current||n!==epoch.current)return;setData(saved);window.dispatchEvent(new Event('origen-follow-up-changed'));}
  }catch{if(active.current&&n===epoch.current){setPreview(null);setError(t('I couldn’t confirm this change. Check the saved updates before trying again.','No pude confirmar este cambio. Consulta las actualizaciones guardadas antes de intentarlo de nuevo.'));}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 if(!data||!data.enabled&&!data.reports.length)return null;
 const canSave=data.enabled&&data.canSave&&data.planVersion===planVersion&&!blocked,disabled=busy||blocked;
 const set=<K extends keyof PrivateUpdatePayload['report']>(key:K,value:PrivateUpdatePayload['report'][K])=>{setPreview(null);setDraft(d=>d?{...d,report:{...d.report,[key]:value}}:d);};
 const date=(value:string)=>new Intl.DateTimeFormat(language==='es'?'es-US':'en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value));
 return <section className="private-follow-up">
  <button type="button" className="text-button" aria-expanded={open} disabled={busy||!!draft||!!outcomeEditing} onClick={()=>setOpen(!open)}>{t('My private updates','Mis actualizaciones privadas')}{data.reports.length?` (${data.reports.length})`:''}</button>
  {open&&<div>
   <p>{t('If I separately approve sharing, that copy is managed in My requests. Correcting or deleting a private update here does not change an approved copy.','Si apruebo compartir por separado, esa copia se administra en Mis solicitudes. Corregir o eliminar aquí una actualización privada no cambia una copia aprobada.')}</p>
   <p>{t('What I report about this action stays in my account. Saving it does not share it or verify an outcome.','Lo que reporto sobre esta acción se queda en mi cuenta. Guardarlo no lo comparte ni verifica el resultado.')}</p>
   {!data.reports.length&&<p>{t('I haven’t saved an update yet.','Aún no he guardado una actualización.')}</p>}
   {data.reports.map(r=><article key={r.id} className="private-update-card">
    <p className="follow-up-note">{r.detail||labels[r.response_state]}</p>
    <dl><dt>{t('Action I reported','Acción que reporté')}</dt><dd>{r.reported_action?labels[r.reported_action]:t('Not recorded','Sin registrar')}</dd><dt>{t('Outcome I reported','Resultado que reporté')}</dt><dd>{r.reported_outcome?labels[r.reported_outcome]:t('Not recorded','Sin registrar')}</dd><dt>{t('Happened on','Ocurrió el')}</dt><dd>{r.occurred_on?date(r.occurred_on):t('Date not specified','Fecha no indicada')}</dd><dt>{t('Recorded on','Registrado el')}</dt><dd>{date(r.recorded_at)}</dd></dl>
    <small>{t('Student-reported · Private · Not institution-verified','Reportado por mí · Privado · No verificado por la institución')}</small>
    <div className="follow-up-buttons">{r.response_state==='answered'&&<StudentUpdateShare source={source} wording={r.detail} disabled={disabled||!!draft||!!outcomeEditing}/>} {canSave&&<button type="button" className="text-button" disabled={disabled||!!draft||!!outcomeEditing} onClick={()=>{setPreview(null);setDraft({report:{responseState:r.response_state,reportedAction:r.reported_action,reportedOutcome:r.reported_outcome,detail:r.detail,helpfulness:r.helpfulness,occurredOn:r.occurred_on,timeZone:r.time_zone},planStatus:null,reportId:r.id,reportVersion:r.version});}}>{t('Correct update','Corregir actualización')}</button>}<button type="button" className="text-button" disabled={disabled||!!draft||!!outcomeEditing} onClick={()=>{if(window.confirm(t('Delete this private update? This keeps the action’s current progress.','¿Eliminar esta actualización privada? Se conserva el progreso actual de la acción.')))void run({action:'delete-report',target,operationId:crypto.randomUUID(),reportId:r.id,revision:r.version},'/api/student-follow-up');}}>{t('Delete update','Eliminar actualización')}</button></div>
    <OutcomeEvidence studentId={studentId} target={target} planVersion={planVersion} report={r} language={language} source={source} onEditingChange={outcomeLock} blocked={disabled||!!draft||!!outcomeEditing&&outcomeEditing!==r.id}/>
   </article>)}
   {canSave&&!draft&&<button type="button" className="text-button" disabled={disabled||!!outcomeEditing} onClick={()=>{setDraft(blank());setNotice('');}}>{t('Write a private update','Escribir una actualización privada')}</button>}
   {draft&&canSave&&<form className="private-update-form" onSubmit={e=>{e.preventDefault();void run({action:'prepare',target,operationId:crypto.randomUUID(),planVersion,payload:draft,language});}}>
    <label>{t('What I want to record','Lo que quiero registrar')}<select aria-label={t('What I want to record','Lo que quiero registrar')} value={draft.report.responseState} disabled={disabled} onChange={e=>{const responseState=e.target.value as PrivateUpdatePayload['report']['responseState'];setPreview(null);setDraft({...draft,report:responseState==='answered'?{...blank().report,timeZone:draft.report.timeZone}:{...draft.report,responseState,reportedAction:null,reportedOutcome:null,detail:'',helpfulness:null,occurredOn:null}});}}>{['answered','declined','unknown'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
    {draft.report.responseState==='answered'&&<>
     <label>{t('In my own words','En mis propias palabras')}<textarea aria-label={t('In my own words','En mis propias palabras')} rows={3} maxLength={2000} value={draft.report.detail} disabled={disabled} onChange={e=>set('detail',e.target.value)}/></label>
     <label>{t('My action','Mi acción')}<select aria-label={t('My action','Mi acción')} value={draft.report.reportedAction||'unknown'} disabled={disabled} onChange={e=>set('reportedAction',e.target.value as PrivateUpdatePayload['report']['reportedAction'])}>{['unknown','not_started','attempted','completed','changed_course'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
     <label>{t('What happened with the issue','Qué pasó con el asunto')}<select aria-label={t('What happened with the issue','Qué pasó con el asunto')} value={draft.report.reportedOutcome||'unknown'} disabled={disabled} onChange={e=>set('reportedOutcome',e.target.value as PrivateUpdatePayload['report']['reportedOutcome'])}>{['unknown','pending','resolved','unresolved'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
     <label>{t('How helpful was the advice? (optional)','¿Qué tan útil fue el consejo? (opcional)')}<select aria-label={t('How helpful was the advice? (optional)','¿Qué tan útil fue el consejo? (opcional)')} value={draft.report.helpfulness||''} disabled={disabled} onChange={e=>set('helpfulness',(e.target.value||null) as PrivateUpdatePayload['report']['helpfulness'])}><option value="">{t('Leave unrecorded','Dejar sin registrar')}</option>{['helpful','partly_helpful','not_helpful','unknown'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
     <label>{t('Date it happened (optional)','Fecha en que ocurrió (opcional)')}<input aria-label={t('Date it happened (optional)','Fecha en que ocurrió (opcional)')} type="date" value={draft.report.occurredOn||''} disabled={disabled} onChange={e=>set('occurredOn',e.target.value||null)}/></label>
    </>}
    <label>{t('Time zone','Zona horaria')}<input aria-label={t('Time zone','Zona horaria')} value={draft.report.timeZone} maxLength={100} required disabled={disabled} onChange={e=>set('timeZone',e.target.value)}/></label>
    <label>{t('Action progress','Progreso de la acción')}<select aria-label={t('Action progress','Progreso de la acción')} value={draft.planStatus||''} disabled={disabled} onChange={e=>{setPreview(null);setDraft({...draft,planStatus:e.target.value||null});}}><option value="">{t('Keep current progress','Conservar el progreso actual')}</option>{['not-started','in-progress','complete','deferred'].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label>
    <p>{t('Completing an action does not mean the issue was resolved.','Completar una acción no significa que el asunto se haya resuelto.')}</p>
    <div className="follow-up-buttons"><button className="button outline" type="submit" disabled={disabled}>{t('Review my update','Revisar mi actualización')}</button><button className="text-button" type="button" disabled={busy} onClick={()=>{setDraft(null);setPreview(null);}}>{t('Cancel','Cancelar')}</button></div>
   </form>}
   {preview&&canSave&&<div className="follow-up-review" role="region" aria-label={t('Review private update','Revisar actualización privada')} tabIndex={-1} ref={review}><p>{privateUpdateReadback(preview,language,false)}</p><div className="follow-up-buttons"><button type="button" className="button outline" disabled={disabled||Date.parse(preview.expiresAt)<=Date.now()} onClick={()=>void run({action:'confirm',previewId:preview.id,digest:preview.digest,confirmed:true})}>{t('Save this private update','Guardar esta actualización privada')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>setPreview(null)}>{t('Keep editing','Seguir editando')}</button></div></div>}
   {notice&&<p role="status">{notice}</p>}{error&&<div role="alert"><p>{error}</p><button type="button" className="text-button" disabled={busy} onClick={()=>{setDraft(null);setPreview(null);setError('');void load();}}>{t('Check saved updates','Consultar actualizaciones guardadas')}</button></div>}
  </div>}
 </section>;
}
