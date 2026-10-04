import {setAPITokenProvider} from './api';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useState} from 'react';
import App from './App';
import Landing from './Landing';
import MobileDesign from './MobileDesign';
import InviteAccept from './InviteAccept';
export default function Entry(){
 const [route,setRoute]=useState(window.location.hash);
 const {isLoading,isAuthenticated,error,user,getAccessTokenSilently}=useAuth0();
 useEffect(()=>{setAPITokenProvider(isAuthenticated?()=>getAccessTokenSilently():undefined);return()=>setAPITokenProvider(undefined);},[isAuthenticated,getAccessTokenSilently]);
 const inside=route==='#app'||route==='#welcome';
 useEffect(()=>{const update=()=>{setRoute(window.location.hash);window.scrollTo(0,0);};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 if(isLoading&&window.location.search.includes('code='))return <p role="status">Completing sign-in…</p>;
 if(error&&window.location.search.includes('error='))return <div><p role="alert">Sign-in could not be completed. Please try again.</p><a href="/">Return to Origen</a></div>;
 if(/^#invite\/[A-Za-z0-9_-]{43}$/.test(route))return <InviteAccept token={route.slice(8)}/>;
 return route==='#mobile-design'?<MobileDesign/>:inside?<App welcomePreview={route==='#welcome'} key={isAuthenticated?user?.sub:'preview'}/>:<Landing enter={()=>{window.location.hash='app';}}/>;
}
