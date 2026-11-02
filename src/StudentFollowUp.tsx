import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useNavigationGuard} from './workspaceNavigation';
import {useBinderNavigationGuard} from './useBinderFollow';
import type {FollowUpTarget,FollowUpSchedule,FollowUpState} from './studentFollowUp.mjs';
import './StudentFollowUp.css';

type T=(en:string,es:string)=>string;
type Item={target:FollowUpTarget;planVersion:number;state:FollowUpState;revision:number;pauseReason:string|null;schedule:FollowUpSchedule|null;canEnroll:boolean};
type Overview={enabled:boolean;items:Item[];remaining:number;pending:number};
type Preview={id:string;digest:string;expiresAt:string;language:'en'|'es';selection:{target:FollowUpTarget;planVersion:number;revision:number;action:{title:string;content:string;notes:string;dueDate:string|null};schedule:FollowUpSchedule;oneCheckIn:true;sharedWithCoordinator:false}};
type Input=Record<string,unknown>;
type Context={data:Overview|null;preview:Preview|null;busy:boolean;uncertain:boolean;stoppedAll:boolean;error:string;t:T;language:'en'|'es';run:(input:Input)=>Promise<void>;refresh:()=>void;discard:()=>void;retry:()=>void};
const FollowUpContext=createContext<Context|null>(null);
const same=(a:FollowUpTarget,b:FollowUpTarget)=>a.planId===b.planId&&a.stepId===b.stepId;
function localDay(timeZone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');}
function dateLabel(day:string,language:string){return new Intl.DateTimeFormat(language==='es'?'es-US':'en-US',{dateStyle:'long',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));}
async function request(studentId:string,input:Input){
 const lease=browserPrivacy.capture({studentId});
 try{const response=await apiFetch('/api/student-follow-up',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,studentId}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(8000)])});const value=await response.json();lease.assert();if(!response.ok)throw Object.assign(Error('follow_up_unavailable'),{status:response.status});return value;}
 finally{lease.release();}
}

// One bounded overview for all visible actions. No private state is persisted in
// browser storage; late requests cannot cross a student/account/privacy change.
export function StudentFollowUpProvider({studentId,language,t,children}:{studentId:string|null;language:'en'|'es';t:T;children:ReactNode}){
 const [data,setData]=useState<Overview|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Input|null>(null),[stoppedAll,setStoppedAll]=useState(false);
 const epoch=useRef(0),lock=useRef(false),active=useRef(false),previewRef=useRef(preview);previewRef.current=preview;
 const discard=()=>{setPreview(null);};
 useBinderNavigationGuard(busy||!!preview||!!pending);
 useNavigationGuard(!!preview||!!pending,{locked:busy,onLeave:()=>{discard();setPending(null);}});
 const failure=()=>t('I couldn’t confirm the saved check-in settings. Try again or check the saved state.','No pude confirmar la configuración guardada. Intenta de nuevo o consulta el estado guardado.');
 async function load(clear=false){
  if(!studentId||!active.current||lock.current)return;
  if(clear){setPending(null);setPreview(null);setError('');}
  if(document.hidden||!navigator.onLine){epoch.current++;setData(null);setPreview(null);return;}
  const n=++epoch.current;
  try{const next:Overview=await request(studentId,{action:'overview'});if(!active.current||n!==epoch.current)return;
   setData(next);if(next.remaining||next.pending)setStoppedAll(false);
   const p=previewRef.current,item=p&&next.items.find(i=>same(i.target,p.selection.target));
   if(p&&(!next.enabled||!item?.canEnroll||item.revision!==p.selection.revision||item.planVersion!==p.selection.planVersion||Date.parse(p.expiresAt)<=Date.now())){setPreview(null);setError(t('This action or permission changed. Review a fresh check-in choice.','Esta acción o el permiso cambió. Revisa una nueva opción de seguimiento.'));}
  }catch{if(active.current&&n===epoch.current){setData(null);setPreview(null);setError(failure());}}
 }
 useEffect(()=>{
  active.current=true;setData(null);setPreview(null);setPending(null);setError('');setStoppedAll(false);
  const clear=()=>{epoch.current++;setData(null);setPreview(null);if(!navigator.onLine)setError(failure());};
  const privacy=()=>{active.current=false;clear();setPending(null);setError('');setStoppedAll(false);};
  const refresh=()=>{if(document.hidden){clear();return;}void load();};void load();const timer=setInterval(refresh,10000),unsubscribe=browserPrivacy.subscribe(event=>{if(event.type==='end')privacy();else{clear();refresh();}});
  window.addEventListener('origen-follow-up-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',refresh);
  return()=>{active.current=false;epoch.current++;clearInterval(timer);unsubscribe();window.removeEventListener('origen-follow-up-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',refresh);};
 },[studentId,language]);
 async function run(input:Input){
  if(lock.current||!studentId||!active.current)return;
  lock.current=true;setBusy(true);setError('');setStoppedAll(false);const n=++epoch.current;
  try{
   const result=await request(studentId,input);if(!active.current||n!==epoch.current)return;
   setPending(null);
   if(input.action==='prepare'){setPreview(result.preview);}
   else{
    setPreview(null);
    // A lost response or replay may describe a later stop; render only a fresh
    // server snapshot, never infer "scheduled" from clicking confirmation.
    const next=await request(studentId,{action:'overview'});if(active.current&&n===epoch.current){setData(next);setStoppedAll(input.action==='stop-all'&&!next.remaining&&!next.pending);}
   }
  }catch(e){if(active.current&&n===epoch.current){setData(null);setPreview(null);setError(failure());const status=(e as {status?:number}).status;setPending(!status||status>=500?input:null);}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 return <FollowUpContext.Provider value={{data,preview,busy,uncertain:!!pending,stoppedAll,error,t,language,run,refresh:()=>void load(true),discard,retry:()=>{if(pending)void run(pending);}}}>{children}</FollowUpContext.Provider>;
}

export function StudentFollowUpSettings(){
 const c=useContext(FollowUpContext);if(!c)return null;const {t,data,busy,error,uncertain,stoppedAll}=c;
 if(!data&&!error)return null;
 // Existing consent remains controllable when the enrollment capability is off.
 if(data&&!data.enabled&&!data.remaining&&!data.pending&&!error&&!stoppedAll)return null;
 return <aside className="student-follow-up-settings" aria-label={t('My check-in settings','Mi configuración de seguimiento')}>
  <div><strong>{t('My check-ins with Origen','Mis seguimientos con Origen')}</strong><p>{t('Private to my account. Stopping check-ins keeps my actions and notes.','Privados en mi cuenta. Detener el seguimiento conserva mis acciones y notas.')}</p></div>
  {stoppedAll&&data&&!data.remaining&&!data.pending&&<p role="status">{t('I stopped all my check-ins.','Detuve todos mis seguimientos.')}</p>}
  {data&&<><button type="button" className="text-button" disabled={busy} onClick={()=>void c.run({action:'stop-all',operationId:crypto.randomUUID()})}>{t('Stop all my check-ins','Detener todos mis seguimientos')}</button>
   {!data.remaining&&!data.pending&&<p role="status">{t('No check-ins are scheduled or paused in my account.','No hay seguimientos programados ni en pausa en mi cuenta.')}</p>}
   {!data.enabled&&<p>{t('New check-ins are currently unavailable. I can still stop mine.','Los nuevos seguimientos no están disponibles. Aún puedo detener los míos.')}</p>}</>}
  {error&&<div role="alert"><p>{error}</p><div className="follow-up-buttons">{uncertain&&<button type="button" className="text-button" disabled={busy} onClick={c.retry}>{t('Try again','Intentar de nuevo')}</button>}<button type="button" className="text-button" disabled={busy} onClick={c.refresh}>{t('Check saved state','Consultar estado guardado')}</button></div></div>}
  {busy&&<p role="status">{t('Checking with your account…','Consultando tu cuenta…')}</p>}
 </aside>;
}

export function StudentFollowUpAction({target,planVersion,blocked=false}:{target:FollowUpTarget;planVersion:number;blocked?:boolean}){
 const c=useContext(FollowUpContext),heading=useId(),[choosing,setChoosing]=useState(false),[day,setDay]=useState(''),[zone,setZone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone),[zoneError,setZoneError]=useState(false),review=useRef<HTMLDivElement>(null);
 const item=c?.data?.items.find(i=>same(i.target,target)),preview=c?.preview&&same(c.preview.selection.target,target)?c.preview:null;
 useEffect(()=>{if(preview){setChoosing(false);requestAnimationFrame(()=>review.current?.focus({preventScroll:true}));}},[preview?.id]);
 useEffect(()=>{setChoosing(false);setDay('');c?.discard();},[planVersion]);
 if(!c||!item||!c.data?.enabled&&item.state==='off')return null;
 const {t,language,busy}=c,disabled=busy||blocked||c.uncertain,canEnroll=item.canEnroll&&item.planVersion===planVersion&&!blocked;
 let min='';try{min=localDay(zone);}catch{/* Display validation beside the field before requesting a preview. */}
 const choose=(onOrAfter:string|null,timeZone=zone)=>{try{localDay(timeZone);setZoneError(false);void c.run({action:'prepare',target,operationId:crypto.randomUUID(),revision:item.revision,planVersion,schedule:{onOrAfter,timeZone},language});}catch{setZoneError(true);}};
 const saved=item.state==='scheduled'&&item.planVersion===planVersion;
 const sentence=saved?(item.schedule?.onOrAfter?t(`I asked Origen for one check-in when we next talk on or after ${dateLabel(item.schedule.onOrAfter,language)}.`,`Le pedí a Origen un seguimiento cuando volvamos a hablar a partir del ${dateLabel(item.schedule.onOrAfter,language)}.`):t('I asked Origen for one check-in the next time we talk.','Le pedí a Origen un seguimiento la próxima vez que hablemos.')):item.state==='paused'?t('My check-in is paused. I choose when to ask again.','Mi seguimiento está en pausa. Yo decido cuándo volver a pedirlo.'):item.state==='closed'?t('This check-in has ended. My action keeps its own progress.','Este seguimiento terminó. Mi acción conserva su propio progreso.'):item.state==='scheduled'?t('Checking my saved check-in…','Consultando mi seguimiento guardado…'):t('I haven’t scheduled a check-in for this action.','No tengo un seguimiento programado para esta acción.');
 return <section className="student-follow-up" aria-labelledby={heading}>
  <h4 id={heading}>{t('A check-in, on my terms','Un seguimiento, a mi ritmo')}</h4>
  <p className="follow-up-note" role="status">{sentence} {t('This stays private.','Esto es privado.')}</p>
  {saved&&item.schedule&&<small>{t('Saved time zone: ','Zona horaria guardada: ')}{item.schedule.timeZone}</small>}
  {item.state==='paused'&&item.pauseReason==='attempt_limit'&&<p>{t('Origen couldn’t complete this check-in. I can choose a new time.','Origen no pudo completar este seguimiento. Puedo elegir otro momento.')}</p>}
  {item.state==='paused'&&!['student','attempt_limit'].includes(item.pauseReason||'')&&<p>{t('The action or access changed. A new review is needed before a check-in can resume.','La acción o el acceso cambió. Hace falta una nueva revisión para reanudar el seguimiento.')}</p>}
  <div className="follow-up-buttons">
   {canEnroll&&<><button type="button" className="text-button" disabled={disabled} onClick={()=>choose(null,Intl.DateTimeFormat().resolvedOptions().timeZone)}>{item.state==='paused'?t('Resume next time','Retomar la próxima vez'):t('Check in next time','Retomar la próxima vez')}</button><button type="button" className="text-button" aria-expanded={choosing} disabled={disabled} onClick={()=>{c.discard();setChoosing(!choosing);}}>{t('Choose a date','Elegir una fecha')}</button></>}
   {item.state==='scheduled'&&<button type="button" className="text-button" disabled={busy} onClick={()=>void c.run({action:'pause',target,operationId:crypto.randomUUID(),revision:item.revision})}>{t('Pause','Pausar')}</button>}
   {(item.state!=='off'||preview)&&<button type="button" className="text-button" disabled={busy} onClick={()=>void c.run({action:'stop',target,operationId:crypto.randomUUID(),revision:item.revision})}>{t('Stop','Detener')}</button>}
  </div>
  {!canEnroll&&item.state!=='off'&&<small>{t('A new check-in is available only for an unfinished action with current access.','Un nuevo seguimiento requiere una acción pendiente y acceso vigente.')}</small>}
  {choosing&&canEnroll&&<form className="follow-up-date" onSubmit={e=>{e.preventDefault();choose(day);}}>
   <label>{t('Check in on or after','Retomar a partir del')}<input type="date" required min={min} max="9999-12-31" value={day} disabled={disabled} onChange={e=>{c.discard();setDay(e.target.value);}}/></label>
   <label>{t('Time zone','Zona horaria')}<input required maxLength={100} value={zone} disabled={disabled} onChange={e=>{c.discard();setZone(e.target.value);setZoneError(false);}} aria-invalid={zoneError||undefined}/></label>
   {zoneError&&<p role="alert">{t('Enter a time zone such as America/Chicago.','Ingresa una zona horaria como America/Chicago.')}</p>}
   <p>{t('Origen will check in when I next start a conversation on or after this date. My personal target date stays the same.','Origen retomará esto cuando yo inicie una conversación a partir de esta fecha. Mi fecha meta personal no cambia.')}</p>
   <div className="follow-up-buttons"><button type="submit" className="button outline" disabled={disabled||!day}>{t('Review my choice','Revisar mi elección')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>setChoosing(false)}>{t('Cancel','Cancelar')}</button></div>
  </form>}
  {preview&&canEnroll&&preview.selection.planVersion===planVersion&&preview.selection.revision===item.revision&&<div className="follow-up-review" role="region" aria-label={t('Review this check-in','Revisar este seguimiento')} tabIndex={-1} ref={review}>
   <strong>{t('Before I save','Antes de guardar')}</strong><p><strong>{preview.selection.action.title}</strong></p><p>{preview.selection.action.content}</p>
   {preview.selection.action.notes&&<p>{t('My notes: ','Mis notas: ')}{preview.selection.action.notes}</p>}
   {preview.selection.action.dueDate&&<p>{t('My personal target stays: ','Mi fecha meta sigue siendo: ')}{dateLabel(preview.selection.action.dueDate,language)}</p>}
   <p>{preview.selection.schedule.onOrAfter?t(`One check-in when I next talk with Origen on or after ${dateLabel(preview.selection.schedule.onOrAfter,language)}.`,`Un seguimiento cuando vuelva a hablar con Origen a partir del ${dateLabel(preview.selection.schedule.onOrAfter,language)}.`):t('One check-in the next time I talk with Origen.','Un seguimiento la próxima vez que hable con Origen.')} ({preview.selection.schedule.timeZone})</p>
   <p>{t('This stays private. It does not send an update to my coordinator.','Esto es privado. No envía una actualización a mi coordinador.')}</p>
   <div className="follow-up-buttons"><button type="button" className="button outline" disabled={disabled||Date.parse(preview.expiresAt)<=Date.now()} onClick={()=>void c.run({action:'confirm',target,operationId:crypto.randomUUID(),previewId:preview.id,digest:preview.digest,confirmed:true})}>{t('Confirm my check-in','Confirmar mi seguimiento')}</button><button type="button" className="text-button" disabled={busy} onClick={c.discard}>{t('Cancel','Cancelar')}</button></div>
  </div>}
 </section>;
}
