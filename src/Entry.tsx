import InstitutionPortal,{InstitutionPublic} from './InstitutionPortal';
import {setAPITokenProvider} from './api';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useState} from 'react';
import App from './App';
import Landing from './Landing';
import MobileDesign from './MobileDesign';
import InviteAccept from './InviteAccept';
export default function Entry(){
 const [route,setRoute]=useState(window.location.hash);
 const [closed,setClosed]=useState(false);
 useEffect(()=>{const stop=()=>setClosed(true);window.addEventListener('origen-account-closed',stop);return()=>window.removeEventListener('origen-account-closed',stop);},[]);
 const {isLoading,isAuthenticated,error,user,getAccessTokenSilently}=useAuth0();
 useEffect(()=>{setAPITokenProvider(isAuthenticated?()=>getAccessTokenSilently():undefined);return()=>setAPITokenProvider(undefined);},[isAuthenticated,getAccessTokenSilently]);
 const inside=route==='#app'||route==='#welcome';
 useEffect(()=>{const update=()=>setRoute(window.location.hash);window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{const section=document.getElementById(route.slice(1));if(section)section.scrollIntoView({block:'start'});else window.scrollTo(0,0);});return()=>cancelAnimationFrame(frame);},[route]);
 if(closed)return <main><p role="status">Your Origen account is closed. Tu cuenta de Origen está cerrada.</p><a href="/">Return to Origen / Volver a Origen</a></main>;
 if(isLoading&&window.location.search.includes('code='))return <p role="status">Completing sign-in…</p>;
 if(error&&window.location.search.includes('error='))return <div><p role="alert">Sign-in could not be completed. Please try again.</p><a href="/">Return to Origen</a></div>;
 if(route==='#institutions')return <InstitutionPortal key={isAuthenticated?user?.sub:'anonymous'}/>;
 if(/^#institution\/[a-z0-9-]{1,100}$/.test(route))return <InstitutionPublic key={route} slug={route.slice(13)}/>;
 if(/^#invite\/[A-Za-z0-9_-]{43}$/.test(route))return <InviteAccept token={route.slice(8)}/>;
 return route==='#mobile-design'?<MobileDesign/>:inside?<App welcomePreview={route==='#welcome'} key={isAuthenticated?user?.sub:'preview'}/>:<Landing enter={()=>{window.location.hash='app';}}/>;
}
