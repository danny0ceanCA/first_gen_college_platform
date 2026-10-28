import {motionDuration,motionPreference} from './motion';
import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {animate,createTimeline} from 'animejs';
import {ArrowRight,BookOpen,X} from 'lucide-react';
import './PersonalBinder.css';
import {useNavigationState,navigateWorkspace} from './workspaceNavigation';

export default function PersonalBinder({name,t,children,onOpen,initiallyOpen=false,discussing=[],openRequest=0,onFollowReady,navigationKey}:{navigationKey?:string;openRequest?:number;onFollowReady?:()=>void;discussing?:{id:string;title:string}[];initiallyOpen?:boolean;name:string;t:(en:string,es:string)=>string;children:ReactNode;onOpen?:()=>void}){
 const pagesId=useId();
 const [savedOpen,setSavedOpen]=useNavigationState((navigationKey||pagesId)+'.open',initiallyOpen,(v):v is boolean=>typeof v==='boolean');
 const remembered=useRef({key:navigationKey,open:savedOpen});
 const [phase,setPhase]=useState<'closed'|'opening'|'open'|'closing'>(savedOpen?'open':'closed');
 const opened=phase==='open',moving=phase==='opening'||phase==='closing';
 const stage=useRef<HTMLDivElement>(null),cover=useRef<HTMLButtonElement>(null),pages=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null);
 const startHeight=useRef(0),pending=useRef(false);
 useLayoutEffect(()=>{if(remembered.current.key!==navigationKey||remembered.current.open!==savedOpen){remembered.current={key:navigationKey,open:savedOpen};pending.current=false;setPhase(savedOpen?'open':'closed');}},[navigationKey,savedOpen]);
 const automatic=useRef(false),followed=useRef(0),followReady=useRef(onFollowReady);followReady.current=onFollowReady;
 useLayoutEffect(()=>{
  if(!openRequest||followed.current===openRequest)return;
  automatic.current=true;remembered.current.open=true;setSavedOpen(true);
  if(phase==='open'){followed.current=openRequest;followReady.current?.();return;}
  if(phase!=='closed')return;
  pending.current=true;startHeight.current=stage.current?.getBoundingClientRect().height||0;setPhase('opening');
 },[openRequest,phase]);
 useLayoutEffect(()=>{
  if(!moving||!stage.current||!cover.current||!pages.current)return;
  const root=stage.current,front=cover.current,inside=pages.current;
  const opening=phase==='opening',destination=opening?inside:front;
  const preference=window.matchMedia(motionPreference);
  const duration=motionDuration('binder');
   const openingTime=(time:number)=>duration*time/720,closingTime=(time:number)=>duration*time/980;
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
  if(opening){inside.style.opacity='0';inside.style.transform='translateX(12px)';}
  else{front.style.transform='rotateY(-105deg)';inside.style.height=`${startHeight.current}px`;}
  // Keep the cover opaque as it turns: the paper is revealed by the hinge,
  // never through the cover. One timeline owns both surfaces and their height.
  const motion=createTimeline({autoplay:false,onComplete:()=>{
   if(disposed)return;
   if(!opening){finish();return;}
   // Saved content can finish loading during the opening animation.
   const actual=destinationHeight();
   if(Math.abs(actual-root.getBoundingClientRect().height)>1){
    animations.push(animate(root,{height:actual,duration:motionDuration('control'),ease:'outCubic',onComplete:finish}));
   }else finish();
  }});
  animations.push(motion);
  if(opening){
   motion.add(front,{rotateY:[0,-105],duration:openingTime(620),ease:'inOutCubic'},0)
    .add(inside,{translateX:[12,0],opacity:[0,1],duration:openingTime(460),ease:'outCubic'},openingTime(120))
    .add(root,{height:[startHeight.current,targetHeight],duration:duration,ease:'inOutCubic'},0);
  }else{
   const top=root.getBoundingClientRect().top;
   if(top<16)window.scrollTo({top:Math.max(0,window.scrollY+top-24),behavior:'smooth'});
   motion.add(inside,{translateX:[0,6],duration:closingTime(500),ease:'inOutSine'},0)
    .add(inside,{opacity:[1,0],duration:closingTime(180),ease:'inCubic'},closingTime(460))
    .add(root,{height:[startHeight.current,targetHeight],duration:closingTime(340),ease:'inOutCubic'},closingTime(640))
    .add(front,{rotateY:[-105,0],duration:closingTime(640),ease:'inOutCubic'},closingTime(120));
  }
  motion.play();
  const reduce=()=>{if(preference.matches){animations.forEach(animation=>animation.cancel());finish();}};
  preference.addEventListener('change',reduce);
  return()=>{disposed=true;animations.forEach(animation=>animation.revert());root.style.height='';if(frontStyle===null)front.removeAttribute('style');else front.setAttribute('style',frontStyle);if(pageStyle===null)inside.removeAttribute('style');else inside.setAttribute('style',pageStyle);preference.removeEventListener('change',reduce);};
 },[phase,moving]);
 useLayoutEffect(()=>{
  if(phase==='open'&&!automatic.current)close.current?.focus({preventScroll:true});
  else if(phase==='closed'&&startHeight.current&&!automatic.current)cover.current?.focus({preventScroll:true});
 },[phase]);
 function changeBinder(opening:boolean){
  if(pending.current||moving)return;
  navigateWorkspace(()=>{
   automatic.current=false;remembered.current.open=opening;setSavedOpen(opening);
   pending.current=true;startHeight.current=stage.current?.getBoundingClientRect().height||0;
   if(opening)onOpen?.();setPhase(opening?'opening':'closing');
  });
 }
 return <div ref={stage} className={`personal-binder binder-${phase}${moving?' is-transitioning':''}`} aria-busy={moving}>
  <button ref={cover} type="button" className="binder-cover" onClick={()=>changeBinder(true)} disabled={moving} hidden={opened} aria-hidden={phase==='closing'||undefined} aria-expanded={opened} aria-controls={pagesId}>
   <span className="binder-cover-spine" aria-hidden="true"/>
   <span className="binder-cover-content"><span className="binder-brand" aria-hidden="true">○ origen.</span><span className="binder-cover-kicker">{t('YOUR COLLEGE JOURNEY','TU CAMINO A LA UNIVERSIDAD')}</span><strong>{t('My binder','Mi carpeta')}</strong><span className="binder-owner-label"><span>{t('BELONGS TO','PERTENECE A')}</span><span className="binder-cover-owner">{name}</span></span><span className="binder-cover-description">{t('Your conversations, notes, and questions—in one place.','Tus conversaciones, notas y preguntas, en un solo lugar.')}</span><span className="binder-open-label"><BookOpen size={19} aria-hidden="true"/>{t('Open my binder','Abrir mi carpeta')}<ArrowRight size={19} aria-hidden="true"/></span></span>
   {discussing.length>0&&<span className="binder-cover-discussion" role="status"><span>{t('Discussing now','Conversando ahora')}</span>{discussing.map(topic=><strong key={topic.id} data-topic={topic.id} className="is-discussing">{topic.title}</strong>)}</span>}
   <span className="binder-cover-tabs" aria-hidden="true"><i/><i/><i/><i/></span>
  </button>
  <div ref={pages} id={pagesId} className="binder-pages" hidden={phase==='closed'} inert={!opened}>
   <div className="binder-topline"><span><BookOpen size={17} aria-hidden="true"/>{t('My binder','Mi carpeta')}</span><button ref={close} type="button" onClick={()=>changeBinder(false)} disabled={moving}><X size={16} aria-hidden="true"/>{t('Close binder','Cerrar carpeta')}</button></div>
   <div className="binder-rings" aria-hidden="true"><i/><i/><i/></div>
   {children}
  </div>
 </div>;
}
