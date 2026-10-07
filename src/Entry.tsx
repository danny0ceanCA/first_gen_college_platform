import {InquiryReceipt} from './InstitutionInquiry';
import InstitutionInvite from './InstitutionInvite';
import AdminDashboard from './AdminDashboard';
import {apiFetch} from './api';
import InstitutionPortal,{InstitutionPublic,InstitutionDirectory} from './InstitutionPortal';
import {setAPITokenProvider} from './api';
import {useAuth0} from '@auth0/auth0-react';
import {useEffect,useState} from 'react';
import App from './App';
import Landing from './Landing';
import LandingInformation from './LandingInformation';
import InviteAccept from './InviteAccept';
export default function Entry(){
 const publicRoute=()=>window.location.pathname==='/institutions'?'#directory':/^\/institutions\/[a-z0-9-]{1,100}$/.test(window.location.pathname)?'#institution/'+window.location.pathname.slice(14):'';
 const [route,setRoute]=useState(window.location.hash||publicRoute());
 useEffect(()=>{const token=sessionStorage.getItem('origen.pending-institution-invite');if(!window.location.hash&&token&&/^[A-Za-z0-9_-]{43}$/.test(token)){sessionStorage.removeItem('origen.pending-institution-invite');window.location.hash=`#institution-invite/${token}`;}},[]);
 const [closed,setClosed]=useState(false);
 const [adminAccess,setAdminAccess]=useState<{subject:string;allowed:boolean}|null>(null);
 useEffect(()=>{const stop=()=>setClosed(true);window.addEventListener('origen-account-closed',stop);return()=>window.removeEventListener('origen-account-closed',stop);},[]);
 const {isLoading,isAuthenticated,error,user,getAccessTokenSilently,logout}=useAuth0();
 useEffect(()=>{setAPITokenProvider(isAuthenticated?()=>getAccessTokenSilently():undefined);return()=>setAPITokenProvider(undefined);},[isAuthenticated,getAccessTokenSilently]);
 useEffect(()=>{if(!isAuthenticated)return;const id=sessionStorage.getItem('origen-login-event');if(!id)return;void apiFetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',id})}).then(r=>{if(r.ok&&sessionStorage.getItem('origen-login-event')===id)sessionStorage.removeItem('origen-login-event');}).catch(()=>{});},[isAuthenticated,getAccessTokenSilently]);
 useEffect(()=>{if(!isAuthenticated||!user?.sub){setAdminAccess(null);return;}let current=true;const subject=user.sub;void getAccessTokenSilently().then(token=>apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'})})).then(response=>{if(current)setAdminAccess({subject,allowed:response.ok});}).catch(()=>{if(current)setAdminAccess({subject,allowed:false});});return()=>{current=false;};},[isAuthenticated,user?.sub,getAccessTokenSilently]);
 const [workspace,setWorkspace]=useState<{subject:string;memberships:{id:string;name:string;role:string}[];hasPersonalAccount:boolean}|null>(null);
 const [workspaceError,setWorkspaceError]=useState(false),[workspaceRetry,setWorkspaceRetry]=useState(0);
 useEffect(()=>{if(!isAuthenticated||!user?.sub){setWorkspace(null);return;}let current=true;const subject=user.sub;setWorkspaceError(false);void getAccessTokenSilently().then(token=>apiFetch('/api/institutions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'})})).then(async response=>{if(!response.ok)throw new Error();const data=await response.json();if(current)setWorkspace({...data,subject});}).catch(()=>{if(current)setWorkspaceError(true);});return()=>{current=false;};},[isAuthenticated,user?.sub,getAccessTokenSilently,workspaceRetry]);
 const inside=route==='#app'||route==='#welcome'||route==='#mobile-design'||route==='#personal';
 useEffect(()=>{const update=()=>setRoute(window.location.hash||publicRoute());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(route==='#about'||route==='#privacy'){window.scrollTo(0,0);return;}const section=document.getElementById(route.slice(1));if(section)section.scrollIntoView({block:'start'});else window.scrollTo(0,0);});return()=>cancelAnimationFrame(frame);},[route]);
 if(closed)return <main><p role="status">Your Origen account is closed. Tu cuenta de Origen está cerrada.</p><a href="/">Return to Origen / Volver a Origen</a></main>;
 if(isLoading&&(inside||route==='#admin'||route==='#institutions'||route.startsWith('#invite/')||route.startsWith('#institution-invite/')||window.location.search.includes('code=')))return <main className="application-panel"><p role="status">Loading Origen… / Cargando Origen…</p></main>;
 if(error&&window.location.search.includes('error='))return <div><p role="alert">Sign-in could not be completed. Please try again.</p><a href="/">Return to Origen</a></div>;
 if(inside&&isAuthenticated&&adminAccess?.subject!==user?.sub)return <main className="application-panel"><p role="status">Opening your account… / Abriendo tu cuenta…</p></main>;
 if(inside&&isAuthenticated&&adminAccess?.allowed)return <AdminDashboard/>;
 if(route==='#admin'&&isAuthenticated)return <AdminDashboard/>;
 if(inside&&route!=='#personal'&&isAuthenticated&&!adminAccess?.allowed){
  if(!workspace||workspace.subject!==user?.sub)return <main className="institution-shell"><p role={workspaceError?'alert':'status'}>{workspaceError?'Could not open your workspace. / No se pudo abrir tu espacio.':'Opening your workspace… / Abriendo tu espacio…'}</p>{workspaceError&&<button className="button primary" onClick={()=>setWorkspaceRetry(x=>x+1)}>Try again / Intentar de nuevo</button>}<button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></main>;
  if(workspace.memberships.length){if(!workspace.hasPersonalAccount)return <InstitutionPortal key={user?.sub}/>;return <main className="institution-shell"><h1>Choose your workspace / Elige tu espacio</h1><p>You have personal and institutional access. / Tienes acceso personal e institucional.</p><div className="institution-actions"><a className="button primary" href="#institutions">Institutions / Instituciones</a><a className="button outline" href="#personal">Personal / Personal</a><button className="text-button" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></div></main>;}
 }
 if(/^#institution-invite\/[A-Za-z0-9_-]{43}$/.test(route))return <InstitutionInvite key={route} token={route.slice(20)}/>;
 if(/^#inquiry\/[A-Za-z0-9_-]{43}$/.test(route))return <InquiryReceipt key={route} receipt={route.slice(9)}/>;
 if(route==='#directory')return <InstitutionDirectory/>;
 if(route==='#institutions')return <InstitutionPortal key={isAuthenticated?user?.sub:'anonymous'}/>;
 if(route==='#about'||route==='#privacy')return <LandingInformation page={route==='#about'?'about':'privacy'}/>;
 if(/^#institution\/[a-z0-9-]{1,100}$/.test(route))return <InstitutionPublic key={route} slug={route.slice(13)}/>;
 if(/^#invite\/[A-Za-z0-9_-]{43}$/.test(route))return <InviteAccept token={route.slice(8)}/>;
 return inside&&isAuthenticated?<App key={user?.sub}/>:<Landing/>;
}
