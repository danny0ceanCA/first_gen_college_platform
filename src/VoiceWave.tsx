import {useEffect,useRef} from 'react';
import {animate} from 'animejs';
import './VoiceWave.css';

export default function VoiceWave({speaking}:{speaking:boolean}){
 const svg=useRef<SVGSVGElement>(null);
 useEffect(()=>{
  const paths=svg.current?.querySelectorAll('path');
  if(!paths)return;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const phase={value:0};
  function draw(moving:boolean){
   paths!.forEach((path,index)=>{
    const points=Array.from({length:57},(_,x)=>{
     const envelope=Math.sin(x/56*Math.PI);
     const y=12+(moving?Math.sin(x/56*Math.PI*4-phase.value+index*1.4)*envelope*(index?5:9):0);
     return `${x===0?'M':'L'}${x},${y.toFixed(2)}`;
    });
    path.setAttribute('d',points.join(' '));
   });
  }
  const animation=animate(phase,{value:[0,Math.PI*2],duration:1200,loop:true,ease:'linear',autoplay:false,onUpdate:()=>draw(true)});
  function sync(){
   if(speaking&&!motion.matches&&!document.hidden)animation.resume();
   else{animation.pause();draw(false);}
  }
  sync();motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  return()=>{animation.revert();motion.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[speaking]);
 return <svg ref={svg} className={`voice-radio-wave${speaking?' is-speaking':''}`} viewBox="0 0 56 24" aria-hidden="true"><path d="M0,12 L56,12"/><path d="M0,12 L56,12"/></svg>;
}
