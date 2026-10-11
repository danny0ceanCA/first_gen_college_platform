import {useState,useRef} from 'react';
import {useFamily} from './FamilyStore';
import {apiFetch} from './api';
export default function ProgressPanel({studentId,language,t}:{studentId:string;language:'en'|'es';t:(en:string,es:string)=>string}){
 const family=useFamily();
 if(!family.cloud||import.meta.env.VITE_PROGRESS_HISTORY_ENABLED!=='true')return null;
 return <ProgressForm key={studentId} studentId={studentId} language={language} t={t}/>;
}
function ProgressForm({studentId,language,t}:{studentId:string;language:'en'|'es';t:(en:string,es:string)=>string}){
 const [status,setStatus]=useState('');const [busy,setBusy]=useState(false);
 const [feedbackSaved,setFeedbackSaved]=useState(false),inFlight=useRef(false);
 const opportunity=useRef<Promise<string|undefined>|null>(null);
 const pending=useRef<Partial<Record<'feedback'|'milestone',{key:string;id:string}>>>({});
 const [milestone,setMilestone]=useState('');
 function opened(){
  if(opportunity.current)return;
  const id=crypto.randomUUID();
  // A deliberate panel opening, not a claim that the user read or understood it.
  const signal=AbortSignal.timeout(4000);
  opportunity.current=Promise.race([
   apiFetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prompt-opened',id,studentId,language}),signal}).then(r=>r.ok?id:undefined).catch(()=>undefined),
   new Promise<undefined>(resolve=>signal.addEventListener('abort',()=>resolve(undefined),{once:true}))
  ]);
 }
 const record=async(kind:'feedback'|'milestone',value:string|null)=>{
  if(inFlight.current||(kind==='feedback'&&feedbackSaved))return;
  inFlight.current=true;
  setBusy(true);setStatus('');
  const key=JSON.stringify([studentId,kind,value,language]);
  if(pending.current[kind]?.key!==key)pending.current[kind]={key,id:crypto.randomUUID()};
  const id=pending.current[kind]!.id;
  try{
   const promptId=kind==='feedback'?await opportunity.current:undefined;
   const response=await apiFetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'record',id,studentId,kind,responseStatus:value===null?'declined':'answered',value,language,...(promptId?{promptId}:{})})});
   if(kind==='feedback'&&response.status===409){
    const error=await response.json();
    if(error.error==='prompt_already_answered'){setFeedbackSaved(true);delete pending.current[kind];setStatus(t('Feedback was already saved for this visit.','Los comentarios de esta visita ya se guardaron.'));return;}
   }
   if(!response.ok)throw new Error();
   delete pending.current[kind];
   if(kind==='feedback')setFeedbackSaved(true);else setMilestone('');
   setStatus(t('Saved to your account.','Guardado en tu cuenta.'));
  }catch{setStatus(t('Could not save. Please try again.','No se pudo guardar. Intenta de nuevo.'));}finally{inFlight.current=false;setBusy(false);}
 };
 return <details className="planning-resources progress-panel" onToggle={e=>{if(e.currentTarget.open)opened();}}><summary>{t('Share progress or optional feedback','Comparte tu progreso o comentarios opcionales')}</summary>
  <p>{t('These are your reports, not verified school records. We count openings of this optional section and use feedback and progress totals to improve Origen. Your records are kept for 90 days and are not shared with institutions or used to measure learning.','Estos son tus reportes, no registros verificados de la escuela. Contamos las aperturas de esta sección opcional y usamos los totales de comentarios y progreso para mejorar Origen. Tus registros se conservan por 90 días y no se comparten con instituciones ni se usan para medir el aprendizaje.')}</p>
  <label>{t('A step you have taken','Un paso que has dado')} <select disabled={busy} value={milestone} onChange={e=>setMilestone(e.target.value)}>
   <option value="" disabled>{t('Choose a step','Elige un paso')}</option><option value="counselor-contacted">{t('Contacted a counselor','Contacté a un consejero')}</option><option value="application-started">{t('Started an application','Empecé una solicitud')}</option><option value="application-submitted">{t('Submitted an application','Envié una solicitud')}</option><option value="aid-offer-reviewed">{t('Reviewed an aid offer','Revisé una oferta de ayuda')}</option>
  </select></label> <button type="button" disabled={busy||!milestone} onClick={()=>void record('milestone',milestone)}>{t('Save reported progress','Guardar progreso reportado')}</button>
  <p>{t('Was this guidance helpful?','¿Te sirvió esta orientación?')}</p>
  {([['helpful','Helpful','Sí'],['partly','Partly','En parte'],['not-yet','Not yet','Todavía no']] as const).map(([value,en,es])=><button type="button" key={value} disabled={busy||feedbackSaved} onClick={()=>void record('feedback',value)}>{t(en,es)}</button>)}
  <button type="button" disabled={busy||feedbackSaved} onClick={()=>void record('feedback',null)}>{t('Prefer not to answer','Prefiero no responder')}</button>
  <p role="status">{status}</p>
 </details>;
}
