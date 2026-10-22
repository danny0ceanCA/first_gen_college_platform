import {endRecoverySession} from './conversationRecovery';
import {Auth0Context,useAuth0} from '@auth0/auth0-react';
import {useLayoutEffect,useState,type ReactNode} from 'react';
import {browserPrivacy} from './browserPrivacy.mjs';
import AccountOpening from './AccountOpening';

// Gate children until their account owns the privacy lifecycle, including native onboarding.
export default function PrivateSession({children}:{children:ReactNode}){
 const auth=useAuth0(),subject=auth.isAuthenticated?auth.user?.sub:undefined;
 const [logoutError,setLogoutError]=useState(false);
 const [ready,setReady]=useState<string>(),[ended,setEnded]=useState(false);
 useLayoutEffect(()=>browserPrivacy.subscribe(event=>{if(event.type==='end'&&!['eligibility_changed','permission_unavailable'].includes(event.reason||'')){setReady(undefined);setEnded(true);}}),[]);
 useLayoutEffect(()=>{
  if(auth.isLoading)return;
  if(!subject){browserPrivacy.stop('signed_out');setReady(undefined);setEnded(false);return;}
  let fresh=false;try{fresh=!!sessionStorage.getItem('origen-login-fresh');sessionStorage.removeItem('origen-login-fresh');}catch{}
  const allowed=browserPrivacy.start(subject,{fresh});setReady(allowed?subject:undefined);setEnded(!allowed);
 },[auth.isLoading,subject]);
 const logout:typeof auth.logout=async options=>{setLogoutError(false);try{await endRecoverySession(()=>auth.getAccessTokenSilently());}catch{setLogoutError(true);return;}browserPrivacy.stop('logout');await auth.logout(options);};
 if(!auth.isLoading&&subject&&!ended&&ready!==subject)return <AccountOpening/>;
 if(!auth.isLoading&&subject&&ended)return <main className="application-panel"><p role="status">Your session ended. Unsaved conversation text was cleared. / Tu sesión terminó. Se borró el texto de conversación sin guardar.</p><button className="button primary" onClick={()=>void auth.loginWithRedirect({appState:{returnTo:'#app'},authorizationParams:{prompt:'login'}})}>Sign in again / Iniciar sesión de nuevo</button><button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></main>;
 return <Auth0Context.Provider value={{...auth,logout}}>{logoutError&&<p role="alert">Could not clear temporary recovery copies. Check your connection and try signing out again. / No se pudieron borrar las copias temporales. Revisa tu conexión e intenta cerrar sesión de nuevo.</p>}{children}</Auth0Context.Provider>;
}
