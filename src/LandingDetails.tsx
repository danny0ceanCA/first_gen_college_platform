import PrivacyNotice from './PrivacyNotice';
const email=(import.meta.env.VITE_PUBLIC_CONTACT_EMAIL as string|undefined)||'daniel@origenedu.ai';
export const publicContactEmail=email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:undefined;
type Props={t:(en:string,es:string)=>string;section?:'privacy'|'contact'};
export default function LandingDetails({t,section}:Props){
 const contact=publicContactEmail;
 return <>
  {section!=='contact'&&<PrivacyNotice t={t}/>}
  {section!=='privacy'&&contact&&<section className="landing-resource" id="contact" aria-labelledby="contact-title"><span className="landing-eyebrow">{t('CONTACT','CONTACTO')}</span><h2 id="contact-title">{t('Get in touch with Origen.','Contacta a Origen.')}</h2><p>{t('Origen Edu is operated by Blueprint Holdings LLC.','Origen Edu es operado por Blueprint Holdings LLC.')}</p><p>{t('Questions about Origen, sharing it with your community, or your information? Email us. Please keep student records and sensitive details out of your message.','¿Tienes preguntas sobre Origen, cómo compartirlo con tu comunidad o tu información? Escríbenos. No incluyas registros de estudiantes ni información sensible en tu mensaje.')}</p><a className="landing-share-link" href={`mailto:${contact}`}>{contact}</a></section>}
 </>;
}
