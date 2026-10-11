import {Auth0Context,useAuth0} from '@auth0/auth0-react';
import {useLayoutEffect,useState,type ReactNode} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';

// Gate children until their account owns the privacy lifecycle, including native onboarding.
export default function PrivateSession({children}:{children:ReactNode}){
 const auth=useAuth0(),subject=auth.isAuthenticated?auth.user?.sub:undefined;
 const [ready,setReady]=useState<string>(),[ended,setEnded]=useState(false);
 useLayoutEffect(()=>browserPrivacy.subscribe(event=>{if(event.type==='end'){setReady(undefined);setEnded(true);}}),[]);
 useLayoutEffect(()=>{
  if(auth.isLoading)return;
  if(!subject){browserPrivacy.stop('signed_out');setReady(undefined);setEnded(false);return;}
  let fresh=false;try{fresh=!!sessionStorage.getItem('origen-login-fresh');sessionStorage.removeItem('origen-login-fresh');}catch{}
  const allowed=browserPrivacy.start(subject,{fresh});setReady(allowed?subject:undefined);setEnded(!allowed);
 },[auth.isLoading,subject]);
 const logout:typeof auth.logout=async options=>{browserPrivacy.stop('logout');await auth.logout(options);};
 if(!auth.isLoading&&subject&&(ended||ready!==subject))return <main className="application-panel"><p role="status">{ended?'Your session ended. Unsaved conversation text was cleared. / Tu sesión terminó. Se borró el texto de conversación sin guardar.':'Opening your account… / Abriendo tu cuenta…'}</p>{ended&&<><button className="button primary" onClick={()=>void auth.loginWithRedirect({appState:{returnTo:'#app'},authorizationParams:{prompt:'login'}})}>Sign in again / Iniciar sesión de nuevo</button><button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></>}</main>;
 return <Auth0Context.Provider value={{...auth,logout}}>{children}</Auth0Context.Provider>;
}
