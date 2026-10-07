import StoryFlora from './StoryFlora';
import StoryArtwork from './StoryArtwork';
import {storyAccents} from './storyAccents';
import {useLayoutEffect,useRef} from 'react';
import {animate} from 'animejs';
import './LandingStory.css';
export default function LandingStory({t}:{t:(en:string,es:string)=>string}){
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sections=Array.from(element.querySelectorAll<HTMLElement>('.story-chapter'));
  if(reduced){sections.forEach(s=>s.classList.add('story-visible'));return;}
  // Split compound paths: dash offsets otherwise reveal every disconnected subpath at once.
  const originals=Array.from(element.querySelectorAll<SVGPathElement>('.story-ink'));
  const fragments:SVGPathElement[]=[];
  const savedStyles=originals.map(path=>path.getAttribute('style'));
  originals.forEach(original=>{
   const parts=original.getAttribute('d')?.match(/M[^M]*/g)??[];
   parts.forEach(d=>{
    const path=original.cloneNode() as SVGPathElement;
    path.setAttribute('d',d);path.setAttribute('fill','none');path.classList.add('story-stroke');
    original.after(path);fragments.push(path);
   });
   original.style.stroke='none';
  });
  const nibs=sections.map(()=>document.createElementNS('http://www.w3.org/2000/svg','path'));
  nibs.forEach(p=>{p.setAttribute('class','story-nib');p.setAttribute('fill','none');});
  const strokeData=sections.map(section=>{
   // Keep authored layer order, but draw each independent contour with the same pen.
   const paths=fragments.filter(path=>section.contains(path));
   let cursor=0;
   const steps=paths.map((path,index)=>{
    const length=path.getTotalLength(),start=path.getPointAtLength(0);
    const previous=paths[index-1];
    const from=previous?previous.getPointAtLength(previous.getTotalLength()):start;
    const travel=index?Math.min(32,Math.hypot(start.x-from.x,start.y-from.y)):0;
    const begin=cursor;cursor+=travel;const ink=cursor;cursor+=length;
    path.style.strokeDasharray=`${length} ${length}`;path.style.strokeDashoffset=String(length);
    return {path,length,start,from,begin,ink,end:cursor,offset:length};
   });
   return {steps,total:cursor};
  });
  const thread=element.querySelector<SVGPathElement>('.thread-drawn')!;
  const threadTip=element.querySelector<SVGPathElement>('.thread-light')!;
  const bridge=element.querySelector<SVGPathElement>('.thread-bridge')!;
  const threadLength=thread.getTotalLength();thread.style.strokeDasharray=String(threadLength);threadTip.style.strokeDasharray=`24 ${threadLength}`;

  const floraPaths=Array.from(element.querySelectorAll<SVGPathElement>('.floral-stroke'));
  floraPaths.forEach(path=>{const length=path.getTotalLength();path.style.strokeDasharray=String(length);path.style.strokeDashoffset=String(length);});
  const flora=animate(floraPaths,{strokeDashoffset:0,duration:1400,delay:(_,i)=>(i??0)*22,autoplay:false,ease:'inOutSine'});
  const child=animate(element.querySelector('.story-child')!,{translateX:[0,22],duration:1000,autoplay:false,ease:'inOutSine'});
  const rider=animate(element.querySelector('.story-rider')!,{translateX:[-45,-5],translateY:[14,14],duration:1000,autoplay:false,ease:'inOutSine'});
  const arms=element.querySelector('.story-embrace')!;
  const release=animate(arms,{translateY:[0,8],duration:1000,autoplay:false,ease:'inOutSine'});
  let frame=0,lastFrame=0,displayPosition:number|undefined;
  const drawnPositions=sections.map(()=>-1);
  let mobile=window.matchMedia('(max-width:760px)').matches;
  let viewportWidth=window.innerWidth;
  let storyTop=element.getBoundingClientRect().top+window.scrollY;
  let travel=element.offsetHeight-(element.querySelector<HTMLElement>('.story-stage')?.offsetHeight??window.innerHeight);
  const update=(time=performance.now())=>{frame=0;const elapsed=lastFrame?Math.min(64,time-lastFrame):16.67;lastFrame=time;const progress=Math.max(0,Math.min(1,(window.scrollY-storyTop)/Math.max(1,travel)));const target=progress*3.95;displayPosition=displayPosition===undefined?target:displayPosition+(target-displayPosition)*(1-Math.exp(-elapsed/(mobile?90:60)));const position=displayPosition;flora.seek(Math.min(1,(position+.15)/3.5)*flora.duration);const current=Math.min(3,Math.floor(position+.15));
   sections.forEach((section,i)=>{const local=Math.max(0,Math.min(1,position-i));const enter=i===0?1:Math.max(0,Math.min(1,(position-i+.18)/.28));const leave=i===3?1:1-Math.max(0,Math.min(1,(position-i-.82)/.28));const fadeIn=i===0?1:Math.max(0,Math.min(1,(position-i+.20)/.18));const fadeOut=i===3?1:Math.max(0,Math.min(1,(i+.98-position)/.26));const opacity=fadeIn*fadeOut;const active=opacity>.001;
    section.classList.toggle('story-visible',active);section.style.opacity=String(opacity);section.style.visibility=active?'visible':'hidden';section.setAttribute('aria-hidden',String(i!==current));
    const direction=i%2===0?1:-1;const art=section.querySelector<HTMLElement>('.story-art')!;art.style.transform=mobile?'none':`translate(${direction*(1-enter)*34-direction*(1-leave)*34}px,${(1-enter)*12}px) scale(${.975+.025*enter})`;
    // The thread arrives first, then lends its single pen to the illustration.
    const inkTime=Math.max(0,Math.min(1,(local-.10)/.56));
    if(inkTime!==drawnPositions[i]){
     const {steps,total}=strokeData[i],distance=inkTime*total;
     steps.forEach(step=>{
      const offset=step.length-Math.max(0,Math.min(step.length,distance-step.ink));
      if(offset!==step.offset){step.path.style.strokeDashoffset=String(offset);step.offset=offset;}
     });
     drawnPositions[i]=inkTime;
     const stroke=steps.find(s=>distance>=s.begin&&distance<s.end);
     const nib=nibs[i];nib.style.opacity=stroke&&distance>=stroke.ink&&inkTime>0?'1':'0';
     if(stroke){
      const at=Math.max(0,distance-stroke.ink);
      const a=stroke.path.getPointAtLength(Math.max(0,at-5)),b=stroke.path.getPointAtLength(at);
      nib.setAttribute('d',`M${a.x} ${a.y} L${b.x} ${b.y}`);
      if(stroke.path.nextSibling!==nib)stroke.path.after(nib);
     }
    }
   });
   const chapter=Math.min(3,Math.floor(position));
   const local=position-chapter;
   // Pause forward travel while drawing; resume along the curve between chapters.
   const anchor=(chapter+.25)/4;
   const advance=local<.10?local/.10:local>.70?1+(local-.70)/.30:1;
   const previous=chapter/4;
   const threadProgress=Math.min(1,advance<=1?previous+(anchor-previous)*advance:anchor+((chapter+1)/4-anchor)*(advance-1));
   thread.style.strokeDashoffset=String(threadLength*(1-threadProgress));
   threadTip.style.strokeDashoffset=String(24-threadLength*threadProgress);
   threadTip.style.opacity=local>=.10&&local<=.70?'0':'1';
   const entry=strokeData[chapter].steps[0]?.path;
   const matrix=entry?.getScreenCTM(),threadMatrix=thread.getScreenCTM();
   if(entry&&matrix&&threadMatrix){
    const start=entry.getPointAtLength(0).matrixTransform(matrix).matrixTransform(threadMatrix.inverse());
    const point=thread.getPointAtLength(threadLength*anchor);
    bridge.setAttribute('d',`M${point.x} ${point.y} C${point.x} ${point.y+35} ${start.x} ${start.y-35} ${start.x} ${start.y}`);
    bridge.style.opacity=local>=.10&&local<.78?'0.55':'0';
   }
   child.seek(Math.max(0,Math.min(1,(position-.68)/.26))*1000);release.seek(Math.max(0,Math.min(1,(position-.68)/.26))*1000);rider.seek(Math.max(0,Math.min(1,(position-3.68)/.27))*1000);
   if(Math.abs(target-position)>.0005)frame=requestAnimationFrame(update);
  };
  const schedule=()=>{if(!frame){lastFrame=0;frame=requestAnimationFrame(update);}};window.addEventListener('scroll',schedule,{passive:true});const resize=()=>{if(mobile&&window.innerWidth===viewportWidth)return;viewportWidth=window.innerWidth;mobile=window.matchMedia('(max-width:760px)').matches;storyTop=element.getBoundingClientRect().top+window.scrollY;travel=element.offsetHeight-(element.querySelector<HTMLElement>('.story-stage')?.offsetHeight??window.innerHeight);schedule();};window.addEventListener('resize',resize);update();
  return()=>{window.removeEventListener('scroll',schedule);window.removeEventListener('resize',resize);cancelAnimationFrame(frame);fragments.forEach(p=>p.remove());originals.forEach((p,i)=>{const style=savedStyles[i];if(style===null)p.removeAttribute('style');else p.setAttribute('style',style);});bridge.style.opacity='0';nibs.forEach(p=>p.remove());child.cancel();rider.cancel();release.cancel();flora.cancel();floraPaths.forEach(path=>{path.style.strokeDasharray='';path.style.strokeDashoffset='';});};
 },[]);
 const chapters=[{title:t('Your path. With the support you choose.','Tu camino. Con el apoyo que elijas.'),copy:t('Explore what interests you and where you want to go. Start on your own or bring your family into the conversation.','Explora lo que te interesa y adónde quieres llegar. Empieza por tu cuenta o invita a tu familia a la conversación.'),label:t('A family embraces their child, who steps forward','Una familia abraza a su hijo, que da un paso adelante')},{title:t('Bring your questions. We’ll talk them through.','Trae tus preguntas. Las conversamos juntos.'),copy:t('Ask out loud, take your time, and ask again. Origen explains in everyday language—in English or Spanish.','Pregunta en voz alta, toma tu tiempo y vuelve a preguntar. Origen explica con palabras sencillas, en español o inglés.'),label:t('Concha, oreja, cuernito and braided pan dulce','Concha, oreja, cuernito y pan dulce trenzado')},{title:t('See how the pieces fit together.','Entiende cómo se unen las piezas.'),copy:t('Understand tuition, financial aid, and the FAFSA. Explore what you may need to pay as a first-time or transfer student.','Entiende la matrícula, la ayuda económica y la FAFSA. Explora lo que podrías pagar al empezar la universidad o transferirte.'),label:t('An intricately woven petate','Un petate de tejido detallado')},{title:t('Your next step toward university.','Tu próximo paso hacia la universidad.'),copy:t('Starting at community college or preparing to transfer? Explore UC, Cal State, and other application paths, find official resources, and ask what comes next.','¿Empiezas en un colegio comunitario o te preparas para transferirte? Explora las solicitudes de UC, Cal State y otras opciones, consulta recursos oficiales y pregunta cuál es tu próximo paso.'),label:t('A child riding a burro toward a college doorway','Un niño montado en un burro hacia la puerta de una universidad')}];
 return <div className="landing-story" id="story" ref={root}><div className="story-stage"><StoryFlora/><div className="story-thread" aria-hidden="true"><svg viewBox="0 0 1000 800" preserveAspectRatio="none"><path d="M300 0 C300 64 72 60 72 204 C72 295 440 285 440 390 C440 480 80 495 80 600 C80 695 760 700 760 800"/><path className="thread-drawn" d="M300 0 C300 64 72 60 72 204 C72 295 440 285 440 390 C440 480 80 495 80 600 C80 695 760 700 760 800"/><path className="thread-light" d="M300 0 C300 64 72 60 72 204 C72 295 440 285 440 390 C440 480 80 495 80 600 C80 695 760 700 760 800"/><path className="thread-bridge"/></svg></div><div className="story-caption">{t('ONE THREAD. A WORLD OF POSSIBILITY.','UN HILO. UN MUNDO DE POSIBILIDADES.')}</div>{chapters.map((c,index)=><section className={`story-chapter story-chapter-${index}`} key={index}><div className="story-art"><svg viewBox="0 0 560 480" role="img" aria-label={c.label} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path className="story-ink story-entry" d={storyAccents[index].entry}/><StoryArtwork scene={index}/>{storyAccents[index].details.map((d,j)=><path key={j} className="story-ink ink-detail" d={d}/>)}</svg></div><div className="story-copy"><span className="landing-eyebrow">0{index+1} / {t('A PATH FORWARD','UN CAMINO ADELANTE')}</span><h2>{c.title}</h2><p>{c.copy}</p></div></section>)}</div></div>;
}
