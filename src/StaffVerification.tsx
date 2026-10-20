import {useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {AuthenticatorGuide} from './AuthenticatorGuide';
export const staffAuthorization={max_age:0,prompt:'login',acr_values:'http://schemas.openid.net/pape/policies/2007/06/multi-factor'} as const;
export const adminAuthorization={max_age:0,prompt:'login'} as const;
export const staffVerificationErrors=['staff_mfa_required','reauthentication_required'];
export default function StaffVerification({es=false,returnTo='#institutions',requireMfa=true}:{es?:boolean;returnTo?:string;requireMfa?:boolean}){
 const {loginWithRedirect}=useAuth0();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <div className="institution-review-note">{requireMfa&&<h2>{es?'Verifica tu acceso':'Verify your access'}</h2>}<p>{requireMfa?(es?'Usa un código de la app de autenticación de tu teléfono para proteger tu acceso como personal. Si ya lo configuraste, abre la app cuando se te pida el código.':'Use a code from your phone’s authenticator app to protect your staff access. If you’ve already set it up, open the app when you’re asked for a code.'):(es?'Inicia sesión de nuevo antes de realizar esta acción.':'Sign in again before completing this action.')}</p>{requireMfa&&<AuthenticatorGuide es={es}/>}<button className="button outline" disabled={busy} onClick={()=>{setBusy(true);void loginWithRedirect({appState:{returnTo},authorizationParams:requireMfa?staffAuthorization:adminAuthorization}).catch(()=>{setBusy(false);setError(es?'No se pudo abrir el inicio de sesión. Intenta de nuevo.':'Sign-in could not open. Please try again.');});}}>{busy?(es?'Abriendo…':'Opening…'):requireMfa?(es?'Verificar mi identidad':'Verify my identity'):(es?'Iniciar sesión de nuevo':'Sign in again')}</button>{error&&<p role="alert">{error}</p>}</div>;
}
