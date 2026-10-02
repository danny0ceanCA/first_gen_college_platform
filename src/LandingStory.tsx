import StoryArtwork from './StoryArtwork';
import {useEffect,useRef} from 'react';
import {animate} from 'animejs';
import './LandingStory.css';
export default function LandingStory({t}:{t:(en:string,es:string)=>string}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=root.current;if(!element)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sections=Array.from(element.querySelectorAll<HTMLElement>('.story-chapter'));
  if(reduced){sections.forEach(s=>s.classList.add('story-visible'));return;}
  const motions=sections.map(s=>Array.from(s.querySelectorAll<SVGPathElement>('.story-ink')).map((p,i)=>{const length=p.getTotalLength();p.style.strokeDasharray=`${length}`;p.style.strokeDashoffset=`${length}`;return animate(p,{strokeDashoffset:0,duration:1500,delay:i*28,autoplay:false,ease:'inOutSine'});}));
  const child=animate(element.querySelector('.story-child')!,{translateX:[0,22],duration:1000,autoplay:false,ease:'inOutSine'});
  const rider=animate(element.querySelector('.story-rider')!,{translateX:[0,150],translateY:[0,-8],scale:[1,.78],duration:1000,autoplay:false,ease:'inOutSine'});
  const arms=element.querySelector('.story-embrace')!;
  const release=animate(arms,{translateY:[0,8],duration:1000,autoplay:false,ease:'inOutSine'});
  let frame=0,displayPosition:number|undefined;
  const mobile=window.matchMedia('(max-width:760px)').matches;
  let storyTop=element.getBoundingClientRect().top+window.scrollY;
  let travel=element.offsetHeight-(element.querySelector<HTMLElement>('.story-stage')?.offsetHeight??window.innerHeight);
  const update=()=>{frame=0;const progress=Math.max(0,Math.min(1,(window.scrollY-storyTop)/Math.max(1,travel)));const target=progress*3.65;displayPosition=displayPosition===undefined?target:displayPosition+(target-displayPosition)*.24;const position=displayPosition;const current=Math.min(3,Math.floor(position+.15));
   sections.forEach((section,i)=>{const local=Math.max(0,Math.min(1,position-i+.18));const enter=i===0?1:Math.max(0,Math.min(1,(position-i+.18)/.28));const leave=i===3?1:1-Math.max(0,Math.min(1,(position-i-.82)/.28));const fadeIn=i===0?1:Math.max(0,Math.min(1,(position-i+.15)/.15));const fadeOut=i===3?1:Math.max(0,Math.min(1,(i+.85-position)/.15));const opacity=fadeIn*fadeOut;const active=opacity>.001;
    section.classList.toggle('story-visible',active);section.style.opacity=String(opacity);section.style.visibility=active?'visible':'hidden';section.setAttribute('aria-hidden',String(i!==current));
    const direction=i%2===0?1:-1;const art=section.querySelector<HTMLElement>('.story-art')!;art.style.transform=mobile?'none':`translate(${direction*(1-enter)*34-direction*(1-leave)*34}px,${(1-enter)*12}px) scale(${.975+.025*enter})`;
    motions[i].forEach(m=>m.seek(Math.max(0,local)*6500));
   });
   child.seek(Math.max(0,Math.min(1,(position-.5)*2))*1000);release.seek(Math.max(0,Math.min(1,(position-.5)*2))*1000);rider.seek(Math.max(0,Math.min(1,(position-3)/.65))*1000);
   if(Math.abs(target-position)>.0005)frame=requestAnimationFrame(update);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};window.addEventListener('scroll',schedule,{passive:true});const resize=()=>{storyTop=element.getBoundingClientRect().top+window.scrollY;travel=element.offsetHeight-(element.querySelector<HTMLElement>('.story-stage')?.offsetHeight??window.innerHeight);schedule();};window.addEventListener('resize',resize);update();
  return()=>{window.removeEventListener('scroll',schedule);window.removeEventListener('resize',resize);cancelAnimationFrame(frame);motions.flat().forEach(m=>m.cancel());child.cancel();rider.cancel();release.cancel();};
 },[]);
 const chapters=[{title:t('Their next chapter. Your support, every step.','Su próximo capítulo. Tu apoyo en cada paso.'),copy:t('College may be new to your family. Keep your student’s interests and goals close, and find a place to begin together.','La universidad puede ser nueva para tu familia. Reúne los intereses y las metas de tu estudiante y encuentren juntos un lugar para empezar.'),label:t('A family embraces their child, who steps forward','Una familia abraza a su hijo, que da un paso adelante')},{title:t('Bring your questions. We’ll talk them through.','Trae tus preguntas. Las conversamos juntos.'),copy:t('Ask out loud, take your time, and ask again. Origen explains in everyday language—in English or Spanish.','Pregunta en voz alta, toma tu tiempo y vuelve a preguntar. Origen explica con palabras sencillas, en español o inglés.'),label:t('Concha, oreja, cuernito and braided pan dulce','Concha, oreja, cuernito y pan dulce trenzado')},{title:t('See how the pieces fit together.','Entiende cómo se unen las piezas.'),copy:t('Start with tuition and fees. Understand financial aid, the FAFSA, and what your family may still need to cover.','Empieza con la matrícula y las cuotas. Entiende la ayuda económica, la FAFSA y lo que tu familia todavía podría necesitar cubrir.'),label:t('An intricately woven petate','Un petate de tejido detallado')},{title:t('A little guidance for the road ahead.','Un poco de orientación para el camino.'),copy:t('Understand your next step with UC, Cal State, Common App, and community college applications. Find the official portals and ask about anything unfamiliar.','Conoce tu próximo paso con las solicitudes de UC, Cal State, Common App y colegios comunitarios. Encuentra los portales oficiales y pregunta sobre lo que no conoces.'),label:t('A child riding a burro toward a college doorway','Un niño montado en un burro hacia la puerta de una universidad')}];
 return <div className="landing-story" id="how" ref={root}><div className="story-stage"><div className="story-thread" aria-hidden="true"><svg viewBox="0 0 1000 800" preserveAspectRatio="none"><path d="M300 0 C300 64 72 60 72 204 C72 295 440 285 440 390 C440 480 80 495 80 600 C80 695 760 700 760 800"/><path className="thread-light" d="M300 0 C300 64 72 60 72 204 C72 295 440 285 440 390 C440 480 80 495 80 600 C80 695 760 700 760 800"/></svg></div><div className="story-caption">{t('ONE THREAD. A WORLD OF POSSIBILITY.','UN HILO. UN MUNDO DE POSIBILIDADES.')}</div>{chapters.map((c,index)=><section className={`story-chapter story-chapter-${index}`} key={index}><div className="story-art"><svg viewBox="0 0 560 480" role="img" aria-label={c.label} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><StoryArtwork scene={index}/></svg></div><div className="story-copy"><span className="landing-eyebrow">0{index+1} / {t('A PATH FORWARD','UN CAMINO ADELANTE')}</span><h2>{c.title}</h2><p>{c.copy}</p></div></section>)}</div></div>;
}
