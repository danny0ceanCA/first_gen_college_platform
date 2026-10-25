import CoordinatorConnectPage from './CoordinatorConnectPage';
import CoordinatorWorkspace from './CoordinatorWorkspace';
import CoordinatorRegistration from './CoordinatorRegistration';
import EligibilityGate from './EligibilityGate';
import AccountOpening from './AccountOpening';
import {InquiryReceipt} from './InstitutionInquiry';
import InstitutionInvite from './InstitutionInvite';
import AdminDashboard from './AdminDashboard';
import {apiFetch} from './api';
import {withRequestDeadline} from './requestDeadline.mjs';
import {adminAccessDecision} from './accountAccess.mjs';
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
 const [adminAccess,setAdminAccess]=useState<{subject:string;status:'pending'|'allowed'|'denied'|'error'}|null>(null);
 const [adminRetry,setAdminRetry]=useState(0);
 useEffect(()=>{const stop=()=>setClosed(true);window.addEventListener('origen-account-closed',stop);return()=>window.removeEventListener('origen-account-closed',stop);},[]);
 const {isLoading,isAuthenticated,error,user,getAccessTokenSilently,logout}=useAuth0();
 useEffect(()=>{setAPITokenProvider(isAuthenticated?()=>getAccessTokenSilently():undefined);return()=>setAPITokenProvider(undefined);},[isAuthenticated,getAccessTokenSilently]);
 useEffect(()=>{
  if(!isAuthenticated||!user?.sub){setAdminAccess(null);return;}
  const controller=new AbortController(),subject=user.sub;
  setAdminAccess({subject,status:'pending'});
  void withRequestDeadline(async signal=>{
   const token=await getAccessTokenSilently();signal.throwIfAborted();
   const response=await apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'}),signal});
   const status=await adminAccessDecision(response);signal.throwIfAborted();return status;
  },{signal:controller.signal}).then(status=>{if(!controller.signal.aborted)setAdminAccess({subject,status});}).catch(()=>{if(!controller.signal.aborted)setAdminAccess({subject,status:'error'});});
  return()=>controller.abort();
 },[isAuthenticated,user?.sub,getAccessTokenSilently,adminRetry]);
 const [workspace,setWorkspace]=useState<{subject:string;memberships:{id:string;name:string;role:string}[];hasPersonalAccount:boolean;coordinatorAccountsEnabled?:boolean;coordinatorApplicationStatus?:string|null}|null>(null);
 const [workspaceError,setWorkspaceError]=useState(false),[workspaceRetry,setWorkspaceRetry]=useState(0);
 useEffect(()=>{if(!isAuthenticated||!user?.sub){setWorkspace(null);return;}const controller=new AbortController(),subject=user.sub;setWorkspaceError(false);void withRequestDeadline(async signal=>{const token=await getAccessTokenSilently();signal.throwIfAborted();const response=await apiFetch('/api/institutions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:'access'}),signal});if(!response.ok)throw new Error();const data=await response.json();signal.throwIfAborted();if(!Array.isArray(data.memberships)||typeof data.hasPersonalAccount!=='boolean')throw new Error();return data;},{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setWorkspace({...data,subject});}).catch(()=>{if(!controller.signal.aborted)setWorkspaceError(true);});return()=>controller.abort();},[isAuthenticated,user?.sub,getAccessTokenSilently,workspaceRetry]);
 const approvalRoute=['#institutions','#coordinators'].includes(route);
 const inside=route==='#app'||route==='#welcome'||route==='#mobile-design'||route==='#personal';
 useEffect(()=>{const update=()=>setRoute(window.location.hash||publicRoute());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>{if(route==='#about'||route==='#privacy'){window.scrollTo(0,0);return;}const section=document.getElementById(route.slice(1));if(section)section.scrollIntoView({block:'start'});else window.scrollTo(0,0);});return()=>cancelAnimationFrame(frame);},[route]);
 if(closed)return <main><p role="status">Your Origen account is closed. Tu cuenta de Origen está cerrada.</p><a href="/">Return to Origen / Volver a Origen</a></main>;
 if(isLoading&&(inside||route==='#admin'||route==='#institutions'||route==='#coordinators'||route.startsWith('#invite/')||route.startsWith('#institution-invite/')||window.location.search.includes('code=')))return <AccountOpening/>;
 if(error&&window.location.search.includes('error='))return <div><p role="alert">Sign-in could not be completed. Please try again.</p><a href="/">Return to Origen</a></div>;
 if((inside||approvalRoute)&&isAuthenticated&&(!adminAccess||adminAccess.subject!==user?.sub||adminAccess.status==='pending'))return <AccountOpening/>;
 if(inside&&isAuthenticated&&adminAccess?.status==='error')return <main className="application-panel"><p role={adminAccess?.status==='error'?'alert':'status'}>{adminAccess?.status==='error'?'Could not open your account. Please try again. / No se pudo abrir tu cuenta. Intenta de nuevo.':'Opening your account… / Abriendo tu cuenta…'}</p>{adminAccess?.status==='error'&&<button className="button primary" onClick={()=>setAdminRetry(x=>x+1)}>Try again / Intentar de nuevo</button>}<button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></main>;
 if(approvalRoute&&isAuthenticated&&adminAccess?.status==='allowed')return <AdminDashboard initialView="approvals" initialApprovalTab={route==='#coordinators'?'coordinators':'organizations'}/>;
 if(inside&&isAuthenticated&&adminAccess?.status==='allowed')return <AdminDashboard/>;
 if(route==='#admin'&&isAuthenticated)return <AdminDashboard/>;
 if(inside&&route!=='#personal'&&isAuthenticated&&adminAccess?.status==='denied'){
  if((!workspace||workspace.subject!==user?.sub)&&!workspaceError)return <AccountOpening/>;
  if(!workspace||workspace.subject!==user?.sub)return <main className="institution-shell"><p role={workspaceError?'alert':'status'}>{workspaceError?'Could not open your workspace. / No se pudo abrir tu espacio.':'Opening your workspace… / Abriendo tu espacio…'}</p>{workspaceError&&<button className="button primary" onClick={()=>setWorkspaceRetry(x=>x+1)}>Try again / Intentar de nuevo</button>}<button className="button outline" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></main>;
  if(workspace.coordinatorAccountsEnabled&&workspace.coordinatorApplicationStatus&&(workspace.coordinatorApplicationStatus!=='approved'||!workspace.memberships.length))return <CoordinatorRegistration key={user?.sub}/>;
  if(workspace.memberships.length){if(!workspace.hasPersonalAccount&&!workspace.coordinatorAccountsEnabled)return <InstitutionPortal key={user?.sub}/>;return <main className="institution-shell"><h1>Choose your workspace / Elige tu espacio</h1><p>Choose where you want to work today. / Elige dónde quieres trabajar hoy.</p><div className="institution-actions"><a className="button primary" href="#institutions">Institutions / Instituciones</a>{workspace.coordinatorAccountsEnabled&&<a className="button outline" href="#coordinators">Coordinators / Coordinadores</a>}<a className="button outline" href="#personal">Personal / Personal</a><button className="text-button" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>Log out / Cerrar sesión</button></div></main>;}
 }
 if(/^#institution-invite\/[A-Za-z0-9_-]{43}$/.test(route))return <InstitutionInvite key={route} token={route.slice(20)}/>;
 if(/^#inquiry\/[A-Za-z0-9_-]{43}$/.test(route))return <InquiryReceipt key={route} receipt={route.slice(9)}/>;
 if(route==='#directory')return <InstitutionDirectory/>;
 if(route==='#coordinators')return <CoordinatorWorkspace key={user?.sub||'anonymous'}/>;
 if(route==='#coordinator-register')return <CoordinatorRegistration key={user?.sub||'anonymous'}/>;
 if(/^#connect\/[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(route))return <CoordinatorConnectPage key={user?.sub||'anonymous'} code={route.slice(9)}/>;
 if(route==='#institutions')return <InstitutionPortal key={isAuthenticated?user?.sub:'anonymous'}/>;
 if(route==='#about'||route==='#privacy')return <LandingInformation page={route==='#about'?'about':'privacy'}/>;
 if(/^#institution\/[a-z0-9-]{1,100}$/.test(route))return <InstitutionPublic key={route} slug={route.slice(13)}/>;
 if(/^#invite\/[A-Za-z0-9_-]{43}$/.test(route))return <EligibilityGate key={user?.sub}><InviteAccept token={route.slice(8)}/></EligibilityGate>;
 return inside&&isAuthenticated?<EligibilityGate key={user?.sub}><App/></EligibilityGate>:<Landing/>;
}
