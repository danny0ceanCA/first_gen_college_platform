import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowRight,BookOpen,Building2,Check,MessageCircle,ShieldCheck} from 'lucide-react';
import {apiFetch} from './api';
import {CoordinatorReadiness} from './AuthenticatorGuide';
import StaffVerification,{staffVerificationErrors} from './StaffVerification';
import {browserPrivacy} from './browserPrivacy.mjs';
import {signupOrganization,registerSignupOrganization,type OrganizationRegistration} from './coordinatorOrganizationSignup.mjs';
import './InstitutionPortal.css';
import './CoordinatorWorkspace.css';
import './CoordinatorRegistration.css';

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
 const [organizationMode,setOrganizationMode]=useState('join'),[description,setDescription]=useState(''),[authorized,setAuthorized]=useState(false);
 const organizationKey=`origen.user.${user?.sub}.coordinator-organization.v1`;
 const organizationStorage=useMemo(()=>browserPrivacy.storage(organizationKey),[organizationKey]);
 const [organizationSignup,setOrganizationSignup]=useState<{registration:OrganizationRegistration;done?:boolean}|null>(()=>{
  try{const saved=JSON.parse(organizationStorage.getItem(organizationKey)||'null');return saved?.registration?.registrationKey?saved:null;}catch{return null;}
 });
 const [organizationBusy,setOrganizationBusy]=useState(false),[organizationError,setOrganizationError]=useState('');
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
 async function finishOrganization(signup=organizationSignup){
  if(!signup||signup.done||organizationBusy)return;
  const current=version.current;setOrganizationBusy(true);setOrganizationError('');
  try{
   await registerSignupOrganization(async input=>{
    if(current!==version.current)throw new Error('privacy_session_ended');
    const token=await getAccessTokenSilently();
    if(current!==version.current)throw new Error('privacy_session_ended');
    const response=await apiFetch('/api/institutions',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
   },signup.registration);
   if(current===version.current){const completed={...signup,done:true};organizationStorage.setItem(organizationKey,JSON.stringify(completed));setOrganizationSignup(completed);}
  }catch(e){if(current===version.current)setOrganizationError(e instanceof Error?e.message:'unavailable');}
  finally{if(current===version.current)setOrganizationBusy(false);}
 }
 async function startOrganization(saved:Application){
  setOrganizationError('');
  try{
   const signup={registration:signupOrganization(saved,description,crypto.randomUUID(),authorized)};
   organizationStorage.setItem(organizationKey,JSON.stringify(signup));setOrganizationSignup(signup);
   await finishOrganization(signup);
  }catch{setOrganizationError('organization_recovery_unavailable');}
 }
 async function submit(withdraw=false){
  const current=version.current;setBusy(true);setError('');
  try{
   const data=await request(withdraw?{action:'withdraw-application'}:{action:'submit-application',displayName,organizationName,organizationWebsite,jobRole});
   if(current!==version.current)return;
   setApplication(data.application);
   if(withdraw)setOrganizationMode('join');
   if(!withdraw&&organizationMode==='new'&&!organizationSignup){
    if(data.application?.status!=='pending'||data.application.organizationName!==organizationName.trim()||data.application.organizationWebsite!==new URL(organizationWebsite).href||data.application.displayName!==displayName.trim()||data.application.jobRole!==jobRole.trim())throw new Error('application_changed');
    // Use the saved application's verified email, never a separate contact field.
    await startOrganization(data.application);
   }
  }
  catch(e){if(current===version.current)setError(e instanceof Error?e.message:'unavailable');}
  finally{if(current===version.current)setBusy(false);}
 }
 const organizationFields=<>
  <label>{t('What does your organization do?','¿Qué hace tu organización?')}<textarea required maxLength={5000} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/><span>{t('This description can appear on your organization’s page after approval.','Esta descripción puede aparecer en la página de tu organización después de aprobarse.')}</span></label>
  <label className="coordinator-organization-consent"><input required type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/><span>{t('I’m authorized to register this organization and manage its team.','Tengo autorización para registrar esta organización y gestionar su equipo.')}</span></label>
 </>;
 return <main className="institution-shell coordinator-workspace coordinator-registration">
  <nav className="coordinator-registration-nav" aria-label={t('Navigation','Navegación')}>
   <a className="coordinator-registration-brand" href="#" aria-label="Origen"><span aria-hidden="true">○</span> origen.</a>
   <div><a className="coordinator-workspace-link" href="#coordinators">{t('Coordinator workspace','Espacio del coordinador')} <ArrowRight size={15} aria-hidden="true"/></a><button className="coordinator-language" onClick={()=>{setEs(!es);localStorage.setItem('origen.language',es?'en':'es');}}>{es?'English':'Español'}</button>{isAuthenticated&&<button className="coordinator-language" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>{t('Log out','Cerrar sesión')}</button>}</div>
  </nav>
  <header className="coordinator-registration-hero">
   <div className="coordinator-registration-intro">
    <div className="eyebrow">{t('FOR THE PEOPLE GUIDING THE WAY','PARA QUIENES ACOMPAÑAN EL CAMINO')}</div>
    <h1>{t('Help students take','Ayuda a los estudiantes a dar')} <em>{t('their next step.','su siguiente paso.')}</em></h1>
    <p className="coordinator-registration-lead">{t('Stay connected between meetings. Review the binder pages students choose to share, leave a little guidance, and help them move forward.','Mantén el contacto entre reuniones. Revisa las páginas que los estudiantes eligen compartir, deja orientación y ayúdalos a seguir adelante.')}</p>
    <p className="coordinator-privacy-promise"><ShieldCheck size={20} aria-hidden="true"/>{t('Shared by the student. Guided by you. Family conversations stay private.','El estudiante elige qué compartir. Tú orientas. Las conversaciones familiares siguen siendo privadas.')}</p>
   </div>
   <div className="coordinator-binder-example" aria-label={t('Illustrative example of a shared binder','Ejemplo ilustrativo de una carpeta compartida')}>
    <div className="coordinator-example-caption"><BookOpen size={17} aria-hidden="true"/>{t('A little context. A better conversation.','Un poco de contexto. Una mejor conversación.')}</div>
    <div className="coordinator-example-paper">
     <span className="coordinator-example-tab">{t('College options','Opciones universitarias')}</span>
     <div className="coordinator-example-label">{t('FROM MY BINDER','DE MI CARPETA')}</div>
     <h2>{t('Making room for what’s next.','Un espacio para lo que sigue.')}</h2>
     <p className="coordinator-example-student">{t('Compare two programs and bring my questions to our next meeting.','Comparar dos programas y llevar mis preguntas a nuestra próxima reunión.')}</p>
     <div className="coordinator-example-guidance"><span><MessageCircle size={14} aria-hidden="true"/>{t('A note from your coordinator','Una nota de tu coordinador')}</span><p>{t('Let’s look at costs and student support together. Bring the programs you’re curious about.','Revisemos los costos y los apoyos juntos. Trae los programas que te interesan.')}</p></div>
     <div className="coordinator-example-footer"><Check size={14} aria-hidden="true"/>{t('Only the pages the student shares','Solo las páginas que comparte el estudiante')}</div>
    </div>
    <span className="coordinator-example-disclosure">{t('Illustrative example','Ejemplo ilustrativo')}</span>
   </div>
  </header>
  <ol className="coordinator-journey" aria-label={t('How coordinator registration works','Cómo funciona el registro de coordinadores')}>
   {[['Create your account','Crea tu cuenta','Use your own email and tell us about your work.','Usa tu propio correo y cuéntanos sobre tu trabajo.'],['Connect with your organization','Conéctate con tu organización','We review your affiliation before enabling access.','Revisamos tu afiliación antes de activar el acceso.'],['Guide from their binder','Orienta desde su carpeta','Students decide what to share with you.','Los estudiantes deciden qué compartir contigo.']].map(([en,sp,detailEn,detailSp],i)=><li key={en}><span className="coordinator-journey-number" aria-hidden="true">0{i+1}</span><div><h2>{t(en,sp)}</h2><p>{t(detailEn,detailSp)}</p></div></li>)}
  </ol>
  <div className="coordinator-registration-layout">
   <section className="coordinator-registration-main" aria-label={t('Your coordinator application','Tu solicitud como coordinador')}>
   {isLoading?<div className="coordinator-card"><p role="status">{t('Loading…','Cargando…')}</p></div>:!isAuthenticated?<section className="coordinator-card coordinator-signup-card"><span className="coordinator-card-eyebrow">{t('YOUR NEXT STEP','TU SIGUIENTE PASO')}</span><h2>{t('Start with your own account','Empieza con tu propia cuenta')}</h2><p>{t('Use the email you want associated with your coordinator work. You can apply now and set up verification when you’re ready for staff access.','Usa el correo que deseas asociar con tu trabajo de coordinador. Puedes enviar tu solicitud ahora y configurar la verificación cuando vayas a acceder como personal.')}</p><button className="button primary coordinator-signup-button" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinator-register'},authorizationParams:{screen_hint:'signup'}}).catch(()=>setError('signin'))}>{t('Register as a coordinator','Registrarme como coordinador')}<ArrowRight size={18} aria-hidden="true"/></button><div className="coordinator-signin-divider"><span>{t('Already part of Origen?','¿Ya tienes cuenta en Origen?')}</span></div><button className="coordinator-signin-button" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinator-register'}}).catch(()=>setError('signin'))}>{t('Already have an account? Sign in','¿Ya tienes cuenta? Inicia sesión')}<ArrowRight size={15} aria-hidden="true"/></button><p className="coordinator-access-caption"><ShieldCheck size={15} aria-hidden="true"/>{t('Your application is reviewed before coordinator access is enabled.','Revisamos tu solicitud antes de activar el acceso como coordinador.')}</p></section>:<>
    <div className="coordinator-application-controls"><span>{t('YOUR APPLICATION','TU SOLICITUD')}</span><button className="text-button" disabled={busy||organizationBusy} onClick={()=>setRetry(n=>n+1)}>{t('Refresh status','Actualizar estado')}</button></div>
    {busy&&<p role="status">{t('Checking your application…','Consultando tu solicitud…')}</p>}
    {application?<section className="coordinator-card coordinator-application-status" aria-labelledby="application-status"><span className={'coordinator-status-pill '+application.status}>{application.status==='pending'?t('In review','En revisión'):application.status==='approved'?t('Approved','Aprobada'):t('Review complete','Revisión completada')}</span><h2 id="application-status">{application.status==='pending'?t('Your application is awaiting review','Tu solicitud está pendiente de revisión'):application.status==='approved'?t('Your application was approved','Tu solicitud fue aprobada'):t('Your application was not approved','Tu solicitud no fue aprobada')}</h2><div className="coordinator-applicant"><strong>{application.displayName}</strong><span>{application.organizationName} · {application.jobRole}</span><span>{application.email}</span></div>
     {application.reviewNote&&<div className="coordinator-review-message"><span>{t('From the Origen team','Del equipo de Origen')}</span><p>{application.reviewNote}</p></div>}
     {application.status==='pending'&&<p>{organizationSignup?t('We’ll review your organization and coordinator application before enabling access. Return here to check your status.','Revisaremos tu organización y tu solicitud como coordinador antes de activar el acceso. Vuelve aquí para consultar tu estado.'):t('The Origen team will verify your affiliation. If you’re joining an existing organization, ask its owner to invite you using your sign-in email. Return here to check your status.','El equipo de Origen verificará tu afiliación. Si te unes a una organización existente, pide al propietario una invitación con tu correo de inicio de sesión. Vuelve aquí para consultar tu estado.')}</p>}
     {application.status==='approved'?<><p>{t('Open your workspace to verify your sign-in and create your connection code. Access also depends on your organization and current staff permissions.','Abre tu espacio para verificar tu inicio de sesión y crear tu código de conexión. El acceso también depende de tu organización y tus permisos actuales.')}</p><a className="button primary" href="#coordinators">{t('Open coordinator workspace','Abrir espacio del coordinador')}<ArrowRight size={17} aria-hidden="true"/></a></>:<button className="text-button" disabled={busy||organizationBusy} onClick={()=>{if(window.confirm(t('Withdraw this application? This does not remove an organization you registered.','¿Retirar esta solicitud? Esto no elimina una organización que hayas registrado.')))void submit(true);}}>{t('Withdraw application','Retirar solicitud')}</button>}
    </section>:application===null&&<form className="coordinator-card coordinator-registration-form" onSubmit={e=>{e.preventDefault();void submit();}}>
     <span className="coordinator-card-eyebrow">{t('LET’S GET TO KNOW YOU','CUÉNTANOS SOBRE TI')}</span><h2>{t('Tell us about your work','Cuéntanos sobre tu trabajo')}</h2>
     <p className="coordinator-form-intro">{t('Share a few details so we can review your role and organization.','Comparte algunos datos para que podamos revisar tu función y organización.')}</p>
     <label>{t('Your name','Tu nombre')}<input required autoComplete="name" maxLength={100} value={displayName} onChange={e=>setName(e.target.value)}/></label>
     <label>{t('Organization name','Nombre de la organización')}<input required autoComplete="organization" maxLength={200} value={organizationName} onChange={e=>setOrganization(e.target.value)}/></label>
     <label>{t('Organization website (https://)','Sitio web de la organización (https://)')}<input required type="url" placeholder="https://example.org" maxLength={2000} value={organizationWebsite} onChange={e=>setWebsite(e.target.value)}/></label>
     <label>{t('Your role or job title','Tu función o cargo')}<input required autoComplete="organization-title" maxLength={200} value={jobRole} onChange={e=>setRole(e.target.value)}/></label>
     <fieldset className="coordinator-organization-choice" disabled={busy}><legend>{t('Your organization','Tu organización')}</legend><label><input type="radio" name="organization-mode" value="join" checked={organizationMode==='join'} onChange={()=>setOrganizationMode('join')}/><span>{t('Join an existing organization','Unirme a una organización existente')}</span></label>{!organizationSignup&&<label><input type="radio" name="organization-mode" value="new" checked={organizationMode==='new'} onChange={()=>setOrganizationMode('new')}/><span>{t('Register my organization','Registrar mi organización')}</span></label>}</fieldset>
     {organizationMode==='new'?<div className="coordinator-new-organization">{organizationFields}</div>:<p className="coordinator-form-intro">{t('Ask your organization’s owner to invite you using your sign-in email.','Pide al propietario de tu organización una invitación con tu correo de inicio de sesión.')}</p>}
     <p className="coordinator-access-caption">{organizationMode==='new'?t('We’ll register your organization here and send it for review. Two-step verification is required. Registration does not give access to student information.','Registraremos tu organización aquí y la enviaremos a revisión. Se requiere verificación en dos pasos. Registrarse no da acceso a información de estudiantes.'):t('Your verified sign-in email will be included. Origen reviews your application before enabling access.','Incluiremos tu correo de inicio de sesión verificado. Origen revisa tu solicitud antes de activar el acceso.')}</p>
     <button className="button primary" disabled={busy||organizationBusy}>{organizationMode==='new'?t('Register and apply','Registrar y solicitar acceso'):t('Submit for review','Enviar para revisión')}<ArrowRight size={17} aria-hidden="true"/></button>
    </form>}
    {application&&organizationSignup&&<section className="coordinator-card coordinator-organization-progress" aria-label={t('Organization registration','Registro de organización')}>
     <h2>{organizationSignup.done?t('Organization registered','Organización registrada'):t('Finish registering your organization','Termina de registrar tu organización')}</h2><p>{organizationSignup.registration.page.name}</p>
     {organizationSignup.done?<p role="status">{t('Your organization has been sent for review. Your sign-in account is its owner. Coordinator access still needs Origen’s approval.','Tu organización se envió a revisión. Tu cuenta es su propietaria. El acceso como coordinador todavía requiere la aprobación de Origen.')}</p>:<>
      <p>{t('Your application is saved. Complete organization registration here; your details are kept in this tab while you verify your identity.','Tu solicitud está guardada. Completa aquí el registro de tu organización; tus datos se conservan en esta pestaña mientras verificas tu identidad.')}</p>
      {staffVerificationErrors.includes(organizationError)?<StaffVerification es={es} returnTo="#coordinator-register"/>:<button className="button primary" disabled={busy||organizationBusy} onClick={()=>void finishOrganization()}>{organizationBusy?t('Registering…','Registrando…'):t('Complete organization registration','Completar registro de organización')}</button>}
     </>}
    </section>}
    {application?.status==='pending'&&!organizationSignup&&<details className="coordinator-card coordinator-inline-organization"><summary>{t('Need to register your organization? Do it here.','¿Necesitas registrar tu organización? Hazlo aquí.')}</summary><form className="coordinator-registration-form" onSubmit={e=>{e.preventDefault();void startOrganization(application);}}><p>{application.organizationName}</p>{organizationFields}<p>{t('Two-step verification is required. Origen reviews the organization before enabling access.','Se requiere verificación en dos pasos. Origen revisa la organización antes de activar el acceso.')}</p><button className="button primary" disabled={busy||organizationBusy}>{t('Register my organization','Registrar mi organización')}</button></form></details>}
    {organizationError&&!staffVerificationErrors.includes(organizationError)&&<p role="alert" className="institution-error">{organizationError==='organization_recovery_unavailable'?t('Your application is saved, but this browser couldn’t keep the organization details for a safe retry. Allow session storage and try again.','Tu solicitud está guardada, pero el navegador no pudo conservar los datos para reintentar de forma segura. Permite el almacenamiento de sesión e inténtalo de nuevo.'):organizationError==='staff_access_revoked'?t('Your staff access is suspended. Contact Origen before continuing.','Tu acceso como personal está suspendido. Contacta a Origen antes de continuar.'):t('Your application is saved. Organization registration has not finished; try completing it again.','Tu solicitud está guardada. El registro de la organización no ha terminado; intenta completarlo de nuevo.')}</p>}
   </>}
   {error&&<p className="institution-error" role="alert">{applicationError(error,t)}</p>}
   </section>
   <aside className="coordinator-registration-help" aria-label={t('Getting ready','Prepárate')}>
    <section className="coordinator-organization-help"><span className="coordinator-help-icon"><Building2 size={22} aria-hidden="true"/></span><h2>{t('How your organization fits in','Cómo participa tu organización')}</h2><p>{t('Join your team or register your organization during signup.','Únete a tu equipo o registra tu organización durante el registro.')}</p><details><summary>{t('My organization is already on Origen','Mi organización ya está en Origen')}</summary><p>{t('Ask its owner to invite you to the team using your sign-in email. We review your affiliation before enabling coordinator access.','Pide al propietario que te invite al equipo con tu correo de inicio de sesión. Revisamos tu afiliación antes de activar el acceso como coordinador.')}</p></details><details><summary>{t('My organization is new to Origen','Mi organización es nueva en Origen')}</summary><p>{t('Choose Register my organization on the signup form. Confirm you’re authorized, add a short description, and complete two-step verification. We’ll register it and send it for review from this page.','Elige Registrar mi organización en el formulario. Confirma que tienes autorización, agrega una breve descripción y completa la verificación en dos pasos. La registraremos y enviaremos a revisión desde esta página.')}</p></details></section>
    <CoordinatorReadiness es={es}/>
   </aside>
  </div>
  <footer className="coordinator-registration-footer"><span className="coordinator-registration-brand">origen.</span><p>{t('Different paths. A future that fits.','Caminos distintos. Un futuro a tu medida.')}</p><a href="#privacy">{t('Data privacy','Privacidad de datos')}</a></footer>
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
