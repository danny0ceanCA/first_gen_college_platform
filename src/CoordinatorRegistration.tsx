import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import './InstitutionPortal.css';
import './CoordinatorWorkspace.css';

type Application={id:string;displayName:string;email:string;organizationName:string;organizationWebsite:string;jobRole:string;status:'pending'|'approved'|'declined';reviewNote:string;createdAt:string};
type Translate=(en:string,es:string)=>string;
export function applicationError(error:string,t:Translate){
 const messages:Record<string,string>={
  coordinator_sharing_unavailable:t('Coordinator registration is not open yet. Please check back with the Origen team.','El registro de coordinadores aún no está abierto. Consulta con el equipo de Origen.'),
  verified_email_required:t('Verify your sign-in email, then select Refresh status.','Verifica tu correo de inicio de sesión y selecciona Actualizar estado.'),
  invitation_email_required:t('Sign in again so we can verify your email.','Inicia sesión de nuevo para verificar tu correo.'),
  application_membership_required:t('The applicant must first accept an invitation to the selected organization. Use Invitations and team in its owner workspace.','La persona debe aceptar primero una invitación a la organización seleccionada. Usa Invitaciones y equipo en el espacio del propietario.'),
  application_changed:t('This application has changed. Refresh the list before reviewing it.','Esta solicitud ha cambiado. Actualiza la lista antes de revisarla.'),
  independent_review_required:t('An independent Origen reviewer must review this application. You cannot approve yourself or your own organization.','Un revisor independiente de Origen debe revisar esta solicitud. No puedes aprobarte ni aprobar tu propia organización.'),
  organization_verification_required:t('Choose an organization whose affiliation and coordinator pilot have been approved.','Elige una organización con afiliación y piloto de coordinadores aprobados.'),
 };
 return messages[error]||t('We couldn’t complete this request. Please try again.','No pudimos completar la solicitud. Intenta de nuevo.');
}
export default function CoordinatorRegistration(){
 const {isAuthenticated,isLoading,user,getAccessTokenSilently,loginWithRedirect,logout}=useAuth0();
 const [es,setEs]=useState(localStorage.getItem('origen.language')==='es');
 const t:Translate=(en,sp)=>es?sp:en;
 const [application,setApplication]=useState<Application|null>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [displayName,setName]=useState(''),[organizationName,setOrganization]=useState(''),[organizationWebsite,setWebsite]=useState(''),[jobRole,setRole]=useState('');
 const version=useRef(0);
 const request=useCallback(async(input:unknown)=>{
  const token=await getAccessTokenSilently();
  const response=await apiFetch('/api/coordinator-access',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
 },[getAccessTokenSilently]);
 useEffect(()=>{
  const current=++version.current;setApplication(undefined);setError('');
  if(isAuthenticated){setBusy(true);void request({action:'application-status'}).then(data=>{if(current===version.current)setApplication(data.application);}).catch(e=>{if(current===version.current)setError(e.message);}).finally(()=>{if(current===version.current)setBusy(false);});}
  return()=>{version.current++;};
 },[isAuthenticated,user?.sub,retry,request]);
 async function submit(withdraw=false){
  const current=version.current;setBusy(true);setError('');
  try{const data=await request(withdraw?{action:'withdraw-application'}:{action:'submit-application',displayName,organizationName,organizationWebsite,jobRole});if(current===version.current)setApplication(data.application);}
  catch(e){if(current===version.current)setError(e instanceof Error?e.message:'unavailable');}
  finally{if(current===version.current)setBusy(false);}
 }
 return <main className="institution-shell coordinator-workspace coordinator-registration">
  <nav className="institution-actions" aria-label={t('Navigation','Navegación')}><a href="#">{t('← Origen','← Origen')}</a><a href="#coordinators">{t('Coordinator workspace','Espacio del coordinador')}</a><button className="text-button" onClick={()=>{setEs(!es);localStorage.setItem('origen.language',es?'en':'es');}}>{es?'English':'Español'}</button>{isAuthenticated&&<button className="text-button" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>{t('Log out','Cerrar sesión')}</button>}</nav>
  <div className="eyebrow">{t('FOR COORDINATORS','PARA COORDINADORES')}</div>
  <h1>{t('Help students take their next step.','Ayuda a los estudiantes a dar su siguiente paso.')}</h1>
  <p>{t('Apply to guide students through Origen. We’ll review your role and organization before enabling coordinator access.','Solicita acceso para orientar a estudiantes con Origen. Revisaremos tu función y organización antes de activar tu acceso.')}</p>
  <p>{t('Students choose what to share. Family conversations remain private.','Los estudiantes eligen qué compartir. Las conversaciones familiares permanecen privadas.')}</p>
  {isLoading?<p role="status">{t('Loading…','Cargando…')}</p>:!isAuthenticated?<section className="coordinator-card"><h2>{t('Start with your own account','Empieza con tu propia cuenta')}</h2><p>{t('Use the email you want associated with your coordinator work.','Usa el correo que deseas asociar con tu trabajo de coordinador.')}</p><div className="institution-actions"><button className="button primary" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinator-register'},authorizationParams:{screen_hint:'signup'}}).catch(()=>setError('signin'))}>{t('Register as a coordinator','Registrarme como coordinador')}</button><button className="button outline" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinator-register'}}).catch(()=>setError('signin'))}>{t('Already have an account? Sign in','¿Ya tienes cuenta? Inicia sesión')}</button></div></section>:<>
   <button className="text-button" disabled={busy} onClick={()=>setRetry(n=>n+1)}>{t('Refresh status','Actualizar estado')}</button>
   {busy&&<p role="status">{t('Checking your application…','Consultando tu solicitud…')}</p>}
   {application?<section className="coordinator-card" aria-labelledby="application-status"><h2 id="application-status">{application.status==='pending'?t('Your application is awaiting review','Tu solicitud está pendiente de revisión'):application.status==='approved'?t('Your application was approved','Tu solicitud fue aprobada'):t('Your application was not approved','Tu solicitud no fue aprobada')}</h2><p><strong>{application.displayName}</strong> · {application.organizationName}</p><p>{application.jobRole} · {application.email}</p>
    {application.reviewNote&&<p>{application.reviewNote}</p>}
    {application.status==='pending'&&<p>{t('The Origen team will verify your affiliation. Your organization’s owner may send you an invitation to join its team. Return here to check your status; no approval email is sent automatically.','El equipo de Origen verificará tu afiliación. El propietario de tu organización puede enviarte una invitación para unirte a su equipo. Vuelve aquí para consultar tu estado; no se envía un correo de aprobación automáticamente.')}</p>}
    {application.status==='approved'?<><p>{t('Open your workspace to verify your sign-in with multi-factor authentication and create your connection code. Workspace access also depends on your organization and current staff permissions.','Abre tu espacio para verificar tu inicio de sesión con autenticación multifactor y crear tu código de conexión. El acceso también depende de tu organización y tus permisos actuales.')}</p><a className="button primary" href="#coordinators">{t('Open coordinator workspace','Abrir espacio del coordinador')}</a></>:<button className="button outline" disabled={busy} onClick={()=>{if(window.confirm(t('Withdraw this application? You can submit a new one.','¿Retirar esta solicitud? Puedes enviar una nueva.')))void submit(true);}}>{t('Withdraw application','Retirar solicitud')}</button>}
   </section>:application===null&&<form className="coordinator-card coordinator-registration-form" onSubmit={e=>{e.preventDefault();void submit();}}>
    <h2>{t('Tell us about your work','Cuéntanos sobre tu trabajo')}</h2>
    <label>{t('Your name','Tu nombre')}<input required autoComplete="name" maxLength={100} value={displayName} onChange={e=>setName(e.target.value)}/></label>
    <label>{t('Organization name','Nombre de la organización')}<input required autoComplete="organization" maxLength={200} value={organizationName} onChange={e=>setOrganization(e.target.value)}/></label>
    <label>{t('Organization website (https://)','Sitio web de la organización (https://)')}<input required type="url" placeholder="https://example.org" maxLength={2000} value={organizationWebsite} onChange={e=>setWebsite(e.target.value)}/></label>
    <label>{t('Your role or job title','Tu función o cargo')}<input required autoComplete="organization-title" maxLength={200} value={jobRole} onChange={e=>setRole(e.target.value)}/></label>
    <p>{t('Your verified sign-in email will be included with your application. Submitting does not give access to any student information.','Incluiremos tu correo de inicio de sesión verificado en la solicitud. Enviarla no da acceso a información de estudiantes.')}</p>
    <button className="button primary" disabled={busy}>{t('Submit for review','Enviar para revisión')}</button>
   </form>}
  </>}
  {error&&<p className="institution-error" role="alert">{applicationError(error,t)}</p>}
 </main>;
}

type Request=(input:unknown)=>Promise<{applications?:Application[]}>;
export function CoordinatorApplications({request,organizations,t,onError}:{request:Request;organizations:{id:string;name:string;pilotStatus:string;verificationStatus:string;role?:string}[];t:Translate;onError:(error:string)=>void}){
 const [items,setItems]=useState<Application[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[after,setAfter]=useState(''),[next,setNext]=useState('');
 const [selected,setSelected]=useState(''),[note,setNote]=useState(''),[institution,setInstitution]=useState('');
 const version=useRef(0);useEffect(()=>()=>{version.current++;},[]);
 async function load(cursor=''){
  const current=++version.current;setBusy(true);onError('');
  try{const data=await request({action:'applications',after:cursor});if(current!==version.current)return;const list=data.applications||[];setItems(list.slice(0,50));setNext(list.length>50?list[49].id:'');setAfter(cursor);setLoaded(true);setSelected('');setNote('');setInstitution('');}
  catch(e){if(current===version.current)onError(e instanceof Error?e.message:'unavailable');}finally{if(current===version.current)setBusy(false);}
 }
 async function review(approve:boolean){
  const current=version.current;setBusy(true);onError('');
  try{await request({action:approve?'approve-application':'decline-application',id:selected,institutionId:institution,reviewNote:note});if(current===version.current)await load(after);}
  catch(e){if(current===version.current)onError(e instanceof Error?e.message:'unavailable');}finally{if(current===version.current)setBusy(false);}
 }
 return <section className="coordinator-card"><h2>{t('Coordinator applications','Solicitudes de coordinadores')}</h2>
  <p>{t('Verify the applicant’s affiliation independently. Approve the organization’s pilot and have its owner invite the applicant first. Approving below enables coordinator access only after they accept that invitation.','Verifica la afiliación de forma independiente. Aprueba el piloto de la organización y pide al propietario que invite a la persona primero. La aprobación aquí activa el acceso solo después de que acepte esa invitación.')}</p>
  <button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh applications','Actualizar solicitudes')}</button>
  {loaded&&!items.length&&<p role="status">{t('No pending applications on this page.','No hay solicitudes pendientes en esta página.')}</p>}
  <ul className="coordinator-members">{items.map(item=><li key={item.id}><div><strong>{item.displayName}</strong><p>{item.organizationName} · {item.jobRole}</p><p>{item.email}</p><p>{item.organizationWebsite}</p></div><button className="button outline" disabled={busy} onClick={()=>{setSelected(item.id);setNote('');setInstitution('');}}>{t('Review','Revisar')}</button></li>)}</ul>
  {selected&&<form className="coordinator-registration-form" onSubmit={e=>{e.preventDefault();void review(true);}}><h3>{t('Review application','Revisar solicitud')}: {items.find(i=>i.id===selected)?.displayName}</h3>
   <label>{t('Verified organization','Organización verificada')}<select required value={institution} onChange={e=>setInstitution(e.target.value)}><option value="">{t('Choose an organization','Elige una organización')}</option>{organizations.filter(o=>o.pilotStatus==='active'&&o.verificationStatus==='verified'&&!o.role).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   <label>{t('Message the applicant will see','Mensaje que verá la persona')}<textarea required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <div className="institution-actions"><button className="button primary" disabled={busy}>{t('Approve coordinator access','Aprobar acceso de coordinador')}</button><button type="button" className="button outline" disabled={busy||!note.trim()} onClick={()=>void review(false)}>{t('Decline application','Rechazar solicitud')}</button></div>
  </form>}
  <div className="institution-actions">{after&&<button className="text-button" disabled={busy} onClick={()=>void load()}>{t('First page','Primera página')}</button>}{next&&<button className="text-button" disabled={busy} onClick={()=>void load(next)}>{t('Next page','Página siguiente')}</button>}</div>
 </section>;
}
