import RecommendationSuggestion from './RecommendationSuggestion';
import {useContext,useEffect,useRef,useState} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {SharedVoiceContext} from './SharedVoiceContext';
import type {ReviewResponseReference} from './reviewResponseConnection.mjs';
import type {WorkspaceTopic} from './voiceWorkspace.mjs';
import type {ActionSeed} from './ActionPlan';
type T=(en:string,es:string)=>string;
type Choice={enabled:boolean;available:boolean;canFollowUp?:boolean;acceptedActionCount:number;choice:{state:'available'|'deferred';revision:number;reviewOn:string|null;shouldOffer:boolean}};
export async function responseChoiceRequest(studentId:string,source:ReviewResponseReference,action:string,extra:Record<string,unknown>={}){
 const lease=browserPrivacy.capture({studentId});
 try{const response=await apiFetch('/api/review-response-choices',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,studentId,source,...extra}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(8000)])});const result=await response.json();lease.assert();if(!response.ok)throw Object.assign(Error(result.error||'review_response_unavailable'),{status:response.status});return result;}
 finally{lease.release();}
}
function responseTopic(question:string):WorkspaceTopic{
 const text=question.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 return /\b(insurance|health|ship|waiver|aid|fafsa|tuition|scholarships?|seguro|salud|exencion|becas?|costos?|financiera)\b/.test(text)?'costs':/\b(essay|application|ensayo|solicitud|admissions)\b/.test(text)?'applications':/\b(transfer|courses?|transferencia|cursos?)\b/.test(text)?'transfer':'options';
}
export default function ReviewResponseChoices({studentId,source,question,suggestedAction,t,onAction,onTalk,onStale,onFollowUp}:{studentId:string;source:ReviewResponseReference;question:string;suggestedAction:string;t:T;onAction?:(seed:ActionSeed)=>void;onTalk:()=>void;onStale:()=>void;onFollowUp?:()=>void}){
 const shared=useContext(SharedVoiceContext),[data,setData]=useState<Choice>(),[busy,setBusy]=useState(false),[later,setLater]=useState(false),[reviewOn,setReviewOn]=useState(''),[error,setError]=useState('');
 const epoch=useRef(0),lock=useRef(false),latestStale=useRef(onStale);latestStale.current=onStale;
 const topic=responseTopic(question);
 useEffect(()=>{
  const n=++epoch.current;let active=true;setData(undefined);setError('');setLater(false);setBusy(false);lock.current=false;
  const clear=()=>{if(active){setData(undefined);setLater(false);}};
  const load=()=>{if(document.hidden||!navigator.onLine){clear();return;}if(lock.current)return;void responseChoiceRequest(studentId,source,'load').then(value=>{if(active&&n===epoch.current)setData(value);}).catch(e=>{if(active&&n===epoch.current){clear();if(e.status===404||e.status===409)latestStale.current();}});};
  load();const timer=setInterval(load,5000),unsubscribe=browserPrivacy.subscribe(clear);
  window.addEventListener('focus',load);window.addEventListener('offline',clear);document.addEventListener('visibilitychange',load);
  return()=>{active=false;epoch.current++;clearInterval(timer);unsubscribe();window.removeEventListener('focus',load);window.removeEventListener('offline',clear);document.removeEventListener('visibilitychange',load);};
 },[studentId,source.requestId,source.responseVersion]);
 async function choose(action:'defer'|'revisit',next?:()=>void){
  if(lock.current||!data?.enabled)return;lock.current=true;setBusy(true);setError('');const n=epoch.current;
  try{const value=await responseChoiceRequest(studentId,source,action,{revision:data.choice.revision,operationId:crypto.randomUUID(),...(action==='defer'?{reviewOn:reviewOn||null}:{})});if(n!==epoch.current)return;setData(value);setLater(false);next?.();}
  catch{if(n===epoch.current){setData(undefined);setLater(false);setError(t('This response changed or the result could not be confirmed. Refresh your requests before continuing.','Esta respuesta cambió o no se pudo confirmar el resultado. Actualiza tus solicitudes antes de continuar.'));latestStale.current();}}
  finally{if(n===epoch.current){lock.current=false;setBusy(false);}}
 }
 if(!data&&!error)return null;
 return <div className="review-response-choices">
  {!!data?.acceptedActionCount&&<p>{t('I saved a private next step from this response.','Guardé un próximo paso privado a partir de esta respuesta.')}</p>}
  {data?.choice.state==='deferred'&&<p role="status">{data.choice.reviewOn?t(`I chose to review this on ${data.choice.reviewOn}.`,`Elegí revisar esto el ${data.choice.reviewOn}.`):t('I set this aside until I choose to return.','Dejé esto para cuando decida retomarlo.')}</p>}
  {data?.enabled&&<><div className="review-request-actions">
   <button type="button" className="text-button" disabled={busy||!shared} onClick={()=>void choose('revisit',()=>{onTalk();shared?.talkAbout({kind:'review-response',studentId,topic,source});})}>{t('Talk about this','Hablemos de esto')}</button>
   <button type="button" className="text-button" disabled={busy} onClick={()=>setLater(value=>!value)}>{t('Review later','Revisar después')}</button>
   {!!suggestedAction&&onAction&&<button type="button" className="text-button" disabled={busy} onClick={()=>{onAction({serial:crypto.randomUUID(),studentId,content:'',topic,responseSource:source});}}>{t('Add to my next steps','Agregar a mis próximos pasos')}</button>}
  </div>{later&&<div className="review-response-later"><label>{t('Review date (optional)','Fecha para revisar (opcional)')}<input type="date" min={new Date().toISOString().slice(0,10)} max="9999-12-31" value={reviewOn} disabled={busy} onChange={e=>setReviewOn(e.target.value)}/></label><p>{t('This is private. It does not create a reminder or send an update.','Esto es privado. No crea un recordatorio ni envía una actualización.')}</p><button type="button" className="button outline" disabled={busy} onClick={()=>void choose('defer')}>{t('Keep for later','Dejar para después')}</button></div>}</>}
  {data?.canFollowUp&&onFollowUp&&<button type="button" className="text-button" disabled={busy} onClick={onFollowUp}>{t('Ask my coordinator a follow-up','Pedir una aclaración a mi coordinador')}</button>}
  {data?.enabled&&<RecommendationSuggestion studentId={studentId} language={t('en','es')==='es'?'es':'en'} t={t} focus={source} blocked={busy} onSaved={()=>window.dispatchEvent(new Event('origen-recommendation-saved'))}/>}
  {error&&<p role="status">{error}</p>}
 </div>;
}
