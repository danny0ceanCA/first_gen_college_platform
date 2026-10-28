import {motionDuration} from './motion';
import {useCallback,useEffect,useLayoutEffect,useState,type ReactNode} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import AccountOpening from './AccountOpening';
import {ArrivalReadiness} from './arrivalReadiness';

export const WORKSPACE_ARRIVAL_TIMEOUT_MS=15000;

// Children stay mounted while covered, so access checks and profile requests
// run during the introduction. Internal loading gates do not restart it.
export function WorkspaceArrival({active,children}:{active:boolean;children:ReactNode}){
 const [stalled,setStalled]=useState(false);
 const [revealed,setRevealed]=useState(false),[departed,setDeparted]=useState(false);
 const [waiting,setWaiting]=useState<Set<symbol>>(()=>new Set());
 const updateReadiness=useCallback((id:symbol,pending:boolean)=>setWaiting(current=>{
  if(current.has(id)===pending)return current;
  const next=new Set(current);if(pending)next.add(id);else next.delete(id);return next;
 }),[]);
 useEffect(()=>{
  if(!active){setStalled(false);setRevealed(false);setDeparted(false);return;}
  if(revealed)return;
  const timer=window.setTimeout(()=>setStalled(true),WORKSPACE_ARRIVAL_TIMEOUT_MS);
  return()=>window.clearTimeout(timer);
 },[active,revealed]);
 // Give replacement gates and lazy modules two frames to register. This is a
 // readiness handoff, not a minimum viewing time for the welcome animation.
 useLayoutEffect(()=>{
  if(!active||revealed||waiting.size)return;
  let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setRevealed(true));});
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
 },[active,revealed,waiting]);
 useEffect(()=>{
  if(!revealed)return;
  const timer=window.setTimeout(()=>setDeparted(true),motionDuration('arrival'));
  return()=>window.clearTimeout(timer);
 },[revealed]);
 const holding=active&&!revealed;
 return <ArrivalReadiness.Provider value={updateReadiness}>
  <div className={`workspace-arrival-content${holding?' arrival-covered':active?' arrival-visible':''}`} aria-hidden={holding||undefined} inert={holding}>{children}</div>
  {active&&!departed&&<div className={`workspace-arrival-overlay${revealed?' is-leaving':''}`} aria-hidden={revealed||undefined} inert={revealed}><AccountOpening gate={false} stalled={stalled}/></div>}
 </ArrivalReadiness.Provider>;
}

export default function LoginArrival({children}:{children:ReactNode}){
 const {isLoading,isAuthenticated}=useAuth0();
 const [route,setRoute]=useState(()=>window.location.hash);
 useEffect(()=>{const update=()=>setRoute(window.location.hash);window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 const workspaceRoute=/^#(?:app|personal|welcome|mobile-design|admin|institutions|coordinators|coordinator-register)$/.test(route)||/^#(?:invite|institution-invite)\//.test(route)||new URLSearchParams(window.location.search).has('code');
 return <WorkspaceArrival active={workspaceRoute&&(isLoading||isAuthenticated)}>{children}</WorkspaceArrival>;
}
