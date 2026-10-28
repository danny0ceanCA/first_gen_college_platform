import {useContext,type ReactNode} from 'react';
import {SharedVoiceContext} from './SharedVoiceContext';
import VoiceStartButton from './VoiceStartButton';
import {ArrowRight,type LucideIcon} from 'lucide-react';
import ConversationHistory from './ConversationHistory';
import './HomeOverview.css';
import TopicNotebook from './TopicNotebook';
import type {BinderFollowRequest} from './binderFollow.mjs';
import ActionPlan,{type ActionSeed} from './ActionPlan';
type Student = { id: string; name: string; stage: string; interest: string; gpa: string; color: string; goals?:string };
type Action = { title: string; detail: string; icon: LucideIcon; action: () => void };
export type HomeOverviewProps = {
  binderInitiallyOpen?:boolean;
  sharingOpenRequest?:number;
  binderFollow?:BinderFollowRequest|null;
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
  const voice=useContext(SharedVoiceContext);
  const student=students.find(s=>s.id===selected);
  if(!student)return null;
  const goal=student.goals?.trim()||student.interest?.trim();
  return <div className="home-workspace">
    <section className="home-person" aria-label={role==='parent'?t('Selected student','Estudiante seleccionado'):t('Your profile','Tu perfil')}>
      {role==='parent'&&students.length>1&&<label className="home-student-switch">{t('Planning for','Planificar para')}<select value={student.id} onChange={e=>p.select(e.target.value)}>{students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <div className="home-person-heading"><span className={`avatar ${student.color}`} aria-hidden="true">{student.name[0]}</span><div><span className="home-kicker">{role==='parent'?t('PLANNING FOR','PLANIFICAR PARA'):t('YOUR PATH','TU CAMINO')}</span><h2>{student.name}</h2><p>{p.stageText(student)}</p></div><button type="button" className="text-button" onClick={()=>p.editProfile(student.id)}>{t('Edit profile','Editar perfil')}<ArrowRight size={15} aria-hidden="true"/></button></div>
      <div className="home-primary-actions"><VoiceStartButton label={voice?.active?t('Open conversation','Abrir conversación'):t('Talk with Origen','Hablar con Origen')} disabled={!voice?.ready} onClick={()=>voice?.active?voice.open():voice?.start()}/><span>{t('Your binder keeps what you learn together.','Tu carpeta reúne lo que vas aprendiendo.')}</span></div>
      {goal&&<p className="home-person-blurb">{goal}</p>}
    </section>
    <TopicNotebook sharingOpenRequest={p.sharingOpenRequest} followRequest={p.binderFollow} initiallyOpen={p.binderInitiallyOpen} onAction={p.cloud?p.queueAction:undefined} renderNextSteps={p.cloud?(target)=><ActionPlan compact scopeStudentId={target} studentId={student.id} name={student.name} role={role} language={language} t={t} seed={p.actionSeed||null}/>:undefined} renderGuide={p.renderGuide} studentId={student.id} name={student.name} role={role} language={language} t={t} navigate={p.navigate} renderSummary={(target,flowing)=><section className="home-memory" aria-label={t('Your saved conversations','Tus conversaciones guardadas')}><ConversationHistory binder basic flowing={flowing} key={`${target??'family'}-${language}`} studentId={target} t={t} title={target===null?t('Your family summary','Tu resumen familiar'):role==='parent'?t(`Summary for ${student.name}`,`Resumen de ${student.name}`):t('What we talked about','De qué hablamos')}/></section>}/>
  </div>;
}
