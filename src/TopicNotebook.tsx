import ConversationRecovery from './ConversationRecoveryPanel';
import CoordinatorNotifications,{type NoticeDestination} from './CoordinatorNotifications';
import {useGuidanceRequest,type Guidance} from './CoordinatorGuidance';
import {StudentCommentsProvider,StudentEntryComments,useStudentComments} from './StudentComments';
import BinderSharing from './BinderSharing';
import {notifyMemoryContext} from './memoryContext.mjs';
import StudentMemory,{type Memory} from './StudentMemory';
import {binderMemoryEntries,binderMemorySignalId} from './binderMemory.mjs';
import OrganizationEvidence,{type OrganizationInfo} from './OrganizationEvidence';
import useBinderCorrections from './useBinderCorrections';
import type {ActionSeed} from './ActionPlan';
import PersonalBinder from './PersonalBinder';
import {refreshBinderNotes} from './binderRefresh.mjs';
import {revealBinderTopic} from './binderReveal.mjs';
import type {BinderFollowRequest} from './binderFollow.mjs';
import {useBinderNavigationGuard} from './useBinderFollow';
import WorkspaceTalkButton from './WorkspaceTalkButton';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {useNavigationState,useNavigationGuard,navigateWorkspace,navigationEnum} from './workspaceNavigation';
import {animate} from 'animejs';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowLeft,ChevronLeft,ChevronRight,Compass,Download,GraduationCap,Languages,Map,MessageCircle,Plus,Trash2,Wallet} from 'lucide-react';
import {apiFetch} from './api';
import {apiFailure,diagnosticHint} from './diagnosticClient.mjs';
import {ErrorReference} from './ErrorReference';
import {browserPrivacy} from './browserPrivacy.mjs';
import {distinctConversationPoints} from './binderKeyPoints.mjs';
import {binderActivity,binderNoteUpdates as noteUpdates} from './binderActivity';
import BinderNoteHighlight from './BinderNoteHighlight';
import {binderExportData} from './binderExport.mjs';
import {useConversationHistory} from './ConversationHistory';
import './TopicNotebook.css';


type Topic='options'|'transfer'|'costs'|'applications';
type NotebookPage=Topic|'summary';
type Kind='note'|'explanation'|'question'|'decision';
type Language='en'|'es';
type Note={id:string;studentId:string|null;topic:Topic;kind:Kind;content:string;language:Language;status:'saved'|'suggested';origin:'user'|'conversation';summaryId:string|null;quote:string;translations:Partial<Record<Language,string>>;version:number;updatedAt:string;sources:{title:string;url:string;checkedAt:string}[];conversationAt:string|null;organization?:OrganizationInfo;excludedFromGuidance?:boolean};
type Draft={decisionConfirmed?:boolean;id:string;version?:number;topic:Topic;kind:Kind;content:string;language:Language};
type Data={scope:string;correctionsEnabled?:boolean;notes:Note[];generatedSummaryIds:string[];pendingCount?:number;background?:{enabled:boolean;pending:number;failed:number;canRetry?:boolean;retryAfterMs:number}};
type Props={sharingOpenRequest?:number;followRequest?:BinderFollowRequest|null;initiallyOpen?:boolean;onAction?:(seed:ActionSeed)=>void;renderNextSteps?:(studentId:string|null)=>ReactNode;renderGuide?:(topic:Topic)=>ReactNode;renderSummary?:(studentId:string|null,flowing:boolean)=>ReactNode;studentId:string;name:string;role:'parent'|'student';language:Language;t:(en:string,es:string)=>string;navigate:(page:'explore'|'planning'|'costs'|'applications')=>void};

const mobileBinderQuery='(max-width: 760px)';
const notesPerPage=4;
function subscribeMobileBinder(callback:()=>void){
 const query=window.matchMedia(mobileBinderQuery);
 query.addEventListener('change',callback);
 return()=>query.removeEventListener('change',callback);
}

export default function TopicNotebook(props:Props){
 const [commentAction,setCommentAction]=useState(0);
 const body=<TopicNotebookContent {...props} commentAction={commentAction}/>;
 return props.role==='student'?<StudentCommentsProvider studentId={props.studentId} t={props.t} onAction={props.onAction?seed=>{setCommentAction(n=>n+1);props.onAction?.(seed);}:undefined}>{body}</StudentCommentsProvider>:body;
}
function TopicNotebookContent({commentAction,sharingOpenRequest=0,followRequest,initiallyOpen,onAction,renderNextSteps,renderGuide,renderSummary,studentId,name,role,language,t}:Props&{commentAction:number}){
 const comments=useStudentComments();
 const unreadComments=comments.items.filter(f=>!f.reviewed&&!f.hidden&&!f.withdrawn);
 const commentFollowPending=useRef(false);
 const [commentOpenRequest,setCommentOpenRequest]=useState(0),[commentFocus,setCommentFocus]=useState<Guidance>();
 const history=useConversationHistory();
 const {user,getAccessTokenSilently}=useAuth0();
 const [familyFor,setFamilyFor]=useState<string|null>(null);
 const target=role==='parent'&&familyFor===studentId?null:studentId;
 const corrections=useBinderCorrections('note',target);
 const scope=JSON.stringify([user?.sub,target]);
 const latestScope=useRef(scope);latestScope.current=scope;
 const liveBinder=useSyncExternalStore(binderActivity.subscribe,binderActivity.snapshot,()=>null);
 const discussing=liveBinder?.subject===user?.sub&&liveBinder?.studentId===target?liveBinder.topics:[];
 const updateSnapshot=useSyncExternalStore(noteUpdates.subscribe,noteUpdates.snapshot,noteUpdates.snapshot);
 const freshIds=new Set(updateSnapshot.scope===scope?updateSnapshot.ids:[]);
 const [memoryData,setMemoryData]=useState<{scope:string;entries:Memory[]}>({scope:'',entries:[]});
 const memories=binderMemoryEntries(memoryData.scope===scope?memoryData.entries:[],target);
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(false),[attempt,setAttempt]=useState(0);
 const navKey=`student.notebook.${target||'family'}`;
 const [open,setOpen]=useNavigationState<NotebookPage>(navKey+'.topic',renderSummary?'summary':'options',navigationEnum('summary','options','transfer','costs','applications')),[drafts,setDrafts]=useState<Record<string,Draft|undefined>>({});
 const mobile=useSyncExternalStore(subscribeMobileBinder,()=>window.matchMedia(mobileBinderQuery).matches,()=>false);
 const [mobilePage,setMobilePage]=useNavigationState(navKey+'.mobilePage',false,(v):v is boolean=>typeof v==='boolean');
 const showingPage=!mobile||mobilePage;
 const contents=useRef<HTMLElement>(null),pageView=useRef<HTMLDivElement>(null);
 const navigationPending=useRef(false);
 const [message,setMessage]=useState<{scope:string;text:string;error:boolean;reference?:string}|null>(null),[busy,setBusy]=useState(false);
 useBinderNavigationGuard(busy||Object.values(drafts).some(Boolean));
 useNavigationGuard(Object.values(drafts).some(Boolean),{locked:busy,onLeave:()=>setDrafts({})});
 const inFlight=useRef(false),mutationVersion=useRef(0),panel=useRef<HTMLElement>(null),editor=useRef<HTMLTextAreaElement>(null);
 const [originals,setOriginals]=useState<Record<string,boolean>>({});
 const [reading,setReading]=useNavigationState<Record<string,{kind:Kind;page:number}>>(navKey+'.reading',{},(v):v is Record<string,{kind:Kind;page:number}>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(r=>r&&['note','explanation','question','decision'].includes(r.kind)&&Number.isSafeInteger(r.page)&&r.page>=0));
 const readingHeading=useRef<HTMLHeadingElement>(null),readingNavigationPending=useRef(false);
 const tabs=useRef<HTMLDivElement>(null),notebook=useRef<HTMLElement>(null);
 const consumedFollow=useRef(0);
 const [binderOpenRequest,setBinderOpenRequest]=useState(0);
 const followValid=!!followRequest&&followRequest.subject===user?.sub&&followRequest.source===liveBinder?.source&&
  followRequest.studentId===liveBinder?.studentId&&(followRequest.studentId===studentId||followRequest.studentId===null&&role==='parent');
 useLayoutEffect(()=>{
  if(!followValid||!followRequest||consumedFollow.current===followRequest.serial)return;
  consumedFollow.current=followRequest.serial;
  setFamilyFor(followRequest.studentId===null?studentId:null);
  if(followRequest.topic){setOpen(followRequest.topic);setMobilePage(true);}
  else{setOpen(renderSummary?'summary':'options');setMobilePage(false);}
  setBinderOpenRequest(followRequest.serial);
 },[followRequest,followValid,studentId]);
 function revealFollow(){
  // Run after the cover has opened and the selected page has been committed.
  requestAnimationFrame(()=>{
   if(!followRequest||!followValid||binderActivity.snapshot()?.source!==followRequest.source)return;
   const root=notebook.current?.closest('.personal-binder');
   if(followRequest.topic)revealBinderTopic(root,followRequest.topic);
   else if(root&&!root.closest('[hidden]')&&!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')){
    const rect=root.getBoundingClientRect();if(rect.top<24||rect.top>window.innerHeight-120)window.scrollTo({top:Math.max(0,window.scrollY+rect.top-24),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   }
  });
 }
 const requests=useRef(new Set<AbortController>());
 const feedbackRequest=useGuidanceRequest();
 const [includeGuidance,setIncludeGuidance]=useState(false);
 const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState<string|null>(null);
 const exportLock=useRef(false);
 useEffect(()=>()=>{for(const controller of requests.current)controller.abort();},[]);
 const retryOrganization=useRef(false);
 const [indexing,setIndexing]=useState(false),[indexError,setIndexError]=useState<string|null>(null);
 useEffect(()=>browserPrivacy.subscribe(event=>{
  for(const controller of requests.current)controller.abort();
  mutationVersion.current++;setData(null);setMemoryData({scope:'',entries:[]});setIndexError(null);setAttempt(n=>n+1);
  if(event.type==='end'){setDrafts({});setOriginals({});setReading({});setMessage(null);}
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
 const kinds:Record<Kind,string>={decision:t('Decisions I made','Decisiones que tomé'),note:t('My notes','Mis notas'),explanation:t('Things to remember','Para recordar'),question:t('Questions to ask','Preguntas por hacer')};
 const notes=data?.scope===scope?data.notes:[];
 useEffect(()=>{
  if(data?.scope===scope&&memoryData.scope===scope)noteUpdates.observe(scope,[...data.notes.filter(note=>note.status==='saved'),...distinctConversationPoints(data.notes),...memories.map(item=>({id:binderMemorySignalId(item.id)}))]);
 },[data,scope,noteUpdates,memoryData]);
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
  const response=await apiFetch('/api/topic-notes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Origen-Operation':diagnosticHint('notes',body.studentId as string|null,JSON.stringify([body.action,body.id,body.summaryId,body.version]))},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,lease.signal,timeout,...(signal?[signal]:[])])});
  const result=await response.json();
  lease.assert();if(controller.signal.aborted)throw new DOMException('Request cancelled','AbortError');
  if(!response.ok)throw apiFailure(response,result.error||'notes_unavailable');
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
    const action=retryOrganization.current?'retry':'sync';retryOrganization.current=false;
    await refreshBinderNotes({action,signal:controller.signal,
     request:(action,signal)=>request({action,studentId:target,language},signal),
     onData:result=>{if(current&&version===mutationVersion.current&&latestScope.current===scope)setData({scope,...result});},
     onFailure:error=>{if(current&&version===mutationVersion.current&&latestScope.current===scope)setIndexError(error);},
    });
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
  if(code==='undo_unavailable')return t('Undo is no longer available. Reload to see the current information.','Ya no se puede deshacer. Recarga para ver la información actual.');
  if(['item_changed','operation_changed','correction_operation_required'].includes(code))code='note_changed';
  if(code==='note_changed')return t('This note changed in another window. Your draft is still here. Reload the notebook and review the latest note before saving again.','Esta nota cambió en otra ventana. Tu borrador sigue aquí. Recarga el cuaderno y revisa la versión más reciente antes de guardar de nuevo.');
  if(code==='notes_ai_limit')return t('You’ve reached the hourly limit for suggestions and translations. You can still write and edit your notes. Try again later.','Alcanzaste el límite por hora de sugerencias y traducciones. Aún puedes escribir y editar tus notas. Inténtalo más tarde.');
  if(code==='note_limit')return t('Your notebook is full. Delete a note you no longer need before adding another.','Tu cuaderno está lleno. Elimina una nota que ya no necesites antes de agregar otra.');
  if(code==='summary_not_found'||code==='note_not_found')return t('That conversation or note is no longer available. Reload the notebook.','Esa conversación o nota ya no está disponible. Recarga el cuaderno.');
  return t('Could not finish that request. Your draft has not been cleared. Please try again.','No se pudo completar la solicitud. Tu borrador no se borró. Inténtalo de nuevo.');
 }
 async function act(body:Record<string,unknown>,success:string,clearDraft=false){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage(null);
  const actionScope=scope,actionDraftKey=draftKey;let acknowledged=false;
  try{
   let result:Omit<Data,'scope'>;
   if(data?.correctionsEnabled&&['update','delete','undo'].includes(String(body.action))){
    if(body.action==='undo')await corrections.restore();else await corrections.change(body,notes.find(n=>n.id===body.id));
    acknowledged=true;if(clearDraft)setDrafts(prev=>({...prev,[actionDraftKey]:undefined}));
    result=await request({action:'load',studentId:target});
   }else result=await request({...body,studentId:target});
   if(user?.sub&&['update','delete'].includes(String(body.action)))notifyMemoryContext(user.sub,target);
   if(latestScope.current===actionScope){
    mutationVersion.current++;setData({scope:actionScope,...result});setLoadError(false);setMessage({scope:actionScope,text:success,error:false});
    if(clearDraft){
     const savedNote=result.notes.find(note=>note.id===body.id);
     if(savedNote){
      const entries=[...result.notes.filter(note=>note.topic===savedNote.topic&&note.status==='saved'),...distinctConversationPoints(result.notes.filter(note=>note.topic===savedNote.topic))].filter(note=>note.kind===savedNote.kind).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
      setReading(previous=>({...previous,[JSON.stringify([actionScope,savedNote.topic])]:{kind:savedNote.kind,page:Math.max(0,Math.floor(entries.findIndex(note=>note.id===savedNote.id)/notesPerPage))}}));
      setOpen(savedNote.topic);if(mobile){navigationPending.current=true;setMobilePage(true);}
     }
    }
   }
   if(clearDraft)setDrafts(prev=>({...prev,[actionDraftKey]:undefined}));
  }
  catch(error){if(latestScope.current===actionScope)setMessage({scope:actionScope,text:acknowledged?t('Your change was saved. Reload the notebook to display it.','Tu cambio se guardó. Recarga el cuaderno para verlo.'):errorText(error instanceof Error?error.message:''),error:true,reference:(error as {errorReference?:string})?.errorReference});}
  finally{inFlight.current=false;setBusy(false);}
 }
 function edit(note?:Note,kind?:Kind){
  if(open==='summary')return;
  if(draft&&draft.content.trim()&&!window.confirm(t('Replace the unsaved draft in this topic?','¿Reemplazar el borrador sin guardar de este tema?')))return;
  setDrafts(prev=>({...prev,[draftKey]:note?{id:note.id,version:note.version,topic:note.topic,kind:kind||note.kind,content:note.content,language:note.language,decisionConfirmed:false}:{id:crypto.randomUUID(),topic:open,kind:'note',content:'',language}}));
 }
 function openTopic(topic:NotebookPage){if(topic===open&&(!mobile||mobilePage))return;navigateWorkspace(()=>{setOpen(topic);if(mobile){navigationPending.current=true;setMobilePage(true);}});}
 useEffect(()=>{if(commentAction)openTopic('summary');},[commentAction]);
 function showContents(){navigateWorkspace(()=>{navigationPending.current=true;setMobilePage(false);});}
 function renderNote(note:Note){
  const translated=note.language!==language&&note.translations[language]&&!originals[note.id];
  return <BinderNoteHighlight key={note.id} id={note.id} topic={note.topic} fresh={freshIds.has(note.id)} suggested={note.status==='suggested'} onRead={()=>noteUpdates.read(scope,note.id)}>
   <div className="student-note-writing"><div className="notebook-note-origin">{freshIds.has(note.id)&&<span className="notebook-new-label">{t('New','Nuevo')}</span>}<time dateTime={note.conversationAt||note.updatedAt}>{date(note.conversationAt||note.updatedAt)}</time></div>
    {note.status==='suggested'&&<OrganizationEvidence value={note.organization} t={t}/>}
    {note.excludedFromGuidance&&<p className="organization-evidence">{t('Kept for reference. Excluded from future guidance after a correction or removal.','Se conserva como referencia. No se usará en futuras conversaciones después de una corrección o eliminación.')}</p>}
    <NotebookWriting key={`${note.id}-${note.version}-${translated?language:note.language}`} content={(translated?note.translations[language]:note.content)||''} language={translated?language:note.language} t={t}/>
    {note.organization&&<details className="memory-evidence"><summary>{t('See source','Ver fuente')}</summary><blockquote lang={note.language}>{note.quote}</blockquote><p>{t('From a saved conversation summary, not a verbatim transcript or a verified policy.','De un resumen guardado, no de una transcripción literal ni de una política verificada.')}</p></details>}
   {note.language!==language&&<div className="notebook-translation">{translated?<><span>{t('AI translation · Original preserved','Traducción con IA · Original conservado')}</span><button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:true}))}>{t('Show original','Ver original')}</button></>:note.translations[language]?<button type="button" className="text-button" onClick={()=>setOriginals(prev=>({...prev,[note.id]:false}))}>{t('Show translation','Ver traducción')}</button>:<button type="button" className="text-button" disabled={busy} onClick={()=>void act({action:'translate',id:note.id,version:note.version,language},t('Translation ready. The original is unchanged.','Traducción lista. El original no cambió.'))}><Languages size={15} aria-hidden="true"/>{t('Read in English','Leer en español')}</button>}</div>}
   <div className="notebook-note-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>edit(note)}>{note.language===language?t('Edit','Editar'):t('Edit original','Editar original')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm(t('Delete this note? Your original conversation summary will remain.','¿Eliminar esta nota? Se conservará el resumen original de la conversación.')))void act({action:'delete',id:note.id,version:note.version},t('Note deleted.','Nota eliminada.'));}}><Trash2 size={14} aria-hidden="true"/>{note.status==='suggested'?t('Remove','Quitar'):t('Delete','Eliminar')}</button></div>
   </div><StudentEntryComments id={note.id} topic={note.topic}/>
  </BinderNoteHighlight>;
 }
 const dividers=[...(renderSummary?[{id:'summary' as const,title:t('Summary','Resumen'),icon:MessageCircle}]:[]),...topics];
 const selected=topics.find(topic=>topic.id===open);
 const grouped=notes.filter(note=>note.topic===open);
 const topicMemories=memories.filter(item=>item.organization?.topic===open);
 const points=distinctConversationPoints(grouped);
 const sectionLabels:Record<Kind,string>={note:t('Notes & ideas','Notas e ideas'),explanation:t('Things to remember','Para recordar'),decision:t('Decisions','Decisiones'),question:t('Questions','Preguntas')};
 const sectionDescriptions:Record<Kind,string>={note:t('Your interests, possibilities, and personal notes.','Tus intereses, posibilidades y notas personales.'),explanation:t('Useful explanations to return to.','Explicaciones útiles para volver a consultar.'),decision:t('Choices you have personally confirmed.','Las decisiones que tú has confirmado.'),question:t('Questions to bring to your next conversation.','Preguntas para tu próxima conversación.')};
 // Keep the existing note categories and exact text. Recaps remain distinct from
 // saved notes; placing them together never turns a suggestion into a decision.
 const sectionNotes=[...grouped.filter(note=>note.status==='saved'),...points].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
 const sections=(['note','explanation','decision','question'] as Kind[]).map(kind=>({kind,notes:sectionNotes.filter(note=>note.kind===kind)}));
 const readingKey=JSON.stringify([scope,open]);
 const activeKind=reading[readingKey]?.kind||sections.find(section=>section.notes.length)?.kind||'note';
 const activeNotes=sections.find(section=>section.kind===activeKind)!.notes;
 const pageCount=Math.max(1,Math.ceil(activeNotes.length/notesPerPage));
 const currentPage=Math.min(reading[readingKey]?.page||0,pageCount-1);
 const visibleNotes=activeNotes.slice(currentPage*notesPerPage,(currentPage+1)*notesPerPage);
 function selectSection(kind:Kind){if(kind!==activeKind)navigateWorkspace(()=>setReading(previous=>({...previous,[readingKey]:{kind,page:0}})));}
 function changeReadingPage(page:number){navigateWorkspace(()=>{readingNavigationPending.current=true;setReading(previous=>({...previous,[readingKey]:{kind:activeKind,page}}));});}
 useLayoutEffect(()=>{
  if(!readingNavigationPending.current||!readingHeading.current)return;
  readingNavigationPending.current=false;
  const heading=readingHeading.current;
  heading.focus({preventScroll:true});
  if(heading.getBoundingClientRect().top<24)window.scrollTo({top:Math.max(0,window.scrollY+heading.getBoundingClientRect().top-24),behavior:'instant'});
 },[readingKey,activeKind,currentPage]);
 const scopeLabel=target===null?t('Family notes','Notas familiares'):name;
 async function downloadPdf(topic?:Topic){
  if(exportLock.current||loading||loadError||busy)return;
  exportLock.current=true;setExporting(true);setExportError(null);
  const controller=new AbortController();requests.current.add(controller);
  const lease=browserPrivacy.capture({studentId:target});
  const snapshotScope=scope,version=mutationVersion.current;
  try{
   lease.assert();
   const [{binderPdf},overview,guidance]=await Promise.all([
    import('./binderPdf.mjs'),
    !topic&&discussions.length?history.overview(target,undefined,language,'basic'):Promise.resolve(null),
    includeGuidance&&role==='student'&&target?feedbackRequest({action:'student-list',studentId:target}):Promise.resolve(null)
   ]);
   const check=()=>{lease.assert();if(controller.signal.aborted||latestScope.current!==snapshotScope||version!==mutationVersion.current)throw new Error('export_changed');};
   check();
   const document=binderPdf(binderExportData({studentId:target,name:scopeLabel,language,notes,includeGuidance,coordinatorGuidance:guidance?.feedback||[],summary:overview?.summary||'',topic,originalIds:Object.keys(originals).filter(id=>originals[id])}));
   check();
   const url=URL.createObjectURL(document.output('blob'));
   const link=window.document.createElement('a');link.href=url;link.download=`origen-${topic||'binder'}.pdf`;
   window.document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{
   if(!controller.signal.aborted&&latestScope.current===snapshotScope&&lease.valid())setExportError(t('The PDF could not be prepared. Please try again.','No se pudo preparar el PDF. Inténtalo de nuevo.'));
  }finally{lease.release();requests.current.delete(controller);exportLock.current=false;setExporting(false);}
 }
 function exportButton(topic?:Topic){
  const disabled=exporting||loading||loadError||busy||history.loading||history.error;
  return <details key={topic||'summary'} className="notebook-options" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}>
   <summary>{t('PDF options','Opciones de PDF')} <Download size={16} aria-hidden="true"/></summary>
   <div className="notebook-options-content">
    {topic&&<button type="button" className="notebook-pdf-button" disabled={disabled} onClick={()=>void downloadPdf(topic)}>{exporting?t('Preparing PDF…','Preparando PDF…'):t('Save this topic as PDF','Guardar este tema en PDF')}</button>}
    <button type="button" className="notebook-pdf-button" disabled={disabled} onClick={()=>void downloadPdf()}>{exporting?t('Preparing PDF…','Preparando PDF…'):t('Save binder as PDF','Guardar carpeta en PDF')}</button>
    {role==='student'&&target&&<label><input type="checkbox" checked={includeGuidance} onChange={e=>setIncludeGuidance(e.target.checked)}/>{t('Include coordinator guidance in PDF','Incluir orientación del coordinador en el PDF')}</label>}
   </div>
  </details>;
 }

 const [noticeTarget,setNoticeTarget]=useState<(NoticeDestination & {sequence:number})>();
 function openCoordinatorUpdate(value:NoticeDestination){if(value.studentId!==target)return;setNoticeTarget({...value,sequence:Date.now()});if(value.destination==='guidance')openTopic('summary');requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelector(value.destination==='guidance'?'.coordinator-guidance':'.binder-sharing')?.scrollIntoView({block:'start'})));}
 function dividerDetail(id:NotebookPage){
  if(id==='summary')return t('What we talked about','Lo que conversamos');
  if(loading||loadError)return '—';
  const saved=notes.filter(note=>note.topic===id&&note.status==='saved').length;
  const pointCount=distinctConversationPoints(notes.filter(note=>note.topic===id)).length;
  const personalCount=memories.filter(item=>item.organization?.topic===id).length;
  return [personalCount?`${personalCount} ${t(personalCount===1?'detail':'details',personalCount===1?'dato':'datos')}`:'',pointCount?`${pointCount} ${t(pointCount===1?'key point':'key points',pointCount===1?'punto clave':'puntos clave')}`:'',saved?`${saved} ${t(saved===1?'note':'notes',saved===1?'nota':'notas')}`:''].filter(Boolean).join(' · ')||t('Ready when you are','Cuando tú quieras');
 }
 function jumpToComment(f:Guidance){
  const topic=f.topic as Topic;commentFollowPending.current=true;openTopic(topic);setCommentFocus(f);setCommentOpenRequest(Date.now());
 }
 const locatedComment=useRef(0);
 useEffect(()=>{
  if(!commentFocus||loading||loadError||locatedComment.current===commentOpenRequest)return;
  locatedComment.current=commentOpenRequest;const f=commentFocus,topic=f.topic;
  if(f.anchor?.kind==='note'){
   const group=notes.filter(n=>n.topic===topic),all=[...group.filter(n=>n.status==='saved'),...distinctConversationPoints(group)].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
   const note=all.find(n=>n.id===f.anchor?.id);
   if(note)setReading(prev=>({...prev,[JSON.stringify([scope,topic])]:{kind:note.kind,page:Math.floor(all.filter(n=>n.kind===note.kind).findIndex(n=>n.id===note.id)/notesPerPage)}}));
  }
 },[commentOpenRequest,loading,loadError,data]);
 function revealComment(){if(!commentFocus||!commentFollowPending.current||loading||memoryData.scope!==scope)return false;const element=notebook.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(commentFocus.id)}"]`);if(!element||!element.closest('.binder-open'))return false;commentFollowPending.current=false;element.focus({preventScroll:true});element.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return true;}
 useEffect(()=>{if(!commentFocus)return;const frame=requestAnimationFrame(()=>revealComment());return()=>cancelAnimationFrame(frame);},[commentFocus,reading,open,mobilePage,loading,memoryData]);
 const commentIndex=<div className="student-comment-index">{comments.items.filter(f=>!f.withdrawn).map(f=><button type="button" key={f.id} onClick={()=>jumpToComment(f)}><strong>{topics.find(topic=>topic.id===f.topic)?.title||t('Page comment','Comentario en la página')} · {f.authorName}{!f.reviewed&&!f.hidden?` · ${t('New','Nuevo')}`:''}</strong><span>{f.body}</span></button>)}</div>;
 const unplacedComments=comments.items.filter(f=>f.topic===open&&(!f.anchor||(f.anchor.kind==='note'?!sectionNotes.some(n=>n.id===f.anchor?.id):!topicMemories.some(m=>m.id===f.anchor?.id))));
 function freshCount(id:NotebookPage){return notes.filter(note=>note.topic===id&&freshIds.has(note.id)).length+memories.filter(item=>item.organization?.topic===id&&freshIds.has(binderMemorySignalId(item.id))).length;}
 function dividerGlow(id:NotebookPage){return `${id!=='summary'&&discussing.includes(id)?' is-discussing':''}${freshCount(id)?' has-new-notes':''}`;}
 function dividerSignal(id:NotebookPage){return <span className="notebook-divider-signals">{unreadComments.some(f=>f.topic===id)&&<span className="comment-topic-signal">{unreadComments.filter(f=>f.topic===id).length} {t(unreadComments.filter(f=>f.topic===id).length===1?'new comment':'new comments',unreadComments.filter(f=>f.topic===id).length===1?'comentario nuevo':'comentarios nuevos')}</span>}{id!=='summary'&&discussing.includes(id)&&<span className="notebook-discussing-label"><i aria-hidden="true"/>{t('Discussing now','Conversando ahora')}</span>}{freshCount(id)>0&&(id==='summary'||!discussing.includes(id))&&<span className="notebook-new-label">{freshCount(id)} {t('new','nuevos')}</span>}</span>;}
 return <><ConversationRecovery studentId={target} t={t}/>{role==='student'&&target&&<BinderSharing launchRequest={sharingOpenRequest} key={'sharing-'+target} studentId={target} t={t} openRequest={noticeTarget?.studentId===target&&noticeTarget.destination==='sharing'?noticeTarget.sequence:0} connectionOpenRequest={noticeTarget?.studentId===target&&noticeTarget.destination==='connections'?noticeTarget.sequence:0}/>}
   {indexing&&discussions.length>0&&<p className="notebook-sync-status" role="status">{data?.background?.enabled?t('Your conversation is saved. Key points will appear here when ready.','Tu conversación está guardada. Los puntos clave aparecerán aquí cuando estén listos.'):t('Organizing conversation key points into your topics…','Organizando los puntos clave de tus conversaciones por tema…')}</p>}
   {indexError&&<p className="notebook-sync-status" role="status">{indexError==='notes_ai_limit'?t('Some older conversations still need organizing. Try again later; your saved notes are ready to use.','Aún faltan algunas conversaciones anteriores por organizar. Inténtalo más tarde; tus notas guardadas están listas.'):t('Some conversation points could not be organized yet. Your saved conversations and notes are still here.','Todavía no se pudieron organizar algunos puntos. Tus conversaciones y notas siguen aquí.')} {data?.background?.canRetry!==false&&<button type="button" className="text-button" onClick={()=>{retryOrganization.current=data?.background?.enabled===true;setAttempt(n=>n+1);}}>{t('Try again','Intentar de nuevo')}</button>}</p>}
{comments.status}{unreadComments.length>0&&<button type="button" className="student-comment-arrival" onClick={()=>jumpToComment(unreadComments[0])}>{unreadComments.length} {t(unreadComments.length===1?'new comment from your coordinator':'new comments from your coordinator',unreadComments.length===1?'comentario nuevo de tu coordinador':'comentarios nuevos de tu coordinador')} <span aria-hidden="true">→</span></button>}
<PersonalBinder navigationKey={navKey} openRequest={Math.max(followValid?binderOpenRequest:0,commentOpenRequest)} onFollowReady={()=>{if(!revealComment())revealFollow();}} discussing={topics.filter(topic=>discussing.includes(topic.id)).map(({id,title})=>({id,title}))} initiallyOpen={initiallyOpen} name={target===null?t('Family','Familia'):name} t={t} onOpen={()=>setMobilePage(false)}><section ref={notebook} className={`topic-notebook${mobile?' notebook-mobile':''}`} aria-label={t('My topics & notes','Mis temas y notas')}>
  {(!mobile||!mobilePage)&&<><div className="home-section-heading"><span className="home-kicker">{mobile?t('IN YOUR BINDER','EN TU CARPETA'):t('MAKE IT YOURS','HAZLO TUYO')}</span><h2 id="notebook-heading">{mobile?t('Choose a topic','Elige un tema'):t('My topics & notes','Mis temas y notas')}</h2></div>
  {role==='parent'&&<div className="home-summary-switch" role="group" aria-label={t('Notebook belongs to','Este cuaderno pertenece a')}><button type="button" aria-pressed={target!==null} onClick={()=>setFamilyFor(null)}>{name}</button><button type="button" aria-pressed={target===null} onClick={()=>setFamilyFor(studentId)}>{t('Family notes','Notas familiares')}</button></div>}
  {role==='student'&&target&&<><CoordinatorNotifications key={'updates-'+target} studentId={target} t={t} onOpen={openCoordinatorUpdate}/></>}
  <p className="notebook-scope">{t('Notebook for: ','Cuaderno de: ')}<strong>{scopeLabel}</strong></p></>}
  {!history.cloud?<p>{t('Sign in to save topic notes to your account.','Inicia sesión para guardar notas en tu cuenta.')}</p>:<>
   <StudentMemory key={scope} onEntries={entries=>setMemoryData({scope,entries})} studentId={target} language={language} t={t} historyKey={JSON.stringify([history.items.filter(item=>item.studentId===target).map(item=>item.id),data?.scope===scope?data.generatedSummaryIds:[]])}/>
   {loading&&<p role="status">{t('Loading your notebook…','Cargando tu cuaderno…')}</p>}
   {loadError&&<p role="alert">{t('Your notebook could not be loaded. Your saved notes have not been replaced.','No se pudo cargar tu cuaderno. Tus notas guardadas no se han reemplazado.')} <button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Try again','Intentar de nuevo')}</button></p>}
   <div className="notebook-export-toolbar">{exportButton(selected?.id)}</div>
   {exportError&&<p role="alert" className="notebook-export-error">{exportError}</p>}
   <p className="notebook-live-announcement" role="status">{discussing.length>0?t(`Discussing now: ${topics.filter(topic=>discussing.includes(topic.id)).map(topic=>topic.title).join(", ")}.`,`Conversando ahora: ${topics.filter(topic=>discussing.includes(topic.id)).map(topic=>topic.title).join(", ")}.`):""}{freshIds.size>0?t(` ${freshIds.size} new entries in your binder.`,` ${freshIds.size} entradas nuevas en tu carpeta.`):""}</p>
   <div ref={pageView} className="notebook-page-view">
   {mobile?!mobilePage&&<nav ref={contents} className="notebook-contents" aria-label={t('Binder topics','Temas de la carpeta')}>{dividers.map(({id,title,icon:Icon})=><button type="button" key={id} data-topic={id} className={`notebook-contents-topic divider-${id}${dividerGlow(id)}`} onClick={()=>openTopic(id)}><span className="notebook-contents-icon" aria-hidden="true"><Icon size={21}/></span><span><strong>{title}</strong><small>{dividerDetail(id)}</small>{dividerSignal(id)}</span><ChevronRight size={19} aria-hidden="true"/></button>)}</nav>:<div ref={tabs} className="notebook-topics" role="tablist" aria-label={t('Notebook topics','Temas del cuaderno')}>{dividers.map(({id,title,icon:Icon},index)=><button type="button" role="tab" data-topic={id} id={`notebook-tab-${id}`} key={id} className={`notebook-topic divider-${id}${dividerGlow(id)}`} aria-selected={open===id} tabIndex={open===id?0:-1} aria-controls="notebook-panel" onClick={()=>openTopic(id)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%dividers.length;else if(event.key==='ArrowLeft')next=(index+dividers.length-1)%dividers.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=dividers.length-1;else return;event.preventDefault();openTopic(dividers[next].id);document.getElementById(`notebook-tab-${dividers[next].id}`)?.focus();}}><span className="notebook-tab-icon" aria-hidden="true"><Icon size={19}/></span><span><strong>{title}</strong><small>{dividerDetail(id)}</small>{dividerSignal(id)}</span></button>)}</div>}
   {mobile&&mobilePage&&discussing.length>0&&<nav className="notebook-live-topics" aria-label={t('Topics being discussed','Temas de la conversación')}>{topics.filter(topic=>discussing.includes(topic.id)).map(topic=><button type="button" key={topic.id} data-topic={topic.id} className={`notebook-topic divider-${topic.id} is-discussing`} onClick={()=>openTopic(topic.id)}><strong>{topic.title}</strong>{dividerSignal(topic.id)}</button>)}</nav>}
   {mobile&&mobilePage&&<div className="notebook-page-navigation"><button type="button" onClick={showContents}><ArrowLeft size={18} aria-hidden="true"/>{t('Topics','Temas')}</button><span>{selected?.title||t('Summary','Resumen')}</span></div>}
   {renderNextSteps&&<div className="notebook-next-steps" hidden={!showingPage||open!=='summary'}>{renderNextSteps(target)}</div>}
   {showingPage&&open==='summary'&&renderSummary&&<section className="notebook-panel notebook-summary-page" ref={panel} id="notebook-panel" role={mobile?'region':'tabpanel'} tabIndex={0} aria-label={mobile?t('Summary','Resumen'):undefined} aria-labelledby={mobile?undefined:'notebook-tab-summary'}>{renderSummary(target,mobile)}{role==='student'&&comments.items.length>0&&<section aria-label={t('Coordinator comments','Comentarios del coordinador')}><h4>{t('Comments on your pages','Comentarios en tus páginas')}</h4>{commentIndex}</section>}</section>}
   {showingPage&&selected&&<section className={`notebook-panel divider-${selected.id}`} id="notebook-panel" role={mobile?'region':'tabpanel'} ref={panel} tabIndex={0} aria-label={mobile?selected.title:undefined} aria-labelledby={mobile?undefined:`notebook-tab-${selected.id}`}><div className="notebook-panel-heading"><div><span className="home-kicker">{scopeLabel}</span><h3 id="notebook-topic-heading">{selected.title}</h3>{dividerSignal(selected.id)}<p className="notebook-topic-description">{selected.detail}</p></div></div>
    <div className="notebook-toolbar"><WorkspaceTalkButton t={t} disabled={busy||loading||loadError} focus={{kind:'topic',studentId:target,topic:selected.id}}/><button type="button" className="button primary" disabled={busy||loading||loadError} onClick={()=>edit()}><Plus size={16} aria-hidden="true"/>{t('Add a note','Agregar una nota')}</button></div>

      {data?.correctionsEnabled&&corrections.undo&&<div className="memory-actions"><button type="button" disabled={busy||!!draft} onClick={()=>void act({action:'undo'},t('The selected note was restored. Sharing remains unchanged.','Se restauró la nota seleccionada. Lo compartido no cambia.'))}>{t('Undo last change','Deshacer último cambio')}</button><span>{t('Available here for 10 minutes. Restores only this note.','Disponible aquí durante 10 minutos. Solo restaura esta nota.')}</span></div>}
      {corrections.withdrawn>0&&<p role="status">{t('Related unreviewed details were withdrawn so old information is not used again. Undo restores only the selected note.','Se retiraron los datos relacionados sin revisar para no volver a usar información anterior. Deshacer solo restaura la nota seleccionada.')}</p>}
    {message?.scope===scope&&<div className="notebook-message" role={message.error?'alert':'status'}>{message.text}{message.error&&<ErrorReference reference={message.reference} language={language}/>}{message.error&&<button type="button" className="text-button" onClick={()=>setAttempt(n=>n+1)}>{t('Reload notebook','Recargar cuaderno')}</button>}</div>}
    {busy&&<p role="status">{t('Working on your request…','Procesando tu solicitud…')}</p>}
    {draft&&<form className="notebook-editor" onSubmit={e=>{e.preventDefault();void act({action:draft.version?'update':'create',id:draft.id,...(draft.version?{version:draft.version}:{}),note:{topic:draft.topic,kind:draft.kind,content:draft.content,language:draft.language,decisionConfirmed:draft.decisionConfirmed}},t('Note saved to your account.','Nota guardada en tu cuenta.'),true);}}>
     <h4>{draft.version?t('Edit your note','Editar tu nota'):t('Write something worth keeping','Escribe algo que quieras conservar')}</h4><div className="notebook-editor-fields"><label>{t('Type','Tipo')}<select value={draft.kind} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,kind:e.target.value as Kind,decisionConfirmed:false}}))}>{Object.entries(kinds).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></label><label>{t('Topic','Tema')}<select value={draft.topic} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,topic:e.target.value as Topic}}))}>{topics.map(topic=><option value={topic.id} key={topic.id}>{topic.title}</option>)}</select></label><label>{t('Writing language','Idioma del texto')}<select value={draft.language} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,language:e.target.value as Language}}))}><option value="en">English</option><option value="es">Español</option></select></label></div>
     {draftConflict&&latestDraftNote&&<div className="notebook-message" role="alert"><strong>{t('The saved note has changed. Review it before replacing it with your draft.','La nota guardada cambió. Revísala antes de reemplazarla con tu borrador.')}</strong><p>{latestDraftNote.content}</p><button type="button" className="text-button" disabled={busy} onClick={()=>setDrafts(prev=>({...prev,[draftKey]:{...draft,version:latestDraftNote.version}}))}>{t('I reviewed it; keep my draft','La revisé; conservar mi borrador')}</button></div>}
     {draft.kind==='decision'&&<label className="notebook-decision-confirm"><input type="checkbox" checked={!!draft.decisionConfirmed} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,decisionConfirmed:e.target.checked}}))}/>{t('This is a decision I have made, not an option I am still considering.','Esta es una decisión que tomé, no una opción que todavía estoy considerando.')}</label>}
     <label>{t('Your note','Tu nota')}<textarea ref={editor} required maxLength={2000} rows={5} lang={draft.language} value={draft.content} disabled={busy} onChange={e=>setDrafts(prev=>({...prev,[draftKey]:{...draft,content:e.target.value}}))}/></label><small>{draft.content.length}/2000</small>
     <div className="notebook-toolbar"><button type="submit" className="button primary" disabled={busy||!draft.content.trim()||loading||loadError||draftConflict||draft.kind==='decision'&&!draft.decisionConfirmed}>{t('Save note','Guardar nota')}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{if(!draft.content.trim()||window.confirm(t('Discard this unsaved draft?','¿Descartar este borrador sin guardar?')))setDrafts(prev=>({...prev,[draftKey]:undefined}));}}>{t('Cancel','Cancelar')}</button></div>
    </form>}
    {selected&&topicMemories.length>0&&<StudentMemory key={`${scope}:${selected.id}`} topic={selected.id} revealId={commentFocus?.anchor?.kind==='memory'?commentFocus.anchor.id:undefined} studentId={target} language={language} t={t} freshIds={freshIds} onRead={id=>noteUpdates.read(scope,id)} historyKey={JSON.stringify([historyKey,data?.generatedSummaryIds,memories.map(item=>[item.id,item.version])])}/>}
    {!loading&&!loadError&&<>{!grouped.length&&!draft?topicMemories.length?null:<p className="notebook-empty">{t('A fresh page for this part of your journey. Add a note, or talk with Origen and find your conversation points here.','Una página nueva para esta parte de tu camino. Agrega una nota o conversa con Origen y encuentra aquí los puntos de tu conversación.')}</p>:<div className="notebook-reading-room">
     <div className="notebook-section-box"><h4 id="notebook-sections-title">{t('Topics','Temas')}</h4><div className="notebook-section-tabs" role="tablist" aria-labelledby="notebook-sections-title">{sections.map(({kind,notes:entries},index)=><button type="button" key={kind} id={`notebook-section-${kind}`} role="tab" aria-selected={activeKind===kind} aria-controls="notebook-reading-page" tabIndex={activeKind===kind?0:-1} onClick={()=>selectSection(kind)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%sections.length;else if(event.key==='ArrowLeft')next=(index+sections.length-1)%sections.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=sections.length-1;else return;event.preventDefault();selectSection(sections[next].kind);document.getElementById(`notebook-section-${sections[next].kind}`)?.focus();}}><span>{sectionLabels[kind]}</span><span className="notebook-section-count">{entries.length}</span></button>)}</div></div>
     <section className="notebook-reading-page" id="notebook-reading-page" role="tabpanel" aria-labelledby={`notebook-section-${activeKind}`} tabIndex={0}>
      <div className="notebook-reading-heading"><div><h4 ref={readingHeading} tabIndex={-1}>{sectionLabels[activeKind]}</h4><p>{sectionDescriptions[activeKind]}</p></div><span aria-hidden="true" className="notebook-page-number">{String(currentPage+1).padStart(2,'0')}</span></div>
      {visibleNotes.length?<div className="notebook-entries">{visibleNotes.map(renderNote)}</div>:<p className="notebook-section-empty">{activeKind==='decision'?t('No decisions recorded yet. When you make a choice, you can save a note as a decision.','Aún no hay decisiones guardadas. Cuando tomes una decisión, puedes guardar una nota como decisión.'):t('Nothing here yet. Your notes will appear in this section as you add them.','Todavía no hay nada aquí. Tus notas aparecerán en esta sección cuando las agregues.')}</p>}
      {pageCount>1&&<nav className="notebook-pagination" aria-label={t('Note pages','Páginas de notas')}><button type="button" aria-label={t('Previous page','Página anterior')} disabled={currentPage===0} onClick={()=>changeReadingPage(currentPage-1)}><ChevronLeft size={17} aria-hidden="true"/><span>{t('Previous','Anterior')}</span></button><span role="status">{t(`Page ${currentPage+1} of ${pageCount}`,`Página ${currentPage+1} de ${pageCount}`)}</span><button type="button" aria-label={t('Next page','Página siguiente')} disabled={currentPage===pageCount-1} onClick={()=>changeReadingPage(currentPage+1)}><span>{t('Next','Siguiente')}</span><ChevronRight size={17} aria-hidden="true"/></button></nav>}
     </section>
    </div>}</>}

    {comments.render(unplacedComments)}
    {renderGuide&&<NotebookGuides key={selected.id} title={t('Guides & resources','Guías y recursos')}>{()=>renderGuide(selected.id)}</NotebookGuides>}
   </section>}
   </div>
  </>}
 </section></PersonalBinder></>;
}

function NotebookWriting({content,language,t}:{content:string;language:Language;t:(en:string,es:string)=>string}){
 const [expanded,setExpanded]=useState(false);
 const long=content.length>420||content.split('\n').length>6;
 return <div className="notebook-writing"><p className={`notebook-note-content${long&&!expanded?' is-excerpt':''}`} lang={language}>{content}</p>{long&&<button type="button" className="text-button notebook-read-more" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?t('Show less','Ver menos'):t('Read full note','Leer nota completa')}</button>}</div>;
}

function NotebookGuides({title,children}:{title:string;children:()=>ReactNode}){
 const [opened,setOpened]=useState(false);
 return <details className="notebook-guides" onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>{title}</summary>{opened&&<div className="notebook-guide-content">{children()}</div>}</details>;
}
