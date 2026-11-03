import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {recommendationSaveDisclosure} from './recommendationDelivery.mjs';
import {useBinderNavigationGuard} from './useBinderFollow';
import './RecommendationSuggestion.css';
type T=(en:string,es:string)=>string;
type Focus={kind:'accepted-action';planId:string;stepId:string;planVersion:number}|{kind:'review-response';requestId:string;responseVersion:number};
type Preview={status:string;id:string;expiresAt:string;action:string;explanation:string;source:{kind:string;revision?:number;responseVersion?:number};policyVersion:string;reviewedAt:string;canAccept:boolean};
const initialAnswers={document_requested:'unknown',document_prepared:'unknown',submission_reported:'unknown',decision_pending:'unknown'};
export default function RecommendationSuggestion({studentId,language,t,blocked=false,focus,autoOpen=false,onSaved}:{studentId:string;language:'en'|'es';t:T;blocked?:boolean;focus?:Focus;autoOpen?:boolean;onSaved:()=>void}){
 const [enabled,setEnabled]=useState(false),[open,setOpen]=useState(false),[process,setProcess]=useState('office_contact'),[goal,setGoal]=useState('understand_requirement'),[answers,setAnswers]=useState(initialAnswers),[question,setQuestion]=useState(''),[questionCode,setQuestionCode]=useState(''),[preview,setPreview]=useState<Preview>(),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[recoverId,setRecoverId]=useState<string>();
 const epoch=useRef(0),locked=useRef(false),latestSaved=useRef(onSaved);latestSaved.current=onSaved;
 const suggestion=useRef<HTMLElement>(null);
 useBinderNavigationGuard(busy||!!preview);
 async function request(body:Record<string,unknown>){const lease=browserPrivacy.capture({studentId});try{const response=await apiFetch('/api/recommendations',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId,...body}),signal:AbortSignal.any([lease.signal,AbortSignal.timeout(10000)])});const value=await response.json();lease.assert();if(!response.ok)throw Object.assign(Error(value.error||'recommendation_unavailable'),{status:response.status});return value;}finally{lease.release();}}
 const clear=()=>{setPreview(undefined);setAccepted(false);setQuestion('');setQuestionCode('');};
 useEffect(()=>{let active=true;epoch.current++;locked.current=false;setBusy(false);clear();setOpen(autoOpen);setRecoverId(undefined);setEnabled(false);setMessage('');setAnswers(initialAnswers);
  void request({action:'capability'}).then(r=>{if(active)setEnabled(r.enabled===true);}).catch(()=>{});
  const unsubscribe=browserPrivacy.subscribe(()=>{epoch.current++;clear();setRecoverId(undefined);setOpen(false);setEnabled(false);});
  return()=>{active=false;epoch.current++;unsubscribe();};
 },[studentId,language,JSON.stringify(focus),autoOpen]);
 useEffect(()=>{if(!preview||!suggestion.current)return;let observed=false;const observer=new IntersectionObserver(entries=>{if(observed||document.hidden||!navigator.onLine||!entries.some(e=>e.isIntersecting))return;observed=true;void request({action:'display',id:preview.id}).catch(()=>{});});observer.observe(suggestion.current);return()=>observer.disconnect();},[preview?.id]);
 useEffect(()=>{if(!preview)return;let active=true,checking=false;const id=preview.id;
  const discard=()=>{if(active){clear();setMessage(t('This suggestion needs a fresh review. Your saved actions are still available.','Esta sugerencia necesita una nueva revisión. Tus acciones guardadas siguen disponibles.'));}};
  const check=async()=>{if(locked.current||checking||!active)return;if(document.hidden||!navigator.onLine){discard();return;}checking=true;try{const r=await request({action:'verify',id});if(r.status!=='current')discard();}catch{discard();}finally{checking=false;}};
  const interval=setInterval(()=>void check(),5000),visibility=()=>void check();window.addEventListener('focus',visibility);window.addEventListener('offline',discard);document.addEventListener('visibilitychange',visibility);
  return()=>{active=false;clearInterval(interval);window.removeEventListener('focus',visibility);window.removeEventListener('offline',discard);document.removeEventListener('visibilitychange',visibility);};
 },[preview?.id,studentId,language]);
 async function run(action:'select'|'confirm'|'receipt'){
  if(locked.current||blocked)return;locked.current=true;setBusy(true);setMessage('');const current=epoch.current,id=action==='receipt'?recoverId:preview?.id;
  if(action==='confirm'&&!accepted){locked.current=false;setBusy(false);return;}
  if(action==='confirm')setRecoverId(id);
  try{
   const body=action==='select'?{action,request:{language,intent:focus?'revisit_action':'next_action',goal,process,focus:focus||null,episodes:[],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone},answers}:action==='confirm'?{action,id,confirmed:true}:{action,id};
   const r=await request(body);if(current!==epoch.current)return;
   if(r.status==='saved'){clear();setRecoverId(undefined);setMessage(t('Saved privately in My next steps.','Guardado de forma privada en Mis próximos pasos.'));latestSaved.current();}
   else if(r.status==='recommended'){setPreview(r);setAccepted(false);setQuestion('');setQuestionCode('');setRecoverId(undefined);}
   else{clear();if(r.status==='clarification_required'){setQuestion(r.question);setQuestionCode(r.questionKey||r.reason);}
    else setMessage(r.status==='not_saved'?t('No saved action was found. Review a fresh suggestion before saving.','No se encontró una acción guardada. Revisa una nueva sugerencia antes de guardarla.'):r.status==='no_applicable_candidate'?t('There is no new step to suggest for this selection. You can choose another goal or work on a saved action.','No hay un nuevo paso para sugerir con esta selección. Puedes elegir otro objetivo o trabajar en una acción guardada.'):t('We could not verify a suggestion right now. You can still talk with Origen or use your saved steps.','No pudimos verificar una sugerencia ahora. Puedes seguir hablando con Origen o usar tus pasos guardados.'));}
  }catch{if(current===epoch.current){clear();setMessage(action==='confirm'?t('The save result could not be confirmed. Check the saved result before trying again.','No se pudo confirmar el guardado. Consulta el resultado antes de volver a intentarlo.'):t('This information changed or could not be verified. Review a fresh suggestion.','Esta información cambió o no se pudo verificar. Revisa una nueva sugerencia.'));}}
  finally{if(current===epoch.current){locked.current=false;setBusy(false);}}
 }
 function dismiss(){const id=preview?.id;clear();setOpen(false);setMessage('');if(id)void request({action:'cancel',id}).catch(()=>{});}
 if(!enabled)return null;
 return <div className="recommendation-suggestion">
  {!open?<button type="button" className="text-button" disabled={blocked||busy} onClick={()=>setOpen(true)}>{focus?t('Review a next step from this','Revisar un próximo paso a partir de esto'):t('Help me choose a next step','Ayúdame a elegir un próximo paso')}</button>:<section aria-label={t('Choose a next step','Elegir un próximo paso')}>
   <h3>{t('One step that fits your question','Un paso que corresponda a tu pregunta')}</h3>
   {!preview&&<><div className="recommendation-fields"><label>{t('What is this about?','¿De qué se trata?')}<select disabled={busy||blocked} value={process} onChange={e=>{setProcess(e.target.value);setAnswers(initialAnswers);setQuestion('');}}><option value="office_contact">{t('Contacting an office','Contactar a una oficina')}</option><option value="aid_documents">{t('Financial aid documents','Documentos de ayuda financiera')}</option><option value="insurance_waiver">{t('Health insurance waiver','Exención del seguro médico')}</option></select></label>
   <label>{t('What do you want to do?','¿Qué quieres hacer?')}<select disabled={busy||blocked} value={goal} onChange={e=>{setGoal(e.target.value);setQuestion('');}}><option value="understand_requirement">{t('Understand what is required','Entender qué se requiere')}</option><option value="prepare_document">{t('Prepare a document','Preparar un documento')}</option><option value="submit_document">{t('Submit a document','Entregar un documento')}</option><option value="check_decision">{t('Check a pending decision','Consultar una decisión pendiente')}</option></select></label></div>
   {question&&<p role="status">{question}</p>}
   {Object.hasOwn(initialAnswers,questionCode)&&<fieldset><legend>{t('What you know about this request','Lo que sabes de esta solicitud')}</legend><p>{t('These answers are your report; they do not verify institutional requirements or approval.','Estas respuestas son lo que tú reportas; no verifican requisitos institucionales ni aprobación.')}</p>{Object.entries({document_requested:t('The office requested a specific document','La oficina pidió un documento específico'),document_prepared:t('I prepared the requested document','Preparé el documento solicitado'),submission_reported:t('I submitted it for this request','Lo entregué para esta solicitud'),decision_pending:t('The decision is still pending','La decisión sigue pendiente')}).filter(([key])=>key===questionCode).map(([key,label])=><label key={key}>{label}<select disabled={busy||blocked} value={answers[key as keyof typeof answers]} onChange={e=>setAnswers({...answers,[key]:e.target.value})}><option value="unknown">{t('I’m not sure','No estoy seguro')}</option><option value="yes">{t('Yes','Sí')}</option><option value="no">{t('No','No')}</option></select></label>)}</fieldset>}
   <button type="button" className="button outline" disabled={busy||blocked} onClick={()=>void run('select')}>{busy?t('Checking…','Consultando…'):t('Review a suggestion','Revisar una sugerencia')}</button></>}
   {preview&&<article ref={suggestion} className="saved-plan"><h4>{t('Suggested next step','Próximo paso sugerido')}</h4><p>{preview.action}</p><p>{preview.explanation}</p><details><summary>{t('Why this source?','¿Por qué esta fuente?')}</summary><p>{preview.source.kind==='reviewed-template'?t('Reviewed reusable guidance. This general question does not establish campus requirements or eligibility.','Orientación reutilizable revisada. Esta pregunta general no establece requisitos del campus ni elegibilidad.'):preview.source.kind==='review-response'?t('Your selected coordinator suggestion. It remains attributed advice.','La sugerencia de tu coordinador que seleccionaste. Sigue siendo orientación atribuida.'):t('Your existing accepted action. It is already in your plan.','Tu acción existente y aceptada. Ya está en tu plan.')}</p><small>{t('Reviewed: ','Revisado: ')}{new Date(preview.reviewedAt).toLocaleDateString(language==='es'?'es-US':'en-US')}</small></details>
    {preview.canAccept&&<><p className="recommendation-disclosure">{recommendationSaveDisclosure(language)}</p><label className="action-accept"><input type="checkbox" checked={accepted} disabled={busy||blocked} onChange={e=>setAccepted(e.target.checked)}/>{t('I reviewed this exact action and want to save it privately.','Revisé esta acción exacta y quiero guardarla de forma privada.')}</label><button type="button" className="button primary" disabled={!accepted||busy||blocked} onClick={()=>void run('confirm')}>{busy?t('Saving…','Guardando…'):t('Accept and save this step','Aceptar y guardar este paso')}</button></>}
   </article>}
   <button type="button" className="text-button" disabled={busy} onClick={dismiss}>{t('Set aside','Dejar para después')}</button>
  </section>}
  {message&&<p role="status">{message}</p>}{recoverId&&<button type="button" className="text-button" disabled={busy||blocked} onClick={()=>void run('receipt')}>{t('Check saved result','Consultar el guardado')}</button>}
 </div>;
}
