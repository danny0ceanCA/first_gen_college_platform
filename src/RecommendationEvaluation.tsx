import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useBinderNavigationGuard} from './useBinderFollow';
import {recommendationEvaluationNotice} from './recommendationEvaluation.mjs';
type Permission={version:number;status:'granted'|'declined'|'withdrawn'|'needs_review';organizationId:string|null;expiresAt:string|null};
type Current={enabled:boolean;organizations:{id:string;name:string}[];permission:Permission|null};
type Preview={id:string;digest:string;expiresAt:string;organizationName:string;permissionExpiresAt:string};
function currentResponse(value:unknown):Current{
 const data=value as Current,permission=data?.permission;
 if(!data||typeof data.enabled!=='boolean'||!Array.isArray(data.organizations)||data.organizations.some(o=>!o||typeof o.id!=='string'||typeof o.name!=='string')||permission!==null&&(!permission||!Number.isSafeInteger(permission.version)||permission.version<1||!['granted','declined','withdrawn','needs_review'].includes(permission.status)||permission.organizationId!==null&&typeof permission.organizationId!=='string'||permission.expiresAt!==null&&(typeof permission.expiresAt!=='string'||!Number.isFinite(Date.parse(permission.expiresAt)))))throw Error('evaluation_unavailable');
 return data;
}
export default function RecommendationEvaluation({studentId,language,blocked=false}:{studentId:string;language:'en'|'es';blocked?:boolean}){
 const t=(en:string,es:string)=>language==='es'?es:en;
 const [data,setData]=useState<Current>(),[open,setOpen]=useState(false),[org,setOrg]=useState(''),[preview,setPreview]=useState<Preview>(),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const epoch=useRef(0),active=useRef(false),locked=useRef(false),currentVersion=useRef<number|undefined>(undefined);
 useBinderNavigationGuard(busy||!!preview);
 async function request(body:Record<string,unknown>){const lease=browserPrivacy.capture({studentId});try{const response=await apiFetch('/api/recommendation-evaluation',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'recommendation_evaluation',contractVersion:1,studentId,...body}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(8000)])});const value=await response.json();lease.assert();if(!response.ok)throw Error('evaluation_unavailable');return value;}finally{lease.release();}}
 const clear=()=>{setPreview(undefined);setChecked(false);};
 async function load(){if(!active.current||locked.current)return;const n=++epoch.current;try{const value=currentResponse(await request({action:'load'}));if(!active.current||n!==epoch.current)return;if(!value.enabled||currentVersion.current!==undefined&&currentVersion.current!==(value.permission?.version||0))clear();currentVersion.current=value.permission?.version||0;setData(value);setOrg(previous=>value.organizations.some(o=>o.id===previous)?previous:value.permission?.organizationId||value.organizations[0]?.id||'');}catch{if(active.current&&n===epoch.current){setData(undefined);clear();}}}
 useEffect(()=>{active.current=true;locked.current=false;currentVersion.current=undefined;setBusy(false);setData(undefined);setOpen(false);setOrg('');clear();setMessage('');void load();
  const reset=()=>{epoch.current++;locked.current=false;setBusy(false);setData(undefined);clear();},refresh=()=>{clear();if(!document.hidden&&navigator.onLine)void load();else reset();};
  const unsubscribe=browserPrivacy.subscribe(reset),timer=setInterval(()=>{if(!document.hidden&&navigator.onLine)void load();},15000);
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',reset);document.addEventListener('visibilitychange',refresh);
  return()=>{active.current=false;epoch.current++;unsubscribe();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',reset);document.removeEventListener('visibilitychange',refresh);};
 },[studentId,language]);
 useEffect(()=>{if(blocked)clear();},[blocked]);
 async function run(action:'prepare'|'confirm'|'withdraw'|'decline'){
  if(locked.current||blocked||!data||action==='confirm'&&(!preview||!checked))return;locked.current=true;setBusy(true);setMessage('');const n=++epoch.current;
  try{const body=action==='prepare'?{action,version:data.permission?.version||0,organizationId:org,operationId:crypto.randomUUID()}:action==='confirm'?{action,previewId:preview!.id,digest:preview!.digest,confirmed:true}:{action,version:data.permission?.version||0,confirmed:true};
   const r=await request(body);if(!active.current||n!==epoch.current)return;
   if(action==='prepare'){setPreview(r.preview);setChecked(false);}else{clear();setMessage(r.status==='included'?t('Permission saved for future recommendations. Your earlier activity was not added.','Permiso guardado para recomendaciones futuras. No se agregó tu actividad anterior.'):r.status==='excluded'?t('Your contributions were removed. Your guidance and coordinator support stay available.','Se eliminaron tus contribuciones. Tu orientación y apoyo del coordinador siguen disponibles.'):t('Check the current permission before trying again.','Consulta el permiso actual antes de volver a intentarlo.'));}
  }catch{if(active.current&&n===epoch.current){clear();setMessage(t('The result could not be confirmed. Check your permission before trying again.','No se pudo confirmar el resultado. Consulta tu permiso antes de volver a intentarlo.'));}}
  finally{if(active.current&&n===epoch.current){locked.current=false;setBusy(false);if(action!=='prepare')void load();}}
 }
 if(!data)return null;if(!data.enabled&&!data.permission)return null;
 const status=data.permission?.status,disabled=busy||blocked;
 const labels={granted:t('Future recommendations included while permission is current','Recomendaciones futuras incluidas mientras el permiso esté vigente'),declined:t('Not included — declined','No incluido — rechazado'),withdrawn:t('Not included — withdrawn','No incluido — retirado'),needs_review:t('Not included — new approval required','No incluido — requiere nueva aprobación')};
 return <section className="recommendation-evaluation">
  <button type="button" className="text-button" aria-expanded={open} disabled={disabled||!!preview} onClick={()=>setOpen(!open)}>{t('Optional recommendation evaluation','Evaluación opcional de recomendaciones')}</button>
  {open&&<div>{recommendationEvaluationNotice[language].split('\n\n').map((text,i)=><p key={i}>{text}</p>)}
   <p role="status">{status?labels[status]:t('Not included','No incluido')}</p>
   {status==='granted'&&data.permission?.expiresAt&&<p>{t('Permission expires: ','El permiso vence: ')}{new Date(data.permission.expiresAt).toLocaleDateString(language)}</p>}
   {!data.enabled&&<p>{t('New collection is paused. You can still withdraw permission.','La recopilación nueva está pausada. Puedes retirar el permiso.')}</p>}
   {data.enabled&&data.organizations.length===0&&<p>{t('This optional evaluation requires an eligible adult student and a current organization connection. Guidance remains available.','Esta evaluación opcional requiere un estudiante adulto elegible y una conexión vigente con una organización. La orientación sigue disponible.')}</p>}
   {!preview&&<div className="follow-up-buttons">{data.enabled&&data.organizations.length>0&&status!=='granted'&&<><label>{t('Organization for this evaluation','Organización para esta evaluación')}<select value={org} disabled={disabled} onChange={e=>setOrg(e.target.value)}>{data.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button type="button" className="button outline" disabled={disabled||!org} onClick={()=>void run('prepare')}>{t('Review recommendation permission','Revisar permiso de recomendaciones')}</button></>}
    {status==='granted'||status==='needs_review'?<button type="button" className="text-button" disabled={disabled} onClick={()=>void run('withdraw')}>{t('Withdraw recommendation permission','Retirar permiso de recomendaciones')}</button>:status!=='declined'&&status!=='withdrawn'&&<button type="button" className="text-button" disabled={disabled} onClick={()=>void run('decline')}>{t('Do not include my recommendations','No incluir mis recomendaciones')}</button>}
   </div>}
   {preview&&<div className="follow-up-review" role="region" aria-label={t('Review recommendation evaluation','Revisar evaluación de recomendaciones')}>
    <p>{preview.organizationName}</p><p>{t('Permission expires: ','El permiso vence: ')}{new Date(preview.permissionExpiresAt).toLocaleDateString(language)}</p>
    <label><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>setChecked(e.target.checked)}/>{t('I choose this separate, optional use for future recommendations.','Elijo este uso separado y opcional para recomendaciones futuras.')}</label>
    <button type="button" className="button outline" disabled={disabled||!checked||Date.parse(preview.expiresAt)<=Date.now()} onClick={()=>void run('confirm')}>{t('Allow recommendation evaluation','Permitir evaluación de recomendaciones')}</button>
    <button type="button" className="text-button" disabled={busy} onClick={clear}>{t('Cancel permission','Cancelar permiso')}</button>
   </div>}
   {message&&<p role="status">{message}</p>}<button type="button" className="text-button" disabled={disabled} onClick={()=>void load()}>{t('Check recommendation permission','Consultar permiso de recomendaciones')}</button>
  </div>}
 </section>;
}
