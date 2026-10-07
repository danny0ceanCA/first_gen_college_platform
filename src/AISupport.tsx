import {useState} from 'react';
import {ArrowRight,Check,ChevronRight} from 'lucide-react';
import StudentGuidance from './StudentGuidance';
import type {HomeOverviewProps} from './HomeOverview';

export default function AISupport(p:HomeOverviewProps){
  const {t,students,selected,completed,role}=p;
  const [topics,setTopics]=useState<Record<string,number>>({});
  const topicKey=`${role}:${selected}`;
  const topic=topics[topicKey]??0;
  const guidance = [
    {title:t('Research interests & opportunities','Investiga intereses y oportunidades'),detail:t('Connect favorite subjects with majors and careers. Ask AI to find current internships and volunteering that match.','Conecta sus materias favoritas con carreras y profesiones. Pide a la IA que busque pasantías y voluntariado relacionados.')},
    {title:t('Understand the college paths','Conoce los caminos universitarios'),detail:t('Compare college and transfer options that fit your student.','Compara opciones universitarias y de transferencia para tu estudiante.')},
    {title:t('Get comfortable with college costs','Entiende los costos universitarios'),detail:t('Understand costs, financial aid, and what to consider as a family.','Entiende los costos, la ayuda económica y lo que tu familia puede considerar.')}
  ];
  // The family arrives asynchronously after sign-in/refresh. Selection may
  // still belong to the preview or to a student that was just removed.
  const student=students.find(s=>s.id===selected)||students[0];
  if(!student)return <section className="empty-state"><p>{t('Add a student to begin planning with AI.','Agrega un estudiante para empezar a planificar con IA.')}</p></section>;
  return <div className="family-detail-grid expanded-guidance"><section className="overview-panel">
      <div className="section-heading"><div><h2>{t('Plan and research with AI','Planea e investiga con IA')}</h2><p>{t('Ask Origen to connect academic interests with careers, explain college and transfer pathways, or break down costs and financial aid. Ask for current internships or volunteer opportunities to get web research with source links, right in this chat.','Pide a Origen que conecte intereses académicos con profesiones, explique caminos universitarios y de transferencia, o aclare costos y ayuda económica. Pide oportunidades actuales de pasantías o voluntariado para recibir una búsqueda con enlaces a las fuentes en este chat.')}</p></div><span className="pill">{t('AI guidance','Orientación con IA')}</span></div>
      {role==='parent'&&<div className="overview-student-filter" aria-label={t('Next steps by student','Próximos pasos por estudiante')}>{students.map(s=><button key={s.id} className={s.id===selected?'active':''} aria-pressed={s.id===selected} onClick={()=>p.select(s.id)}>{s.name}</button>)}</div>}
      <div className="next-step-workspace"><div className="step-picker"><div className="overview-next-steps">{guidance.map((action,i)=><div key={action.title} className={`overview-action ${topic===i?'selected-topic':''}`}><button className={`circle-check ${completed[`${selected}:${i}`]?'checked':''}`} aria-label={`${completed[`${selected}:${i}`]?t('Reopen','Reabrir'):t('Mark complete','Marcar completado')}: ${action.title}`} aria-pressed={!!completed[`${selected}:${i}`]} onClick={()=>p.toggle(i)}>{completed[`${selected}:${i}`]&&<Check size={15}/>}</button><button className="overview-action-link" aria-pressed={topic===i} onClick={()=>setTopics(prev=>({...prev,[topicKey]:i}))}><strong>{action.title}</strong><span>{action.detail}</span></button><ChevronRight size={16}/></div>)}</div>
      <button className="text-button" onClick={()=>p.open(student.id,'roadmap')}>{t(`View ${student.name}’s profile`,`Ver el perfil de ${student.name}`)}<ArrowRight size={16}/></button>
      </div><StudentGuidance review={(text,kind)=>p.reviewChat(student.id,text,kind)} role={role} student={student} language={p.language} t={t} topic={topic} topicTitle={guidance[topic].title}/></div>
    </section></div>;
}
