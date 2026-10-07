import {useState,useRef} from 'react';
import {useFamily} from './FamilyStore';
import {apiFetch} from './api';
export default function ProgressPanel({studentId,language,t}:{studentId:string;language:'en'|'es';t:(en:string,es:string)=>string}){
 const family=useFamily();
 const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 const pending=useRef<{key:string;id:string}|null>(null);
 const [milestone,setMilestone]=useState('');
 if(!family.cloud||import.meta.env.VITE_PROGRESS_HISTORY_ENABLED!=='true')return null;
 const record=async(kind:'feedback'|'milestone',value:string|null)=>{
  setBusy(true);setStatus('');
  const key=JSON.stringify([studentId,kind,value,language]);
  if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
  try{
   const response=await apiFetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'record',id:pending.current.id,studentId,kind,responseStatus:value===null?'declined':'answered',value,language})});
   if(!response.ok)throw new Error();
   pending.current=null;
   setStatus(t('Saved to your account.','Guardado en tu cuenta.'));
  }catch{setStatus(t('Could not save. Please try again.','No se pudo guardar. Intenta de nuevo.'));}finally{setBusy(false);}
 };
 return <details className="planning-resources progress-panel"><summary>{t('Share progress or optional feedback','Comparte tu progreso o comentarios opcionales')}</summary>
  <p>{t('These are your reports, not verified school records. Optional feedback helps improve the service; it does not measure learning. Records stay private to your account and are kept for 90 days.','Estos son tus reportes, no registros verificados de la escuela. Los comentarios opcionales ayudan a mejorar el servicio; no miden el aprendizaje. Los registros son privados de tu cuenta y se conservan durante 90 días.')}</p>
  <label>{t('A step you have taken','Un paso que has dado')} <select disabled={busy} value={milestone} onChange={e=>setMilestone(e.target.value)}>
   <option value="" disabled>{t('Choose a step','Elige un paso')}</option><option value="counselor-contacted">{t('Contacted a counselor','Contacté a un consejero')}</option><option value="application-started">{t('Started an application','Empecé una solicitud')}</option><option value="application-submitted">{t('Submitted an application','Envié una solicitud')}</option><option value="aid-offer-reviewed">{t('Reviewed an aid offer','Revisé una oferta de ayuda')}</option>
  </select></label> <button type="button" disabled={busy||!milestone} onClick={()=>void record('milestone',milestone)}>{t('Save reported progress','Guardar progreso reportado')}</button>
  <p>{t('Was this guidance helpful?','¿Te sirvió esta orientación?')}</p>
  {([['helpful','Helpful','Sí'],['partly','Partly','En parte'],['not-yet','Not yet','Todavía no']] as const).map(([value,en,es])=><button type="button" key={value} disabled={busy} onClick={()=>void record('feedback',value)}>{t(en,es)}</button>)}
  <button type="button" disabled={busy} onClick={()=>void record('feedback',null)}>{t('Prefer not to answer','Prefiero no responder')}</button>
  <p role="status">{status}</p>
 </details>;
}
