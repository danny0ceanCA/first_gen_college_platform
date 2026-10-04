import {useFamily} from './FamilyStore';
import AccountDataControls from './AccountDataControls';
import {useState} from 'react';
import './AccountSettings.css';

export default function AccountSettings({t}:{t:(en:string,es:string)=>string}){
 const family=useFamily();
 const [account,setAccount]=useState(family.account);
 const [status,setStatus]=useState<'saved'|'error'|null>(null);
 return <section className="account-settings"><h3>{t('Account','Cuenta')}</h3><p>{t('Your information. Separate from your student’s profile.','Tu información. Separada del perfil de tu estudiante.')}</p><form onSubmit={async e=>{e.preventDefault();setStatus(await family.saveAccount({firstName:account.firstName.trim(),email:account.email.trim()})?'saved':'error');}}>
 <label>{t('First name','Nombre')}<input required disabled={family.saving} autoComplete="given-name" maxLength={100} value={account.firstName} onChange={e=>{setAccount({...account,firstName:e.target.value});setStatus(null);}}/></label>
 <label>{t('Email','Correo electrónico')}<input disabled={family.saving} type="email" autoComplete="email" maxLength={254} value={account.email} onChange={e=>{setAccount({...account,email:e.target.value});setStatus(null);}}/></label>
 <button className="account-save" type="submit" disabled={family.saving||!account.firstName.trim()}>{family.saving?t('Saving…','Guardando…'):t('Save information','Guardar información')}</button>
 {status&&<p role="status">{status==='saved'?(family.cloud?t('Saved to your account.','Guardado en tu cuenta.'):t('Saved on this browser.','Guardado en este navegador.')):t('Could not save. Please try again.','No se pudo guardar. Intenta de nuevo.')}</p>}
 </form><small>{family.cloud?t('Saved to your account. Changing this email does not change your Auth0 sign-in.','Se guarda en tu cuenta. Cambiar este correo no cambia tu acceso de Auth0.'):t('Preview account · Saved on this browser only. This does not create an account or change a sign-in email.','Cuenta de ejemplo · Se guarda solo en este navegador. Esto no crea una cuenta ni cambia el correo de acceso.')}</small>{family.cloud&&<AccountDataControls t={t}/>}</section>;
}
