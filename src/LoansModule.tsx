import {ExternalLink} from 'lucide-react';
import ProfileVoice from './ProfileVoice';
import type {StudentProfile} from './planning';
import './LoansModule.css';
const topics=[
 ['Loan types','Tipos de préstamos','Compare federal and private loans, subsidized and unsubsidized loans, and parent borrowing.','Compara préstamos federales y privados, subsidiados y no subsidiados, y préstamos para padres.','https://studentaid.gov/understand-aid/types/loans'],
 ['Interest and loan terms','Intereses y condiciones','Understand interest rates, capitalization, borrowing limits and grace periods.','Entiende las tasas de interés, la capitalización, los límites y los períodos de gracia.','https://studentaid.gov/understand-aid/types/loans/interest-rates'],
 ['Repayment','Pagos','Explore repayment options and learn how to find your loan servicer.','Explora las opciones de pago y cómo encontrar al administrador de tu préstamo.','https://studentaid.gov/manage-loans/repayment'],
 ['Deferment and forbearance','Aplazamiento y suspensión temporal','Learn about temporary payment relief and what happens to interest. A payment pause does not cancel your debt.','Conoce las pausas temporales de pago y qué pasa con los intereses. Una pausa no elimina la deuda.','https://studentaid.gov/manage-loans/lower-payments/get-temporary-relief']
] as const;
export default function Loans({profile,role,language,t}:{profile:StudentProfile;role:'parent'|'student';language:'en'|'es';t:(en:string,es:string)=>string}){
 return <section className="loans-module" aria-label={t('Student loans','Préstamos estudiantiles')}>
 <ProfileVoice mode="loans" profile={profile} role={role} language={language} t={t} apply={()=>{}} onActive={()=>{}}/>
 <div className="loan-topic-grid">{topics.map(([en,es,description,descripcion,url],index)=><article className="loan-topic" key={url}><span className="pill">0{index+1}</span><h2>{t(en,es)}</h2><p>{t(description,descripcion)}</p><a className="source-link" href={url} target="_blank" rel="noreferrer">{t('Explore Federal Student Aid','Consultar Federal Student Aid')}<ExternalLink size={15}/></a></article>)}</div>
 <p className="small-text muted">{t('Ask in English or Spanish. Official source links open Federal Student Aid; some pages may be in English. Your servicer can confirm which options apply to your loan.','Pregunta en español o inglés. Los enlaces oficiales abren Federal Student Aid; algunas páginas pueden estar en inglés. El administrador puede confirmar las opciones para tu préstamo.')}</p>
 </section>;
}
