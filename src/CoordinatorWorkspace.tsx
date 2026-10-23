import CoordinatorNotifications,{CoordinatorOperations,type NoticeDestination} from './CoordinatorNotifications';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import StaffVerification,{staffVerificationErrors,getStaffAccessToken} from './StaffVerification';
import CoordinatorInbox from './CoordinatorInbox';
import CoordinatorBinders from './CoordinatorBinders';
import InstitutionTeam from './InstitutionTeam';
import './InstitutionPortal.css';
import './CoordinatorWorkspace.css';
import {CoordinatorApplications,applicationError} from './CoordinatorRegistration';

type Organization={id:string;name:string;role?:string;pilotStatus:string;verificationStatus:string;profile?:{id:string;displayName:string;status:string}};
type Profile={displayName:string;organizationName:string;code?:{expiresAt:string}};
type Member={subject:string;name:string;role:string;coordinatorStatus:string};
type Overview={organizations:Organization[];canApprove:boolean};
export default function CoordinatorWorkspace(){
 const {isAuthenticated,isLoading,user,getAccessTokenSilently,loginWithRedirect,logout}=useAuth0();
 const [es,setEs]=useState(localStorage.getItem('origen.language')==='es');
 const t=(en:string,sp:string)=>es?sp:en;
 const [overview,setOverview]=useState<Overview>(),[selected,setSelected]=useState(''),[profile,setProfile]=useState<Profile>(),[members,setMembers]=useState<Member[]>([]);
 const [name,setName]=useState(''),[code,setCode]=useState(''),[qr,setQr]=useState(''),[expires,setExpires]=useState(''),[team,setTeam]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [noticeTarget,setNoticeTarget]=useState<(NoticeDestination & {sequence:number})>();
 const generation=useRef(0);
 const request=useCallback(async(input:unknown,institution=false,binders=false,feedback=false)=>{
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  const response=await apiFetch(feedback?'/api/coordinator-feedback':binders?'/api/coordinator-binders':institution?'/api/institutions':'/api/coordinator-access',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'coordinator_access_unavailable');return data;
 },[getAccessTokenSilently]);
 const load=useCallback(async(id='')=>{
  const version=++generation.current;setBusy(true);setError('');setCode('');setQr('');setProfile(undefined);setMembers([]);
  try{
   const next=await request({action:'overview'}) as Overview;
   if(version!==generation.current)return;
   setOverview(next);const org=next.organizations.find(o=>o.id===id)||next.organizations[0];setSelected(org?.id||'');
   if(org?.role==='owner'){
    const data=await request({action:'team',id:org.id});if(version!==generation.current)return;setMembers(data.members);
   }
   if(org?.pilotStatus==='active'&&org.profile?.status==='active'){
    const data=await request({action:'profile',id:org.id});if(version!==generation.current)return;setProfile(data.profile);setName(data.profile.displayName);
   }
  }catch(e){if(version===generation.current){setOverview(undefined);setError(e instanceof Error?e.message:'coordinator_access_unavailable');}}
  finally{if(version===generation.current)setBusy(false);}
 },[request]);
 useEffect(()=>{if(isAuthenticated)void load();return()=>{generation.current++;};},[isAuthenticated,user?.sub,load]);
 const org=overview?.organizations.find(o=>o.id===selected);
 async function change(action:string,extra:Record<string,string>={}){
  setBusy(true);setError('');setNotice('');setCode('');setQr('');
  const version=generation.current;
  try{
   const data=await request({action,id:selected,...extra});if(version!==generation.current)return;
   if(data.code){
    setCode(data.code);setExpires(data.expiresAt);setProfile(p=>p?{...p,code:{expiresAt:data.expiresAt}}:p);
    const QRCode=await import('qrcode');const image=await QRCode.toDataURL(`${window.location.origin}/#connect/${data.code}`,{width:240,margin:2});if(version!==generation.current)return;setQr(image);
   }else await load(selected);
   setNotice(t('Saved.','Guardado.'));
  }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'coordinator_access_unavailable');}
  finally{if(version===generation.current)setBusy(false);}
 }
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice(t('Copied.','Copiado.'));}catch{setNotice(t('Select and copy the code below.','Selecciona y copia el código de abajo.'));}}
 const messages:Record<string,string>={
  coordinator_sharing_unavailable:t('Coordinator accounts are not available yet.','Las cuentas de coordinadores aún no están disponibles.'),
  coordinator_access_denied:t('Your account does not have coordinator access. Ask your organization owner to enable it.','Tu cuenta no tiene acceso de coordinador. Pide al propietario de tu organización que lo active.'),
  verified_email_required:t('Verify your sign-in email before opening this workspace.','Verifica tu correo de inicio de sesión antes de abrir este espacio.'),
  invitation_email_required:t('We could not verify your sign-in email. Sign in again.','No pudimos verificar tu correo. Inicia sesión de nuevo.'),
  independent_review_required:t('Pilot approval requires an Origen administrator outside this organization.','La aprobación requiere un administrador de Origen ajeno a esta organización.'),
  organization_verification_required:t('Confirm the organization’s affiliation in Institutions before approving its pilot. Publishing a page is not required.','Confirma la afiliación en Instituciones antes de aprobar el piloto. No es necesario publicar una página.'),
  staff_access_revoked:t('Your staff access has been suspended. Contact your organization.','Tu acceso de personal se ha suspendido. Contacta a tu organización.'),
 };
 if(isLoading)return <main className="institution-shell"><p role="status">{t('Opening your workspace…','Abriendo tu espacio…')}</p></main>;
 if(!isAuthenticated)return <main className="institution-shell"><h1>{t('Coordinator workspace','Espacio del coordinador')}</h1><button className="button primary" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinators'}})}>{t('Sign in','Iniciar sesión')}</button></main>;
 return <main className="institution-shell coordinator-workspace">
  <nav className="institution-actions" aria-label={t('Switch workspace','Cambiar espacio')}><a href="#app">← {t('Workspaces','Espacios')}</a><a href="#institutions">{t('Institutions','Instituciones')}</a><a href="#personal">{t('Personal binder','Carpeta personal')}</a><button className="text-button" onClick={()=>setEs(!es)}>{es?'English':'Español'}</button><button className="text-button" onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}})}>{t('Log out','Cerrar sesión')}</button></nav>
  <div className="eyebrow">{t('A LITTLE GUIDANCE. A NEXT STEP.','ORIENTACIÓN PARA EL SIGUIENTE PASO.')}</div>
  <h1>{t('Your coordinator workspace','Tu espacio como coordinador')}</h1>
  <a href="#coordinator-register">{t('Apply or check your application','Solicitar acceso o consultar tu solicitud')}</a>
  <p>{t('Review the pages students choose to share, respond to connection requests, and manage your profile.','Revisa las páginas que los estudiantes eligen compartir, responde a solicitudes de conexión y administra tu perfil.')}</p>
  {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators" requireMfa={error==='staff_mfa_required'||error==='mfa_required'}/>:<p className="institution-error" role="alert">{messages[error]||applicationError(error,t)}</p>)}
  <button className="text-button" disabled={busy} onClick={()=>void load(selected)}>{t('Refresh workspace','Actualizar espacio')}</button>
  {overview&&<><label className="coordinator-selector">{t('Organization','Organización')}<select value={selected} disabled={busy} onChange={e=>{setTeam(false);setNotice('');void load(e.target.value);}}>{overview.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
   {org&&<section className="coordinator-card"><h2>{org.name}</h2><p>{org.pilotStatus==='active'?t('Coordinator pilot approved','Piloto de coordinadores aprobado'):org.pilotStatus==='suspended'?t('Coordinator pilot suspended','Piloto de coordinadores suspendido'):t('Awaiting coordinator pilot approval','Esperando aprobación del piloto')}</p>
    {overview.canApprove&&<div className="institution-actions"><button className="button primary" disabled={busy||org.pilotStatus==='active'||org.verificationStatus!=='verified'||!!org.role} onClick={()=>void change('approve-organization')}>{t('Approve pilot','Aprobar piloto')}</button><button className="button outline" disabled={busy||org.pilotStatus!=='active'} onClick={()=>{if(window.confirm(t('Suspend this organization’s coordinator access? Existing connections will need new approval.','¿Suspender el acceso de coordinadores? Las conexiones existentes necesitarán nueva aprobación.')))void change('suspend-organization');}}>{t('Suspend pilot','Suspender piloto')}</button><a href="#institutions">{t('Review organization affiliation','Revisar afiliación')}</a></div>}
   </section>}
   {profile&&<section className="coordinator-card"><div className="eyebrow">{t('YOUR PROFILE','TU PERFIL')}</div><h2>{profile.displayName}</h2><p>{profile.organizationName}</p><form onSubmit={e=>{e.preventDefault();void change('save-profile',{displayName:name});}}><label>{t('Name students will see','Nombre que verán los estudiantes')}<input value={name} maxLength={100} required onChange={e=>setName(e.target.value)}/></label><button className="button outline" disabled={busy}>{t('Save name','Guardar nombre')}</button></form>
    <h3>{t('Your connection code','Tu código de conexión')}</h3><p>{t('A code helps students find you. It never grants access to their binder.','Un código ayuda a los estudiantes a encontrarte. Nunca da acceso a su carpeta.')}</p>
    {profile.code&&!code&&<p>{t('Your code is active until','Tu código está activo hasta')} {new Date(profile.code.expiresAt).toLocaleDateString(es?'es':'en')}. {t('For your privacy, it can only be shown when created. Replace it if you didn’t save it.','Por privacidad, solo se muestra al crearlo. Reemplázalo si no lo guardaste.')}</p>}
    <div className="institution-actions"><button className="button primary" disabled={busy} onClick={()=>{if(!profile.code||window.confirm(t('Replace your code? The previous code will stop working.','¿Reemplazar tu código? El anterior dejará de funcionar.')))void change('rotate-code');}}>{profile.code?t('Replace code','Reemplazar código'):t('Create code','Crear código')}</button>{profile.code&&<button className="button outline" disabled={busy} onClick={()=>void change('revoke-code')}>{t('Revoke code','Revocar código')}</button>}</div>
    {code&&<div className="coordinator-code"><label>{t('Save this code now','Guarda este código ahora')}<input readOnly value={code} onFocus={e=>e.target.select()}/></label><p>{t('Expires','Vence')} {new Date(expires).toLocaleDateString(es?'es':'en')}</p><div className="institution-actions"><button className="button outline" onClick={()=>void copy(code)}>{t('Copy code','Copiar código')}</button><button className="button outline" onClick={()=>void copy(`${window.location.origin}/#connect/${code}`)}>{t('Copy connection link','Copiar enlace')}</button></div>{qr&&<img src={qr} alt={t('Connection code QR','QR del código de conexión')} width={240} height={240}/>}</div>}
   </section>}
   {overview.canApprove&&<><CoordinatorApplications request={request} t={t} onError={setError}/><CoordinatorOperations t={t}/></>}
   {profile&&<CoordinatorNotifications key={`updates-${selected}-${user?.sub}`} organizationId={selected} t={t} onOpen={value=>{setNoticeTarget({...value,sequence:Date.now()});requestAnimationFrame(()=>document.querySelector(value.destination==='connections'?'.coordinator-inbox':'.coordinator-binders')?.scrollIntoView({block:'start'}));}}/>}
   {profile&&<CoordinatorBinders key={`binders-${selected}-${user?.sub}`} organizationId={selected} openRequest={noticeTarget?.organizationId===selected&&['binder','guidance'].includes(noticeTarget.destination)?noticeTarget:undefined} request={input=>request(input,false,true)} feedbackRequest={input=>request(input,false,false,true)} t={t} es={es}/>}
   {profile&&<CoordinatorInbox key={selected+(noticeTarget?.destination==='connections'?noticeTarget.sequence:'')} organizationId={selected} t={t} es={es}/>}
   {org?.role==='owner'&&<section className="coordinator-card"><h2>{t('Your coordinators','Tus coordinadores')}</h2><p>{t('Invite colleagues, then enable coordinator access after they accept. Every coordinator uses their own verified account.','Invita a tus colegas y activa el acceso después de que acepten. Cada coordinador usa su propia cuenta verificada.')}</p><button className="button outline" disabled={busy} onClick={()=>setTeam(!team)}>{t('Invitations and team','Invitaciones y equipo')}</button>
    {team&&<InstitutionTeam id={selected} name={org.name} es={es} request={async input=>{try{return await request(input,true);}catch(e){setError(e instanceof Error?e.message:'coordinator_access_unavailable');throw e;}}} onChanged={()=>void load(selected)} onClose={()=>{setTeam(false);void load(selected);}}/>}
    <ul className="coordinator-members">{members.map(m=><li key={m.subject}><div><strong>{m.name}</strong><p>{m.coordinatorStatus==='active'?t('Coordinator enabled','Coordinador activo'):t('Coordinator disabled','Coordinador desactivado')}</p></div><button className="button outline" disabled={busy||m.coordinatorStatus!=='active'&&org.pilotStatus!=='active'} onClick={()=>{const disable=m.coordinatorStatus==='active';if(!disable||window.confirm(t(`Disable ${m.name} as a coordinator? Their code and existing connections will be revoked.`,`¿Desactivar a ${m.name}? Se revocarán su código y conexiones.`)))void change(disable?'disable-member':'enable-member',{subject:m.subject});}}>{m.coordinatorStatus==='active'?t('Disable coordinator','Desactivar coordinador'):t('Enable coordinator','Activar coordinador')}</button></li>)}</ul>
   </section>}
  </>}
  {busy&&<p role="status">{t('Updating workspace…','Actualizando espacio…')}</p>}{notice&&<p role="status">{notice}</p>}
 </main>;
}
