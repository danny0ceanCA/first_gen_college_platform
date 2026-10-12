import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {animate,createTimeline} from 'animejs';
import {ArrowRight,BookOpen,X} from 'lucide-react';
import './PersonalBinder.css';

export default function PersonalBinder({name,t,children,onOpen}:{name:string;t:(en:string,es:string)=>string;children:ReactNode;onOpen?:()=>void}){
 const [phase,setPhase]=useState<'closed'|'opening'|'open'|'closing'>('closed');
 const opened=phase==='open',moving=phase==='opening'||phase==='closing';
 const stage=useRef<HTMLDivElement>(null),cover=useRef<HTMLButtonElement>(null),pages=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
 const startHeight=useRef(0),pending=useRef(false);
 useLayoutEffect(()=>{
  if(!moving||!stage.current||!cover.current||!pages.current)return;
  const root=stage.current,front=cover.current,inside=pages.current;
  const opening=phase==='opening',destination=opening?inside:front;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations:(ReturnType<typeof animate>|ReturnType<typeof createTimeline>)[]=[];
  let disposed=false;
  root.style.height=`${startHeight.current}px`;
  const finish=()=>{
   if(disposed)return;
   pending.current=false;
   setPhase(opening?'open':'closed');
  };
  if(preference.matches){finish();return()=>{root.style.height='';};}
  const destinationHeight=()=>destination.getBoundingClientRect().height;
  const targetHeight=destinationHeight();
  const frontStyle=front.getAttribute('style'),pageStyle=inside.getAttribute('style');
  // A delayed Anime.js track does not apply its initial pose until it starts.
  // Set the incoming surface before paint so it cannot flash over the outgoing one.
  if(opening){inside.style.opacity='0';inside.style.transform='translateX(8px)';}
  else{front.style.opacity='0';front.style.transform='rotateY(-65deg)';}
  // Fade the writing before gathering the paper, then settle the cover over it.
  // One timeline owns the handoff so neither surface disappears prematurely.
  const motion=createTimeline({autoplay:false,onComplete:()=>{
   if(disposed)return;
   if(!opening){finish();return;}
   // Saved content can finish loading during the opening animation.
   const actual=destinationHeight();
   if(Math.abs(actual-root.getBoundingClientRect().height)>1){
    animations.push(animate(root,{height:actual,duration:180,ease:'outCubic',onComplete:finish}));
   }else finish();
  }});
  animations.push(motion);
  if(opening){
   motion.add(front,{rotateY:[0,-65],opacity:[1,0],duration:420,ease:'inOutCubic'},0)
    .add(inside,{translateX:[8,0],opacity:[0,1],duration:380,ease:'inOutCubic'},100)
    .add(root,{height:[startHeight.current,targetHeight],duration:640,ease:'inOutCubic'},280);
  }else{
   const top=root.getBoundingClientRect().top;
   if(top<16)window.scrollTo({top:Math.max(0,window.scrollY+top-24),behavior:'smooth'});
   motion.add(inside,{translateX:[0,8],opacity:[1,0],duration:300,ease:'inOutSine'},0)
    .add(root,{height:[startHeight.current,targetHeight],duration:720,ease:'inOutCubic'},80)
    .add(front,{rotateY:[-65,0],opacity:[0,1],duration:560,ease:'inOutCubic'},400);
  }
  motion.play();
  const reduce=()=>{if(preference.matches){animations.forEach(animation=>animation.cancel());finish();}};
  preference.addEventListener('change',reduce);
  return()=>{disposed=true;animations.forEach(animation=>animation.revert());root.style.height='';if(frontStyle===null)front.removeAttribute('style');else front.setAttribute('style',frontStyle);if(pageStyle===null)inside.removeAttribute('style');else inside.setAttribute('style',pageStyle);preference.removeEventListener('change',reduce);};
 },[phase,moving]);
 useLayoutEffect(()=>{
  if(phase==='open')close.current?.focus({preventScroll:true});
  else if(phase==='closed'&&startHeight.current)cover.current?.focus({preventScroll:true});
 },[phase]);
 function changeBinder(opening:boolean){
  if(pending.current||moving)return;
  pending.current=true;
  startHeight.current=stage.current?.getBoundingClientRect().height||0;
  if(opening)onOpen?.();
  setPhase(opening?'opening':'closing');
 }
 return <div ref={stage} className={`personal-binder binder-${phase}${moving?' is-transitioning':''}`}>
  <button ref={cover} type="button" className="binder-cover" onClick={()=>changeBinder(true)} disabled={moving} hidden={opened} aria-hidden={phase==='closing'||undefined} aria-expanded={opened} aria-controls="binder-pages">
   <span className="binder-cover-spine" aria-hidden="true"/>
   <span className="binder-cover-content"><span className="binder-brand" aria-hidden="true">○ origen.</span><span className="binder-cover-kicker">{t('YOUR COLLEGE JOURNEY','TU CAMINO A LA UNIVERSIDAD')}</span><strong>{t('My binder','Mi carpeta')}</strong><span className="binder-cover-owner">{name}</span><span className="binder-cover-description">{t('Your conversations, notes, and questions—in one place.','Tus conversaciones, notas y preguntas, en un solo lugar.')}</span><span className="binder-open-label"><BookOpen size={19} aria-hidden="true"/>{t('Open my binder','Abrir mi carpeta')}<ArrowRight size={19} aria-hidden="true"/></span></span>
   <span className="binder-cover-tabs" aria-hidden="true"><i/><i/><i/></span>
  </button>
  <div ref={pages} id="binder-pages" className="binder-pages" hidden={phase==='closed'} inert={!opened}>
   <div className="binder-topline"><span><BookOpen size={17} aria-hidden="true"/>{t('My binder','Mi carpeta')}</span><button ref={close} type="button" onClick={()=>changeBinder(false)} disabled={moving}><X size={16} aria-hidden="true"/>{t('Close binder','Cerrar carpeta')}</button></div>
   <div className="binder-rings" aria-hidden="true"><i/><i/><i/></div>
   {children}
  </div>
 </div>;
}
