import './AccountOpening.css';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {animate} from 'animejs';
import {useArrivalPending} from './arrivalReadiness';

// Shared by each login gate so checking access and loading a profile look like
// one continuous handoff. WorkspaceArrival reveals as soon as content is ready.
export default function AccountOpening({gate=true,stalled=false}:{gate?:boolean;stalled?:boolean}){
 useArrivalPending(gate);
 const [late,setLate]=useState(false);
 useEffect(()=>{if(!gate)return;const timer=setTimeout(()=>setLate(true),15000);return()=>clearTimeout(timer);},[gate]);
 const slow=stalled||late;
 const spanish=localStorage.getItem('origen.language')==='es';
 const hand=useRef<SVGGElement>(null);
 useLayoutEffect(()=>{
  if(!hand.current)return;
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let wave:ReturnType<typeof animate>|undefined;
  const update=()=>{
   wave?.revert();wave=undefined;
   if(!slow&&!preference.matches&&hand.current)wave=animate(hand.current,{rotate:[-14,18],duration:650,ease:'inOutSine',alternate:true,loop:true});
  };
  update();preference.addEventListener('change',update);
  return()=>{wave?.revert();preference.removeEventListener('change',update);};
 },[slow]);
 return <main className="account-opening" aria-busy={!slow} aria-label={spanish?'Abriendo Origen':'Opening Origen'}>
  <div className="account-opening-content">
   <span className="account-opening-brand" aria-hidden="true"><span/>origen.</span>
   <svg className="account-opening-friend" viewBox="0 0 120 112" aria-hidden="true" focusable="false">
    <ellipse className="account-opening-shadow" cx="60" cy="104" rx="24" ry="3"/>
    <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
     <circle cx="60" cy="25" r="12"/>
     <path d="M56 29 Q60 33 64 29 M60 38 V73 M60 47 L45 57 L40 70 M60 73 L47 98 M60 73 L73 98 M60 47 L78 39"/>
     <g ref={hand} className="account-opening-wave"><path d="M78 39 L83 21 M83 21 L79 17 M83 21 L84 15 M83 21 L89 17"/></g>
    </g>
    <g fill="currentColor"><circle cx="56" cy="23" r="1.2"/><circle cx="64" cy="23" r="1.2"/></g>
   </svg>
   <p role={slow?'alert':'status'}>{slow?(spanish?'Está tardando más de lo esperado. Revisa tu conexión e inténtalo de nuevo.':'This is taking longer than expected. Check your connection and try again.'):(spanish?'Cargando tu espacio…':'Loading workspace…')}</p>
   {slow?<div className="account-opening-actions"><button className="button primary" onClick={()=>window.location.reload()}>{spanish?'Intentar de nuevo':'Try again'}</button><a href="/">{spanish?'Volver al inicio':'Back to home'}</a></div>:<span className="account-opening-progress" aria-hidden="true"><i/></span>}
  </div>
 </main>;
}
