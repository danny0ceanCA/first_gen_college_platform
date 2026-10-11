import WorkspaceTalkButton from './WorkspaceTalkButton';
import {planTopic} from './voiceWorkspace.mjs';
import {useEffect,useId,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowRight,CheckCircle2,Plus,RefreshCw} from 'lucide-react';
import {apiFetch} from './api';
import {legacyCreationId,legacyPlanBatches} from './planImport.mjs';
import './ActionPlan.css';

type Step={id:string;title:string;action:string;notes:string;status:'not-started'|'in-progress'|'complete';dueDate:string|null;sources:{title:string;url:string}[]};
type Plan={id:string;studentId:string|null;title:string;goal:string;category:string;status:'active'|'archived';version:number;summaryIds:string[];steps:Step[]};
type Data={plans:Plan[];creationIds:string[];limited:boolean;supportsActions:boolean};
export type ActionSeed={serial:string;studentId:string|null;noteId?:string;version?:number;content:string;topic:string};
type Draft={requestId:string;steps:Step[];base?:Plan;title:string;category:string;fromNote?:{id:string;version:number;stepId:string};accepted:boolean;editing:boolean;imported?:boolean};
type Props={compact?:boolean;studentId:string;name:string;role:'parent'|'student';language:'en'|'es';t:(a:string,b:string)=>string;seed:ActionSeed|null};
export default function ActionPlan({compact=false,studentId,name,role,language,t,seed}:Props){
 const {user,getAccessTokenSilently}=useAuth0(),heading=useId();
 const [familyFor,setFamilyFor]=useState<string|null>(null),[data,setData]=useState<{scope:string;value:Data}|null>(null);
 const target=role==='parent'&&familyFor===studentId?null:studentId,scope=JSON.stringify([user?.sub,target]);
 const currentScope=useRef(scope);currentScope.current=scope;
 const [loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),lock=useRef(false),loadVersion=useRef(0);
 const [drafts,setDrafts]=useState<Record<string,Draft|undefined>>({}),[messages,setMessages]=useState<Record<string,string>>({}),[archive,setArchive]=useState(false);
 const [legacy,setLegacy]=useState<{scope:string;batches:{requestId:string;steps:Step[]}[];error:boolean}|null>(null);
 const section=useRef<HTMLElement>(null),lastSeed=useRef<string|null>(null);
 const [expanded,setExpanded]=useState(false);
 const value=data?.scope===scope?data.value:null,plans=value?.plans.filter(p=>p.studentId===target)||[],draft=drafts[scope];
 const latest=draft?.base?plans.find(p=>p.id===draft.base?.id):undefined;
 const conflict=!!draft?.base&&!!value&&latest?.version!==draft.base.version;
 const alreadySaved=!!latest&&!draft?.editing&&draft?.steps.every(s=>latest.steps.some(saved=>saved.id===s.id));
 const active=plans.filter(p=>p.status==='active'),shown=plans.filter(p=>archive||p.status==='active');
 const nextStep=active.flatMap(plan=>plan.steps.map(step=>({plan,step}))).find(({step})=>step.status!=='complete');
 const showFull=!compact||expanded||!!draft;
 const scopeName=target===null?t('Family plan','Plan familiar'):name;
 const statuses={'not-started':t('Not started','Sin empezar'),'in-progress':t('In progress','En progreso'),complete:t('Done','Hecho')};
 const date=(d:string)=>new Date(`${d}T12:00:00`).toLocaleDateString(language==='es'?'es-US':'en-US',{dateStyle:'medium'});
 async function request(body:Record<string,unknown>,signal?:AbortSignal):Promise<Data>{
  const token=await getAccessTokenSilently();let subject;try{subject=JSON.parse(atob(token!.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
  if(!token||!user?.sub||subject!==user.sub)throw Error('account_changed');
  const timeout=AbortSignal.timeout(20000),response=await apiFetch('/api/plans',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const result=await response.json();if(!response.ok)throw Error(result.error||'plans_unavailable');
  if(!Array.isArray(result.plans)||!Array.isArray(result.creationIds)||!result.supportsActions)throw Error('plans_unavailable');return result;
 }
 useEffect(()=>{
  const controller=new AbortController(),version=loadVersion.current;let current=true;setLoading(true);setFailed(false);setData(null);
  request({action:'load',studentId:target},controller.signal).then(result=>{if(current&&version===loadVersion.current)setData({scope,value:result});}).catch(()=>{if(current)setFailed(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;controller.abort();};
 },[scope,retry]);
 useEffect(()=>{
  let current=true;setLegacy(null);
  void(async()=>{if(!user?.sub||target===null){if(current)setLegacy({scope,batches:[],error:false});return;}
   const raw=localStorage.getItem(`origen.user.${user.sub}.plans.v1`),batches=legacyPlanBatches(raw?JSON.parse(raw):{},target);
   const result=await Promise.all(batches.map(async steps=>({requestId:await legacyCreationId(user.sub!,target,steps),steps})));
   if(current)setLegacy({scope,batches:result,error:false});
  })().catch(()=>{if(current)setLegacy({scope,batches:[],error:true});});return()=>{current=false;};
 },[scope]);
 useEffect(()=>{
  if(!seed||lastSeed.current===seed.serial||seed.studentId!==null&&seed.studentId!==studentId)return;
  const nextScope=JSON.stringify([user?.sub,seed.studentId]);
  if(drafts[nextScope]&&!window.confirm(t('Replace the unfinished action draft?','¿Reemplazar el borrador de acción sin guardar?'))){lastSeed.current=seed.serial;return;}
  lastSeed.current=seed.serial;setFamilyFor(seed.studentId===null?studentId:null);
  const id=crypto.randomUUID();setDrafts(prev=>({...prev,[nextScope]:{requestId:crypto.randomUUID(),steps:[{id,title:'',action:seed.content,notes:'',status:'not-started',dueDate:null,sources:[]}],title:t('My next steps','Mis próximos pasos'),category:seed.topic==='costs'?'financial':seed.topic==='transfer'?'transfer':'education',fromNote:seed.noteId&&seed.version?{id:seed.noteId,version:seed.version,stepId:id}:undefined,accepted:false,editing:false}}));
  requestAnimationFrame(()=>{section.current?.scrollIntoView({block:'start'});section.current?.focus({preventScroll:true});});
 },[seed?.serial]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(Object.values(drafts).some(d=>!!d))event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[drafts]);
 function errorText(code:string){
  if(code==='plan_changed')return t('This plan changed in another window. Reload to review the latest version. Your draft is still here.','Este plan cambió en otra ventana. Recarga para revisar la versión más reciente. Tu borrador sigue aquí.');
  if(code==='note_changed'||code==='note_not_found')return t('The original note changed or was deleted. Reopen it in your notebook before making an action. Your draft is still here.','La nota original cambió o se eliminó. Ábrela de nuevo en tu cuaderno antes de crear una acción. Tu borrador sigue aquí.');
  if(code==='create_request_changed'||code==='plan_deleted')return t('An earlier save with this draft was already processed. Refresh and review your saved plans before starting a new draft.','Un guardado anterior de este borrador ya fue procesado. Actualiza y revisa tus planes antes de iniciar un borrador nuevo.');
  if(code==='plan_limit')return t('You have reached the limit of 200 plans. Remove a plan you no longer need.','Llegaste al límite de 200 planes. Elimina uno que ya no necesites.');
  return t('Could not save this change. Your draft is still here. Reload the plan or try again.','No se pudo guardar este cambio. Tu borrador sigue aquí. Recarga el plan o inténtalo de nuevo.');
 }
 async function mutate(body:Record<string,unknown>,clear=false){
  if(lock.current)return;lock.current=true;setBusy(true);const actionScope=scope;setMessages(prev=>({...prev,[actionScope]:''}));
  try{const result=await request(body);if(currentScope.current===actionScope){loadVersion.current++;setData({scope:actionScope,value:result});setFailed(false);}setMessages(prev=>({...prev,[actionScope]:t('Saved to your account.','Guardado en tu cuenta.')}));if(clear)setDrafts(prev=>({...prev,[actionScope]:undefined}));}
  catch(error){setMessages(prev=>({...prev,[actionScope]:errorText(error instanceof Error?error.message:'')}));}finally{lock.current=false;setBusy(false);}
 }
 function start(base?:Plan,step?:Step){
  if(draft&&!window.confirm(t('Replace the unfinished action draft?','¿Reemplazar el borrador de acción sin guardar?')))return;
  setDrafts(prev=>({...prev,[scope]:{requestId:crypto.randomUUID(),base,steps:[step?structuredClone(step):{id:crypto.randomUUID(),title:'',action:'',notes:'',status:'not-started',dueDate:null,sources:[]}],title:t('My next steps','Mis próximos pasos'),category:'education',accepted:!!step,editing:!!step}}));
 }
 const patch=(update:Partial<Draft>)=>setDrafts(prev=>({...prev,[scope]:{...prev[scope]!,...update}}));
 function save(){if(!draft)return;const base=draft.base,steps=draft.editing?base!.steps.map(s=>s.id===draft.steps[0].id?draft.steps[0]:s):[...(base?.steps||[]),...draft.steps];
  void mutate({action:base?'update':'create',...(base?{id:base.id,version:base.version}:{requestId:draft.requestId}),plan:{...(base||{studentId:target,goal:'',category:draft.category,status:'active',summaryIds:[]}),title:base?.title||draft.title,steps},...(draft.fromNote?{fromNote:draft.fromNote}:{})},true);
 }
 const importBatches=legacy?.scope===scope?legacy.batches.filter(b=>!value?.creationIds.includes(b.requestId)):[];
 return <section className={`action-plan${compact?' action-plan-compact':''}${compact&&showFull?' action-plan-expanded':''}`} id="home-action-plan" ref={section} tabIndex={-1} aria-labelledby={heading}>
  <div className="home-section-heading"><h2 id={heading}>{compact?t('Your next step','Tu próximo paso'):t('My next steps','Mis próximos pasos')}</h2><p>{t('One small step, when you’re ready.','Un pequeño paso, cuando estés listo.')}</p></div>
  {compact&&!showFull&&<div className="home-step-preview">
   {loading?<p role="status">{t('Loading your next step…','Cargando tu próximo paso…')}</p>:failed?<p role="alert">{t('We couldn’t load your steps.','No pudimos cargar tus pasos.')} <button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>:<>
    {nextStep?<><span className="home-step-owner">{scopeName}</span><h3>{nextStep.step.title}</h3>{nextStep.step.action&&<p>{nextStep.step.action}</p>}{nextStep.step.dueDate&&<small>{t('Your target: ','Tu meta: ')}{date(nextStep.step.dueDate)}</small>}<div className="action-plan-toolbar"><button type="button" className="button outline" disabled={busy} onClick={()=>void mutate({action:'update',id:nextStep.plan.id,version:nextStep.plan.version,plan:{...nextStep.plan,steps:nextStep.plan.steps.map(step=>step.id===nextStep.step.id?{...step,status:'complete'}:step)}})}><CheckCircle2 size={16} aria-hidden="true"/>{t('Mark done','Marcar como hecho')}</button></div></>:<p>{active.some(plan=>plan.steps.length)?t('You’ve marked all your steps done. Take a moment to enjoy that.','Marcaste todos tus pasos como hechos. Date un momento para disfrutarlo.'):t('No next step yet. You can talk it through with Origen or add one yourself.','Aún no hay un próximo paso. Puedes pensarlo con Origen o agregar uno tú mismo.')}</p>}
    <button type="button" className="text-button" onClick={()=>{setExpanded(true);if(!plans.length&&!importBatches.length)start();requestAnimationFrame(()=>section.current?.focus({preventScroll:true}));}} aria-expanded={false} aria-controls={`${heading}-plans`}>{plans.length||importBatches.length?t('See all my steps','Ver todos mis pasos'):t('Add a step','Agregar un paso')}<ArrowRight size={16} aria-hidden="true"/></button>
    {messages[scope]&&<p role="status">{messages[scope]}</p>}
    {!!importBatches.length&&<p className="home-step-owner">{t('You also have older steps to review in “See all my steps.”','También tienes pasos anteriores para revisar en “Ver todos mis pasos”.')}</p>}
   </>}
  </div>}
  {compact&&showFull&&!draft&&<button type="button" className="text-button" aria-expanded={true} aria-controls={`${heading}-plans`} onClick={()=>{setExpanded(false);requestAnimationFrame(()=>section.current?.focus({preventScroll:true}));}}>{t('Show just my next step','Ver solo mi próximo paso')}</button>}
  <div id={`${heading}-plans`} hidden={!showFull}>
  {role==='parent'&&<div className="home-summary-switch" role="group" aria-label={t('Plan belongs to','Este plan pertenece a')}><button type="button" aria-pressed={target!==null} onClick={()=>setFamilyFor(null)}>{name}</button><button type="button" aria-pressed={target===null} onClick={()=>setFamilyFor(studentId)}>{t('Family plan','Plan familiar')}</button></div>}
  <div className="action-plan-toolbar"><p><strong>{scopeName}</strong> · {t('Private to your account','Privado en tu cuenta')}</p><button className="text-button" type="button" disabled={busy||loading} onClick={()=>setRetry(n=>n+1)}><RefreshCw size={15}/>{t('Refresh plan','Actualizar plan')}</button></div>
  {loading&&<p role="status">{t('Loading your plan…','Cargando tu plan…')}</p>}
  {failed&&<p role="alert">{t('Your plan could not be loaded. Saved actions have not been replaced.','No se pudo cargar tu plan. Las acciones guardadas no se han reemplazado.')} <button className="text-button" type="button" onClick={()=>setRetry(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
  {value?.limited&&<p role="alert">{t('Only the 200 most recently updated plans are shown.','Solo se muestran los 200 planes actualizados más recientemente.')}</p>}
  {messages[scope]&&<p className="action-plan-message" role="status">{messages[scope]}</p>}
  <div className="action-plan-toolbar"><button className="button primary" type="button" disabled={busy||loading||failed} onClick={()=>start()}><Plus size={16}/>{t('Add an action','Agregar una acción')}</button>{plans.some(p=>p.status==='archived')&&<button className="text-button" type="button" onClick={()=>setArchive(!archive)}>{archive?t('Hide archived plans','Ocultar planes archivados'):t('Show archived plans','Ver planes archivados')}</button>}</div>
  {draft&&<form className="action-editor" onSubmit={event=>{event.preventDefault();save();}}><h3>{draft.imported?t('Review older steps','Revisa los pasos anteriores'):draft.fromNote?t('Turn this note into an action','Convierte esta nota en una acción'):draft.editing?t('Edit action','Editar acción'):t('One next step','Un próximo paso')}</h3>
   {draft.fromNote&&<p>{t('Rewrite the takeaway as something you want to do. This saves a separate action; your original note stays as it is.','Reescribe la idea como algo que quieres hacer. Se guarda una acción separada; la nota original se conserva.')}</p>}
   {!draft.editing&&!draft.imported&&<label>{t('Save in','Guardar en')}<select disabled={busy} value={draft.base?.id||''} onChange={e=>patch({base:active.find(p=>p.id===e.target.value)})}><option value="">{t('A new plan','Un plan nuevo')}</option>{active.filter(p=>p.steps.length<30).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
   {!draft.base&&<label>{t('Plan name','Nombre del plan')}<input required maxLength={200} value={draft.title} disabled={busy} onChange={e=>patch({title:e.target.value})}/></label>}
   {conflict&&<div className="action-plan-message" role="alert"><p>{latest?t('The saved plan changed. Review the latest actions below before applying your draft.','El plan guardado cambió. Revisa las acciones más recientes abajo antes de aplicar tu borrador.'):t('The saved plan is no longer available. Copy this draft into a new plan.','El plan guardado ya no está disponible. Copia este borrador a un plan nuevo.')}</p>{latest&&<ul>{latest.steps.map(s=><li key={s.id}>{s.title}: {s.action} · {statuses[s.status]}</li>)}</ul>}<button type="button" className="text-button" disabled={busy} onClick={()=>{if(alreadySaved)setDrafts(prev=>({...prev,[scope]:undefined}));else patch({base:latest,editing:!!latest&&!!draft.editing&&latest.steps.some(s=>s.id===draft.steps[0].id),requestId:crypto.randomUUID()});}}>{alreadySaved?t('Use the saved action','Usar la acción guardada'):t('I reviewed it; keep my draft','Lo revisé; conservar mi borrador')}</button></div>}
   {draft.steps.map((step,index)=><fieldset key={step.id} disabled={busy}><legend>{draft.imported?`${index+1}. ${step.title}`:t('Action details','Detalles de la acción')}</legend><label>{t('Action title','Título de la acción')}<input required maxLength={200} value={step.title} onChange={e=>patch({steps:draft.steps.map((s,i)=>i===index?{...s,title:e.target.value}:s)})}/></label><label>{t('What I want to do','Lo que quiero hacer')}<textarea maxLength={4000} rows={3} value={step.action} onChange={e=>patch({steps:draft.steps.map((s,i)=>i===index?{...s,action:e.target.value}:s)})}/></label><div className="action-editor-row"><label>{t('Personal target date (optional)','Fecha meta personal (opcional)')}<input type="date" max="9999-12-31" value={step.dueDate||''} onChange={e=>patch({steps:draft.steps.map((s,i)=>i===index?{...s,dueDate:e.target.value||null}:s)})}/></label>{(draft.editing||draft.imported)&&<label>{t('Progress','Progreso')}<select value={step.status} onChange={e=>patch({steps:draft.steps.map((s,i)=>i===index?{...s,status:e.target.value as Step['status']}:s)})}>{Object.entries(statuses).map(([status,label])=><option key={status} value={status}>{label}</option>)}</select></label>}</div><small>{t('This is your own target, not an official deadline.','Esta es tu meta personal, no una fecha límite oficial.')}</small><label>{t('Notes (optional)','Notas (opcional)')}<textarea maxLength={4000} value={step.notes} onChange={e=>patch({steps:draft.steps.map((s,i)=>i===index?{...s,notes:e.target.value}:s)})}/></label></fieldset>)}
   {!draft.editing&&<label className="action-accept"><input type="checkbox" checked={draft.accepted} disabled={busy} onChange={e=>patch({accepted:e.target.checked})}/>{t('I reviewed these actions and want them in my plan.','Revisé estas acciones y quiero agregarlas a mi plan.')}</label>}
   <div className="action-plan-toolbar"><button type="submit" className="button primary" disabled={busy||loading||failed||conflict||!draft.accepted||!draft.title.trim()||draft.steps.some(s=>!s.title.trim())}>{busy?t('Saving…','Guardando…'):draft.editing?t('Save changes','Guardar cambios'):t('Accept and save actions','Aceptar y guardar acciones')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm(t('Discard this unfinished action draft?','¿Descartar este borrador de acción sin guardar?')))setDrafts(prev=>({...prev,[scope]:undefined}));}}>{t('Dismiss draft','Descartar borrador')}</button></div>
  </form>}
  {!loading&&!failed&&!shown.length&&<p className="action-plan-empty">{t('No actions here yet. Add a next step, or turn a note from your topics into an action.','Todavía no hay acciones aquí. Agrega un próximo paso o convierte una nota de tus temas en una acción.')}</p>}
  {!loading&&!failed&&shown.map(plan=><article className="saved-plan" key={plan.id}><div className="action-plan-toolbar"><div><h3>{plan.title}</h3><small>{plan.status==='archived'?t('Archived','Archivado'):`${plan.steps.filter(s=>s.status==='complete').length}/${plan.steps.length} ${t('marked done by you','marcados como hechos por ti')}`}</small></div><button type="button" className="text-button" disabled={busy} onClick={()=>void mutate({action:'update',id:plan.id,version:plan.version,plan:{...plan,status:plan.status==='archived'?'active':'archived'}})}>{plan.status==='archived'?t('Restore plan','Restaurar plan'):t('Archive plan','Archivar plan')}</button></div>{plan.goal&&<p>{plan.goal}</p>}
   <ul className="saved-actions">{plan.steps.map(step=><li key={step.id}><div className="saved-action-top"><strong>{step.title}</strong><span>{statuses[step.status]}</span></div>{step.action&&<p>{step.action}</p>}{step.dueDate&&<p className="action-date">{t('Your target: ','Tu meta: ')}{date(step.dueDate)}</p>}{step.notes&&<details><summary>{t('Your notes','Tus notas')}</summary><p>{step.notes}</p></details>}{step.sources.length>0&&<details><summary>{t('Saved sources','Fuentes guardadas')}</summary><p>{t('These references have not been checked again for this action.','Estas referencias no se han vuelto a verificar para esta acción.')}</p>{step.sources.filter(s=>s.url.startsWith('https://')).map((source,i)=><a key={i} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowRight size={13}/></a>)}</details>}
   <div className="action-plan-toolbar">{plan.status==='active'&&<WorkspaceTalkButton t={t} disabled={busy} focus={{kind:'action',studentId:target,topic:planTopic(plan.category),planId:plan.id,stepId:step.id,version:plan.version}}/>}{plan.status==='active'&&<button className="text-button" type="button" disabled={busy} onClick={()=>void mutate({action:'update',id:plan.id,version:plan.version,plan:{...plan,steps:plan.steps.map(s=>s.id===step.id?{...s,status:step.status==='complete'?'not-started':'complete'}:s)}})}><CheckCircle2 size={16}/>{step.status==='complete'?t('Reopen','Reabrir'):t('Mark done','Marcar como hecho')}</button>}<button className="text-button" type="button" disabled={busy} onClick={()=>start(plan,step)}>{t('Edit action','Editar acción')}</button><button className="text-button" type="button" disabled={busy} onClick={()=>{if(window.confirm(t('Remove this action from your plan? Your notebook is unchanged.','¿Quitar esta acción del plan? Tu cuaderno se conserva.')))void mutate({action:'update',id:plan.id,version:plan.version,plan:{...plan,steps:plan.steps.filter(s=>s.id!==step.id)}});}}>{t('Remove action','Quitar acción')}</button></div></li>)}</ul>
   <div className="action-plan-toolbar">{plan.status==='active'&&<button type="button" className="text-button" disabled={busy||plan.steps.length>=30} onClick={()=>start(plan)}><Plus size={15}/>{t('Add to this plan','Agregar a este plan')}</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm(t('Delete this plan and all its actions? Your notebook notes will remain.','¿Eliminar este plan y todas sus acciones? Las notas de tu cuaderno se conservan.')))void mutate({action:'delete',id:plan.id,version:plan.version});}}>{t('Delete plan','Eliminar plan')}</button></div>
  </article>)}
  {legacy?.scope===scope&&legacy.error&&<p role="alert">{t('Older browser-only steps could not be read. They have not been deleted.','No se pudieron leer los pasos anteriores de este navegador. No se han eliminado.')}</p>}
  {!loading&&!failed&&importBatches.length>0&&<aside className="legacy-plan"><h3>{t('Bring your older steps with you','Conserva tus pasos anteriores')}</h3><p>{t('Some steps are saved only in this browser. Review the dates and progress before saving them to your account. The browser copy will remain.','Algunos pasos solo están guardados en este navegador. Revisa las fechas y el progreso antes de guardarlos en tu cuenta. La copia del navegador se conserva.')}</p>{importBatches.map((batch,index)=><button type="button" className="text-button" key={batch.requestId} disabled={busy} onClick={()=>{if(draft&&!window.confirm(t('Replace your unfinished draft?','¿Reemplazar el borrador sin guardar?')))return;setDrafts(prev=>({...prev,[scope]:{requestId:batch.requestId,steps:structuredClone(batch.steps),title:t('My previous steps','Mis pasos anteriores'),category:'education',accepted:false,editing:false,imported:true}}));section.current?.scrollIntoView();}}>{t('Review older steps','Revisar pasos anteriores')} {importBatches.length>1?index+1:''} ({batch.steps.length})</button>)}</aside>}
 </div>
 </section>;
}
