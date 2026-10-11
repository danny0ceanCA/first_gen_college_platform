import {useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
export const staffAuthorization={max_age:0,prompt:'login',acr_values:'http://schemas.openid.net/pape/policies/2007/06/multi-factor'} as const;
export const adminAuthorization={max_age:0,prompt:'login'} as const;
export const staffVerificationErrors=['staff_mfa_required','reauthentication_required'];
export default function StaffVerification({es=false,returnTo='#institutions',requireMfa=true}:{es?:boolean;returnTo?:string;requireMfa?:boolean}){
 const {loginWithRedirect}=useAuth0();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <div className="institution-review-note"><p>{requireMfa?(es?'El acceso del personal requiere verificación en dos pasos. Para cambiar permisos o exportar datos, verifica tu identidad de nuevo.':'Staff access requires two-step verification. Verify again before changing access or exporting data.'):(es?'Inicia sesión de nuevo antes de realizar esta acción.':'Sign in again before completing this action.')}</p><button className="button outline" disabled={busy} onClick={()=>{setBusy(true);void loginWithRedirect({appState:{returnTo},authorizationParams:requireMfa?staffAuthorization:adminAuthorization}).catch(()=>{setBusy(false);setError(es?'No se pudo abrir el inicio de sesión. Intenta de nuevo.':'Sign-in could not open. Please try again.');});}}>{busy?(es?'Abriendo…':'Opening…'):requireMfa?(es?'Verificar mi identidad':'Verify my identity'):(es?'Iniciar sesión de nuevo':'Sign in again')}</button>{error&&<p role="alert">{error}</p>}</div>;
}
