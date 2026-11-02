import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useBinderNavigationGuard} from './useBinderFollow';
import {useNavigationGuard} from './workspaceNavigation';
import {evaluationNotice} from './outcomeEvaluation.mjs';
import {outcomeDefinitions} from './outcomeEvidence.mjs';
export type EvaluationPermission={version:number;status:'granted'|'declined'|'withdrawn'|'needs_review';expiresAt:string|null};
type Preview={id:string;digest:string;expiresAt:string;definitionId:string;organizationName:string;window:{start:string;end:string;timeZone:string};permissionExpiresAt:string};
type Current={enabled:boolean;eligible:boolean;organizationName:string;permission:EvaluationPermission|null};
export default function OutcomeEvaluation({studentId,episodeId,episodeVersion,language,blocked,onEditingChange}:{studentId:string;episodeId:string;episodeVersion:number;language:'en'|'es';blocked:boolean;onEditingChange:(id:string,editing:boolean)=>void}){
 const t=(en:string,es:string)=>language==='es'?es:en;
 const [open,setOpen]=useState(false),[data,setData]=useState<Current|null>(null),[preview,setPreview]=useState<Preview|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[notice,setNotice]=useState('');
 const permissionVersion=useRef<number|undefined>(undefined);
 const active=useRef(false),epoch=useRef(0),lock=useRef(false),review=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{onEditingChange(episodeId,busy||!!preview);return()=>onEditingChange(episodeId,false);},[episodeId,busy,!!preview,onEditingChange]);
 useBinderNavigationGuard(busy||!!preview);
 useNavigationGuard(!!preview,{locked:busy,onLeave:()=>{setPreview(null);setChecked(false);}});
 async function request(body:Record<string,unknown>){const lease=browserPrivacy.capture({studentId});try{
  const response=await apiFetch('/api/outcome-evaluation',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({purpose:'service_quality',contractVersion:1,studentId,episodeId,...body}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(8000)])});const result=await response.json();lease.assert();if(!response.ok)throw Error('evaluation_unavailable');return result;
 }finally{lease.release();}}
 async function load(){if(!active.current||lock.current||!open)return;const n=++epoch.current;if(document.hidden||!navigator.onLine){setData(null);return;}try{const r=await request({action:'load'});if(active.current&&n===epoch.current){const version=r.permission?.version||0;if(!r.enabled||!r.eligible||permissionVersion.current!==undefined&&permissionVersion.current!==version){setPreview(null);setChecked(false);}permissionVersion.current=version;setData(r);}}catch{if(active.current&&n===epoch.current){setData(null);setError(true);}}}
 useEffect(()=>{
  active.current=true;permissionVersion.current=undefined;setData(null);setPreview(null);setChecked(false);setError(false);setNotice('');void load();
  const clear=()=>{epoch.current++;setData(null);setPreview(null);setChecked(false);},refresh=()=>{setPreview(null);setChecked(false);void load();};
  const off=browserPrivacy.subscribe(clear),timer=setInterval(()=>void load(),15000);
  window.addEventListener('origen-follow-up-changed',refresh);window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',refresh);
  return()=>{active.current=false;epoch.current++;off();clearInterval(timer);window.removeEventListener('origen-follow-up-changed',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',refresh);};
 },[studentId,episodeId,episodeVersion,language,open]);
 useEffect(()=>{if(blocked){setPreview(null);setChecked(false);}},[blocked]);
 useEffect(()=>{if(preview)review.current?.focus({preventScroll:true});},[preview?.id]);
 async function run(action:'prepare'|'confirm'|'decline'|'withdraw'){
  if(lock.current||blocked||!data||action==='confirm'&&(!preview||!checked))return;
  const body=action==='prepare'?{action,version:data.permission?.version||0,operationId:crypto.randomUUID()}:action==='confirm'?{action,previewId:preview!.id,digest:preview!.digest,confirmed:true}:{action,version:data.permission?.version||0,confirmed:true};
  lock.current=true;setBusy(true);setError(false);setNotice('');const n=++epoch.current;
  try{const r=await request(body);if(!active.current||n!==epoch.current)return;
   if(action==='prepare'){setPreview(r.preview);setChecked(false);}
   else{setPreview(null);setChecked(false);setNotice(r.status==='included'?t('I allowed this outcome to be included in protected quality statistics.','Permití incluir este resultado en estadísticas protegidas de calidad.'):r.status==='excluded'?t('This outcome is excluded from future quality reports. My guidance and coordinator support stay available.','Este resultado queda excluido de futuros reportes de calidad. Mi orientación y apoyo del coordinador siguen disponibles.'):t('The permission changed. Check its current status.','El permiso cambió. Consulta su estado actual.'));}
  }catch{if(active.current&&n===epoch.current){setPreview(null);setChecked(false);setData(null);setError(true);}}
  finally{lock.current=false;if(active.current){setBusy(false);if(action!=='prepare')void load();}}
 }
 const disabled=blocked||busy,status=data?.permission?.status;
 const labels={granted:t('Included while this permission is current','Incluido mientras este permiso esté vigente'),declined:t('Not included — I declined','No incluido — rechacé'),withdrawn:t('Not included — permission withdrawn','No incluido — permiso retirado'),needs_review:t('Not included — a fresh approval is needed','No incluido — se necesita una nueva aprobación')};
 return <section className="outcome-evaluation">
  <button type="button" className="text-button" aria-expanded={open} disabled={disabled||!!preview} onClick={()=>setOpen(!open)}>{t('Optional quality evaluation','Evaluación de calidad opcional')}</button>
  {open&&<div>
   {evaluationNotice[language].split('\n\n').map((text,i)=><p key={i}>{text}</p>)}
   {data&&<><p>{data.organizationName} · {status?labels[status]:t('Not included','No incluido')}</p>
    {status==='granted'&&data.permission?.expiresAt&&<p>{t('Permission expires','El permiso vence')}: {new Date(data.permission.expiresAt).toLocaleDateString(language)}</p>}
    {!data.enabled&&<p>{t('New permissions are paused. You can still withdraw an existing permission.','Los permisos nuevos están pausados. Puedes retirar un permiso existente.')}</p>}
    {data.enabled&&!data.eligible&&<p>{t('This outcome is not currently eligible for quality evaluation. Your guidance is still available.','Este resultado no es elegible para evaluación de calidad en este momento. Tu orientación sigue disponible.')}</p>}
    {!preview&&<div className="follow-up-buttons">{data.enabled&&data.eligible&&status!=='granted'&&<button type="button" className="button outline" disabled={disabled} onClick={()=>void run('prepare')}>{t('Review optional permission','Revisar permiso opcional')}</button>}
    {status==='granted'||status==='needs_review'?<button type="button" className="text-button" disabled={disabled} onClick={()=>void run('withdraw')}>{t('Withdraw evaluation permission','Retirar permiso de evaluación')}</button>:status!=='declined'&&status!=='withdrawn'&&<button type="button" className="text-button" disabled={disabled} onClick={()=>void run('decline')}>{t('Do not include this outcome','No incluir este resultado')}</button>}</div>}
   </>}
   {preview&&<div className="follow-up-review" role="region" aria-label={t('Review evaluation permission','Revisar permiso de evaluación')} tabIndex={-1} ref={review}>
    <p>{outcomeDefinitions.find(d=>d.id===preview.definitionId)?.label[language]} · {preview.organizationName}</p>
    <p>{t('Observation period','Período de observación')}: {preview.window.start} – {preview.window.end} ({preview.window.timeZone})</p>
    <p>{t('Permission expires','El permiso vence')}: {new Date(preview.permissionExpiresAt).toLocaleDateString(language)}</p>
    <label><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>setChecked(e.target.checked)}/>{t('I choose this optional use for this outcome.','Elijo este uso opcional para este resultado.')}</label>
    <div className="follow-up-buttons"><button type="button" className="button outline" disabled={disabled||!checked||Date.parse(preview.expiresAt)<=Date.now()} onClick={()=>void run('confirm')}>{t('Allow this quality evaluation','Permitir esta evaluación de calidad')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setPreview(null);setChecked(false);}}>{t('Cancel permission','Cancelar permiso')}</button></div>
   </div>}
   {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{t('The permission could not be confirmed. Check its current status before trying again.','No se pudo confirmar el permiso. Consulta su estado actual antes de intentarlo de nuevo.')}</p>}
   {!preview&&<button type="button" className="text-button" disabled={disabled} onClick={()=>{setError(false);void load();}}>{t('Check evaluation permission','Consultar permiso de evaluación')}</button>}
  </div>}
 </section>;
}
