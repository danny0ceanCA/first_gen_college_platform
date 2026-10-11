import WorkspaceTalkButton from './WorkspaceTalkButton';
import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowRight,BookOpen,Check,Compass,GraduationCap,Languages,Map,MessageCircle,Plus,Trash2,Wallet} from 'lucide-react';
import {apiFetch} from './api';
import {useConversationHistory} from './ConversationHistory';
import './TopicNotebook.css';
import type {ActionSeed} from './ActionPlan';

type Topic='options'|'transfer'|'costs'|'applications';
type Kind='note'|'explanation'|'question'|'decision';
type Language='en'|'es';
type Note={id:string;studentId:string|null;topic:Topic;kind:Kind;content:string;language:Language;status:'saved'|'suggested';origin:'user'|'conversation';summaryId:string|null;quote:string;translations:Partial<Record<Language,string>>;version:number;updatedAt:string;sources:{title:string;url:string;checkedAt:string}[];conversationAt:string|null};
type Draft={decisionConfirmed?:boolean;id:string;version?:number;topic:Topic;kind:Kind;content:string;language:Language};
type Data={scope:string;notes:Note[];generatedSummaryIds:string[]};
type Props={onAction:(seed:Omit<ActionSeed,'serial'>)=>void;studentId:string;name:string;role:'parent'|'student';language:Language;t:(en:string,es:string)=>string;navigate:(page:'explore'|'planning'|'costs'|'applications')=>void};

export default function TopicNotebook({onAction,studentId,name,role,language,t,navigate}:Props){
 const history=useConversationHistory();
 const {user,getAccessTokenSilently}=useAuth0();
 const [familyFor,setFamilyFor]=useState<string|null>(null);
 const target=role==='parent'&&familyFor===studentId?null:studentId;
 const scope=JSON.stringify([user?.sub,target]);
 const latestScope=useRef(scope);latestScope.current=scope;
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[attempt,setAttempt]=useState(0);
 const [open,setOpen]=useState<Topic|null>(null),[drafts,setDrafts]=useState<Record<string,Draft|undefined>>({});
 const [message,setMessage]=useState<{scope:string;text:string;error:boolean}|null>(null),[busy,setBusy]=useState(false);
 const inFlight=useRef(false),mutationVersion=useRef(0),panel=useRef<HTMLElement>(null),editor=useRef<HTMLTextAreaElement>(null);
 const [originals,setOriginals]=useState<Record<string,boolean>>({});
 const topics=[
  {id:'options' as const,title:t('College options','Opciones universitarias'),detail:t('Interests, majors, and places to study.','Intereses, carreras y lugares para estudiar.'),page:'explore' as const,icon:Compass},
  {id:'transfer' as const,title:t('Transfer & courses','Transferencias y cursos'),detail:t('Your path, coursework, and counselor questions.','Tu camino, cursos y preguntas para el consejero.'),page:'planning' as const,icon:Map},
  {id:'costs' as const,title:t('Paying for college','Pagar la universidad'),detail:t('Costs, aid, and student loans.','Costos, ayudas y préstamos estudiantiles.'),page:'costs' as const,icon:Wallet},
  {id:'applications' as const,title:t('Applications','Solicitudes'),detail:t('Applications and questions about applying.','Solicitudes y preguntas sobre el proceso.'),page:'applications' as const,icon:GraduationCap}
 ];
 const kinds:Record<Kind,string>={decision:t('Decisions I made','Decisiones que tomé'),note:t('My notes','Mis notas'),explanation:t('Things we covered','Lo que conversamos'),question:t('Questions to revisit','Preguntas por retomar')};
 const notes=data?.scope===scope?data.notes:[],receipts=data?.scope===scope?data.generatedSummaryIds:[];
 const draftKey=JSON.stringify([scope,open]),draft=drafts[draftKey];
 const latestDraftNote=draft?.version?notes.find(note=>note.id===draft.id):undefined;
 const draftConflict=!!latestDraftNote&&latestDraftNote.version!==draft?.version;
 const discussions=history.items.filter(item=>item.studentId===target).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const historyKey=discussions.map(item=>item.id).join('|');
 async function request(body:Record<string,unknown>,signal?:AbortSignal){
  const token=await getAccessTokenSilently();let sub;
  if(!token)throw new Error('account_changed');
  try{sub=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
  if(!user?.sub||sub!==user.sub)throw new Error('account_changed');
  const timeout=AbortSignal.timeout(40000);
  const response=await apiFetch('/api/topic-notes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,timeout]):timeout});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'notes_unavailable');
  if(!Array.isArray(result.notes)||!Array.isArray(result.generatedSummaryIds)||result.notes.some((note:Note)=>note.studentId!==body.studentId))throw new Error('notes_unavailable');
  return result as Omit<Data,'scope'>;
 }
 useEffect(()=>{
  if(!history.cloud){setLoading(false);return;}
  const controller=new AbortController(),version=mutationVersion.current;let current=true;setLoading(true);setLoadError(false);setData(null);
  request({action:'load',studentId:target},controller.signal).then(result=>{if(current&&version===mutationVersion.current)setData({scope,...result});}).catch(()=>{if(current&&version===mutationVersion.current)setLoadError(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;controller.abort();};
 },[scope,attempt,historyKey,history.cloud]);
 useEffect(()=>{if(draft)editor.current?.focus();},[draft?.id,draftKey]);
 useEffect(()=>{
  const warn=(event:BeforeUnloadEvent)=>{if(Object.values(drafts).some(value=>value?.content.trim()))event.preventDefault();};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[drafts]);
 const date=(value:string)=>new Date(value).toLocaleDateString(language==='es'?'es-US':'en-US',{dateStyle:'medium'});
 function errorText(code:string){
  if(code==='note_changed')return t('This note changed in another window. Your draft is still here. Reload the notebook and review the latest note before saving again.','Esta nota cambió en otra ventana. Tu borrador sigue aquí. Recarga el cuaderno y revisa la versión más reciente antes de guardar de nuevo.');
  if(code==='notes_ai_limit')return t('You’ve reached the hourly limit for suggestions and translations. You can still write and edit your notes. Try again later.','Alcanzaste el límite por hora de sugerencias y traducciones. Aún puedes escribir y editar tus notas. Inténtalo más tarde.');
  if(code==='note_limit')return t('Your notebook is full. Delete a note you no longer need before adding another.','Tu cuaderno está lleno. Elimina una nota que ya no necesites antes de agregar otra.');
  if(code==='summary_not_found'||code==='note_not_found')return t('That conversation or note is no longer available. Reload the notebook.','Esa conversación o nota ya no está disponible. Recarga el cuaderno.');
  return t('Could not finish that request. Your draft has not been cleared. Please try again.','No se pudo completar la solicitud. Tu borrador no se borró. Inténtalo de nuevo.');
 }
 async function act(body:Record<string,unknown>,success:string,clearDraft=false){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage(null);
  const actionScope=scope,actionDraftKey=draftKey;
  try{const result=await request({...body,studentId:target});if(latestScope.current===actionScope){mutationVersion.current++;setData({scope:actionScope,...result});setLoadError(false);setMessage({scope:actionScope,text:success,error:false});}if(clearDraft)setDrafts(prev=>({...prev,[actionDraftKey]:undefined}));}
  catch(error){if(latestScope.current===actionScope)setMessage({scope:actionScope,text:errorText(error instanceof Error?error.message:''),error:true});}
  finally{inFlight.current=false;setBusy(false);}
 }
 function edit(note?:Note,kind?:Kind){
  if(!open)return;
  if(draft&&draft.content.trim()&&!window.confirm(t('Replace the unsaved draft in this topic?','¿Reemplazar el borrador sin guardar de este tema?')))return;
  setDrafts(prev=>({...prev,[draftKey]:note?{id:note.id,version:note.version,topic:note.topic,kind:kind||note.kind,content:note.content,language:note.language,decisionConfirmed:false}:{id:crypto.randomUUID(),topic:open,kind:'note',content:'',language}}));
 }
 function openTopic(topic:Topic){setOpen(topic);requestAnimationFrame(()=>{panel.current?.scrollIntoView({behavior:'instant',block:'start'});panel.current?.focus({preventScroll:true});});}
 function renderNote(note:Note){
  const translated=note.language!==language&&note.translations[language]&&!originals[note.id];
  return <article className={`notebook-note${note.status==='suggested'?' notebook-suggestion':''}`} key={note.id}>
   <div className="notebook-note-meta"><span>{kinds[note.kind]}</span><span>{note.status==='suggested'?t('Suggested by Origen · Review first','Sugerencia de Origen · Revísala primero'):t('Saved by you','Guardada por ti')}</span></div>
   <p className="notebook-note-content" lang={translated?language:note.language}>{translated?note.translations[language]:note.content}</p>
   {note.language!==language&&<div className="notebook-translation">{translated?<><span>{t('AI translation · Original preserved','Traducción con IA · Original conservado')}</span><button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:true}))}>{t('Show original','Ver original')}</button></>:note.translations[language]?<button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:false}))}>{t('Show translation','Ver traducción')}</button>:<button type="button" className="text-button" disabled={busy} onClick={()=>void act({action:'translate',id:note.id,version:note.version,language},t('Translation ready. The original is unchanged.','Traducción lista. El original no cambió.'))}><Languages size={15} aria-hidden="true"/>{t('Read in English','Leer en español')}</button>}</div>}
   {note.summaryId&&<details className="notebook-provenance"><summary>{t('From a saved conversation','De una conversación guardada')}{note.conversationAt?` · ${date(note.conversationAt)}`:''}</summary><blockquote>{note.quote}</blockquote><p>{t('This excerpt is from the saved summary. Deleting that conversation also deletes this linked note.','Este fragmento proviene del resumen guardado. Al eliminar esa conversación también se elimina esta nota vinculada.')}</p>{note.sources.length>0&&<><strong>{t('Sources discussed in that conversation','Fuentes consultadas en esa conversación')}</strong><p>{t('These links have not been checked again for this note.','Estos enlaces no se han vuelto a verificar para esta nota.')}</p><ul>{note.sources.filter(source=>/^https?:\/\//.test(source.url)).map((source,index)=><li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{t('Checked during conversation: ','Consultada durante la conversación: ')}{date(source.checkedAt)}</small></li>)}</ul></>}</details>}
   <div className="notebook-note-actions">{note.status==='saved'&&<WorkspaceTalkButton t={t} disabled={busy} focus={{kind:'note',studentId:target,topic:note.topic,noteId:note.id,version:note.version}}/>}<button type="button" className="text-button" disabled={busy} onClick={()=>onAction({studentId:target,noteId:note.id,version:note.version,content:note.content,topic:note.topic})}>{t('Make an action','Crear una acción')}</button>{note.kind!=='decision'&&<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note,'decision')}>{t('Save as a decision','Guardar como decisión')}</button>}{note.kind!=='question'&&<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note,'question')}>{t('Keep as a question','Guardar como pregunta')}</button>}{note.status==='suggested'&&<button type="button" disabled={busy} className="text-button" onClick={()=>void act({action:'update',id:note.id,version:note.version,note:{topic:note.topic,kind:note.kind,content:note.content,language:note.language}},t('Note saved.','Nota guardada.'))}><Check size={15} aria-hidden="true"/>{t('Keep this','Conservar')}</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note)}>{note.language===language?t('Edit','Editar'):t('Edit original','Editar original')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm(t('Delete this note? Your original conversation summary will remain.','¿Eliminar esta nota? Se conservará el resumen original de la conversación.')))void act({action:'delete',id:note.id,version:note.version},t('Note deleted.','Nota eliminada.'));}}><Trash2 size={14} aria-hidden="true"/>{note.status==='suggested'?t('Dismiss','Descartar'):t('Delete','Eliminar')}</button></div>
  </article>;
 }
 const selected=topics.find(topic=>topic.id===open);
 const grouped=notes.filter(note=>note.topic===open);
 const scopeLabel=target===null?t('Family notes','Notas familiares'):name;
 return <section className="topic-notebook" aria-labelledby="notebook-heading"><div className="home-section-heading"><span className="home-kicker">{t('MAKE IT YOURS','HAZLO TUYO')}</span><h2 id="notebook-heading">{t('My topics & notes','Mis temas y notas')}</h2><p>{t('Keep useful explanations, your own thoughts, and questions you want to revisit.','Guarda explicaciones útiles, tus ideas y preguntas que quieras retomar.')}</p></div>
  {role==='parent'&&<div className="home-summary-switch" role="group" aria-label={t('Notebook belongs to','Este cuaderno pertenece a')}><button type="button" aria-pressed={target!==null} onClick={()=>setFamilyFor(null)}>{name}</button><button type="button" aria-pressed={target===null} onClick={()=>setFamilyFor(studentId)}>{t('Family notes','Notas familiares')}</button></div>}
  <p className="notebook-scope">{t('Notebook for: ','Cuaderno de: ')}<strong>{scopeLabel}</strong><span>{t('Private to your account','Privado en tu cuenta')}</span></p>
  {!history.cloud?<p>{t('Sign in to save topic notes to your account.','Inicia sesión para guardar notas en tu cuenta.')}</p>:<>
   {loading&&<p role="status">{t('Loading your notebook…','Cargando tu cuaderno…')}</p>}
   {loadError&&<p role="alert">{t('Your notebook could not be loaded. Your saved notes have not been replaced.','No se pudo cargar tu cuaderno. Tus notas guardadas no se han reemplazado.')} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
   <div className="notebook-topics">{topics.map(({id,title,detail,icon:Icon})=>{const saved=notes.filter(note=>note.topic===id&&note.status==='saved').length,suggested=notes.filter(note=>note.topic===id&&note.status==='suggested').length;return <button type="button" key={id} className="notebook-topic" aria-expanded={open===id} aria-controls="notebook-panel" onClick={()=>openTopic(id)}><Icon size={21} aria-hidden="true"/><span><strong>{title}</strong><span>{detail}</span><small>{loading||loadError?'—':`${saved} ${t('saved',saved===1?'guardada':'guardadas')}${suggested?` · ${suggested} ${t('to review','por revisar')}`:''}`}</small></span><ArrowRight size={17} aria-hidden="true"/></button>;})}</div>
   {selected&&<section className="notebook-panel" id="notebook-panel" ref={panel} tabIndex={-1} aria-labelledby="notebook-topic-heading"><div className="notebook-panel-heading"><div><span className="home-kicker">{scopeLabel}</span><h3 id="notebook-topic-heading">{selected.title}</h3></div><button type="button" className="text-button" onClick={()=>{setOpen(null);document.getElementById('notebook-heading')?.scrollIntoView();}}>{t('Close topic','Cerrar tema')}</button></div>
    <div className="notebook-toolbar"><WorkspaceTalkButton t={t} disabled={busy||loading||loadError} focus={{kind:'topic',studentId:target,topic:selected.id}}/><button type="button" className="button primary" disabled={busy||loading||loadError} onClick={()=>edit()}><Plus size={16} aria-hidden="true"/>{t('Add a note','Agregar una nota')}</button><button type="button" className="text-button" onClick={()=>navigate(selected.page)}>{t('Explore this topic','Explorar este tema')}<ArrowRight size={16} aria-hidden="true"/></button></div>
    <p className="small-text">{t('Talking about this shares relevant saved notes, actions and summaries with Origen. Unsaved edits and suggestions you have not kept are left out.','Al hablar de esto, compartes las notas, acciones y resúmenes guardados pertinentes con Origen. Los borradores y las sugerencias sin aceptar no se incluyen.')}</p>{message?.scope===scope&&<div className="notebook-message" role={message.error?'alert':'status'}>{message.text}{message.error&&<button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Reload notebook','Recargar cuaderno')}</button>}</div>}
    {busy&&<p role="status">{t('Working on your request…','Procesando tu solicitud…')}</p>}
    {draft&&<form className="notebook-editor" onSubmit={e=>{e.preventDefault();void act({action:draft.version?'update':'create',id:draft.id,...(draft.version?{version:draft.version}:{}),note:{topic:draft.topic,kind:draft.kind,content:draft.content,language:draft.language,decisionConfirmed:draft.decisionConfirmed}},t('Note saved to your account.','Nota guardada en tu cuenta.'),true);}}>
     <h4>{draft.version?t('Edit your note','Editar tu nota'):t('Write something worth keeping','Escribe algo que quieras conservar')}</h4><div className="notebook-editor-fields"><label>{t('Type','Tipo')}<select value={draft.kind} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,kind:e.target.value as Kind,decisionConfirmed:false}}))}>{Object.entries(kinds).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></label><label>{t('Topic','Tema')}<select value={draft.topic} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,topic:e.target.value as Topic}}))}>{topics.map(topic=><option value={topic.id} key={topic.id}>{topic.title}</option>)}</select></label><label>{t('Writing language','Idioma del texto')}<select value={draft.language} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,language:e.target.value as Language}}))}><option value="en">English</option><option value="es">Español</option></select></label></div>
     {draftConflict&&latestDraftNote&&<div className="notebook-message" role="alert"><strong>{t('The saved note has changed. Review it before replacing it with your draft.','La nota guardada cambió. Revísala antes de reemplazarla con tu borrador.')}</strong><p>{latestDraftNote.content}</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDrafts(prev=>({...prev,[draftKey]:{...draft,version:latestDraftNote.version}}))}>{t('I reviewed it; keep my draft','La revisé; conservar mi borrador')}</button></div>}
     {draft.kind==='decision'&&<label className="notebook-decision-confirm"><input type="checkbox" checked={!!draft.decisionConfirmed} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,decisionConfirmed:e.target.checked}}))}/>{t('This is a decision I have made, not an option I am still considering.','Esta es una decisión que tomé, no una opción que todavía estoy considerando.')}</label>}
     <label>{t('Your note','Tu nota')}<textarea ref={editor} required maxLength={2000} rows={5} lang={draft.language} value={draft.content} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,content:e.target.value}}))}/></label><small>{draft.content.length}/2000</small>
     <div className="notebook-toolbar"><button type="submit" className="button primary" disabled={busy||!draft.content.trim()||loading||loadError||draftConflict||draft.kind==='decision'&&!draft.decisionConfirmed}>{t('Save note','Guardar nota')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(!draft.content.trim()||window.confirm(t('Discard this unsaved draft?','¿Descartar este borrador sin guardar?')))setDrafts(prev=>({...prev,[draftKey]:undefined}));}}>{t('Cancel','Cancelar')}</button></div>
    </form>}
    {!loading&&!loadError&&<>{!grouped.length&&!draft&&<p className="notebook-empty">{t('Nothing saved here yet. Add a thought or a question, or review takeaways from a conversation below.','Todavía no hay notas aquí. Agrega una idea o una pregunta, o revisa lo conversado abajo.')}</p>}{(['note','explanation','decision','question'] as Kind[]).map(kind=>{const kept=grouped.filter(note=>note.kind===kind&&note.status==='saved');return kept.length?<div className="notebook-group" key={kind}><h4>{kinds[kind]}</h4>{kept.map(renderNote)}</div>:null;})}{grouped.some(note=>note.status==='suggested')&&<div className="notebook-group"><h4>{t('Suggestions to review','Sugerencias por revisar')}</h4><p>{t('These may need correction. Keep only what represents your conversation.','Pueden necesitar correcciones. Conserva solo lo que represente tu conversación.')}</p>{grouped.filter(note=>note.status==='suggested').map(renderNote)}</div>}</>}
    <div className="notebook-conversations"><h4><MessageCircle size={17} aria-hidden="true"/>{t('Bring a conversation into your notebook','Lleva una conversación a tu cuaderno')}</h4><p>{t('Choose a saved conversation. Origen will suggest notes across the topics it covered. Nothing is accepted automatically.','Elige una conversación guardada. Origen sugerirá notas en los temas que trataron. Nada se acepta automáticamente.')}</p>{history.loading?<p role="status">{t('Loading conversations…','Cargando conversaciones…')}</p>:history.error?<p role="alert">{t('Conversations could not be loaded.','No se pudieron cargar las conversaciones.')} <button className="text-button" type="button" onClick={history.reload}>{t('Try again','Intentar de nuevo')}</button></p>:!discussions.length?<p>{t('After you save a conversation, you can bring its takeaways here. You can write your own notes now.','Después de guardar una conversación, podrás traer sus ideas aquí. Ya puedes escribir tus propias notas.')}</p>:<ul>{discussions.map(item=><li key={item.id}><div><strong>{date(item.date)}</strong><span>{item.mode==='finance'||item.mode==='loans'?t('College costs & loans','Costos y préstamos'):item.mode==='admissions'?t('Applications','Solicitudes'):item.mode==='profile'?t('Getting to know you','Conocerte mejor'):t('Planning','Planificación')}</span></div>{receipts.includes(item.id)?<span className="notebook-generated"><Check size={14} aria-hidden="true"/>{t('Reviewed for suggestions','Revisada para sugerencias')}</span>:<button className="text-button" type="button" disabled={busy||loading||loadError} onClick={()=>void act({action:'suggest',summaryId:item.id,language},t('Conversation reviewed. Check the topic cards for suggestions; some conversations have no new takeaways.','Conversación revisada. Consulta las tarjetas de temas para ver sugerencias; algunas conversaciones no tienen ideas nuevas.'))}><BookOpen size={15} aria-hidden="true"/>{t('Suggest notes','Sugerir notas')}</button>}</li>)}</ul>}</div>
   </section>}
  </>}
 </section>;
}
