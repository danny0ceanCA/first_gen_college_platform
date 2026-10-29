import {StudentEntryComments} from './StudentComments';
import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {useFamily} from './FamilyStore';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {notifyMemoryContext,subscribeMemoryContext} from './memoryContext.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
import './StudentMemory.css';
import OrganizationEvidence,{type OrganizationInfo} from './OrganizationEvidence';
import useBinderCorrections from './useBinderCorrections';
import BinderNoteHighlight from './BinderNoteHighlight';
import {binderMemoryEntries,binderMemorySignalId,binderMemoryReviewEntries,binderMemorySummaryEntries} from './binderMemory.mjs';
import type {BinderTopic} from './binderSignals.mjs';
import {useBinderNavigationGuard} from './useBinderFollow';
type Category='goal'|'constraint'|'preference'|'question';
export type Memory={id:string;version:number;studentId:string|null;category:Category;content:string;language:'en'|'es';speaker:'student'|'parent'|'family'|'unknown';reportedBy:string;status:'proposed'|'confirmed';conversationAt?:string|null;summaryId:string|null;sourceVersion:string|null;quote:string;updatedAt:string;organization?:OrganizationInfo};
type Data={available:boolean;correctionsEnabled?:boolean;extractionEnabled?:boolean;organizationManaged?:boolean;memories:Memory[];pendingCount:number};
type Draft=Omit<Memory,'version'|'status'|'reportedBy'|'summaryId'|'sourceVersion'|'quote'|'updatedAt'>&{version?:number};
type Props={presentation?:'review'|'summary';revealId?:string;topic?:BinderTopic;onEntries?:(entries:Memory[])=>void;freshIds?:Set<string>;onRead?:(id:string)=>void;studentId:string|null;language:'en'|'es';historyKey:string;t:(en:string,es:string)=>string};
export default function StudentMemory({studentId,language,historyKey,t,topic,presentation,onEntries,freshIds,onRead,revealId}:Props){
 const {user}=useAuth0(),family=useFamily();
 const reviewing=presentation==='review',paper=!!topic||presentation==='summary';
 const corrections=useBinderCorrections('memory',studentId);
 const [data,setData]=useState<Data>(),[draft,setDraft]=useState<Draft>(),[category,setCategory]=useState<Category>('goal'),[page,setPage]=useState(0);
 const [busy,setBusy]=useState(false),[organizing,setOrganizing]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[syncError,setSyncError]=useState(false),[attempt,setAttempt]=useState(0);
 const entriesListener=useRef(onEntries);entriesListener.current=onEntries;
 useBinderNavigationGuard(!!draft||busy);
 useEffect(()=>{if(data)entriesListener.current?.(data.memories||[]);},[data]);
 const pending=useRef(false),generation=useRef(0),requests=useRef(new Set<AbortController>()),heading=useRef<HTMLHeadingElement>(null),editor=useRef<HTMLTextAreaElement>(null);
 const labels:Record<Category,string>={goal:t('Goals','Metas'),constraint:t('Practical needs','Necesidades prácticas'),preference:t('Preferences','Preferencias'),question:t('Open questions','Preguntas pendientes')};
 const speakers:Record<Memory['speaker'],string>={student:t('Student','Estudiante'),parent:t('Parent or guardian','Madre, padre o tutor'),family:t('Family','Familia'),unknown:t('Not specified','Sin especificar')};
 const profile=family.students.find(s=>s.id===studentId);
 async function request(body:Record<string,unknown>){
  const controller=new AbortController(),lease=browserPrivacy.capture({studentId});requests.current.add(controller);
  try{return await withRequestDeadline(async signal=>{
   const response=await apiFetch('/api/student-memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,studentId}),signal});const result=await response.json();lease.assert();
   if(!response.ok||result.memories?.some((item:Memory)=>item.studentId!==studentId))throw new Error(result.error||'memory_unavailable');return result as Data;
  },{signal:AbortSignal.any([controller.signal,lease.signal]),timeoutMs:30000});}
  finally{lease.release();requests.current.delete(controller);}
 }
 useEffect(()=>()=>{generation.current++;for(const c of requests.current)c.abort();},[]);
 useEffect(()=>browserPrivacy.subscribe(event=>{
  generation.current++;for(const c of requests.current)c.abort();setData(undefined);setDraft(undefined);setMessage('');setError('');if(event.type!=='end')setAttempt(n=>n+1);
 }),[]);
 useEffect(()=>subscribeMemoryContext(user?.sub,target=>{if(target===studentId&&!pending.current)setAttempt(n=>n+1);}),[user?.sub,studentId]);
 useEffect(()=>{
  const version=++generation.current;let active=true;
  void request({action:'load'}).then(async result=>{
   if(!active||version!==generation.current)return;setData(result);setError('');
   // One resumable proposal batch after a history change. Existing pages remain usable.
   if(!paper&&result.available&&result.extractionEnabled!==false&&result.pendingCount){setOrganizing(true);try{const synced=await request({action:'sync'});if(active&&version===generation.current){setData(synced);setSyncError(false);}}catch{if(active&&version===generation.current)setSyncError(true);}finally{if(active)setOrganizing(false);}}
  }).catch(()=>{if(active&&version===generation.current)setError(t('Your memories could not be loaded. Try again.','No se pudieron cargar tus recuerdos. Intenta de nuevo.'));});
  return()=>{active=false;};
 },[historyKey,attempt,studentId]);
 useEffect(()=>{if(draft)editor.current?.focus();},[draft?.id]);
 async function act(body:Record<string,unknown>){
  let acknowledged=false;
  if(pending.current)return;pending.current=true;setBusy(true);setMessage('');setError('');const version=++generation.current;
  try{
   let result:Data;
   if(data?.correctionsEnabled&&['update','delete','confirm','undo'].includes(String(body.action))){
    if(body.action==='undo')await corrections.restore();else await corrections.change(body,data.memories.find(m=>m.id===body.id));
    acknowledged=true;setDraft(undefined);
    result=await request({action:'load'});
   }else result=await request(body);
   if(version!==generation.current)return;
   setData(result);setDraft(undefined);setPage(0);
   if(user?.sub)notifyMemoryContext(user.sub,studentId);
   setMessage(body.action==='undo'?t('The selected detail was restored. Sharing remains unchanged.','Se restauró el dato seleccionado. Lo compartido no cambia.'):body.action==='delete'?t('Removed from Origen’s memory.','Eliminado de los recuerdos de Origen.'):t('Detail saved in your notebook.','Dato guardado en tu cuaderno.'));heading.current?.focus();
  }catch(cause){if(version===generation.current)setError(acknowledged?t('Your change was saved. Reload to display it.','Tu cambio se guardó. Recarga para verlo.'):cause instanceof Error&&cause.message==='undo_unavailable'?t('Undo is no longer available. Reload to see current information.','Ya no se puede deshacer. Recarga para ver la información actual.'):cause instanceof Error&&cause.message==='memory_limit'?t('Your memory has 200 details. Remove one you no longer need before adding another. Your draft is still here.','Tus recuerdos tienen 200 datos. Quita uno que ya no necesites antes de agregar otro. Tu borrador sigue aquí.'):cause instanceof Error&&['memory_changed','item_changed','operation_changed','correction_operation_required'].includes(cause.message)?t('This detail changed elsewhere. Reload, then review the current version before editing. Your draft is still here.','Este dato cambió en otro lugar. Recarga y revisa la versión actual antes de editar. Tu borrador sigue aquí.'):t('Could not save the change. Your draft is still here; try again.','No se pudo guardar el cambio. Tu borrador sigue aquí; intenta de nuevo.'));}
  finally{pending.current=false;setBusy(false);}
 }
 const scopedEntries=reviewing?binderMemoryReviewEntries(data?.memories,studentId):presentation==='summary'?binderMemorySummaryEntries(data?.memories,studentId):topic?binderMemoryEntries(data?.memories,studentId,topic):data?.memories||[];
 const visibleCategories=topic||reviewing?Object.keys(labels).filter(key=>scopedEntries.some(entry=>entry.category===key)):Object.keys(labels);
 const activeCategory=(topic||reviewing)&&!visibleCategories.includes(category)?visibleCategories[0] as Category||'goal':category;
 const entries=paper?scopedEntries:scopedEntries.filter(m=>m.category===activeCategory),pages=Math.max(1,Math.ceil(entries.length/3)),currentPage=Math.min(page,pages-1);
 useEffect(()=>{if(!revealId||!data)return;const entry=scopedEntries.find(m=>m.id===revealId);if(entry){setCategory(entry.category);setPage(Math.floor((paper?scopedEntries:scopedEntries.filter(m=>m.category===entry.category)).findIndex(m=>m.id===revealId)/3));requestAnimationFrame(()=>{const element=document.querySelector<HTMLElement>(`[data-memory-id="${CSS.escape(revealId)}"] [data-comment-id]`);element?.focus({preventScroll:true});element?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});}},[revealId,data]);
 const undoControl=data?.correctionsEnabled&&corrections.undo&&<div className="memory-actions"><button type="button" disabled={busy||!!draft} onClick={()=>void act({action:'undo'})}>{t('Undo last change','Deshacer último cambio')}</button><span>{t('Available here for 10 minutes. Restores only this detail.','Disponible aquí durante 10 minutos. Solo restaura este dato.')}</span></div>;
 const changed=!!draft?.version&&data?.memories.find(m=>m.id===draft.id)?.version!==draft.version;
 if(reviewing&&data&&!error&&!busy&&!organizing&&!scopedEntries.length&&!data.pendingCount)return message||undoControl?<div className="memory-saved-notice">{message&&<p role="status">{message}</p>}{undoControl}</div>:null;

 const Container=paper?'section':'details';
 return <Container className={`student-memory${paper?' student-memory-topic student-memory-paper':''}`} data-review={reviewing||undefined}>{paper?<h4 ref={heading} tabIndex={-1}>{topic?t('Details from your conversations','Datos de tus conversaciones'):studentId===null?t('About your family','Sobre tu familia'):t('About you','Sobre ti')}</h4>:<summary>{reviewing?t('Details to confirm','Datos por confirmar'):t('What Origen remembers','Lo que Origen recuerda')}<span>{reviewing?scopedEntries.length:t('Review and update','Revisar y actualizar')}</span></summary>}
  <div className="student-memory-body">{!paper&&<h3 tabIndex={-1} ref={heading}>{t('Your story, in your words','Tu historia, en tus palabras')}</h3>}
   {!paper&&<p>{t('Keep the details that help Origen understand you. Conversation suggestions need your review. Saving a detail confirms it for this account; a parent’s report stays attributed to the parent.','Conserva los detalles que ayudan a Origen a comprenderte. Revisa las sugerencias de las conversaciones. Guardar un dato lo confirma para esta cuenta; lo informado por un padre sigue atribuido a él.')}</p>}
   {(!paper||!!draft)&&<p className="memory-call-note">{t('Editing or removing a detail ends an active call so the next one uses current information. That interrupted call is not saved.','Editar o eliminar un dato termina una llamada activa para que la próxima use información actualizada. Esa llamada interrumpida no se guarda.')}</p>}
   {!paper&&!reviewing&&profile&&(profile.goals||profile.needs)&&<details className="memory-profile"><summary>{t('From your student profile','De tu perfil de estudiante')}</summary>{profile.goals&&<p><strong>{labels.goal}: </strong>{profile.goals}</p>}{profile.needs&&<p><strong>{labels.constraint}: </strong>{profile.needs}</p>}<p>{t('Use Edit profile above your binder to update these details. Your saved notes and next steps also inform conversations.','Usa Editar perfil encima de tu carpeta para actualizar estos datos. Tus notas y próximos pasos también orientan las conversaciones.')}</p></details>}
   {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>setAttempt(n=>n+1)}>{t('Reload','Recargar')}</button></p>}{message&&<p role="status">{message}</p>}
   {!data&&!error&&<p role="status">{t('Loading…','Cargando…')}</p>}
   {data?.available===false&&<p>{t('Memory controls are not available yet. Your profile and binder are still available.','Los controles de recuerdos aún no están disponibles. Tu perfil y carpeta siguen disponibles.')}</p>}
   {undoControl}
   {corrections.withdrawn>0&&<p role="status">{t('Related unreviewed details were withdrawn so old information is not used again. Undo restores only the selected detail.','Se retiraron los datos relacionados sin revisar para no volver a usar información anterior. Deshacer solo restaura el dato seleccionado.')}</p>}
   {data?.available&&<><div className="memory-toolbar">{!paper&&<label>{t('Topic','Tema')}<select value={activeCategory} onChange={e=>{setCategory(e.target.value as Category);setPage(0);}}>{visibleCategories.map(key=><option key={key} value={key}>{labels[key as Category]}</option>)}</select></label>}{!topic&&!reviewing&&<button type="button" disabled={busy||!!draft} onClick={()=>setDraft({id:crypto.randomUUID(),studentId,category,content:'',language,speaker:family.account.role==='parent'?'parent':'student'})}>{t('Add a detail','Agregar un dato')}</button>}</div>
   {draft&&<form className="memory-editor" onSubmit={e=>{e.preventDefault();setCategory(draft.category);void act({action:draft.version?'update':'create',id:draft.id,version:draft.version,memory:{category:draft.category,content:draft.content,language:draft.language,speaker:draft.speaker}});}}>
    <label>{t('Topic','Tema')}<select disabled={busy} value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value as Category})}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>{t('Whose perspective?','¿De quién es la perspectiva?')}<select disabled={busy} value={draft.speaker} onChange={e=>setDraft({...draft,speaker:e.target.value as Memory['speaker']})}>{Object.entries(speakers).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>{t('Detail to remember','Dato para recordar')}<textarea ref={editor} value={draft.content} maxLength={1000} rows={4} disabled={busy} onChange={e=>setDraft({...draft,content:e.target.value})}/></label>
    {changed&&<p>{t('A newer version is available. Close this draft and edit the current detail below.','Hay una versión más reciente. Cierra este borrador y edita el dato actual abajo.')}</p>}
    <div className="memory-actions"><button type="submit" disabled={busy||changed||!draft.content.trim()}>{t('Save detail','Guardar dato')}</button><button type="button" disabled={busy} onClick={()=>setDraft(undefined)}>{t('Cancel','Cancelar')}</button></div>
   </form>}
   <div className="memory-entries">{entries.slice(currentPage*3,currentPage*3+3).map(m=><BinderNoteHighlight key={m.id} id={m.id} topic={topic||'options'} memory fresh={!!topic&&!!freshIds?.has(binderMemorySignalId(m.id))} suggested={m.status==='proposed'} onRead={()=>onRead?.(binderMemorySignalId(m.id))}>
    <div className="student-note-writing"><div className="memory-meta"><span>{m.status==='proposed'?t('From a conversation · To review','De una conversación · Por revisar'):t('Confirmed in this account','Confirmado en esta cuenta')}</span><time dateTime={m.updatedAt}>{new Date(m.updatedAt).toLocaleDateString(language)}</time></div>
    {m.status==='proposed'&&<OrganizationEvidence value={m.organization} t={t}/>}
    <p className="memory-writing" lang={m.language}>{m.content}</p><p className="memory-attribution">{speakers[m.speaker]} · {t('Shared by: ','Compartido por: ')}{speakers[m.reportedBy as Memory['speaker']]||speakers.unknown}</p>
    {m.summaryId&&<details className="memory-evidence"><summary>{t('See source','Ver fuente')}</summary>{m.conversationAt&&<time dateTime={m.conversationAt}>{new Date(m.conversationAt).toLocaleDateString(language)}</time>}<blockquote lang={m.language}>{m.quote}</blockquote><p>{t('From a saved summary, not a verbatim transcript. Deleting that conversation also removes this linked memory. A correction or removal excludes that summary and its linked notes from future calls; it stays in your binder.','De un resumen guardado, no de una transcripción literal. Eliminar esa conversación también elimina este recuerdo vinculado. Corregir o quitar un dato excluye ese resumen y sus notas vinculadas de las futuras llamadas; sigue en tu carpeta.')}</p></details>}
    {paper&&m.status==='confirmed'?<details className="memory-management"><summary>{t('Options','Opciones')}</summary><div className="memory-actions"><button type="button" disabled={busy||!!draft} onClick={()=>setDraft({...m})}>{t('Edit detail','Editar dato')}</button><button type="button" disabled={busy||!!draft} onClick={()=>void act({action:'delete',id:m.id,version:m.version})}>{t('Remove detail','Quitar dato')}</button></div></details>:<div className="memory-actions">{m.status==='proposed'&&<button type="button" disabled={busy||!!draft} onClick={()=>void act({action:'confirm',id:m.id,version:m.version})}>{t('Confirm detail','Confirmar dato')}</button>}<button type="button" disabled={busy||!!draft} onClick={()=>setDraft({...m})}>{t('Edit detail','Editar dato')}</button><button type="button" disabled={busy||!!draft} onClick={()=>void act({action:'delete',id:m.id,version:m.version})}>{t('Remove detail','Quitar dato')}</button></div>}
    </div>{topic&&<StudentEntryComments id={m.id} kind="memory" topic={topic}/>}
   </BinderNoteHighlight>)}</div>
   {!entries.length&&<p>{t('Nothing saved in this topic yet. Add something that would help your next conversation.','Aún no hay datos en este tema. Agrega algo que ayude en tu próxima conversación.')}</p>}
   {pages>1&&<nav className="memory-actions" aria-label={t('Memory pages','Páginas de recuerdos')}><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>{t('Previous','Anterior')}</button><span>{currentPage+1} / {pages}</span><button type="button" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}>{t('Next','Siguiente')}</button></nav>}
   {organizing&&<p role="status">{t('Preparing suggestions from one conversation…','Preparando sugerencias de una conversación…')}</p>}
   {syncError&&<p role="status">{t('Conversation suggestions could not be prepared. Your saved conversations and details are still here.','No se pudieron preparar las sugerencias. Tus conversaciones y datos guardados siguen aquí.')}</p>}
    {data.pendingCount>0&&(data.organizationManaged?<p role="status">{t('Your conversation is saved. Origen is organizing the useful details.','Tu conversación está guardada. Origen está organizando los datos útiles.')}</p>:<button type="button" disabled={busy||organizing} onClick={()=>setAttempt(n=>n+1)}>{syncError?t('Retry suggestions','Reintentar sugerencias'):t(`Review older conversations (${data.pendingCount})`,`Revisar conversaciones anteriores (${data.pendingCount})`)}</button>)}
   </>}
  </div>
 </Container>;
}
