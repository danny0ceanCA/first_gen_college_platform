import {animate} from 'animejs';
import {useEffect,useRef} from 'react';

// Only animate the page surfaces; the shared voice player remains mounted.
export function useOnboardingTransition(){
 const pending=useRef<Promise<void>|null>(null);
 const animations=useRef<ReturnType<typeof animate>[]>([]);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;animations.current.forEach(animation=>animation.revert());animations.current=[];},[]);
 return (openHome:()=>void)=>{
  if(pending.current)return pending.current;
  const version=generation.current;
  const task=async()=>{
   const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   const welcome=document.querySelector<HTMLElement>('.welcome-conversation,.welcome-panel');
   if(welcome&&!reduced){
    welcome.inert=true;
    const exit=animate(welcome,{opacity:[1,0],translateY:[0,-12],duration:240,ease:'inOutSine'});
    animations.current.push(exit);
    await exit;
   }
   if(generation.current!==version)return;
   openHome();
   // Wait for React to commit home, then reveal it without touching the audio bar.
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   if(generation.current!==version)return;
   const home=document.querySelector<HTMLElement>('.app-shell');
   if(home&&!reduced){
    const enter=animate(home,{opacity:[0,1],duration:420,ease:'outCubic'});
    animations.current.push(enter);
    await enter;
   }
   if(generation.current!==version)return;
   const heading=home?.querySelector<HTMLElement>('main h1,main h2');
   if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
   animations.current.forEach(animation=>animation.revert());animations.current=[];
  };
  pending.current=task().finally(()=>{pending.current=null;});
  return pending.current;
 };
}
