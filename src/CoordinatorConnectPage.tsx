import {useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {FamilyProvider,useFamily} from './FamilyStore';
import CoordinatorConnection from './CoordinatorConnection';
import EligibilityGate from './EligibilityGate';
function StudentConnect({code,es}:{code:string;es:boolean}){
 const family=useFamily(),[selected,setSelected]=useState('');
 const t=(en:string,sp:string)=>es?sp:en;
 const student=family.students.find(s=>s.id===selected)||family.students[0];
 if(family.loading)return <p role="status">{t('Opening your account…','Abriendo tu cuenta…')}</p>;
 if(family.error)return <p role="alert">{t('Could not load your account. Return to your binder and try again.','No pudimos cargar tu cuenta. Vuelve a tu carpeta e intenta de nuevo.')}</p>;
 return <>{student?<><label>{t('Your student profile','Tu perfil de estudiante')}<select value={student.id} onChange={e=>setSelected(e.target.value)}>{family.students.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><CoordinatorConnection key={student.id} studentId={student.id} initialCode={code} t={t}/></>:<p>{t('Complete your student profile first, then open this link again.','Completa tu perfil de estudiante primero y vuelve a abrir este enlace.')}</p>}</>;
}
export default function CoordinatorConnectPage({code}:{code:string}){
 const {isAuthenticated,isLoading,loginWithRedirect,user}=useAuth0(),[es,setEs]=useState(localStorage.getItem('origen.language')==='es');const t=(en:string,sp:string)=>es?sp:en;
 return <main className="institution-shell"><a href="#personal">← {t('My binder','Mi carpeta')}</a><button className="text-button" onClick={()=>setEs(!es)}>{es?'English':'Español'}</button><h1>{t('Connect with a coordinator','Conectar con un coordinador')}</h1><p>{t('Opening this link shares nothing. Review and confirm the coordinator before sending a request.','Abrir este enlace no comparte nada. Revisa y confirma al coordinador antes de enviar una solicitud.')}</p>{isLoading?<p role="status">{t('Loading…','Cargando…')}</p>:!isAuthenticated?<button className="button primary" onClick={()=>void loginWithRedirect({appState:{returnTo:`#connect/${code}`}})}>{t('Sign in to continue','Inicia sesión para continuar')}</button>:<EligibilityGate key={user?.sub}><FamilyProvider previewStudents={[]}><StudentConnect code={code} es={es}/></FamilyProvider></EligibilityGate>}</main>;
}
