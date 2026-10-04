import {ExternalLink,GraduationCap,Route,NotebookPen} from 'lucide-react';
import ProfileVoice from './ProfileVoice';
import ConversationHistory from './ConversationHistory';
import type {StudentProfile} from './planning';
import './Planning.css';

const resources=[
 {name:'UC',es:'UC',url:'https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/',detail:'First-year preparation and admission requirements',detailEs:'Preparación y requisitos de ingreso de primer año'},
 {name:'A–G Course List',es:'Lista de cursos A–G',url:'https://hs-articulation.ucop.edu/agcourselist',detail:'Find approved courses at a California high school',detailEs:'Consulta cursos aprobados de una preparatoria de California'},
 {name:'Cal State',es:'Cal State',url:'https://www.calstate.edu/apply/freshman/getting_into_the_csu',detail:'CSU first-year admission requirements',detailEs:'Requisitos de ingreso de primer año de CSU'},
 {name:'Community college',es:'Colegio comunitario',url:'https://www.cccco.edu/Students/student-faq',detail:'Getting started and dual enrollment',detailEs:'Cómo empezar e inscripción dual'},
 {name:'ASSIST',es:'ASSIST',url:'https://assist.org/',detail:'College-course transferability and transfer agreements',detailEs:'Transferibilidad de cursos universitarios y acuerdos de transferencia'}
];
export default function Planning({profile,role,language,t}:{profile:StudentProfile;role:'parent'|'student';language:'en'|'es';t:(a:string,b:string)=>string}){
 const grade=profile.stage.match(/^(9|10|11|12)th grade$/)?.[1];
 const focus=profile.stage==='Community college'?t('Explore majors, map a transfer path and identify the course agreements to verify with your counselor.','Explora carreras, planifica una transferencia e identifica los acuerdos de cursos que debes verificar con tu consejero.'):profile.stage==='College'?t('Talk through degree goals, course choices, costs and what comes after college. Bring your campus and catalog year for specific requirements.','Conversa sobre metas, cursos, costos y lo que sigue después de la universidad. Para requisitos específicos, indica tu universidad y año del catálogo.'):grade==='12'?t('Bring your course record and intended entry year. We’ll focus on remaining requirements and upcoming applications.','Trae tu lista de cursos y el año de ingreso previsto. Revisaremos requisitos pendientes y próximas solicitudes.'):grade==='11'?t('Review next year’s courses, explore campuses and majors, and identify what to verify before senior year.','Revisa los cursos del próximo año, explora universidades y carreras, e identifica qué confirmar antes del último año.'):t('Start with interests and your goals. There is room to explore, ask questions and adjust the plan at any stage.','Empieza con intereses y metas. Hay espacio para explorar, preguntar y ajustar el plan en cualquier etapa.');
 return <div className="high-school-planning">
  <section className="planning-intro"><GraduationCap size={28}/><div><h2>{t('A plan that grows with you','Un plan que crece contigo')}</h2><p>{focus}</p></div></section>
  <ProfileVoice key={role} mode="planning" profile={profile} role={role} language={language} t={t} apply={()=>{}} onActive={()=>{}}/>
  <section className="planning-paths" aria-label={t('What we can plan together','Qué podemos planificar juntos')}>
   <article><NotebookPen size={21}/><h3>{t('Choose courses with purpose','Elige cursos con propósito')}</h3><p>{t('Discuss course choices, A–G preparation, transfer agreements or degree requirements for your stage.','Conversa sobre cursos, preparación A–G, acuerdos de transferencia o requisitos de titulación según tu etapa.')}</p></article>
   <article><Route size={21}/><h3>{t('Keep different paths open','Mantén abiertos varios caminos')}</h3><p>{t('Explore college, transfer, major and career goals alongside costs and the time available.','Explora universidades, transferencias, carreras y metas profesionales considerando costos y tiempo disponible.')}</p></article>
   <article><GraduationCap size={21}/><h3>{t('Choose the next few steps','Elige los próximos pasos')}</h3><p>{t('Ask for a short plan for this semester. Conversation summaries keep agreed actions and open questions together.','Pide un plan breve para este semestre. Los resúmenes reúnen las acciones acordadas y preguntas pendientes.')}</p></article>
  </section>
  <section className="planning-resources"><h2>{t('Official sources, close at hand','Fuentes oficiales, a la mano')}</h2><p>{t('A–G approval, high school graduation and college-course transferability are separate checks. Origen verifies the relevant source and year when you ask.','La aprobación A–G, la graduación de preparatoria y la transferibilidad de cursos universitarios son consultas distintas. Origen verifica la fuente y el año correspondientes cuando preguntas.')}</p><div>{resources.map(r=><a href={r.url} target="_blank" rel="noreferrer" key={r.url}><span><strong>{t(r.name,r.es)}</strong><small>{t(r.detail,r.detailEs)}</small></span><ExternalLink size={17}/></a>)}</div></section>
  <ConversationHistory studentId={profile.id} mode="planning" t={t}/>
 </div>;
}
