import ProfileVoice from './ProfileVoice';
import type { StudentProfile } from './planning';

export default function CollegeFinanceChat({ students, selected, select, role, language, t, active }: {
  active:boolean; students: StudentProfile[]; selected: string; select: (id: string) => void;
  role: 'parent' | 'student'; language: 'en' | 'es'; t: (en: string, es: string) => string;
}) {
  const student = students.find(s => s.id === selected);
  if (!student) return null;
  return <section className="finance-chat" aria-labelledby="finance-chat-heading">
    <h2 id="finance-chat-heading">{t('Do you have more questions about paying for college?', '¿Tienes más preguntas sobre cómo pagar la universidad?')}</h2>
    <p>{role === 'parent'
      ? t('Ask Camino to explain college costs, FAFSA, financial aid offers, or what your family may need to cover.', 'Pide a Camino que explique los costos universitarios, la FAFSA, las ofertas de ayuda o lo que tu familia podría necesitar cubrir.')
      : t('Ask Camino to explain your college costs, FAFSA, financial aid offers, or how to pay for your education.', 'Pide a Camino que explique tus costos universitarios, la FAFSA, las ofertas de ayuda o cómo pagar tus estudios.')}</p>
    {role === 'parent' && <div className="overview-student-filter" aria-label={t('Choose a student for financial aid guidance', 'Elige un estudiante para la orientación sobre ayuda económica')}>
      {students.map(s => <button key={s.id} aria-pressed={s.id === selected} className={s.id === selected ? 'active' : ''} onClick={() => select(s.id)}>{s.name}</button>)}
    </div>}
    {active&&<ProfileVoice key={`${student.id}:${role}:${language}`} mode="finance" profile={student} role={role} language={language} t={t} apply={()=>{}} onActive={()=>{}}/>}
  </section>;
}
