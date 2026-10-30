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
  // A cream paper surface bridges the two layouts without touching live audio.
  const bridge=document.createElement('div');bridge.className='onboarding-binder-bridge';bridge.setAttribute('aria-hidden','true');
  bridge.innerHTML='<svg viewBox="0 0 80 64" fill="none"><path d="M40 15C28 6 13 7 6 11v43c10-5 24-4 34 3 10-7 24-8 34-3V11C67 7 52 6 40 15Zm0 0v42" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M15 23h15M15 31h15M50 23h15M50 31h15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  if(!reduced)document.body.appendChild(bridge);
  pending.current=onboardingTransition({signal:controller.signal,record,
   exit:async()=>{if(welcome)welcome.inert=true;if(!reduced){const cover=animate(bridge,{opacity:[0,1],duration:300,ease:'inOutSine'});animations.current.push(cover);if(welcome){const animation=animate(welcome,{opacity:[1,0],translateY:[0,-8],duration:280,ease:'inOutSine'});animations.current.push(animation);}await cover;}},
   open:openHome,
   home:async()=>{const deadline=performance.now()+4000;while(!controller.signal.aborted&&performance.now()<deadline){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const home=document.querySelector<HTMLElement>('.app-shell');if(home)return home;}return null;},
   enter:async home=>{if(!reduced){const animation=animate(home,{opacity:[0,1],duration:520,ease:'outCubic'});const uncover=animate(bridge,{opacity:[1,0],duration:440,ease:'inOutSine'});animations.current.push(animation,uncover);await Promise.all([animation,uncover]);}const heading=home.querySelector<HTMLElement>('main h1,main h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}},
   restore:()=>{bridge.remove();if(welcome)welcome.inert=false;animations.current.forEach(animation=>animation.revert());animations.current=[];},
  }).finally(()=>{pending.current=null;cancellation.current=null;});
  return pending.current;
 };
}
