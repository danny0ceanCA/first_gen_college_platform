import {useEffect,useRef,useState,type ReactNode} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import AccountOpening from './AccountOpening';

export const WORKSPACE_ARRIVAL_MS=6000;

// Children stay mounted while covered, so access checks and profile requests
// run during the introduction. Internal loading gates do not restart it.
export function WorkspaceArrival({active,children}:{active:boolean;children:ReactNode}){
 const started=useRef<number|null>(null);
 const [elapsed,setElapsed]=useState(false);
 useEffect(()=>{
  if(!active){started.current=null;setElapsed(false);return;}
  started.current??=performance.now();
  const timer=window.setTimeout(()=>setElapsed(true),Math.max(0,WORKSPACE_ARRIVAL_MS-(performance.now()-started.current)));
  return()=>window.clearTimeout(timer);
 },[active]);
 const holding=active&&!elapsed;
 return <><div className={`workspace-arrival-content${active&&!holding?' arrival-visible':''}`} hidden={holding} inert={holding}>{children}</div>{holding&&<AccountOpening/>}</>;
}

export default function LoginArrival({children}:{children:ReactNode}){
 const {isLoading,isAuthenticated}=useAuth0();
 const [route,setRoute]=useState(()=>window.location.hash);
 useEffect(()=>{const update=()=>setRoute(window.location.hash);window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 const workspaceRoute=/^#(?:app|personal|welcome|mobile-design|admin|institutions)$/.test(route)||/^#(?:invite|institution-invite)\//.test(route)||new URLSearchParams(window.location.search).has('code');
 return <WorkspaceArrival active={workspaceRoute&&(isLoading||isAuthenticated)}>{children}</WorkspaceArrival>;
}
