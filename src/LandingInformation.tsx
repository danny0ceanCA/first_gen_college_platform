import {useEffect,useRef,useState} from 'react';
import LandingAbout from './LandingAbout';
import LandingDetails,{publicContactEmail} from './LandingDetails';
import './Landing.css';
import './LandingInformation.css';

export default function LandingInformation({page}:{page:'about'|'privacy'}){
 const [es,setEs]=useState(()=>localStorage.getItem('origen.language')==='es');
 const heading=useRef<HTMLHeadingElement>(null);
 const t=(en:string,spanish:string)=>es?spanish:en;
 useEffect(()=>{document.documentElement.lang=es?'es':'en';localStorage.setItem('origen.language',es?'es':'en');},[es]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[page]);
 return <div className="landing landing-information">
  <header className="landing-nav"><a className="landing-logo" href="#" aria-label="Origen home"><span className="landing-mark">○</span>origen<span>.</span></a><nav aria-label={t('Navigation','Navegación')}>
   <a href="#">{t('Home','Inicio')}</a>
   <a href="#about" aria-current={page==='about'?'page':undefined}>{t('About Origen','Acerca de Origen')}</a>
   <a href="#privacy" aria-current={page==='privacy'?'page':undefined}>{t('Data privacy','Privacidad de datos')}</a>
   <button className="landing-language" lang={es?'en':'es'} aria-label={es?'Switch to English':'Ver en español'} onClick={()=>setEs(value=>!value)}>{es?'English':'Español'}</button>
  </nav></header>
  <main className="landing-main landing-information-main">
   <h1 ref={heading} tabIndex={-1}>{page==='about'?t('About Origen','Acerca de Origen'):t('Data privacy','Privacidad de datos')}</h1>
   {page==='about'?<LandingAbout t={t}/>:<LandingDetails t={t} section="privacy"/>}
   <a className="landing-primary" href="#">{t('Back to home','Volver al inicio')} <span aria-hidden="true">↗</span></a>
  </main>
  <footer className="landing-footer"><strong>origen.</strong><a href="#">{t('Home','Inicio')}</a><a href="#about">{t('About Origen','Acerca de Origen')}</a><a href="#privacy">{t('Data privacy','Privacidad de datos')}</a>{publicContactEmail&&<a href={`mailto:${publicContactEmail}`}>{t('Contact','Contacto')}</a>}<span>{t('Origen Edu is operated by Blueprint Holdings LLC.','Origen Edu es operado por Blueprint Holdings LLC.')}</span></footer>
 </div>;
}
