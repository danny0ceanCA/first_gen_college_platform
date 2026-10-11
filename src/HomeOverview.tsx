import {useContext,useId,useState,type ReactNode} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import VoiceStartButton from './VoiceStartButton';
import ConversationHistory,{useConversationHistory} from './ConversationHistory';
import {homeTopicActivity,type HomeTopicMode} from './homeTopics.mjs';
import {ArrowRight,BookOpen,ChevronDown,Compass,FileText,GraduationCap,Map,Wallet,type LucideIcon} from 'lucide-react';
import './HomeOverview.css';
import TopicNotebook from './TopicNotebook';
import ActionPlan,{type ActionSeed} from './ActionPlan';
import WorkspaceSheets from './WorkspaceSheetStudio';

type Student = { id: string; name: string; stage: string; interest: string; gpa: string; color: string; goals?:string };
type Action = { title: string; detail: string; icon: LucideIcon; action: () => void };
export type HomeOverviewProps = {
  cloud?:boolean; actionSeed?:ActionSeed|null; queueAction?:(seed:ActionSeed)=>void;
  reviewChat:(id:string,text:string,kind:'profile'|'step')=>void; editProfile:(id:string)=>void; onFindOpportunities:(text:string)=>void; students: Student[]; selected: string; role: 'parent' | 'student';
  completed: Record<string, boolean>; saved: Record<string, boolean>;
  shared: {id:string;studentId:string;title:string;note:string;response?:string}[];
  booking: string; actions: Action[]; language:'en'|'es';
  t: (en:string,es:string)=>string; stageText:(s:Student)=>string;
  select:(id:string)=>void; open:(id:string,page:'roadmap'|'applications'|'explore')=>void;
  navigate:(page:'costs'|'explore'|'support'|'community'|'planning'|'applications'|'loans')=>void; lesson:(i:number)=>void; toggle:(index:number)=>void;
};

export default function HomeOverview(p:HomeOverviewProps) {
  const {t,students,selected,role,language}=p;
  const history=useConversationHistory();
  const voice=useContext(SharedVoiceContext);
  const [familySummaryFor,setFamilySummaryFor]=useState<string|null>(null);
  const student=students.find(s=>s.id===selected);
  if(!student)return null;
  const activity=history.loading||history.error?[]:homeTopicActivity(history.items,student.id);
  const hasFamily=role==='parent'&&history.items.some(item=>item.studentId===null&&item.summary.trim());
  const familySummary=hasFamily&&familySummaryFor===student.id;
  const topicInfo:Record<HomeTopicMode,{title:string;detail:string;page:'planning'|'costs'|'applications'|'loans';icon:LucideIcon}>={
    planning:{title:t('Planning your path','Planificar tu camino'),detail:t('Courses, transfer options, and what comes next.','Cursos, opciones de transferencia y próximos pasos.'),page:'planning',icon:Map},
    finance:{title:t('Paying for college','Pagar la universidad'),detail:t('Make sense of costs and financial aid.','Entiende los costos y la ayuda económica.'),page:'costs',icon:Wallet},
    admissions:{title:t('College applications','Solicitudes universitarias'),detail:t('Explore applications and prepare your questions.','Explora las solicitudes y prepara tus preguntas.'),page:'applications',icon:GraduationCap},
    loans:{title:t('Student loans','Préstamos estudiantiles'),detail:t('Understand borrowing, repayment, and your options.','Entiende los préstamos, los pagos y tus opciones.'),page:'loans',icon:BookOpen}
  };
  const stageIdea=student.stage==='Community college'
    ?{...topicInfo.planning,title:t('Map out a transfer path','Explora un camino de transferencia'),detail:t('Explore majors, coursework, and questions for a counselor.','Explora carreras, cursos y preguntas para un consejero.')}
    :student.stage==='College'
    ?{...topicInfo.planning,title:t('Think through your next semester','Planifica tu próximo semestre'),detail:t('Connect your course choices with your goals.','Conecta tus cursos con tus metas.')}
    :{title:t('Explore my options','Explorar mis opciones'),detail:t('Discover college paths that could fit your interests.','Descubre caminos universitarios que se adapten a tus intereses.'),page:'explore' as const,icon:Compass};
  const candidates=[...(activity[0]?[{...topicInfo[activity[0].mode],title:t('Pick up where you left off','Retoma la conversación'),detail:topicInfo[activity[0].mode].title}]:[]),stageIdea,{...topicInfo.finance,title:t('Understand college costs','Entender los costos universitarios')},topicInfo.admissions];
  const ideas=candidates.filter((idea,index)=>candidates.findIndex(other=>other.page===idea.page)===index).slice(0,3);
  return <div className="home-workspace">
    <section className="home-person" aria-label={role==='parent'?t('Selected student','Estudiante seleccionado'):t('Your profile','Tu perfil')}>
      <div className="home-person-heading">{role==='parent'&&students.length>1?<div className="home-student-selector" role="group" aria-label={t('Choose a student for this home page','Elige un estudiante para esta página de inicio')}><span>{t('Planning for','Planificar para')}</span>{students.map(s=><button type="button" key={s.id} aria-pressed={s.id===student.id} onClick={()=>{setFamilySummaryFor(null);p.select(s.id);}}>{s.name}</button>)}</div>:<><span className={`avatar ${student.color}`} aria-hidden="true">{student.name[0]}</span><div><span className="home-kicker">{role==='parent'?t('PLANNING FOR','PLANIFICAR PARA'):t('YOUR PATH','TU CAMINO')}</span><h2>{student.name}</h2><p>{p.stageText(student)}</p></div></>}<button type="button" className="text-button" onClick={()=>p.editProfile(student.id)}>{t('Edit profile','Editar perfil')}<ArrowRight size={15} aria-hidden="true"/></button></div>
      {(student.goals?.trim()||student.interest?.trim())&&<details className="home-person-focus"><summary>{student.goals?.trim()?t('Goal from your profile','Meta de tu perfil'):t('Interests from your profile','Intereses de tu perfil')}</summary><p>{student.goals?.trim()||student.interest}</p></details>}
    </section>

    <section className="home-conversation" aria-labelledby="home-conversation-heading">
      <div><span className="home-kicker">{t('HERE WITH YOU','AQUÍ CONTIGO')}</span><h2 id="home-conversation-heading">{t('Let’s talk about your next step.','Hablemos de tu próximo paso.')}</h2><p>{t('Ask about college, costs, or transferring. You don’t need to know where to start.','Pregunta sobre la universidad, los costos o las transferencias. No necesitas saber por dónde empezar.')}</p>
      <VoiceStartButton label={voice?.active?t('Return to conversation','Volver a la conversación'):t('Talk with Origen','Hablar con Origen')} disabled={!voice?.ready} onClick={()=>voice?.start()}/>
      <small>{t('You can also press the circle in the bottom bar, from any page.','También puedes presionar el círculo de la barra inferior desde cualquier página.')}</small></div>
      <aside className="home-conversation-tip"><span>{t('Not sure what to say?','¿No sabes qué decir?')}</span><p>“{t('I’m not sure where to start. Can you help me?','No sé por dónde empezar. ¿Me puedes ayudar?')}”</p><small>{t('Speak in English or Spanish, at your own pace.','Habla en inglés o español, a tu ritmo.')}</small></aside>
    </section>

    <div className="home-at-a-glance">
    <section className="home-memory" aria-label={t('Your saved conversations','Tus conversaciones guardadas')}>
      {hasFamily&&<div className="home-summary-switch" role="group" aria-label={t('Choose which summary to read','Elige qué resumen leer')}><button type="button" aria-pressed={!familySummary} onClick={()=>setFamilySummaryFor(null)}>{student.name}</button><button type="button" aria-pressed={familySummary} onClick={()=>setFamilySummaryFor(student.id)}>{t('Family conversations','Conversaciones familiares')}</button></div>}
      <ConversationHistory key={`${familySummary?'family':student.id}-${language}`} studentId={familySummary?null:student.id} t={t} title={familySummary?t('Your family summary','Tu resumen familiar'):role==='parent'?t(`Summary for ${student.name}`,`Resumen de ${student.name}`):t('What we talked about','De qué hablamos')}/>
    </section>

    <ActionPlan compact studentId={student.id} name={student.name} role={role} language={language} t={t} seed={p.actionSeed||null}/>
    </div>

    <section className="home-next" aria-labelledby="home-next-heading"><div className="home-section-heading"><h2 id="home-next-heading">{t('Or explore a topic','O explora un tema')}</h2><p>{t('Read a little. Ask a question whenever you like.','Lee un poco. Pregunta cuando quieras.')}</p></div>
      <div className="home-next-grid">{ideas.map(({title,detail,page,icon:Icon})=><button type="button" key={page} className="home-next-card" onClick={()=>p.navigate(page)}><Icon size={21} aria-hidden="true"/><strong>{title}</strong><span>{detail}</span><ArrowRight className="home-card-arrow" size={18} aria-hidden="true"/></button>)}</div>
    </section>

    <section className="home-library" aria-label={t('Your notes and tools','Tus notas y herramientas')}>
      <HomeShelf title={t('My notes','Mis notas')} description={t('Things you’ve learned and questions to come back to.','Lo que has aprendido y las preguntas que quieres retomar.')} icon={BookOpen}>
        <TopicNotebook onAction={seed=>p.queueAction?.({...seed,serial:crypto.randomUUID()})} studentId={student.id} name={student.name} role={role} language={language} t={t} navigate={p.navigate}/>
      </HomeShelf>
      <HomeShelf title={t('Prepare for what’s next','Prepárate para lo que viene')} description={t('Make a checklist, compare colleges, or prepare for a counselor visit.','Haz una lista, compara universidades o prepara una visita a consejería.')} icon={FileText}>
        <WorkspaceSheets studentId={student.id} name={student.name} role={role} language={language} t={t}/>
      </HomeShelf>
    </section>
  </div>;
}

/** Load optional tools on first use; keep them mounted so closing never loses a draft. */
function HomeShelf({title,description,icon:Icon,children}:{title:string;description:string;icon:LucideIcon;children:ReactNode}){
 const [visited,setVisited]=useState(false),id=useId();
 return <details className="home-shelf" onToggle={event=>{if(event.currentTarget.open)setVisited(true);}}>
  <summary aria-controls={id}><Icon size={22} aria-hidden="true"/><span><strong>{title}</strong><small>{description}</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
  <div className="home-shelf-content" id={id}>{visited&&children}</div>
 </details>;
}
