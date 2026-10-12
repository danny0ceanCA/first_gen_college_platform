import PersonalBinder from './PersonalBinder';
import WorkspaceTalkButton from './WorkspaceTalkButton';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {animate} from 'animejs';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowLeft,Check,ChevronRight,Compass,GraduationCap,Languages,Map,MessageCircle,Plus,Trash2,Wallet} from 'lucide-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {distinctConversationPoints} from './binderKeyPoints.mjs';
import {useConversationHistory} from './ConversationHistory';
import './TopicNotebook.css';


type Topic='options'|'transfer'|'costs'|'applications';
type NotebookPage=Topic|'summary';
type Kind='note'|'explanation'|'question'|'decision';
type Language='en'|'es';
type Note={id:string;studentId:string|null;topic:Topic;kind:Kind;content:string;language:Language;status:'saved'|'suggested';origin:'user'|'conversation';summaryId:string|null;quote:string;translations:Partial<Record<Language,string>>;version:number;updatedAt:string;sources:{title:string;url:string;checkedAt:string}[];conversationAt:string|null};
type Draft={decisionConfirmed?:boolean;id:string;version?:number;topic:Topic;kind:Kind;content:string;language:Language};
type Data={scope:string;notes:Note[];generatedSummaryIds:string[];pendingCount?:number};
type Props={renderGuide?:(topic:Topic)=>ReactNode;renderSummary?:(studentId:string|null,flowing:boolean)=>ReactNode;studentId:string;name:string;role:'parent'|'student';language:Language;t:(en:string,es:string)=>string;navigate:(page:'explore'|'planning'|'costs'|'applications')=>void};

const mobileBinderQuery='(max-width: 760px)';
function subscribeMobileBinder(callback:()=>void){
 const query=window.matchMedia(mobileBinderQuery);
 query.addEventListener('change',callback);
 return()=>query.removeEventListener('change',callback);
}

export default function TopicNotebook({renderGuide,renderSummary,studentId,name,role,language,t}:Props){
 const history=useConversationHistory();
 const {user,getAccessTokenSilently}=useAuth0();
 const [familyFor,setFamilyFor]=useState<string|null>(null);
 const target=role==='parent'&&familyFor===studentId?null:studentId;
 const scope=JSON.stringify([user?.sub,target]);
 const latestScope=useRef(scope);latestScope.current=scope;
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[attempt,setAttempt]=useState(0);
 const [open,setOpen]=useState<NotebookPage>(renderSummary?'summary':'options'),[drafts,setDrafts]=useState<Record<string,Draft|undefined>>({});
 const mobile=useSyncExternalStore(subscribeMobileBinder,()=>window.matchMedia(mobileBinderQuery).matches,()=>false);
 const [mobilePage,setMobilePage]=useState(false);
 const showingPage=!mobile||mobilePage;
 const contents=useRef<HTMLElement>(null),pageView=useRef<HTMLDivElement>(null);
 const navigationPending=useRef(false);
 const [message,setMessage]=useState<{scope:string;text:string;error:boolean}|null>(null),[busy,setBusy]=useState(false);
 const inFlight=useRef(false),mutationVersion=useRef(0),panel=useRef<HTMLElement>(null),editor=useRef<HTMLTextAreaElement>(null);
 const [originals,setOriginals]=useState<Record<string,boolean>>({});
 const tabs=useRef<HTMLDivElement>(null);
 const requests=useRef(new Set<AbortController>());
 const [indexing,setIndexing]=useState(false),[indexError,setIndexError]=useState<string|null>(null);
 useEffect(()=>browserPrivacy.subscribe(event=>{
  for(const controller of requests.current)controller.abort();
  mutationVersion.current++;setData(null);setIndexError(null);setAttempt(n=>n+1);
  if(event.type==='end'){setDrafts({});setOriginals({});setMessage(null);}
 }),[]);
 useLayoutEffect(()=>{
  const page=mobile?pageView.current:panel.current,rail=tabs.current;
  const active=rail?.querySelector<HTMLElement>('[aria-selected="true"]');
  if(!page)return;
  // Reveal the selected divider within its rail without scrolling the whole page.
  if(rail&&active){
   const bounds=rail.getBoundingClientRect(),tabBounds=active.getBoundingClientRect();
   if(tabBounds.left<bounds.left)rail.scrollLeft-=bounds.left-tabBounds.left+4;
   else if(tabBounds.right>bounds.right)rail.scrollLeft+=tabBounds.right-bounds.right+4;
  }
  if(mobile&&navigationPending.current){
   navigationPending.current=false;
   const destination=mobilePage?panel.current:contents.current?.querySelector<HTMLElement>(`[data-topic="${open}"]`);
   destination?.focus({preventScroll:true});
   // Keep the back button and page heading visible, even after reading a long page.
   const anchor=mobilePage?page:page.closest('.binder-pages')||page;
   window.scrollTo({top:Math.max(0,window.scrollY+anchor.getBoundingClientRect().top-20),behavior:'instant'});
  }
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(motion.matches)return;
  const reveal=animate(page,{opacity:[.65,1],...(mobile?{translateX:[mobilePage?10:-10,0]}:{translateY:[6,0]}),duration:260,ease:'outCubic'});
  const icon=active?.querySelector('.notebook-tab-icon');
  const lift=icon?animate(icon,{scale:[.92,1],duration:230,ease:'outCubic'}):null;
  const finish=()=>{if(motion.matches){reveal.complete();lift?.complete();}};
  motion.addEventListener('change',finish);
  return()=>{reveal.revert();lift?.revert();motion.removeEventListener('change',finish);};
 },[open,scope,mobile,mobilePage]);
 const topics=[
  {id:'options' as const,title:t('College options','Opciones universitarias'),detail:t('Interests, majors, and places to study.','Intereses, carreras y lugares para estudiar.'),page:'explore' as const,icon:Compass},
  {id:'transfer' as const,title:t('Transfer & courses','Transferencias y cursos'),detail:t('Your path, coursework, and counselor questions.','Tu camino, cursos y preguntas para el consejero.'),page:'planning' as const,icon:Map},
  {id:'costs' as const,title:t('Paying for college','Pagar la universidad'),detail:t('Costs, aid, and student loans.','Costos, ayudas y préstamos estudiantiles.'),page:'costs' as const,icon:Wallet},
  {id:'applications' as const,title:t('Applications','Solicitudes'),detail:t('Applications and questions about applying.','Solicitudes y preguntas sobre el proceso.'),page:'applications' as const,icon:GraduationCap}
 ];
 const kinds:Record<Kind,string>={decision:t('Decisions I made','Decisiones que tomé'),note:t('My notes','Mis notas'),explanation:t('Things we covered','Lo que conversamos'),question:t('Questions to revisit','Preguntas por retomar')};
 const notes=data?.scope===scope?data.notes:[];
 const draftKey=JSON.stringify([scope,open]),draft=drafts[draftKey];
 const latestDraftNote=draft?.version?notes.find(note=>note.id===draft.id):undefined;
 const draftConflict=!!latestDraftNote&&latestDraftNote.version!==draft?.version;
 const discussions=history.items.filter(item=>item.studentId===target).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const historyKey=discussions.map(item=>item.id).join('|');
 async function request(body:Record<string,unknown>,signal?:AbortSignal){
  const lease=browserPrivacy.capture({studentId:body.studentId as string|null});
  const controller=new AbortController();requests.current.add(controller);
  try{
  lease.assert();
  const token=await getAccessTokenSilently();let sub;
  if(!token)throw new Error('account_changed');
  try{sub=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
  if(!user?.sub||sub!==user.sub)throw new Error('account_changed');
  lease.assert();
  const timeout=AbortSignal.timeout(body.action==='sync'?105000:40000);
  const response=await apiFetch('/api/topic-notes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,lease.signal,timeout,...(signal?[signal]:[])])});
  const result=await response.json();
  lease.assert();if(controller.signal.aborted)throw new DOMException('Request cancelled','AbortError');
  if(!response.ok)throw new Error(result.error||'notes_unavailable');
  if(!Array.isArray(result.notes)||!Array.isArray(result.generatedSummaryIds)||result.notes.some((note:Note)=>note.studentId!==body.studentId))throw new Error('notes_unavailable');
  return result as Omit<Data,'scope'>;
  }finally{lease.release();requests.current.delete(controller);}
 }
 useEffect(()=>{
  if(!history.cloud){setLoading(false);return;}
  const controller=new AbortController(),version=mutationVersion.current;let current=true;setLoading(true);setLoadError(false);setData(null);
  request({action:'load',studentId:target},controller.signal).then(result=>{if(current&&version===mutationVersion.current)setData({scope,...result});}).catch(()=>{if(current&&version===mutationVersion.current)setLoadError(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;controller.abort();};
 },[scope,attempt,historyKey,history.cloud]);
 useEffect(()=>{
  if(!history.cloud||history.loading||history.error||loading||loadError||busy||data?.scope!==scope)return;
  const controller=new AbortController(),version=mutationVersion.current;let current=true;
  setIndexing(true);setIndexError(null);
  void(async()=>{
   try{
    let remaining:number;
    do{
     const result=await request({action:'sync',studentId:target,language},controller.signal);
     if(!current||version!==mutationVersion.current||latestScope.current!==scope)return;
     setData({scope,...result});remaining=result.pendingCount||0;
    }while(remaining>0);
   }catch(error){
    if(current&&version===mutationVersion.current){
     setIndexError(error instanceof Error?error.message:'notes_unavailable');
     // A partial batch may have saved points before a later model call failed.
     try{const result=await request({action:'load',studentId:target},controller.signal);if(current&&version===mutationVersion.current)setData({scope,...result});}catch{/* Keep the last successfully loaded notes. */}
    }
   }finally{if(current)setIndexing(false);}
  })();
  return()=>{current=false;controller.abort();setIndexing(false);};
 },[scope,historyKey,attempt,history.cloud,history.loading,history.error,loading,loadError,busy,data?.scope]);
 useEffect(()=>{if(draft&&showingPage)editor.current?.focus();},[draft?.id,draftKey,showingPage]);
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
  if(open==='summary')return;
  if(draft&&draft.content.trim()&&!window.confirm(t('Replace the unsaved draft in this topic?','¿Reemplazar el borrador sin guardar de este tema?')))return;
  setDrafts(prev=>({...prev,[draftKey]:note?{id:note.id,version:note.version,topic:note.topic,kind:kind||note.kind,content:note.content,language:note.language,decisionConfirmed:false}:{id:crypto.randomUUID(),topic:open,kind:'note',content:'',language}}));
 }
 function openTopic(topic:NotebookPage){setOpen(topic);if(mobile){navigationPending.current=true;setMobilePage(true);}}
 function showContents(){navigationPending.current=true;setMobilePage(false);}
 function renderNote(note:Note){
  const translated=note.language!==language&&note.translations[language]&&!originals[note.id];
  return <article className={`notebook-note${note.status==='suggested'?' notebook-suggestion':''}`} key={note.id}>
   <div className="notebook-note-meta"><span>{kinds[note.kind]}</span><span>{note.status==='suggested'?`${t('Conversation recap · By Origen','Resumen de conversación · Por Origen')}${note.conversationAt?` · ${date(note.conversationAt)}`:''}`:t('Saved by you','Guardada por ti')}</span></div>
   <p className="notebook-note-content" lang={translated?language:note.language}>{translated?note.translations[language]:note.content}</p>
   {note.language!==language&&<div className="notebook-translation">{translated?<><span>{t('AI translation · Original preserved','Traducción con IA · Original conservado')}</span><button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:true}))}>{t('Show original','Ver original')}</button></>:note.translations[language]?<button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:false}))}>{t('Show translation','Ver traducción')}</button>:<button type="button" className="text-button" disabled={busy} onClick={()=>void act({action:'translate',id:note.id,version:note.version,language},t('Translation ready. The original is unchanged.','Traducción lista. El original no cambió.'))}><Languages size={15} aria-hidden="true"/>{t('Read in English','Leer en español')}</button>}</div>}
   {note.summaryId&&<details className="notebook-provenance"><summary>{t('From a saved conversation','De una conversación guardada')}{note.conversationAt?` · ${date(note.conversationAt)}`:''}</summary><blockquote>{note.quote}</blockquote><p>{t('This excerpt is from the saved summary. Deleting that conversation also deletes this linked note.','Este fragmento proviene del resumen guardado. Al eliminar esa conversación también se elimina esta nota vinculada.')}</p>{note.sources.length>0&&<><strong>{t('Sources discussed in that conversation','Fuentes consultadas en esa conversación')}</strong><p>{t('These links have not been checked again for this note.','Estos enlaces no se han vuelto a verificar para esta nota.')}</p><ul>{note.sources.filter(source=>/^https?:\/\//.test(source.url)).map((source,index)=><li key={`${source.url}-${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{t('Checked during conversation: ','Consultada durante la conversación: ')}{date(source.checkedAt)}</small></li>)}</ul></>}</details>}
   <div className="notebook-note-actions">{note.status==='saved'&&<WorkspaceTalkButton t={t} disabled={busy} focus={{kind:'note',studentId:target,topic:note.topic,noteId:note.id,version:note.version}}/>}{note.status==='saved'&&note.kind!=='decision'&&<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note,'decision')}>{t('Save as a decision','Guardar como decisión')}</button>}{note.status==='saved'&&note.kind!=='question'&&<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note,'question')}>{t('Keep as a question','Guardar como pregunta')}</button>}{note.status==='suggested'&&<button type="button" disabled={busy} className="text-button" onClick={()=>void act({action:'update',id:note.id,version:note.version,note:{topic:note.topic,kind:note.kind,content:note.content,language:note.language}},t('Note saved.','Nota guardada.'))}><Check size={15} aria-hidden="true"/>{t('Keep as my note','Guardar como mi nota')}</button>}<button type="button" className="text-button" disabled={busy} onClick={()=>edit(note)}>{note.language===language?t('Edit','Editar'):t('Edit original','Editar original')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm(t('Delete this note? Your original conversation summary will remain.','¿Eliminar esta nota? Se conservará el resumen original de la conversación.')))void act({action:'delete',id:note.id,version:note.version},t('Note deleted.','Nota eliminada.'));}}><Trash2 size={14} aria-hidden="true"/>{note.status==='suggested'?t('Remove','Quitar'):t('Delete','Eliminar')}</button></div>
  </article>;
 }
 const dividers=[...(renderSummary?[{id:'summary' as const,title:t('Summary','Resumen'),icon:MessageCircle}]:[]),...topics];
 const selected=topics.find(topic=>topic.id===open);
 const grouped=notes.filter(note=>note.topic===open);
 const points=distinctConversationPoints(grouped);
 const scopeLabel=target===null?t('Family notes','Notas familiares'):name;
 function dividerDetail(id:NotebookPage){
  if(id==='summary')return t('What we talked about','Lo que conversamos');
  if(loading||loadError)return '—';
  const saved=notes.filter(note=>note.topic===id&&note.status==='saved').length;
  const pointCount=distinctConversationPoints(notes.filter(note=>note.topic===id)).length;
  return [pointCount?`${pointCount} ${t(pointCount===1?'key point':'key points',pointCount===1?'punto clave':'puntos clave')}`:'',saved?`${saved} ${t(saved===1?'note':'notes',saved===1?'nota':'notas')}`:''].filter(Boolean).join(' · ')||t('Ready when you are','Cuando tú quieras');
 }
 return <PersonalBinder name={name} t={t} onOpen={()=>setMobilePage(false)}><section className={`topic-notebook${mobile?' notebook-mobile':''}`} aria-label={t('My topics & notes','Mis temas y notas')}>
  {(!mobile||!mobilePage)&&<><div className="home-section-heading"><span className="home-kicker">{mobile?t('IN YOUR BINDER','EN TU CARPETA'):t('MAKE IT YOURS','HAZLO TUYO')}</span><h2 id="notebook-heading">{mobile?t('Choose a topic','Elige un tema'):t('My topics & notes','Mis temas y notas')}</h2></div>
  {role==='parent'&&<div className="home-summary-switch" role="group" aria-label={t('Notebook belongs to','Este cuaderno pertenece a')}><button type="button" aria-pressed={target!==null} onClick={()=>setFamilyFor(null)}>{name}</button><button type="button" aria-pressed={target===null} onClick={()=>setFamilyFor(studentId)}>{t('Family notes','Notas familiares')}</button></div>}
  <p className="notebook-scope">{t('Notebook for: ','Cuaderno de: ')}<strong>{scopeLabel}</strong><span>{t('Private to your account','Privado en tu cuenta')}</span></p></>}
  {!history.cloud?<p>{t('Sign in to save topic notes to your account.','Inicia sesión para guardar notas en tu cuenta.')}</p>:<>
   {loading&&<p role="status">{t('Loading your notebook…','Cargando tu cuaderno…')}</p>}
   {loadError&&<p role="alert">{t('Your notebook could not be loaded. Your saved notes have not been replaced.','No se pudo cargar tu cuaderno. Tus notas guardadas no se han reemplazado.')} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
   {indexing&&discussions.length>0&&<p className="notebook-sync-status" role="status">{t('Organizing conversation key points into your topics…','Organizando los puntos clave de tus conversaciones por tema…')}</p>}
   {indexError&&<p className="notebook-sync-status" role="status">{indexError==='notes_ai_limit'?t('Some older conversations still need organizing. Try again later; your saved notes are ready to use.','Aún faltan algunas conversaciones anteriores por organizar. Inténtalo más tarde; tus notas guardadas están listas.'):t('Some conversation points could not be organized yet. Your saved conversations and notes are still here.','Todavía no se pudieron organizar algunos puntos. Tus conversaciones y notas siguen aquí.')} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
   <div ref={pageView} className="notebook-page-view">
   {mobile?!mobilePage&&<nav ref={contents} className="notebook-contents" aria-label={t('Binder topics','Temas de la carpeta')}>{dividers.map(({id,title,icon:Icon})=><button type="button" key={id} data-topic={id} className={`notebook-contents-topic divider-${id}`} onClick={()=>openTopic(id)}><span className="notebook-contents-icon" aria-hidden="true"><Icon size={21}/></span><span><strong>{title}</strong><small>{dividerDetail(id)}</small></span><ChevronRight size={19} aria-hidden="true"/></button>)}</nav>:<div ref={tabs} className="notebook-topics" role="tablist" aria-label={t('Notebook topics','Temas del cuaderno')}>{dividers.map(({id,title,icon:Icon},index)=><button type="button" role="tab" id={`notebook-tab-${id}`} key={id} className="notebook-topic" aria-selected={open===id} tabIndex={open===id?0:-1} aria-controls="notebook-panel" onClick={()=>openTopic(id)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%dividers.length;else if(event.key==='ArrowLeft')next=(index+dividers.length-1)%dividers.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=dividers.length-1;else return;event.preventDefault();openTopic(dividers[next].id);document.getElementById(`notebook-tab-${dividers[next].id}`)?.focus();}}><span className="notebook-tab-icon" aria-hidden="true"><Icon size={19}/></span><span><strong>{title}</strong><small>{dividerDetail(id)}</small></span></button>)}</div>}
   {mobile&&mobilePage&&<div className="notebook-page-navigation"><button type="button" onClick={showContents}><ArrowLeft size={18} aria-hidden="true"/>{t('Topics','Temas')}</button><span>{scopeLabel}</span></div>}
   {showingPage&&open==='summary'&&renderSummary&&<section className="notebook-panel notebook-summary-page" ref={panel} id="notebook-panel" role={mobile?'region':'tabpanel'} tabIndex={0} aria-label={mobile?t('Summary','Resumen'):undefined} aria-labelledby={mobile?undefined:'notebook-tab-summary'}>{renderSummary(target,mobile)}</section>}
   {showingPage&&selected&&<section className="notebook-panel" id="notebook-panel" role={mobile?'region':'tabpanel'} ref={panel} tabIndex={0} aria-label={mobile?selected.title:undefined} aria-labelledby={mobile?undefined:`notebook-tab-${selected.id}`}><div className="notebook-panel-heading"><div><span className="home-kicker">{scopeLabel}</span><h3 id="notebook-topic-heading">{selected.title}</h3></div></div>
    <div className="notebook-toolbar"><WorkspaceTalkButton t={t} disabled={busy||loading||loadError} focus={{kind:'topic',studentId:target,topic:selected.id}}/><button type="button" className="button primary" disabled={busy||loading||loadError} onClick={()=>edit()}><Plus size={16} aria-hidden="true"/>{t('Add a note','Agregar una nota')}</button></div>
    {message?.scope===scope&&<div className="notebook-message" role={message.error?'alert':'status'}>{message.text}{message.error&&<button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Reload notebook','Recargar cuaderno')}</button>}</div>}
    {busy&&<p role="status">{t('Working on your request…','Procesando tu solicitud…')}</p>}
    {draft&&<form className="notebook-editor" onSubmit={e=>{e.preventDefault();void act({action:draft.version?'update':'create',id:draft.id,...(draft.version?{version:draft.version}:{}),note:{topic:draft.topic,kind:draft.kind,content:draft.content,language:draft.language,decisionConfirmed:draft.decisionConfirmed}},t('Note saved to your account.','Nota guardada en tu cuenta.'),true);}}>
     <h4>{draft.version?t('Edit your note','Editar tu nota'):t('Write something worth keeping','Escribe algo que quieras conservar')}</h4><div className="notebook-editor-fields"><label>{t('Type','Tipo')}<select value={draft.kind} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,kind:e.target.value as Kind,decisionConfirmed:false}}))}>{Object.entries(kinds).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></label><label>{t('Topic','Tema')}<select value={draft.topic} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,topic:e.target.value as Topic}}))}>{topics.map(topic=><option value={topic.id} key={topic.id}>{topic.title}</option>)}</select></label><label>{t('Writing language','Idioma del texto')}<select value={draft.language} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,language:e.target.value as Language}}))}><option value="en">English</option><option value="es">Español</option></select></label></div>
     {draftConflict&&latestDraftNote&&<div className="notebook-message" role="alert"><strong>{t('The saved note has changed. Review it before replacing it with your draft.','La nota guardada cambió. Revísala antes de reemplazarla con tu borrador.')}</strong><p>{latestDraftNote.content}</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDrafts(prev=>({...prev,[draftKey]:{...draft,version:latestDraftNote.version}}))}>{t('I reviewed it; keep my draft','La revisé; conservar mi borrador')}</button></div>}
     {draft.kind==='decision'&&<label className="notebook-decision-confirm"><input type="checkbox" checked={!!draft.decisionConfirmed} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,decisionConfirmed:e.target.checked}}))}/>{t('This is a decision I have made, not an option I am still considering.','Esta es una decisión que tomé, no una opción que todavía estoy considerando.')}</label>}
     <label>{t('Your note','Tu nota')}<textarea ref={editor} required maxLength={2000} rows={5} lang={draft.language} value={draft.content} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,content:e.target.value}}))}/></label><small>{draft.content.length}/2000</small>
     <div className="notebook-toolbar"><button type="submit" className="button primary" disabled={busy||!draft.content.trim()||loading||loadError||draftConflict||draft.kind==='decision'&&!draft.decisionConfirmed}>{t('Save note','Guardar nota')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(!draft.content.trim()||window.confirm(t('Discard this unsaved draft?','¿Descartar este borrador sin guardar?')))setDrafts(prev=>({...prev,[draftKey]:undefined}));}}>{t('Cancel','Cancelar')}</button></div>
    </form>}
    {!loading&&!loadError&&<>{!grouped.length&&!draft&&<p className="notebook-empty">{t('After we talk, the key points about this topic will appear here. You can also add your own note.','Después de conversar, aquí aparecerán los puntos clave sobre este tema. También puedes agregar tu propia nota.')}</p>}{points.length>0&&<section className="notebook-key-points" aria-label={t('Key points from our conversations','Puntos clave de nuestras conversaciones')}><h4>{t('Key points from our conversations','Puntos clave de nuestras conversaciones')}</h4><p className="small-text muted">{t('A recap of what we covered. You can correct it or keep a point as your own note.','Un resumen de lo que conversamos. Puedes corregirlo o guardar un punto como nota propia.')}</p><div className="notebook-points-list" role={mobile?undefined:'region'} tabIndex={mobile?undefined:0} aria-label={mobile?undefined:t('Conversation key points. Scroll to read more.','Puntos clave de conversaciones. Desplázate para leer más.')}>{points.map(renderNote)}</div></section>}{(['note','explanation','decision','question'] as Kind[]).map(kind=>{const kept=grouped.filter(note=>note.kind===kind&&note.status==='saved');return kept.length?<div className="notebook-group" key={kind}><h4>{kinds[kind]}</h4>{kept.map(renderNote)}</div>:null;})}</>}

    {renderGuide&&<NotebookGuides key={selected.id} title={t('Guides & resources','Guías y recursos')}>{()=>renderGuide(selected.id)}</NotebookGuides>}
   </section>}
   </div>
  </>}
 </section></PersonalBinder>;
}

function NotebookGuides({title,children}:{title:string;children:()=>ReactNode}){
 const [opened,setOpened]=useState(false);
 return <details className="notebook-guides" onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>{title}</summary>{opened&&<div className="notebook-guide-content">{children()}</div>}</details>;
}
