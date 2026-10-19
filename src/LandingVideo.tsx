import {useEffect,useRef,useState} from 'react';
import {Play} from 'lucide-react';
import './LandingVideo.css';

const videoUrl='/videos/origen-onboarding.mp4';
const posterUrl='/videos/origen-onboarding-poster.svg';

export function LandingVideoPlaceholder({title,t}:{title:string;t:(en:string,es:string)=>string}){
 const status=t('Video coming soon','Video próximamente');
 return <div className="landing-video-placeholder" aria-label={`${title}: ${status}`}>
  <div className="landing-video-heading"><h4>{title}</h4><p>{t('A walkthrough is on the way.','Próximamente: un recorrido guiado.')}</p></div>
  <div className="landing-video-placeholder-frame"><span>{status}</span></div>
 </div>;
}

export default function LandingVideo({t}:{t:(en:string,es:string)=>string}){
 const [activated,setActivated]=useState(false),[failed,setFailed]=useState(false);
 const video=useRef<HTMLVideoElement>(null);
 const title=t('Getting started with Origen','Primeros pasos con Origen');
 useEffect(()=>{
  if(!activated||!video.current)return;
  video.current.focus({preventScroll:true});
  // Playback follows an explicit button activation. If the browser declines,
  // native controls remain available; there is no player or media fetch before it.
  void video.current.play().catch(()=>{});
 },[activated]);
 return <article className="landing-video" aria-labelledby="onboarding-video-title">
  <div className="landing-video-heading">
   <h4 id="onboarding-video-title">{title}</h4>
   <p id="onboarding-video-description">{t('Meet Origen, then follow along with account setup.','Conoce Origen y sigue el recorrido para configurar una cuenta.')}</p>
  </div>
  <div className="landing-video-frame">
   {activated?<video ref={video} controls playsInline preload="none" poster={posterUrl} tabIndex={0} aria-label={title} aria-describedby="onboarding-video-description" onError={()=>setFailed(true)}>
    <source src={videoUrl} type="video/mp4"/>
    {t('Your browser does not support this video.','Tu navegador no admite este video.')}
   </video>:<button type="button" className="landing-video-poster" onClick={()=>setActivated(true)} aria-label={t('Play Getting started with Origen, 3 minutes','Reproducir Primeros pasos con Origen, 3 minutos')} aria-describedby="onboarding-video-description">
    <img src={posterUrl} width="1280" height="720" loading="lazy" alt=""/>
    <span className="landing-video-play"><Play size={28} fill="currentColor" aria-hidden="true"/><span>{t('Watch video','Ver video')}</span></span>
    <span className="landing-video-duration" aria-hidden="true">3 min</span>
   </button>}
  </div>
  {activated&&<p className="landing-video-help">
   {failed&&<span role="alert">{t('The video could not load. Try opening it directly.','No se pudo cargar el video. Intenta abrirlo directamente.')} </span>}
   <a href={videoUrl}>{t('Open video directly','Abrir el video directamente')}</a>
  </p>}
 </article>;
}
