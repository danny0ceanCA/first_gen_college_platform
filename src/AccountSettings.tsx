import {useAuth0} from '@auth0/auth0-react';
import {useState} from 'react';
import './AccountSettings.css';

export default function AccountSettings({t}:{t:(en:string,es:string)=>string}){
 const {isAuthenticated,user}=useAuth0();
 const storageKey=isAuthenticated&&user?.sub?`origen.account.${user.sub}`:'origen.account-preview.v1';
 const [account,setAccount]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');return {firstName:typeof saved.firstName==='string'?saved.firstName:'',email:typeof saved.email==='string'?saved.email:''};}catch{return {firstName:'',email:''};}});
 const [status,setStatus]=useState<'saved'|'error'|null>(null);
 return <section className="account-settings"><h3>{t('Account','Cuenta')}</h3><p>{t('Your information. Separate from your student’s profile.','Tu información. Separada del perfil de tu estudiante.')}</p><form onSubmit={e=>{e.preventDefault();try{localStorage.setItem(storageKey,JSON.stringify({firstName:account.firstName.trim(),email:account.email.trim()}));setStatus('saved');}catch{setStatus('error');}}}>
 <label>{t('First name','Nombre')}<input autoComplete="given-name" maxLength={100} value={account.firstName} onChange={e=>{setAccount({...account,firstName:e.target.value});setStatus(null);}}/></label>
 <label>{t('Email','Correo electrónico')}<input type="email" autoComplete="email" maxLength={254} value={account.email} onChange={e=>{setAccount({...account,email:e.target.value});setStatus(null);}}/></label>
 <button className="account-save" type="submit">{t('Save information','Guardar información')}</button>
 {status&&<p role="status">{status==='saved'?t('Saved on this browser.','Guardado en este navegador.'):t('Could not save. Please try again.','No se pudo guardar. Intenta de nuevo.')}</p>}
 </form><small>{isAuthenticated?t('Signed in with Auth0 · Information below is saved on this browser only. Cloud syncing is not connected.','Acceso con Auth0 · La información se guarda solo en este navegador. Sin sincronización en la nube.'):t('Preview account · Saved on this browser only. This does not create an account or change a sign-in email.','Cuenta de ejemplo · Se guarda solo en este navegador. Esto no crea una cuenta ni cambia el correo de acceso.')}</small></section>;
}
