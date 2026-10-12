import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {animate,type JSAnimation} from 'animejs';
import {ArrowRight,BookOpen,X} from 'lucide-react';
import './PersonalBinder.css';

export default function PersonalBinder({name,t,children}:{name:string;t:(en:string,es:string)=>string;children:ReactNode}){
 const [phase,setPhase]=useState<'closed'|'opening'|'open'|'closing'>('closed');
 const opened=phase==='open',moving=phase==='opening'||phase==='closing';
 const stage=useRef<HTMLDivElement>(null),cover=useRef<HTMLButtonElement>(null),pages=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
 const startHeight=useRef(0),pending=useRef(false);
 useLayoutEffect(()=>{
  if(!moving||!stage.current||!cover.current||!pages.current)return;
  const root=stage.current,front=cover.current,inside=pages.current;
  const opening=phase==='opening',destination=opening?inside:front;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations:JSAnimation[]=[];
  let disposed=false;
  root.style.height=`${startHeight.current}px`;
  const finish=()=>{
   if(disposed)return;
   pending.current=false;
   setPhase(opening?'open':'closed');
  };
  if(preference.matches){finish();return()=>{root.style.height='';};}
  const destinationHeight=()=>destination.getBoundingClientRect().height;
  // Lift the cover first, then unfold the page at its natural text size.
  // On closing, gather the page before returning the cover over it.
  // Only the outer clipping frame changes height; the contents never stretch.
  animations.push(animate(front,{rotateY:opening?[0,-65]:[-65,0],opacity:opening?[1,0]:[0,1],delay:opening?0:560,duration:420,ease:'inOutCubic'}));
  animations.push(animate(inside,{translateX:opening?[8,0]:[0,8],opacity:opening?[0,1]:[1,0],delay:opening?100:620,duration:opening?380:360,ease:'inOutCubic',onComplete:()=>{if(!opening)finish();}}));
  animations.push(animate(root,{height:[startHeight.current,destinationHeight()],delay:opening?280:0,duration:640,ease:'inOutCubic',onComplete:()=>{
   if(disposed)return;
   if(!opening)return;
   // Saved content can finish loading during the opening animation.
   const actual=destinationHeight();
   if(Math.abs(actual-root.getBoundingClientRect().height)>1){
    animations.push(animate(root,{height:actual,duration:180,ease:'outCubic',onComplete:finish}));
   }else finish();
  }}));
  const reduce=()=>{if(preference.matches){animations.forEach(animation=>animation.cancel());finish();}};
  preference.addEventListener('change',reduce);
  return()=>{disposed=true;animations.forEach(animation=>animation.revert());root.style.height='';preference.removeEventListener('change',reduce);};
 },[phase,moving]);
 useLayoutEffect(()=>{
  if(phase==='open')close.current?.focus({preventScroll:true});
  else if(phase==='closed'&&startHeight.current)cover.current?.focus({preventScroll:true});
 },[phase]);
 function changeBinder(opening:boolean){
  if(pending.current||moving)return;
  pending.current=true;
  startHeight.current=stage.current?.getBoundingClientRect().height||0;
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
