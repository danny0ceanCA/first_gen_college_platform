import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {linksRequest,inviteMessage,type LinkResult} from './linkClient';
import './LinkedAccounts.css';
export default function InviteAccept({token}:{token:string}){
 const {isAuthenticated,isLoading,getAccessTokenSilently,loginWithRedirect}=useAuth0();
 const [es,setEs]=useState(localStorage.getItem('origen.language')==='es'),[invitation,setInvitation]=useState<LinkResult['invitation']>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const t=(en:string,spanish:string)=>es?spanish:en;
 const request=(action:string,signal?:AbortSignal)=>linksRequest(()=>getAccessTokenSilently(),import.meta.env.VITE_API_URL||'',{action,token},signal);
 useEffect(()=>{if(!isAuthenticated)return;const controller=new AbortController();setBusy(true);setError('');void request('inspect',controller.signal).then(result=>setInvitation(result.invitation)).catch(error=>{if(!controller.signal.aborted)setError(inviteMessage(error,es));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[isAuthenticated,token,es]);
 return <main className="invite-page"><section className="invite-card"><div className="invite-heading"><strong>○ origen.</strong><button className="text-button" onClick={()=>setEs(!es)}>{es?'English':'Español'}</button></div><h1>{t('A little support, together.','Un poco de apoyo, juntos.')}</h1><p>{t('You’ve been invited to connect accounts on Origen.','Te han invitado a vincular cuentas en Origen.')}</p>
 {invitation&&<p><strong>{invitation.inviterName||t('A family member','Un familiar')}</strong> {t('invited you to support','te invitó a apoyar a')} <strong>{invitation.studentName}</strong> {t('as a','como')} {invitation.role==='parent'?t('parent.','padre o madre.'):t('student.','estudiante.')}</p>}
 <p>{t('Both people can view and edit the student’s academic profile and college plans. Conversation histories, private notes and practical needs stay separate. Either person can unlink later.','Ambos pueden ver y editar el perfil académico y los planes universitarios. Los historiales, notas privadas y necesidades prácticas se mantienen separados. Cualquiera puede desvincular las cuentas después.')}</p>
 {error&&<p role="alert">{error}</p>}
 {!isAuthenticated?<button className="button primary full" disabled={isLoading} onClick={()=>void loginWithRedirect({appState:{returnTo:window.location.hash}})}>{t('Sign in or register to review invitation','Inicia sesión o regístrate para revisar la invitación')}</button>:<button className="button primary full" disabled={busy||!invitation||!!error} onClick={async()=>{setBusy(true);try{await request('accept');window.history.replaceState({},'', '/#app');window.dispatchEvent(new HashChangeEvent('hashchange'));}catch(error){setError(inviteMessage(error,es));}finally{setBusy(false);}}}>{busy?t('Checking…','Consultando…'):t('Accept and link accounts','Aceptar y vincular cuentas')}</button>}
 <a className="invite-native" href={`origen://invite?token=${encodeURIComponent(token)}`}>{t('Open in the Origen phone app','Abrir en la app de Origen')}</a><a href="/#">{t('Not now · Return to Origen','Ahora no · Volver a Origen')}</a></section></main>;
}
