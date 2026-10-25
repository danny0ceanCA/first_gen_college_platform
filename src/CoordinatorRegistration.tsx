import {loadCoordinatorApplicationPage} from './coordinatorApplicationQueue.mjs';
import {defaultCoordinatorOrganization} from './coordinatorOrganizationDefault.mjs';
import {normalizeCoordinatorWebsite} from './coordinatorWebsite.mjs';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {ArrowLeft,ArrowRight,BookOpen,Building2,Check,MessageCircle,ShieldCheck} from 'lucide-react';
import {apiFetch} from './api';
import {CoordinatorReadiness} from './AuthenticatorGuide';
import StaffVerification,{staffVerificationErrors,getStaffAccessToken} from './StaffVerification';
import {browserPrivacy} from './browserPrivacy.mjs';
import {signupOrganization,signupMatchesApplication,registerSignupOrganization,savedOrganizationSignup,resumeOrganizationSignup,type OrganizationRegistration,type SignupOrganization} from './coordinatorOrganizationSignup.mjs';
import './InstitutionPortal.css';
import './CoordinatorWorkspace.css';
import './CoordinatorRegistration.css';

type Application={id:string;displayName:string;email:string;organizationName:string;organizationWebsite:string;jobRole:string;status:'pending'|'approved'|'declined';reviewNote:string;createdAt:string;registeredInstitutionId?:string|null;registeredOrganizationName?:string|null;organizationRegistration?:{description:string;authorized:true}|null};
type Translate=(en:string,es:string)=>string;
export function applicationError(error:string,t:Translate){
 const messages:Record<string,string>={
  invalid_organization_website:t('Enter a website such as example.org or https://example.org.','Escribe un sitio web como ejemplo.org o https://ejemplo.org.'),
  name_required:t('Enter your first and last name.','Escribe tu nombre y apellido.'),
  name_too_long:t('Use a first and last name totaling 100 characters or fewer.','Usa un nombre y apellido de hasta 100 caracteres en total.'),
  organization_changed:t('Organization access changed. Refresh access and review its current status before approving again.','El acceso de la organización cambió. Actualiza el acceso y revisa su estado antes de aprobar de nuevo.'),
  coordinator_review_busy:t('Review is busy. Wait a moment, then refresh applications to check the latest status.','La revisión está ocupada. Espera un momento y actualiza las solicitudes para ver el estado actual.'),
  coordinator_sharing_unavailable:t('Coordinator registration is not open yet. Please check back with the Origen team.','El registro de coordinadores aún no está abierto. Consulta con el equipo de Origen.'),
  verified_email_required:t('Verify your sign-in email, then select Refresh status.','Verifica tu correo de inicio de sesión y selecciona Actualizar estado.'),
  invitation_email_required:t('Sign in again so we can verify your email.','Inicia sesión de nuevo para verificar tu correo.'),
  application_membership_required:t('The applicant must first accept an invitation to the selected organization. Use Invitations and team in its owner workspace.','La persona debe aceptar primero una invitación a la organización seleccionada. Usa Invitaciones y equipo en el espacio del propietario.'),
  application_review_required:t('The Origen team must approve this coordinator’s application before access can be enabled.','El equipo de Origen debe aprobar la solicitud de este coordinador antes de activar su acceso.'),
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
 const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState('');
 const displayName=[firstName.trim(),lastName.trim()].filter(Boolean).join(' ');
 const [organizationName,setOrganization]=useState(''),[organizationWebsite,setWebsite]=useState(''),[jobRole,setRole]=useState('');
 const [organizationMode,setOrganizationMode]=useState('join'),[description,setDescription]=useState(''),[authorized,setAuthorized]=useState(false);
 const organizationKey=`origen.user.${user?.sub}.coordinator-organization.v1`;
 const organizationStorage=useMemo(()=>browserPrivacy.storage(organizationKey),[organizationKey]);
 const draftKey=`origen.user.${user?.sub}.coordinator-application-draft.v1`;
 const [organizationSignup,setOrganizationSignup]=useState<{registration:OrganizationRegistration}|null>(null);
 const [organization,setSavedOrganization]=useState<SignupOrganization|null>();
 const [organizationBusy,setOrganizationBusy]=useState(false),[organizationError,setOrganizationError]=useState('');
 const version=useRef(0);
 const request=useCallback(async(input:unknown)=>{
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  const response=await apiFetch('/api/coordinator-access',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
 },[getAccessTokenSilently]);
 const organizationRequest=useCallback(async(input:unknown)=>{
  const current=version.current;
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  if(current!==version.current)throw new Error('privacy_session_ended');
  const response=await apiFetch('/api/institutions',{method:'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error);
  if(current!==version.current)throw new Error('privacy_session_ended');
  return data;
 },[getAccessTokenSilently]);
 useEffect(()=>{
  const current=++version.current;setApplication(undefined);setError('');setOrganizationError('');setSavedOrganization(undefined);setOrganizationSignup(null);setOrganizationBusy(false);
  if(isAuthenticated){setBusy(true);void request({action:'application-status'}).then(async data=>{
   if(current!==version.current)return;
   setApplication(data.application);
   if(!data.application){
    try{
     const draft=JSON.parse(organizationStorage.getItem(draftKey)||'null');
     if(draft&&typeof draft.displayName==='string'&&typeof draft.organizationName==='string'&&typeof draft.organizationWebsite==='string'&&typeof draft.jobRole==='string'&&typeof draft.description==='string'){
      const parts=draft.displayName.trim().split(/\s+/);setFirstName(typeof draft.firstName==='string'?draft.firstName:parts.shift()||'');setLastName(typeof draft.lastName==='string'?draft.lastName:parts.join(' '));setOrganization(draft.organizationName);setWebsite(draft.organizationWebsite);setRole(draft.jobRole);setDescription(draft.description);setOrganizationMode(draft.organizationMode==='new'?'new':'join');setAuthorized(draft.authorized===true);
     }
    }catch{/* An unavailable draft never blocks server recovery. */}
    return;
   }
   try{organizationStorage.removeItem(draftKey);}catch{/* Server state is authoritative. */}
   let recovered=data.application as Application;
   let signup=savedOrganizationSignup(recovered);
   if(!signup)try{const saved=JSON.parse(organizationStorage.getItem(organizationKey)||'null');if(signupMatchesApplication(saved,recovered))signup=saved;}catch{/* Server recovery is available without browser storage. */}
   if(signup)setOrganizationSignup(signup);
   try{
    // Migrate an interrupted legacy tab draft before any MFA redirect.
    if(signup&&!recovered.organizationRegistration&&recovered.status==='pending'){
     const result=await request({action:'save-organization-registration',id:recovered.id,organizationRegistration:{description:signup.registration.page.description,authorized:true}});
     if(current!==version.current)return;
     recovered=result.application;setApplication(recovered);
    }
    const organization=await resumeOrganizationSignup(input=>{if(current!==version.current)throw new Error('privacy_session_ended');return organizationRequest(input);},recovered);
    if(current===version.current){setSavedOrganization(organization);if(organization){setOrganizationSignup(null);try{organizationStorage.removeItem(organizationKey);}catch{/* Account state is authoritative. */}}}
   }catch(e){if(current===version.current)setOrganizationError(e instanceof Error?e.message:'unavailable');}
  }).catch(e=>{if(current===version.current)setError(e.message);}).finally(()=>{if(current===version.current)setBusy(false);});}
  return()=>{version.current++;};
 },[isAuthenticated,user?.sub,retry,request,organizationRequest,organizationStorage,organizationKey,draftKey]);
 function preserveApplicationDraft(){
  // Account-scoped, tab-only storage survives the redirect and is purged on logout.
  // Do not leave the page if saving an unfinished form fails.
  if(!application)organizationStorage.setItem(draftKey,JSON.stringify({displayName,firstName,lastName,organizationName,organizationWebsite,jobRole,organizationMode,description,authorized}));
 }
 async function finishOrganization(signup=organizationSignup,saved=application){
  if(!signup||!signupMatchesApplication(signup,saved)||organizationBusy)return;
  const current=version.current;setOrganizationBusy(true);setOrganizationError('');
  try{
   await registerSignupOrganization(input=>{if(current!==version.current)throw new Error('privacy_session_ended');return organizationRequest(input);},signup.registration);
   const result=await organizationRequest({action:'signup-status',applicationId:saved!.id});
   if(current===version.current){setSavedOrganization(result.organization);setOrganizationSignup(null);try{organizationStorage.removeItem(organizationKey);}catch{/* Server state remains authoritative. */}}
  }catch(e){if(current===version.current)setOrganizationError(e instanceof Error?e.message:'unavailable');}
  finally{if(current===version.current)setOrganizationBusy(false);}
 }
 async function startOrganization(saved:Application){
  const current=version.current;
  setOrganizationError('');
  try{
   if(!saved.organizationRegistration){
    const result=await request({action:'save-organization-registration',id:saved.id,organizationRegistration:{description,authorized}});
    if(current!==version.current)return;
    saved=result.application;setApplication(saved);
   }
   const signup=savedOrganizationSignup(saved);
   if(!signup)throw new Error('organization_details_required');
   try{organizationStorage.setItem(organizationKey,JSON.stringify(signup));}catch{/* The server retry key is the application ID. */}
   setOrganizationSignup(signup);
   await finishOrganization(signup,saved);
  }catch(e){if(current===version.current)setOrganizationError(e instanceof Error?e.message:'unavailable');}
 }
 async function submit(withdraw=false){
  if(!withdraw&&(!firstName.trim()||!lastName.trim())){setError('name_required');return;}
  if(!withdraw&&displayName.length>100){setError('name_too_long');return;}
  const current=version.current;setBusy(true);setError('');
  try{
   const website=withdraw?'':normalizeCoordinatorWebsite(organizationWebsite);
   if(!withdraw)setWebsite(website);
   const data=await request(withdraw?{action:'withdraw-application',id:application?.id}:{action:'submit-application',displayName,organizationName,organizationWebsite:website,jobRole,...(organizationMode==='new'?{organizationRegistration:{description,authorized}}:{})});
   if(current!==version.current)return;
   setApplication(data.application);
   try{organizationStorage.removeItem(draftKey);}catch{/* The submitted application is already saved. */}
   if(withdraw){setOrganizationMode('join');setOrganizationSignup(null);setSavedOrganization(undefined);setDescription('');setAuthorized(false);setOrganizationError('');try{organizationStorage.removeItem(organizationKey);}catch{/* Server state remains authoritative. */}}
   if(!withdraw&&organizationMode==='new'&&!organizationSignup){
    if(data.application?.status!=='pending'||data.application.organizationName!==organizationName.trim()||data.application.organizationWebsite!==website||data.application.displayName!==displayName.trim()||data.application.jobRole!==jobRole.trim())throw new Error('application_changed');
    // Use the saved application's verified email, never a separate contact field.
    await startOrganization(data.application);
   }
  }
  catch(e){if(current===version.current)setError(e instanceof Error?e.message:'unavailable');}
  finally{if(current===version.current)setBusy(false);}
 }
 async function resubmitOrganization(page:SignupOrganization['page']){
  if(!organization||organizationBusy)return;
  const current=version.current;setOrganizationBusy(true);setOrganizationError('');
  try{
   const result=await organizationRequest({action:'save',id:organization.id,revision:organization.revision,page:{...page,website:normalizeCoordinatorWebsite(page.website)}});
   const saved=result.institutions?.find((item:SignupOrganization)=>item.id===organization.id);
   if(current!==version.current)return;
   if(!saved)throw new Error('organization_registration_incomplete');
   // Update the revision even if submission fails, so retry can recover safely.
   setSavedOrganization(saved);
   await organizationRequest({action:'submit',id:saved.id,revision:saved.revision});
   if(current===version.current)setRetry(n=>n+1);
  }catch(e){if(current===version.current){setOrganizationError(e instanceof Error?e.message:'unavailable');}}
  finally{if(current===version.current)setOrganizationBusy(false);}
 }
 const organizationFields=<>
  <label>{t('What does your organization do?','¿Qué hace tu organización?')}<textarea required maxLength={5000} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/><span>{t('This description can appear on your organization’s page after approval.','Esta descripción puede aparecer en la página de tu organización después de aprobarse.')}</span></label>
  <label className="coordinator-organization-consent"><input required type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/><span>{t('I’m authorized to register this organization and manage its team.','Tengo autorización para registrar esta organización y gestionar su equipo.')}</span></label>
 </>;
 const signupCard=(<section className="coordinator-card coordinator-signup-card"><h2>{t('Start with your own account','Empieza con tu propia cuenta')}</h2><p>{t('Use the email you want associated with your coordinator work. You can apply now and set up verification when you’re ready for staff access.','Usa el correo que deseas asociar con tu trabajo de coordinador. Puedes enviar tu solicitud ahora y configurar la verificación cuando vayas a acceder como personal.')}</p><button className="button primary coordinator-signup-button" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinator-register'},authorizationParams:{screen_hint:'signup'}}).catch(()=>setError('signin'))}>{t('Register as a coordinator','Registrarme como coordinador')}<ArrowRight size={18} aria-hidden="true"/></button><div className="coordinator-signin-divider"><span>{t('Already part of Origen?','¿Ya tienes cuenta en Origen?')}</span></div><button className="coordinator-signin-button" onClick={()=>void loginWithRedirect({appState:{returnTo:'#app'}}).catch(()=>setError('signin'))}>{t('Already have an account? Sign in','¿Ya tienes cuenta? Inicia sesión')}<ArrowRight size={15} aria-hidden="true"/></button><p className="coordinator-access-caption"><ShieldCheck size={15} aria-hidden="true"/>{t('Your application is reviewed before coordinator access is enabled.','Revisamos tu solicitud antes de activar el acceso como coordinador.')}</p></section>);
 return <main className={`institution-shell coordinator-workspace coordinator-registration${isAuthenticated?' coordinator-registration-signed-in':''}`}>
  <nav className="coordinator-registration-nav" aria-label={t('Navigation','Navegación')}>
   <span className="coordinator-brand-group"><a className="coordinator-registration-brand" href="#" aria-label={t('Origen home','Inicio de Origen')}><span aria-hidden="true">○</span> origen.</a><a className="coordinator-home-link" href="#"><ArrowLeft size={14} aria-hidden="true"/>{t('Back to home','Volver al inicio')}</a></span>
   <div><a className="coordinator-workspace-link" href="#coordinators">{t('Coordinator workspace','Espacio del coordinador')} <ArrowRight size={15} aria-hidden="true"/></a><button className="coordinator-language" onClick={()=>{setEs(!es);localStorage.setItem('origen.language',es?'en':'es');}}>{es?'English':'Español'}</button>{isAuthenticated&&<button className="coordinator-language" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>{t('Log out','Cerrar sesión')}</button>}</div>
  </nav>
  {!isLoading&&!isAuthenticated&&<div className="coordinator-signup-top">{signupCard}<aside className="coordinator-registration-help" aria-label={t('Getting ready','Prepárate')}>
    <section className="coordinator-organization-help"><span className="coordinator-help-icon"><Building2 size={22} aria-hidden="true"/></span><h2>{t('How your organization fits in','Cómo participa tu organización')}</h2><p>{t('Join your team or register your organization during signup.','Únete a tu equipo o registra tu organización durante el registro.')}</p><details><summary>{t('My organization is already on Origen','Mi organización ya está en Origen')}</summary><p>{t('Ask its owner to invite you to the team using your sign-in email. We review your affiliation before enabling coordinator access.','Pide al propietario que te invite al equipo con tu correo de inicio de sesión. Revisamos tu afiliación antes de activar el acceso como coordinador.')}</p></details><details><summary>{t('My organization is new to Origen','Mi organización es nueva en Origen')}</summary><p>{t('Choose Register my organization on the signup form. Confirm you’re authorized, add a short description, and complete two-step verification. We’ll register it and send it for review from this page.','Elige Registrar mi organización en el formulario. Confirma que tienes autorización, agrega una breve descripción y completa la verificación en dos pasos. La registraremos y enviaremos a revisión desde esta página.')}</p></details></section>
    <CoordinatorReadiness es={es} compact/>
   </aside></div>}
  {!isAuthenticated&&<>
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
  </>}
  <div hidden={!isAuthenticated&&!isLoading&&!error} className={`coordinator-registration-layout${!isAuthenticated?' coordinator-public-details':''}`}>
   <section className="coordinator-registration-main" hidden={!isLoading&&!isAuthenticated&&!error} aria-label={t('Your coordinator application','Tu solicitud como coordinador')}>
   {isLoading?<div className="coordinator-card"><p role="status">{t('Loading…','Cargando…')}</p></div>:!isAuthenticated?null:<>
    <div className="coordinator-application-controls"><span>{t('YOUR APPLICATION','TU SOLICITUD')}</span><button className="text-button" disabled={busy||organizationBusy} onClick={()=>setRetry(n=>n+1)}>{t('Refresh status','Actualizar estado')}</button></div>
    {busy&&<p role="status">{t('Checking your application…','Consultando tu solicitud…')}</p>}
    {application?<section className="coordinator-card coordinator-application-status" aria-labelledby="application-status"><span className={'coordinator-status-pill '+application.status}>{application.status==='pending'?t('In review','En revisión'):application.status==='approved'?t('Approved','Aprobada'):t('Review complete','Revisión completada')}</span><h2 id="application-status">{application.status==='pending'?t('Your application is awaiting review','Tu solicitud está pendiente de revisión'):application.status==='approved'?t('Your application was approved','Tu solicitud fue aprobada'):t('Your application was not approved','Tu solicitud no fue aprobada')}</h2><div className="coordinator-applicant"><strong>{application.displayName}</strong><span>{application.organizationName} · {application.jobRole}</span><span>{application.email}</span></div>
     {application.reviewNote&&<div className="coordinator-review-message"><span>{t('From the Origen team','Del equipo de Origen')}</span><p>{application.reviewNote}</p></div>}
     {application.status==='pending'&&<p>{organization||organizationSignup?t('We’ll review your organization and coordinator application before enabling access. Return here to check your status.','Revisaremos tu organización y tu solicitud como coordinador antes de activar el acceso. Vuelve aquí para consultar tu estado.'):t('The Origen team will verify your affiliation. If you’re joining an existing organization, ask its owner to invite you using your sign-in email. Return here to check your status.','El equipo de Origen verificará tu afiliación. Si te unes a una organización existente, pide al propietario una invitación con tu correo de inicio de sesión. Vuelve aquí para consultar tu estado.')}</p>}
     {application.status==='approved'?<><p>{t('Open your workspace to verify your sign-in and create your connection code. Access also depends on your organization and current staff permissions.','Abre tu espacio para verificar tu inicio de sesión y crear tu código de conexión. El acceso también depende de tu organización y tus permisos actuales.')}</p><a className="button primary" href="#coordinators">{t('Open coordinator workspace','Abrir espacio del coordinador')}<ArrowRight size={17} aria-hidden="true"/></a></>:<button className="text-button" disabled={busy||organizationBusy} onClick={()=>{if(window.confirm(t('Withdraw this application? This does not remove an organization you registered.','¿Retirar esta solicitud? Esto no elimina una organización que hayas registrado.')))void submit(true);}}>{t('Withdraw application','Retirar solicitud')}</button>}
    </section>:application===null&&<form className="coordinator-card coordinator-registration-form" onSubmit={e=>{e.preventDefault();void submit();}}>
     <span className="coordinator-card-eyebrow">{t('LET’S GET TO KNOW YOU','CUÉNTANOS SOBRE TI')}</span><h1>{t('Tell us about your work','Cuéntanos sobre tu trabajo')}</h1>
     <p className="coordinator-form-intro">{t('Share a few details so we can review your role and organization.','Comparte algunos datos para que podamos revisar tu función y organización.')}</p>
     <div className="coordinator-name-fields"><label>{t('First name','Nombre')}<input required autoComplete="given-name" maxLength={100} value={firstName} onChange={e=>setFirstName(e.target.value)} aria-describedby="coordinator-name-visibility"/></label><label>{t('Last name','Apellido')}<input required autoComplete="family-name" maxLength={100} value={lastName} onChange={e=>setLastName(e.target.value)} aria-describedby="coordinator-name-visibility"/></label></div><p id="coordinator-name-visibility" className="coordinator-name-hint">{t('Students will see your first and last name when connecting with you and reading your guidance.','Los estudiantes verán tu nombre y apellido al conectarse contigo y leer tu orientación.')}</p>
     <label>{t('Organization name','Nombre de la organización')}<input required autoComplete="organization" maxLength={200} value={organizationName} onChange={e=>setOrganization(e.target.value)}/></label>
     <label>{t('Organization website (optional)','Sitio web de la organización (opcional)')}<input type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="example.org" maxLength={2000} value={organizationWebsite} onChange={e=>setWebsite(e.target.value)}/></label>
     <label>{t('Your role or job title','Tu función o cargo')}<input required autoComplete="organization-title" maxLength={200} value={jobRole} onChange={e=>setRole(e.target.value)}/></label>
     <fieldset className="coordinator-organization-choice" disabled={busy}><legend>{t('Your organization','Tu organización')}</legend><label><input type="radio" name="organization-mode" value="join" checked={organizationMode==='join'} onChange={()=>setOrganizationMode('join')}/><span>{t('Join an existing organization','Unirme a una organización existente')}</span></label>{!organizationSignup&&<label><input type="radio" name="organization-mode" value="new" checked={organizationMode==='new'} onChange={()=>setOrganizationMode('new')}/><span>{t('Register my organization','Registrar mi organización')}</span></label>}</fieldset>
     {organizationMode==='new'?<div className="coordinator-new-organization">{organizationFields}</div>:<p className="coordinator-form-intro">{t('Ask your organization’s owner to invite you using your sign-in email.','Pide al propietario de tu organización una invitación con tu correo de inicio de sesión.')}</p>}
     <p className="coordinator-access-caption">{organizationMode==='new'?t('We’ll register your organization here and send it for review. Two-step verification is required. Registration does not give access to student information.','Registraremos tu organización aquí y la enviaremos a revisión. Se requiere verificación en dos pasos. Registrarse no da acceso a información de estudiantes.'):t('Your verified sign-in email will be included. Origen reviews your application before enabling access.','Incluiremos tu correo de inicio de sesión verificado. Origen revisa tu solicitud antes de activar el acceso.')}</p>
     <button className="button primary" disabled={busy||organizationBusy}>{organizationMode==='new'?t('Register and apply','Registrar y solicitar acceso'):t('Submit for review','Enviar para revisión')}<ArrowRight size={17} aria-hidden="true"/></button>
    </form>}
    {application&&organization&&<SignupOrganizationStatus key={organization.id+':'+organization.revision} organization={organization} busy={busy||organizationBusy} t={t} onSubmit={page=>void resubmitOrganization(page)}/>}
    {application?.status==='pending'&&!organization&&organizationSignup&&<section className="coordinator-card coordinator-organization-progress" aria-label={t('Organization registration','Registro de organización')}>
     <h2>{t('Finish registering your organization','Termina de registrar tu organización')}</h2><p>{organizationSignup.registration.page.name}</p>
     <p>{t('Your application and organization details are saved to your account. Registration resumes after verification, even in a new tab.','Tu solicitud y los datos de tu organización están guardados en tu cuenta. El registro continúa después de verificarte, incluso en otra pestaña.')}</p>
     {!staffVerificationErrors.includes(organizationError)&&<button className="button primary" disabled={busy||organizationBusy} onClick={()=>void finishOrganization()}>{organizationBusy?t('Registering…','Registrando…'):t('Complete organization registration','Completar registro de organización')}</button>}
    </section>}
    {application&&staffVerificationErrors.includes(organizationError)&&<StaffVerification es={es} returnTo="#coordinator-register" requireMfa={organizationError==='staff_mfa_required'||organizationError==='mfa_required'} beforeVerify={()=>{if(!application.organizationRegistration&&description.trim()&&authorized)organizationStorage.setItem(organizationKey,JSON.stringify({registration:signupOrganization(application,description,application.id,true)}));}}/>}
    {application?.status==='pending'&&organization===null&&!organizationSignup&&!staffVerificationErrors.includes(organizationError)&&!['organization_recovery_ambiguous','organization_ownership_changed','staff_access_revoked'].includes(organizationError)&&<details open={!!organizationError} className="coordinator-card coordinator-inline-organization"><summary>{t('Need to register your organization? Do it here.','¿Necesitas registrar tu organización? Hazlo aquí.')}</summary><form className="coordinator-registration-form" onSubmit={e=>{e.preventDefault();void startOrganization(application);}}><p>{application.organizationName}</p>{organizationFields}<p>{t('Two-step verification is required. Origen reviews the organization before enabling access.','Se requiere verificación en dos pasos. Origen revisa la organización antes de activar el acceso.')}</p><button className="button primary" disabled={busy||organizationBusy}>{t('Register my organization','Registrar mi organización')}</button></form></details>}
    {['organization_recovery_ambiguous','organization_ownership_changed'].includes(organizationError)&&<p>{t('Review your existing organizations before continuing.','Revisa tus organizaciones existentes antes de continuar.')} <a href="#institutions">{t('Open organizations','Abrir organizaciones')}</a></p>}
    {organizationError&&!staffVerificationErrors.includes(organizationError)&&<p role="alert" className="institution-error">{['organization_details_required','invalid_coordinator_request'].includes(organizationError)?t('Enter a description and confirm you’re authorized to register this organization, then try again.','Escribe una descripción y confirma que tienes autorización para registrar esta organización; luego intenta de nuevo.'):organizationError==='staff_access_revoked'?t('Your staff access is suspended. Contact Origen before continuing.','Tu acceso como personal está suspendido. Contacta a Origen antes de continuar.'):t('Your application is saved. We couldn’t finish saving or registering your organization. Your entries are still here; please try again.','Tu solicitud está guardada. No pudimos terminar de guardar o registrar tu organización. Los datos siguen aquí; intenta de nuevo.')}</p>}
   </>}
   {isAuthenticated&&staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinator-register" requireMfa={error==='mfa_required'||error==='staff_mfa_required'} beforeVerify={preserveApplicationDraft}/>:error&&<p className="institution-error" role="alert">{applicationError(error,t)}</p>}
   </section>

  </div>
  {!isAuthenticated&&<footer className="coordinator-registration-footer"><span className="coordinator-registration-brand">origen.</span><p>{t('Different paths. A future that fits.','Caminos distintos. Un futuro a tu medida.')}</p><a href="#privacy">{t('Data privacy','Privacidad de datos')}</a></footer>}
 </main>;
}

function SignupOrganizationStatus({organization,busy,t,onSubmit}:{organization:SignupOrganization;busy:boolean;t:Translate;onSubmit:(page:SignupOrganization['page'])=>void}){
 const [page,setPage]=useState(organization.page);
 const editable=!organization.archivedAt&&['draft','changes-requested'].includes(organization.status);
 return <section className="coordinator-card coordinator-organization-progress" aria-label={t('Organization registration','Registro de organización')}>
  <h2>{organization.archivedAt?t('Organization archived','Organización archivada'):organization.status==='changes-requested'?t('Your organization needs changes','Tu organización necesita cambios'):organization.status==='draft'?t('Finish your organization submission','Completa el envío de tu organización'):t('Organization registered','Organización registrada')}</h2>
  <p>{organization.page.name}</p>
  {!editable&&!organization.archivedAt&&<p role="status">{organization.status==='published'?t('Your organization page is published. Coordinator access requires a separate approval.','La página de tu organización está publicada. El acceso como coordinador requiere otra aprobación.'):t('Your organization has been sent for review. Coordinator access still needs Origen’s approval.','Tu organización se envió a revisión. El acceso como coordinador todavía requiere aprobación de Origen.')}</p>}
  {organization.reviews?.filter(review=>review.action==='request-changes'&&review.revision===organization.revision).map((review,index)=><div className="coordinator-review-message" key={index}><strong>{t('From the Origen team','Del equipo de Origen')}</strong><p>{review.note}</p></div>)}
  {editable&&<form className="coordinator-registration-form" onSubmit={e=>{e.preventDefault();onSubmit(page);}}>
   <label>{t('Organization name','Nombre de la organización')}<input required maxLength={200} value={page.name} onChange={e=>setPage({...page,name:e.target.value})}/></label>
   <label>{t('Organization website (optional)','Sitio web de la organización (opcional)')}<input type="text" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="example.org" maxLength={2000} value={page.website} onChange={e=>setPage({...page,website:e.target.value})}/></label>
   <label>{t('What does your organization do?','¿Qué hace tu organización?')}<textarea required maxLength={5000} rows={3} value={page.description} onChange={e=>setPage({...page,description:e.target.value})}/></label>
   <button className="button primary" disabled={busy}>{t('Save and send for review','Guardar y enviar a revisión')}</button>
  </form>}
  {organization.archivedAt&&<a href="#institutions">{t('Manage organization','Administrar organización')}</a>}
 </section>;
}

const requestedOrganizationName=(item:Application)=>item.registeredOrganizationName||item.organizationName;

type Request=(input:unknown)=>Promise<{applications?:Application[];organizations?:{id:string;name:string}[]}>;
export function CoordinatorApplications({request,t,onError,streamlined=false}:{request:Request;t:Translate;onError:(error:string)=>void;streamlined?:boolean}){
 const [items,setItems]=useState<Application[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[after,setAfter]=useState(''),[next,setNext]=useState('');
 const [selected,setSelected]=useState(''),[note,setNote]=useState(''),[institution,setInstitution]=useState('');
 const [organizations,setOrganizations]=useState<{id:string;name:string}[]>([]),[orgBusy,setOrgBusy]=useState(false),[search,setSearch]=useState(''),[orgAfter,setOrgAfter]=useState(''),[orgNext,setOrgNext]=useState('');
 const [orgFailed,setOrgFailed]=useState(false);
 const [reviewError,setReviewError]=useState(''),[reviewNotice,setReviewNotice]=useState(''),[reviewing,setReviewing]=useState<'approve'|'decline'|null>(null);
 const reviewPending=useRef(false);
 useEffect(()=>{setReviewError('');},[selected]);
 const orgVersion=useRef(0);useEffect(()=>()=>{orgVersion.current++;},[]);
 const version=useRef(0);useEffect(()=>()=>{version.current++;},[]);
 async function load(cursor=''){
  const current=++version.current;orgVersion.current++;setOrgBusy(false);setBusy(true);onError('');
  try{const data=await loadCoordinatorApplicationPage(request,cursor);if(current!==version.current)return;const list=data.applications;setItems(list.slice(0,50));setNext(list.length>50?list[49].id:'');setAfter(data.after);setLoaded(true);setSearch(streamlined&&list[0]?requestedOrganizationName(list[0]):'');setOrgAfter('');setOrgNext('');setSelected(streamlined?list[0]?.id||'':'');setNote('');setInstitution('');if(streamlined&&list[0])void loadOrganizations(list[0].id,requestedOrganizationName(list[0]),'',requestedOrganizationName(list[0]),list[0].registeredInstitutionId);}
  catch(e){if(current===version.current)onError(e instanceof Error?e.message:'unavailable');}finally{if(current===version.current)setBusy(false);}
 }
 async function loadOrganizations(id:string,query='',cursor='',requestedName=items.find(item=>item.id===id)?.registeredOrganizationName||items.find(item=>item.id===id)?.organizationName||'',registeredId=items.find(item=>item.id===id)?.registeredInstitutionId){
  const current=++orgVersion.current;setOrgBusy(true);setOrgFailed(false);setInstitution('');setOrganizations([]);setOrgNext('');onError('');
  try{const data=await request({action:'application-organizations',id,search:query.trim(),after:cursor});if(current!==orgVersion.current)return;const list=data.organizations||[];setOrganizations(list.slice(0,50));setInstitution(defaultCoordinatorOrganization(requestedName,list,registeredId));setOrgNext(list.length>50?list[49].id:'');setOrgAfter(cursor);}
  catch(e){if(current===orgVersion.current){setOrgFailed(true);onError(e instanceof Error?e.message:'unavailable');}}finally{if(current===orgVersion.current)setOrgBusy(false);}
 }
 async function review(approve:boolean){
  if(reviewPending.current||busy||orgBusy||!selected||!note.trim()||approve&&!institution)return;
  const current=version.current,name=items.find(item=>item.id===selected)?.displayName||t('The applicant','La persona');
  reviewPending.current=true;setReviewing(approve?'approve':'decline');setBusy(true);onError('');setReviewError('');setReviewNotice('');
  try{
   await request({action:approve?'approve-application':'decline-application',id:selected,institutionId:institution,reviewNote:note});
   if(current!==version.current)return;
   setReviewNotice(approve?t(`Coordinator access approved for ${name}.`, `Acceso de coordinador aprobado para ${name}.`):t(`Application declined for ${name}.`, `Solicitud rechazada para ${name}.`));
   setItems(list=>list.filter(item=>item.id!==selected));setSelected('');setInstitution('');setNote('');
   await load(after);
  }
  catch(e){if(current===version.current){const code=e instanceof Error?e.message:'unavailable';setReviewError(code);if(staffVerificationErrors.includes(code))onError(code);}}
  finally{reviewPending.current=false;setReviewing(null);if(current===version.current)setBusy(false);}
 }
 useEffect(()=>{if(streamlined)void load();},[streamlined,request]);
 const applicant=items.find(item=>item.id===selected);
 const requestedPending=!!applicant&&!orgBusy&&!orgFailed&&!organizations.length&&!orgNext&&search.trim().toLocaleLowerCase()===requestedOrganizationName(applicant).trim().toLocaleLowerCase();
 const reviewFeedback=<>{reviewing&&<p role="status" className="approval-review-feedback">{reviewing==='approve'?t('Approving coordinator access…','Aprobando el acceso de coordinador…'):t('Saving review decision…','Guardando la decisión…')}</p>}{reviewError&&<p role="alert" className="institution-error approval-review-feedback">{staffVerificationErrors.includes(reviewError)?t('Sign in again using the verification message above, then retry. Your message is still here.','Inicia sesión de nuevo con el aviso de verificación de arriba y vuelve a intentar. Tu mensaje sigue aquí.'):reviewError==='invalid_coordinator_request'?t('The review could not be saved. Use a message of 1–1,000 characters, then try again. Your message is still here.','No se pudo guardar la revisión. Usa un mensaje de 1 a 1,000 caracteres y vuelve a intentar. Tu mensaje sigue aquí.'):applicationError(reviewError,t)}</p>}</>;
 if(streamlined)return <section className="org-review" aria-label={t('Coordinator applications','Solicitudes de coordinadores')}>
  <div className="approval-section-intro"><div><h2>{t('Coordinator applications','Solicitudes de coordinadores')}</h2><p>{t('Review the applicant and connect them to an approved organization.','Revisa la solicitud y vincula a la persona con una organización aprobada.')}</p></div><button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh applications','Actualizar solicitudes')}</button></div>
  {reviewNotice&&<p className="approval-notice" role="status">{reviewNotice}</p>}
  <div className="org-review-workspace"><aside className="org-review-list" aria-label={t('Pending coordinators','Coordinadores pendientes')}><p className="approval-help">{items.length}{next?'+':''} {t('pending on this page','pendientes en esta página')}</p><div className="org-review-rows">{items.map(item=><button key={item.id} className="org-review-row" disabled={busy} aria-current={selected===item.id?'true':undefined} onClick={()=>{setSelected(item.id);setNote('');setSearch(requestedOrganizationName(item));setOrgAfter('');void loadOrganizations(item.id,requestedOrganizationName(item));}}><span className="org-review-row-name"><strong>{item.displayName}</strong></span><span className="org-review-row-person">{item.organizationName}</span><span className="org-review-badge">{t('Awaiting review','Pendiente de revisión')}</span></button>)}</div>{!items.length&&<p className="org-review-no-results" role="status">{loaded?t('No pending applications.','No hay solicitudes pendientes.'):t('Loading applications…','Cargando solicitudes…')}</p>}<div className="approval-pagination">{after&&<button disabled={busy} onClick={()=>void load()}>{t('First page','Primera página')}</button>}{next&&<button disabled={busy} onClick={()=>void load(next)}>{t('Next page','Página siguiente')}</button>}</div></aside>
  {applicant?<article className="org-review-detail"><header><span className="org-review-badge">{t('Awaiting review','Pendiente de revisión')}</span><h2>{applicant.displayName}</h2><p className="approval-help">{applicant.organizationName} · {applicant.jobRole}</p></header><section className="org-review-info"><h3>{t('Application details','Datos de la solicitud')}</h3><dl><div><dt>{t('Email','Correo electrónico')}</dt><dd>{applicant.email}</dd></div><div><dt>{t('Submitted','Enviada')}</dt><dd>{new Date(applicant.createdAt).toLocaleDateString(t('en','es'),{month:'short',day:'numeric',year:'numeric'})}</dd></div><div><dt>{t('Organization website','Sitio de la organización')}</dt><dd>{applicant.organizationWebsite||t('Not provided','No proporcionado')}</dd></div></dl>{applicant.registeredOrganizationName&&applicant.registeredOrganizationName!==applicant.organizationName&&<p className="approval-help">{t("Current registered organization: ","Organización registrada actual: ")}{applicant.registeredOrganizationName}</p>}</section><p className="approval-help">{t('The organization must have confirmed affiliation and coordinator access enabled. The applicant must also have accepted its membership invitation.','La organización debe tener afiliación confirmada y acceso habilitado. La persona también debe haber aceptado su invitación.')}</p>
  {selected&&<form className="approval-application-form" onSubmit={e=>{e.preventDefault();void review(true);}}><h3>{t('Review decision','Decisión de revisión')}</h3>
   <label>{t('Find an organization','Buscar una organización')}<input maxLength={200} value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <button type="button" className="button outline" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search)}>{t('Search organizations','Buscar organizaciones')}</button>
   <label>{t('Organization','Organización')}<select required disabled={busy||orgBusy} value={institution} onChange={e=>setInstitution(e.target.value)}><option value="">{requestedPending?`${requestedOrganizationName(applicant!)} — ${t('pending eligibility','requisitos pendientes')}`:t('Choose an organization','Elige una organización')}</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   {!orgBusy&&!orgFailed&&!organizations.length&&<p role="status">{requestedPending?t(`${requestedOrganizationName(applicant!)} is not eligible yet. Confirm its affiliation, enable coordinator access, and ensure the applicant has joined the organization.`,`${requestedOrganizationName(applicant!)} aún no cumple los requisitos. Confirma su afiliación, habilita el acceso de coordinadores y verifica que la persona se haya unido a la organización.`):t('No eligible organizations found for this search.','No se encontraron organizaciones elegibles para esta búsqueda.')}</p>}
   <div className="institution-actions">{orgAfter&&<button type="button" className="text-button" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search)}>{t('First organizations','Primeras organizaciones')}</button>}{orgNext&&<button type="button" className="text-button" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search,orgNext)}>{t('More organizations','Más organizaciones')}</button>}</div>
   <label>{t('Message the applicant will see','Mensaje que verá la persona')}<textarea required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   {reviewFeedback}<div className="institution-actions"><button type="submit" className="button primary" disabled={busy||orgBusy||!institution||!note.trim()}>{reviewing==='approve'?t('Approving…','Aprobando…'):t('Approve coordinator access','Aprobar acceso de coordinador')}</button><button type="button" className="button outline" disabled={busy||orgBusy||!note.trim()} onClick={()=>void review(false)}>{reviewing==='decline'?t('Saving…','Guardando…'):t('Decline application','Rechazar solicitud')}</button></div>
  </form>}
  </article>:<div className="org-review-empty"><h2>{loaded?t('All caught up','Todo al día'):t('Loading…','Cargando…')}</h2><p>{t('New coordinator applications will appear here.','Las nuevas solicitudes aparecerán aquí.')}</p></div>}</div></section>;
 return <section className="coordinator-card"><h2>{t('Coordinator applications','Solicitudes de coordinadores')}</h2>
  {reviewNotice&&<p className="approval-notice" role="status">{reviewNotice}</p>}
  <p>{t('Verify the applicant’s affiliation independently. Approve the organization’s pilot and have its owner invite the applicant first. Approving below enables coordinator access only after they accept that invitation.','Verifica la afiliación de forma independiente. Aprueba el piloto de la organización y pide al propietario que invite a la persona primero. La aprobación aquí activa el acceso solo después de que acepte esa invitación.')}</p>
  <button className="button outline" disabled={busy} onClick={()=>void load()}>{t('Refresh applications','Actualizar solicitudes')}</button>
  {loaded&&!items.length&&<p role="status">{t('No pending applications on this page.','No hay solicitudes pendientes en esta página.')}</p>}
  <ul className="coordinator-members">{items.map(item=><li key={item.id}><div><strong>{item.displayName}</strong><p>{item.organizationName} · {item.jobRole}</p><p>{item.email}</p><p>{item.organizationWebsite}</p></div><button className="button outline" disabled={busy} onClick={()=>{setSelected(item.id);setNote('');setSearch(requestedOrganizationName(item));setOrgAfter('');void loadOrganizations(item.id,requestedOrganizationName(item));}}>{t('Review','Revisar')}</button></li>)}</ul>
  {selected&&<form className="coordinator-registration-form" onSubmit={e=>{e.preventDefault();void review(true);}}><h3>{t('Review application','Revisar solicitud')}: {items.find(i=>i.id===selected)?.displayName}</h3>
   <label>{t('Find an organization','Buscar una organización')}<input maxLength={200} value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <button type="button" className="button outline" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search)}>{t('Search organizations','Buscar organizaciones')}</button>
   <label>{t('Organization','Organización')}<select required disabled={busy||orgBusy} value={institution} onChange={e=>setInstitution(e.target.value)}><option value="">{requestedPending?`${requestedOrganizationName(applicant!)} — ${t('pending eligibility','requisitos pendientes')}`:t('Choose an organization','Elige una organización')}</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   {!orgBusy&&!orgFailed&&!organizations.length&&<p role="status">{requestedPending?t(`${requestedOrganizationName(applicant!)} is not eligible yet. Confirm its affiliation, enable coordinator access, and ensure the applicant has joined the organization.`,`${requestedOrganizationName(applicant!)} aún no cumple los requisitos. Confirma su afiliación, habilita el acceso de coordinadores y verifica que la persona se haya unido a la organización.`):t('No eligible organizations found for this search.','No se encontraron organizaciones elegibles para esta búsqueda.')}</p>}
   <div className="institution-actions">{orgAfter&&<button type="button" className="text-button" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search)}>{t('First organizations','Primeras organizaciones')}</button>}{orgNext&&<button type="button" className="text-button" disabled={busy||orgBusy} onClick={()=>void loadOrganizations(selected,search,orgNext)}>{t('More organizations','Más organizaciones')}</button>}</div>
   <label>{t('Message the applicant will see','Mensaje que verá la persona')}<textarea required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   {reviewFeedback}<div className="institution-actions"><button type="submit" className="button primary" disabled={busy||orgBusy||!institution||!note.trim()}>{reviewing==='approve'?t('Approving…','Aprobando…'):t('Approve coordinator access','Aprobar acceso de coordinador')}</button><button type="button" className="button outline" disabled={busy||orgBusy||!note.trim()} onClick={()=>void review(false)}>{reviewing==='decline'?t('Saving…','Guardando…'):t('Decline application','Rechazar solicitud')}</button></div>
  </form>}
  <div className="institution-actions">{after&&<button className="text-button" disabled={busy} onClick={()=>void load()}>{t('First page','Primera página')}</button>}{next&&<button className="text-button" disabled={busy} onClick={()=>void load(next)}>{t('Next page','Página siguiente')}</button>}</div>
 </section>;
}
