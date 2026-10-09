import {animate} from 'animejs';
import {useEffect,useRef} from 'react';
import {onboardingTransition} from './onboardingTransition.mjs';

// Only animate the page surfaces; the shared voice player remains mounted.
export function useOnboardingTransition(){
 const pending=useRef<Promise<void>|null>(null);
 const animations=useRef<ReturnType<typeof animate>[]>([]);
 const cancellation=useRef<AbortController|null>(null);
 useEffect(()=>()=>{cancellation.current?.abort();animations.current.forEach(animation=>animation.revert());animations.current=[];},[]);
 return (openHome:()=>void,record?:(name:string,metadata?:Record<string,unknown>)=>void)=>{
  if(pending.current)return pending.current;
  const controller=new AbortController();cancellation.current=controller;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const welcome=document.querySelector<HTMLElement>('.welcome-conversation,.welcome-panel');
  pending.current=onboardingTransition({signal:controller.signal,record,
   exit:async()=>{if(welcome&&!reduced){welcome.inert=true;const animation=animate(welcome,{opacity:[1,0],translateY:[0,-12],duration:240,ease:'inOutSine'});animations.current.push(animation);await animation;}},
   open:openHome,
   home:async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return document.querySelector<HTMLElement>('.app-shell');},
   enter:async home=>{if(!reduced){const animation=animate(home,{opacity:[0,1],duration:420,ease:'outCubic'});animations.current.push(animation);await animation;}const heading=home.querySelector<HTMLElement>('main h1,main h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}},
   restore:()=>{if(welcome)welcome.inert=false;animations.current.forEach(animation=>animation.revert());animations.current=[];},
  }).finally(()=>{pending.current=null;cancellation.current=null;});
  return pending.current;
 };
}
