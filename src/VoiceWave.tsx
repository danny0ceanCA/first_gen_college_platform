import {useEffect,useRef} from 'react';
import {animate,type JSAnimation} from 'animejs';
import './VoiceWave.css';

export default function VoiceWave({speaking}:{speaking:boolean}){
 const svg=useRef<SVGSVGElement>(null);
 const signal=useRef({phase:0,gain:0});
 const loop=useRef<JSAnimation|null>(null);
 const ramp=useRef<JSAnimation|null>(null);
 const speakingNow=useRef(speaking);speakingNow.current=speaking;
 const update=useRef<()=>void>(()=>{});
 useEffect(()=>{
  const paths=svg.current?.querySelectorAll('path');
  if(!paths)return;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const draw=()=>paths.forEach((path,index)=>{
   const points=Array.from({length:57},(_,x)=>{
    const envelope=Math.sin(x/56*Math.PI);
    const y=12+Math.sin(x/56*Math.PI*4-signal.current.phase+index*1.4)*envelope*(index?5:9)*signal.current.gain;
    return `${x===0?'M':'L'}${x},${y.toFixed(2)}`;
   });
   path.setAttribute('d',points.join(' '));
  });
  loop.current=animate(signal.current,{phase:[0,Math.PI*2],duration:1200,loop:true,ease:'linear',autoplay:false,onUpdate:draw});
  const sync=()=>{
   ramp.current?.cancel();
   if(motion.matches||document.hidden){loop.current?.pause();signal.current.gain=0;draw();return;}
   loop.current?.resume();
   ramp.current=animate(signal.current,{gain:speakingNow.current?1:0,duration:speakingNow.current?220:420,ease:'outQuad',onUpdate:draw,onComplete:()=>{if(!speakingNow.current)loop.current?.pause();}});
  };
  update.current=sync;sync();
  motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  return()=>{ramp.current?.cancel();loop.current?.cancel();motion.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
 },[]);
 useEffect(()=>{update.current();},[speaking]);
 return <svg ref={svg} className={`voice-radio-wave${speaking?' is-speaking':''}`} viewBox="0 0 56 24" aria-hidden="true"><path d="M0,12 L56,12"/><path d="M0,12 L56,12"/></svg>;
}
