import ConversationHistory from './ConversationHistory';
import type {PlanStep} from './planning';
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, GraduationCap, Map, Users, Wallet, type LucideIcon } from 'lucide-react';

type Student = { id: string; name: string; stage: string; interest: string; gpa: string; color: string };
type Action = { title: string; detail: string; icon: LucideIcon; action: () => void };
export type HomeOverviewProps = {
  cloud?:boolean;
  reviewChat:(id:string,text:string,kind:'profile'|'step')=>void; editProfile:(id:string)=>void; plans:Record<string,PlanStep[]>; onFindOpportunities:(text:string)=>void; students: Student[]; selected: string; role: 'parent' | 'student';
  completed: Record<string, boolean>; saved: Record<string, boolean>;
  shared: {id:string;studentId:string;title:string;note:string;response?:string}[];
  booking: string; actions: Action[]; language:'en'|'es';
  t: (en:string,es:string)=>string; stageText:(s:Student)=>string;
  select:(id:string)=>void; open:(id:string,page:'roadmap'|'applications'|'explore')=>void;
  navigate:(page:'costs'|'explore'|'support'|'community')=>void; lesson:(i:number)=>void; toggle:(index:number)=>void;
};

export default function HomeOverview(p:HomeOverviewProps) {
  const {t,students,selected,completed,shared,saved,role}=p;
  const visible=role==='parent'?students:students.filter(s=>s.id===selected);
  return <div className="family-overview">
    {role==='parent'&&<ConversationHistory studentId={null} t={t}/>}
    <section className="overview-metrics" aria-label={t('Family summary','Resumen familiar')}>
      <div><span className="metric-icon"><Users size={21}/></span><span><strong>{visible.length}</strong><small>{t('Student profiles','Perfiles de estudiantes')}</small></span></div>
    </section>

    <div className="section-heading overview-section-title"><div><h2>{role==='parent'?t('Your students at a glance','Tus estudiantes de un vistazo'):t('Your status at a glance','Tu estado de un vistazo')}</h2></div><span className="pill">{p.cloud?t('Your family','Tu familia'):t('Sample family','Familia de ejemplo')}</span></div>
    <section className="student-status-grid">
      {visible.map(s=>{
        const steps=p.plans[s.id]||[];const count=steps.filter(step=>step.status==='complete').length;
        const transfer=s.stage==='Community college';
        return <details className="student-status-card student-dropdown" key={s.id}>
          <summary className="student-status-header"><span className={`avatar ${s.color}`}>{s.name[0]}</span><div><h2>{s.name}</h2><p>{p.stageText(s)}</p></div><span className="status-label">{t('Student profile','Perfil del estudiante')}</span><ChevronDown className="student-expand-icon" size={19} aria-hidden="true"/></summary>
          <div className="student-focus"><Map size={18}/><div><small>{t('CURRENT FOCUS','ENFOQUE ACTUAL')}</small><strong>{transfer?t('Preparing a transfer pathway','Preparar el camino de transferencia'):t('Exploring college pathways','Explorar caminos universitarios')}</strong></div></div>
          <dl className="student-status-details"><div><dt>{t('Reported GPA','GPA reportado')}</dt><dd>{s.gpa||t('Not added','Sin agregar')}</dd></div></dl>
          <div className="student-card-footer"><button className="text-button" onClick={()=>p.editProfile(s.id)}>{t('Edit profile','Editar perfil')}</button><button className="text-button" onClick={()=>p.open(s.id,'roadmap')}>{t('View profile','Ver perfil')}<ArrowRight size={16}/></button></div>
          <ConversationHistory studentId={s.id} t={t}/>
        </details>;
      })}
    </section>


  </div>;
}
