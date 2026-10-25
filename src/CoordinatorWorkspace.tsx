import CoordinatorNotifications,{type NoticeDestination} from './CoordinatorNotifications';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import StaffVerification,{staffVerificationErrors,getStaffAccessToken} from './StaffVerification';
import CoordinatorInbox from './CoordinatorInbox';
import CoordinatorBinders from './CoordinatorBinders';
import InstitutionTeam from './InstitutionTeam';
import './InstitutionPortal.css';
import './CoordinatorWorkspace.css';
import {applicationError} from './CoordinatorRegistration';
import {ArrowLeft,BookOpen,Building2,ChevronRight,LayoutDashboard,LogOut,RefreshCw,UserRound,Users,UserRoundPlus} from 'lucide-react';
import CoordinatorHome,{type BinderView} from './CoordinatorHome';
import './admin.css';
import './CoordinatorDashboard.css';

type View='overview'|'binders'|'connections'|'profile'|'team';

type Organization={id:string;name:string;role?:string;pilotStatus:string;pilotRevision:number;verificationStatus:string;profile?:{id:string;displayName:string;status:string}};
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
 const [view,setView]=useState<View>('overview'),[binderView,setBinderView]=useState<BinderView>('all');
 function navigate(next:View){setView(next);setNotice('');window.scrollTo({top:0});}
 function openBinders(filter:BinderView='all'){setBinderView(filter);setNoticeTarget(undefined);navigate('binders');}
 const request=useCallback(async(input:unknown,institution=false,binders=false,feedback=false)=>{
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  const response=await apiFetch(feedback?'/api/coordinator-feedback':binders?'/api/coordinator-binders':institution?'/api/institutions':'/api/coordinator-access',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'coordinator_access_unavailable');return data;
 },[getAccessTokenSilently]);
 const load=useCallback(async(id='')=>{
  const version=++generation.current;setBusy(true);setError('');setCode('');setQr('');setOverview(undefined);setProfile(undefined);setMembers([]);
  try{
   const next=await request({action:'overview'}) as Overview;
   if(version!==generation.current)return;
   setOverview(next);const org=next.organizations.find(o=>o.id===id)||next.organizations.find(o=>o.pilotStatus==='active'&&o.profile?.status==='active')||next.organizations[0];setSelected(org?.id||'');
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
   const data=await request({action,id:selected,...extra,...(action==='approve-organization'?{revision:org?.pilotRevision}:{})});if(version!==generation.current)return;
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
  organization_changed:t('Organization access changed. Refresh the workspace before approving again.','El acceso de la organización cambió. Actualiza el espacio antes de aprobar de nuevo.'),
  coordinator_access_denied:t('Your account does not have coordinator access. Ask your organization owner to enable it.','Tu cuenta no tiene acceso de coordinador. Pide al propietario de tu organización que lo active.'),
  verified_email_required:t('Verify your sign-in email before opening this workspace.','Verifica tu correo de inicio de sesión antes de abrir este espacio.'),
  invitation_email_required:t('We could not verify your sign-in email. Sign in again.','No pudimos verificar tu correo. Inicia sesión de nuevo.'),
  independent_review_required:t('Pilot approval requires an Origen administrator outside this organization.','La aprobación requiere un administrador de Origen ajeno a esta organización.'),
  organization_verification_required:t('Confirm the organization’s affiliation in Institutions before approving its pilot. Publishing a page is not required.','Confirma la afiliación en Instituciones antes de aprobar el piloto. No es necesario publicar una página.'),
  staff_access_revoked:t('Your staff access has been suspended. Contact your organization.','Tu acceso de personal se ha suspendido. Contacta a tu organización.'),
 };
 if(isLoading)return <main className="institution-shell"><p role="status">{t('Opening your workspace…','Abriendo tu espacio…')}</p></main>;
 if(!isAuthenticated)return <main className="institution-shell"><h1>{t('Coordinator workspace','Espacio del coordinador')}</h1><button className="button primary" onClick={()=>void loginWithRedirect({appState:{returnTo:'#coordinators'}})}>{t('Sign in','Iniciar sesión')}</button></main>;
 const sections=[
  {id:'overview' as const,label:t('Overview','Resumen'),Icon:LayoutDashboard},
  ...(profile?[
   {id:'binders' as const,label:t('Shared binders','Carpetas compartidas'),Icon:BookOpen},
   {id:'connections' as const,label:t('Connections','Conexiones'),Icon:UserRoundPlus},
   {id:'profile' as const,label:t('Profile & code','Perfil y código'),Icon:UserRound},
  ]:[]),
  ...(org?.role==='owner'?[{id:'team' as const,label:t('Your team','Tu equipo'),Icon:Users}]:[])
 ];
 return <div className="admin-workspace coordinator-dashboard">
  <aside className="admin-sidebar"><a className="admin-logo" href="#" aria-label={t('Origen home','Inicio de Origen')}><span aria-hidden="true">○</span> origen<span>.</span></a><span className="admin-workspace-label">{t('Coordinator workspace','Espacio del coordinador')}</span>
   <nav aria-label={t('Coordinator navigation','Navegación del coordinador')}>{sections.map(({id,label,Icon})=><button key={id} disabled={busy} aria-current={view===id?'page':undefined} onClick={()=>id==='binders'?openBinders():navigate(id)}><Icon size={19}/>{label}{view===id&&<span className="admin-nav-dot"/>}</button>)}</nav>
   <div className="admin-sidebar-bottom">{overview&&overview.organizations.length>0&&<a href="#institutions"><Building2 size={16}/>{t('Organization workspace','Espacio de la organización')}</a>}<a href="#personal"><BookOpen size={16}/>{t('Personal binder','Carpeta personal')}</a><a href="#"><ArrowLeft size={16}/>{t('Origen home','Inicio de Origen')}</a><button onClick={()=>void logout({logoutParams:{returnTo:window.location.origin}}).catch(()=>setError('logout_failed'))}><LogOut size={16}/>{t('Log out','Cerrar sesión')}</button></div>
  </aside>
  <main className="admin-dashboard coordinator-dashboard-main">
   <header className="admin-header"><div><div className="admin-breadcrumb">Origen <ChevronRight size={14}/>{t('Coordinator workspace','Espacio del coordinador')}</div><h1>{sections.find(s=>s.id===view)?.label||t('Your workspace','Tu espacio')}</h1></div><div className="admin-header-actions"><button className="admin-refresh" onClick={()=>{localStorage.setItem('origen.language',es?'en':'es');setEs(!es);}}>{es?'English':'Español'}</button><button className="admin-refresh" disabled={busy} onClick={()=>void load(selected)}><RefreshCw size={16}/>{t('Refresh','Actualizar')}</button></div></header>
   {error&&(staffVerificationErrors.includes(error)?<StaffVerification es={es} returnTo="#coordinators" requireMfa={error==='staff_mfa_required'||error==='mfa_required'}/>:<p className="institution-error" role="alert">{error==='logout_failed'?t('Could not log out. Please try again.','No se pudo cerrar sesión. Intenta de nuevo.'):messages[error]||applicationError(error,t)}</p>)}
   {busy&&<p className="coordinator-dashboard-status" role="status">{t('Updating workspace…','Actualizando espacio…')}</p>}
   {notice&&<p className="coordinator-dashboard-status" role="status">{notice}</p>}
   {overview&&<>
    {org&&<div className="coordinator-organization-bar"><Building2 size={20}/>{overview.organizations.length>1?<label>{t('Organization','Organización')}<select value={selected} disabled={busy} onChange={e=>{setTeam(false);setNoticeTarget(undefined);navigate('overview');void load(e.target.value);}}>{overview.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>:<strong>{org.name}</strong>}<span>{profile?t('Coordinator access enabled','Acceso de coordinador activo'):t('Coordinator access pending','Acceso de coordinador pendiente')}</span></div>}
    {profile&&<CoordinatorNotifications key={`updates-${selected}-${user?.sub}`} organizationId={selected} t={t} onOpen={value=>{setNoticeTarget({...value,sequence:Date.now()});setBinderView('all');navigate(value.destination==='connections'?'connections':'binders');}}/>}
    {!profile&&<section className="coordinator-card coordinator-access-state"><h2>{t('Your coordinator access','Tu acceso de coordinador')}</h2><p>{org?.pilotStatus==='suspended'?t('Coordinator access for this organization is suspended. Contact your organization for help.','El acceso de coordinador de esta organización está suspendido. Contacta a tu organización para obtener ayuda.'):t('Your application or organization access may still need review. Check your application for the next step.','Tu solicitud o el acceso de tu organización puede necesitar revisión. Consulta tu solicitud para conocer el siguiente paso.')}</p><a className="button outline" href="#coordinator-register">{t('View application status','Ver estado de la solicitud')}</a></section>}
    {profile&&view==='overview'&&<CoordinatorHome key={selected} organizationId={selected} name={profile.displayName} t={t} request={input=>request(input,false,true)} onBinders={openBinders} onConnections={()=>navigate('connections')} onProfile={()=>navigate('profile')}/>}
    {profile&&view==='binders'&&<CoordinatorBinders key={`binders-${selected}-${binderView}-${user?.sub}`} initialView={binderView} organizationId={selected} openRequest={noticeTarget?.organizationId===selected&&['binder','guidance'].includes(noticeTarget.destination)?noticeTarget:undefined} request={input=>request(input,false,true)} feedbackRequest={input=>request(input,false,false,true)} t={t} es={es}/>}
    {profile&&view==='connections'&&<CoordinatorInbox key={selected+(noticeTarget?.destination==='connections'?noticeTarget.sequence:'')} organizationId={selected} t={t} es={es}/>}
   {profile&&view==='profile'&&<section className="coordinator-card"><div className="eyebrow">{t('YOUR PROFILE','TU PERFIL')}</div><h2>{profile.displayName}</h2><p>{profile.organizationName}</p><form onSubmit={e=>{e.preventDefault();void change('save-profile',{displayName:name});}}><label>{t('Name students will see','Nombre que verán los estudiantes')}<input value={name} maxLength={100} required onChange={e=>setName(e.target.value)}/></label><button className="button outline" disabled={busy}>{t('Save name','Guardar nombre')}</button></form>
    <h3>{t('Your connection code','Tu código de conexión')}</h3><p>{t('A code helps students find you. It never grants access to their binder.','Un código ayuda a los estudiantes a encontrarte. Nunca da acceso a su carpeta.')}</p>
    {profile.code&&!code&&<p>{t('Your code is active until','Tu código está activo hasta')} {new Date(profile.code.expiresAt).toLocaleDateString(es?'es':'en')}. {t('For your privacy, it can only be shown when created. Replace it if you didn’t save it.','Por privacidad, solo se muestra al crearlo. Reemplázalo si no lo guardaste.')}</p>}
    <div className="institution-actions"><button className="button primary" disabled={busy} onClick={()=>{if(!profile.code||window.confirm(t('Replace your code? The previous code will stop working.','¿Reemplazar tu código? El anterior dejará de funcionar.')))void change('rotate-code');}}>{profile.code?t('Replace code','Reemplazar código'):t('Create code','Crear código')}</button>{profile.code&&<button className="button outline" disabled={busy} onClick={()=>void change('revoke-code')}>{t('Revoke code','Revocar código')}</button>}</div>
    {code&&<div className="coordinator-code"><label>{t('Save this code now','Guarda este código ahora')}<input readOnly value={code} onFocus={e=>e.target.select()}/></label><p>{t('Expires','Vence')} {new Date(expires).toLocaleDateString(es?'es':'en')}</p><div className="institution-actions"><button className="button outline" onClick={()=>void copy(code)}>{t('Copy code','Copiar código')}</button><button className="button outline" onClick={()=>void copy(`${window.location.origin}/#connect/${code}`)}>{t('Copy connection link','Copiar enlace')}</button></div>{qr&&<img src={qr} alt={t('Connection code QR','QR del código de conexión')} width={240} height={240}/>}</div>}
   </section>}
   {view==='team'&&org?.role==='owner'&&<section className="coordinator-card"><h2>{t('Your coordinators','Tus coordinadores')}</h2><p>{t('Invite colleagues, then enable coordinator access after they accept. Every coordinator uses their own verified account.','Invita a tus colegas y activa el acceso después de que acepten. Cada coordinador usa su propia cuenta verificada.')}</p><button className="button outline" disabled={busy} onClick={()=>setTeam(!team)}>{t('Invitations and team','Invitaciones y equipo')}</button>
    {team&&<InstitutionTeam id={selected} name={org.name} es={es} request={async input=>{try{return await request(input,true);}catch(e){setError(e instanceof Error?e.message:'coordinator_access_unavailable');throw e;}}} onChanged={()=>void load(selected)} onClose={()=>{setTeam(false);void load(selected);}}/>}
    <ul className="coordinator-members">{members.map(m=><li key={m.subject}><div><strong>{m.name}</strong><p>{m.coordinatorStatus==='active'?t('Coordinator enabled','Coordinador activo'):t('Coordinator disabled','Coordinador desactivado')}</p></div><button className="button outline" disabled={busy||m.coordinatorStatus!=='active'&&org.pilotStatus!=='active'} onClick={()=>{const disable=m.coordinatorStatus==='active';if(!disable||window.confirm(t(`Disable ${m.name} as a coordinator? Their code and existing connections will be revoked.`,`¿Desactivar a ${m.name}? Se revocarán su código y conexiones.`)))void change(disable?'disable-member':'enable-member',{subject:m.subject});}}>{m.coordinatorStatus==='active'?t('Disable coordinator','Desactivar coordinador'):t('Enable coordinator','Activar coordinador')}</button></li>)}</ul>
   </section>}

   </>}
  </main>
 </div>;
}
