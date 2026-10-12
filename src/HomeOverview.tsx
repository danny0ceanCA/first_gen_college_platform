import type {ReactNode} from 'react';
import {ArrowRight,type LucideIcon} from 'lucide-react';
import ConversationHistory from './ConversationHistory';
import './HomeOverview.css';
import TopicNotebook from './TopicNotebook';
import type {ActionSeed} from './ActionPlan';
type Student = { id: string; name: string; stage: string; interest: string; gpa: string; color: string; goals?:string };
type Action = { title: string; detail: string; icon: LucideIcon; action: () => void };
export type HomeOverviewProps = {
  renderGuide?:(topic:'options'|'transfer'|'costs'|'applications')=>ReactNode;
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
  const student=students.find(s=>s.id===selected);
  if(!student)return null;
  const goal=student.goals?.trim()||student.interest?.trim();
  return <div className="home-workspace">
    <section className="home-person" aria-label={role==='parent'?t('Selected student','Estudiante seleccionado'):t('Your profile','Tu perfil')}>
      <div className="home-person-heading">{role==='parent'&&students.length>1?<div className="home-student-selector" role="group" aria-label={t('Choose a student for this home page','Elige un estudiante para esta página de inicio')}><span>{t('Planning for','Planificar para')}</span>{students.map(s=><button type="button" key={s.id} aria-pressed={s.id===student.id} onClick={()=>p.select(s.id)}>{s.name}</button>)}</div>:<><span className={`avatar ${student.color}`} aria-hidden="true">{student.name[0]}</span><div><span className="home-kicker">{role==='parent'?t('PLANNING FOR','PLANIFICAR PARA'):t('YOUR PATH','TU CAMINO')}</span><h2>{student.name}</h2><p>{p.stageText(student)}</p></div></>}<button type="button" className="text-button" onClick={()=>p.editProfile(student.id)}>{t('Edit profile','Editar perfil')}<ArrowRight size={15} aria-hidden="true"/></button></div>
      {goal&&<p className="home-person-blurb">{goal}</p>}
    </section>
    <TopicNotebook renderGuide={p.renderGuide} studentId={student.id} name={student.name} role={role} language={language} t={t} navigate={p.navigate} renderSummary={(target,flowing)=><section className="home-memory" aria-label={t('Your saved conversations','Tus conversaciones guardadas')}><ConversationHistory basic flowing={flowing} key={`${target??'family'}-${language}`} studentId={target} t={t} title={target===null?t('Your family summary','Tu resumen familiar'):role==='parent'?t(`Summary for ${student.name}`,`Resumen de ${student.name}`):t('What we talked about','De qué hablamos')}/></section>}/>
  </div>;
}
