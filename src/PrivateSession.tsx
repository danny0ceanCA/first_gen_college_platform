import {endRecoverySession} from './conversationRecovery';
import {Auth0Context,useAuth0} from '@auth0/auth0-react';
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';
import AccountOpening from './AccountOpening';
import LogoutTransition,{type LogoutPhase} from './LogoutTransition';
import {clearLogoutReturn,createLogoutTransition,readLogoutReturn,LOGOUT_COVER_MS,LOGOUT_REVEAL_MS} from './logoutHandoff.mjs';

const tabStorage=()=>{try{return window.sessionStorage;}catch{return undefined;}};
const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Gate children until their account owns the privacy lifecycle, including native onboarding.
export default function PrivateSession({children}:{children:ReactNode}){
 const auth=useAuth0(),subject=auth.isAuthenticated?auth.user?.sub:undefined;
 const [logoutPhase,setLogoutPhase]=useState<LogoutPhase>(()=>readLogoutReturn(tabStorage())?'returning':'idle');
 const latestAuth=useRef(auth);latestAuth.current=auth;
 const logoutOptions=useRef<Parameters<typeof auth.logout>[0]>(undefined);
 const flow=useRef<ReturnType<typeof createLogoutTransition>|null>(null);
 const flowSubject=useRef(subject);
 if(!flow.current||subject&&subject!==flowSubject.current&&logoutPhase==='idle'){
  flowSubject.current=subject;
  flow.current=createLogoutTransition({
  cleanup:()=>endRecoverySession(()=>latestAuth.current.getAccessTokenSilently()),
  stop:()=>browserPrivacy.stop('logout'),
  redirect:(options:Parameters<typeof auth.logout>[0])=>latestAuth.current.logout(options),
  cover:()=>new Promise<void>(resolve=>window.setTimeout(resolve,reducedMotion()?0:LOGOUT_COVER_MS)),
  onPhase:(phase:LogoutPhase)=>setLogoutPhase(phase),storage:tabStorage(),
  });
 }
 const [ready,setReady]=useState<string>(),[ended,setEnded]=useState(false);
 useLayoutEffect(()=>browserPrivacy.subscribe(event=>{if(event.type==='end'&&!['eligibility_changed','permission_unavailable'].includes(event.reason||'')){setReady(undefined);setEnded(true);}}),[]);
 useLayoutEffect(()=>{
  if(auth.isLoading)return;
  if(!subject){browserPrivacy.stop('signed_out');setReady(undefined);setEnded(false);return;}
  let fresh=false;try{fresh=!!sessionStorage.getItem('origen-login-fresh');sessionStorage.removeItem('origen-login-fresh');}catch{}
  const allowed=browserPrivacy.start(subject,{fresh});setReady(allowed?subject:undefined);setEnded(!allowed);
 },[auth.isLoading,subject]);
 useEffect(()=>{
  if(logoutPhase!=='returning'||auth.isLoading)return;
  clearLogoutReturn(tabStorage());
  // Auth0 must confirm sign-out before the landing page is revealed.
  setLogoutPhase(auth.isAuthenticated?'error':'revealing');
 },[logoutPhase,auth.isLoading,auth.isAuthenticated]);
 useEffect(()=>{
  if(logoutPhase!=='revealing')return;
  const timer=window.setTimeout(()=>setLogoutPhase('idle'),reducedMotion()?0:LOGOUT_REVEAL_MS);
  return()=>window.clearTimeout(timer);
 },[logoutPhase]);
 const logout:typeof auth.logout=async options=>{logoutOptions.current=options;await flow.current!.start(options);};
 let content=children;
 if((logoutPhase==='leaving'||logoutPhase==='error')&&!flow.current.canReturn)content=null;
 else if(!auth.isLoading&&subject&&!ended&&ready!==subject)content=logoutPhase==='idle'?<AccountOpening/>:null;
 else if(!auth.isLoading&&subject&&ended)content=logoutPhase==='idle'?<main className="application-panel"><p role="status">Your session ended. Unsaved conversation text was cleared. / Tu sesión terminó. Se borró el texto de conversación sin guardar.</p><button className="button primary" onClick={()=>void auth.loginWithRedirect({appState:{returnTo:'#app'},authorizationParams:{prompt:'login'}})}>Sign in again / Iniciar sesión de nuevo</button><button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></main>:null;
 return <Auth0Context.Provider value={{...auth,logout}}>{content}{logoutPhase!=='idle'&&<LogoutTransition phase={logoutPhase} canReturn={flow.current.canReturn&&browserPrivacy.valid()} onRetry={()=>void logout(logoutOptions.current||{logoutParams:{returnTo:window.location.origin}})} onReturn={()=>setLogoutPhase('idle')}/>}</Auth0Context.Provider>;
}
