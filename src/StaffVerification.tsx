import {useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
export const staffAuthorization={max_age:0,prompt:'login',acr_values:'http://schemas.openid.net/pape/policies/2007/06/multi-factor'} as const;
export const staffVerificationErrors=['staff_mfa_required','reauthentication_required'];
export default function StaffVerification({es=false,returnTo='#institutions'}:{es?:boolean;returnTo?:string}){
 const {loginWithRedirect}=useAuth0();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <div className="institution-review-note"><p>{es?'El acceso del personal requiere verificación en dos pasos. Para cambiar permisos o exportar datos, verifica tu identidad de nuevo.':'Staff access requires two-step verification. Verify again before changing access or exporting data.'}</p><button className="button outline" disabled={busy} onClick={()=>{setBusy(true);void loginWithRedirect({appState:{returnTo},authorizationParams:staffAuthorization}).catch(()=>{setBusy(false);setError(es?'No se pudo abrir la verificación. Intenta de nuevo.':'Verification could not open. Please try again.');});}}>{busy?(es?'Abriendo…':'Opening…'):(es?'Verificar mi identidad':'Verify my identity')}</button>{error&&<p role="alert">{error}</p>}</div>;
}
