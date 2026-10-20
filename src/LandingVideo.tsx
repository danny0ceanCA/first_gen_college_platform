import {useEffect,useRef,useState} from 'react';
import {Play} from 'lucide-react';
import './LandingVideo.css';

const posterUrl='/videos/origen-onboarding-poster.svg';
const videos={
 onboarding:{
  id:'onboarding-video',url:'/videos/origen-onboarding.mp4',duration:'3 min',
  title:['Getting started with Origen','Primeros pasos con Origen'],
  description:['Meet Origen, then follow along with account setup.','Conoce Origen y sigue el recorrido para configurar una cuenta.'],
  playLabel:['Play Getting started with Origen, 3 minutes','Reproducir Primeros pasos con Origen, 3 minutos']
 },
 'college-costs':{
  id:'college-costs-video',url:'/videos/origen-college-costs.mp4',duration:'3 min',
  title:['College costs with Origen','Costos universitarios con Origen'],
  description:['Explore college costs and financial aid with Origen.','Explora los costos universitarios y la ayuda económica con Origen.'],
  playLabel:['Play College costs with Origen, 3 minutes','Reproducir Costos universitarios con Origen, 3 minutos']
 },
 binder:{
  id:'binder-video',url:'/videos/origen-binder-preview.mp4',duration:'1:23',
  title:['Your Origen binder','Tu carpeta de Origen'],
  description:['Preview notes and next steps. Audio in English.','Conoce tus notas y próximos pasos. Audio en inglés.'],
  playLabel:['Play Your Origen binder, 1 minute 23 seconds, audio in English','Reproducir Tu carpeta de Origen, 1 minuto y 23 segundos, audio en inglés']
 }
} as const;

export function LandingVideoPlaceholder({title,t}:{title:string;t:(en:string,es:string)=>string}){
 const status=t('Video coming soon','Video próximamente');
 return <div className="landing-video-placeholder" aria-label={`${title}: ${status}`}>
  <div className="landing-video-heading"><h4>{title}</h4><p>{t('A walkthrough is on the way.','Próximamente: un recorrido guiado.')}</p></div>
  <div className="landing-video-placeholder-frame"><span>{status}</span></div>
 </div>;
}

export default function LandingVideo({t,variant='onboarding'}:{t:(en:string,es:string)=>string;variant?:keyof typeof videos}){
 const [activated,setActivated]=useState(false),[failed,setFailed]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 const content=videos[variant],videoUrl=content.url,title=t(content.title[0],content.title[1]);
 const titleId=`${content.id}-title`,descriptionId=`${content.id}-description`;
 useEffect(()=>{
  if(!activated||!video.current)return;
  video.current.focus({preventScroll:true});
  // Playback follows an explicit button activation. If the browser declines,
  // native controls remain available; there is no player or media fetch before it.
  void video.current.play().catch(()=>{});
 },[activated]);
 return <article className="landing-video" data-video={variant} aria-labelledby={titleId}>
  <div className="landing-video-heading">
   <h4 id={titleId}>{title}</h4>
   <p id={descriptionId}>{t(content.description[0],content.description[1])}</p>
  </div>
  <div className="landing-video-frame">
   {activated?<video ref={video} controls playsInline preload="none" poster={posterUrl} tabIndex={0} aria-label={title} aria-describedby={descriptionId} onError={()=>setFailed(true)}>
    <source src={videoUrl} type="video/mp4"/>
    {t('Your browser does not support this video.','Tu navegador no admite este video.')}
   </video>:<button type="button" className="landing-video-poster" onClick={()=>setActivated(true)} aria-label={t(content.playLabel[0],content.playLabel[1])} aria-describedby={descriptionId}>
    <img src={posterUrl} width="1280" height="720" loading="lazy" alt=""/>
    <span className="landing-video-play"><Play size={28} fill="currentColor" aria-hidden="true"/><span>{t('Watch video','Ver video')}</span></span>
    <span className="landing-video-duration" aria-hidden="true">{content.duration}</span>
   </button>}
  </div>
  {activated&&<p className="landing-video-help">
   {failed&&<span role="alert">{t('The video could not load. Try opening it directly.','No se pudo cargar el video. Intenta abrirlo directamente.')} </span>}
   <a href={videoUrl}>{t('Open video directly','Abrir el video directamente')}</a>
  </p>}
 </article>;
}
