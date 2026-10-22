import {useEffect,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import './PrivacyCenter.css';
type Category='summaries'|'notes'|'plans'|'sheets'|'memories';
type Counts=Record<Category,number>;
type Overview={counts:Counts;recoveryCopies?:number;days:number|null;students:{id:string;name:string}[]};
type Preview={counts:Counts;recoveryCopies?:number;derivedNotes:number;revision:string};
const categories:Category[]=['summaries','notes','plans','sheets','memories'];
export default function PrivacyCenter({t}:{t:(en:string,es:string)=>string}){
 const {loginWithRedirect}=useAuth0();
 const [overview,setOverview]=useState<Overview>(),[chosen,setChosen]=useState<Category[]>([]),[scope,setScope]=useState('all'),[preview,setPreview]=useState<Preview>(),[confirm,setConfirm]=useState(''),[days,setDays]=useState('keep'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[reauth,setReauth]=useState(false);
 const label=(key:Category)=>({memories:t('Student memories','Recuerdos del estudiante'),summaries:t('Conversations','Conversaciones'),notes:t('Topic notes','Notas por tema'),plans:t('Plans and actions','Planes y acciones'),sheets:t('Saved worksheets','Hojas guardadas')}[key]);
 function reset(){setPreview(undefined);setConfirm('');setMessage('');}
 async function request(body:Record<string,unknown>){
  const lease=browserPrivacy.capture();try{
   const response=await apiFetch('/api/privacy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();lease.assert();
   if(!response.ok)throw new Error(result.error||'privacy_unavailable');return result;
  }finally{lease.release();}
 }
 function failure(cause:unknown){
  if(cause instanceof Error&&cause.name==='AbortError')return;
  const code=cause instanceof Error?cause.message:'';
  if(code==='reauthentication_required'){setReauth(true);reset();setError(t('Please sign in again, then reopen Settings and review your choice. Nothing was changed.','Inicia sesión de nuevo, vuelve a Configuración y revisa tu selección. No se cambió nada.'));}
  else if(code==='privacy_selection_changed'){reset();setError(t('Your saved records changed. Review the selection again before deleting.','Tus registros cambiaron. Revisa la selección de nuevo antes de eliminar.'));}
  else setError(t('We could not load or update your privacy settings. Try again.','No pudimos cargar o actualizar tu configuración de privacidad. Intenta de nuevo.'));
 }
 useEffect(()=>{let active=true;void request({action:'status'}).then(value=>{if(active){setOverview(value);setDays(value.days===null?'keep':String(value.days));}}).catch(e=>{if(active)failure(e);});return()=>{active=false;};},[]);
 const target=scope==='all'?{}:{studentId:scope==='family'?null:scope.slice(8)};
 async function act(action:'preview'|'erase'|'retention'){
  setBusy(true);setError('');setMessage('');try{
   const result=await request(action==='retention'?{action,days:days==='keep'?null:Number(days)}:{action,categories:chosen,...target,...(action==='erase'?{revision:preview?.revision,confirmation:confirm}:{})});
   if(action==='preview')setPreview(result);
   if(action==='retention'){setOverview(current=>current?{...current,days:result.days}:current);setMessage(t('Saved. Automatic cleanup runs at startup and about once an hour.','Guardado. La limpieza automática se ejecuta al iniciar el servicio y aproximadamente cada hora.'));}
   if(action==='erase'){
    // End all private sessions before reopening this tab. Other tabs cannot
    // replay stale drafts or keep speaking from deleted conversation context.
    try{sessionStorage.setItem('origen-login-fresh','1');}catch{/* The session still ends if browser storage is unavailable. */}
    browserPrivacy.stop('privacy_updated');window.location.reload();
   }
  }catch(e){failure(e);}finally{setBusy(false);}
 }
 return <section className="privacy-center" aria-labelledby="privacy-heading">
  <span className="privacy-eyebrow">{t('Your choices','Tus decisiones')}</span><h3 id="privacy-heading">{t('Privacy Center','Centro de privacidad')}</h3>
  <p>{t('Your conversations are private to your account. Here you can choose what to keep.','Tus conversaciones son privadas para tu cuenta. Aquí puedes elegir qué conservar.')}</p>
  <details><summary>{t('What is saved, and who receives it?','¿Qué se guarda y quién lo recibe?')}</summary>
   <p>{t('Origen saves your profile, conversation summaries, memories, notes, plans and worksheets. Unsaved conversation text stays in browser memory unless you choose temporary recovery. That option keeps a private server copy for up to 24 hours, removed sooner after saving, discarding, signing out or permission withdrawal. Origen does not keep a recording of your voice.','Origen guarda tu perfil, resúmenes, recuerdos, notas, planes y hojas de trabajo. El texto sin guardar permanece en la memoria del navegador, salvo que elijas recuperación temporal. Esa opción conserva una copia privada en el servidor hasta 24 horas, eliminada antes al guardar, descartar, cerrar sesión o retirar el permiso. Origen no guarda una grabación de tu voz.')}</p>
   <p>{t('OpenAI processes live audio and the profile or saved context needed to respond. Auth0 handles sign-in. Render hosts the app and database. Official-source searches may include relevant question details. Provider retention is separate from your saved-record choices here.','OpenAI procesa el audio en vivo y el perfil o contexto guardado necesario para responder. Auth0 gestiona el acceso. Render aloja la aplicación y la base de datos. Las búsquedas en fuentes oficiales pueden incluir detalles relevantes de tu pregunta. La retención de los proveedores es independiente de tus decisiones aquí.')}</p>
   <p>{t('Family links share selected academic profile fields, not your conversations. Institutions do not receive private conversations through their dashboards. Research remains a synthetic sandbox; these controls do not enroll you in research or grant model-improvement permission.','Los vínculos familiares comparten ciertos datos académicos del perfil, no tus conversaciones. Las instituciones no reciben conversaciones privadas en sus paneles. La investigación sigue en un entorno con datos ficticios; estos controles no te inscriben en investigaciones ni otorgan permiso para mejorar modelos.')}</p>
  </details>
  <h4>{t('Choose what to remove','Elige qué eliminar')}</h4>
  <p>{t('Deleting a conversation also removes notes and memories linked to it. Separate notes, plans and worksheets stay unless you select them too. Downloaded or printed copies cannot be removed from someone’s device.','Eliminar una conversación también elimina las notas y los recuerdos vinculados a ella. Las notas independientes, los planes y las hojas permanecen salvo que también los selecciones. No se pueden borrar las copias descargadas o impresas del dispositivo de otra persona.')}</p>
  {!overview?<button type="button" className="account-save" disabled={busy} onClick={()=>{setBusy(true);setError('');void request({action:'status'}).then(value=>{setOverview(value);setDays(value.days===null?'keep':String(value.days));}).catch(failure).finally(()=>setBusy(false));}}>{t('Load my saved records','Cargar mis registros guardados')}</button>:<>
   <label>{t('For whom?','¿Para quién?')}<select value={scope} disabled={busy} onChange={e=>{setScope(e.target.value);reset();}}><option value="all">{t('My whole account','Toda mi cuenta')}</option><option value="family">{t('Family conversations and workspace','Conversaciones y espacio familiar')}</option>{overview.students.map(s=><option key={s.id} value={`student:${s.id}`}>{s.name}</option>)}</select></label>
   <fieldset disabled={busy}><legend>{t('Select saved records','Selecciona registros guardados')}</legend>{categories.map(key=><label className="privacy-choice" key={key}><input type="checkbox" checked={chosen.includes(key)} onChange={e=>{setChosen(current=>e.target.checked?[...current,key]:current.filter(k=>k!==key));reset();}}/><span>{label(key)}</span><small>{overview.counts[key]} {t('in account','en la cuenta')}</small></label>)}</fieldset>
   {chosen.includes('memories')&&<p>{t('Removing memories also stops existing conversations and their linked notes from supplying details to future calls. Those conversations stay in your binder unless you select them here.','Quitar los recuerdos también impide que las conversaciones existentes y sus notas vinculadas aporten datos a futuras llamadas. Esas conversaciones siguen en tu carpeta a menos que las selecciones aquí.')}</p>}
   <button className="account-save" disabled={busy||!chosen.length} onClick={()=>void act('preview')}>{t('Review deletion','Revisar eliminación')}</button>
   {preview&&<div className="privacy-review" role="region" aria-label={t('Deletion review','Revisión de eliminación')}><h4>{t('These records will be removed','Se eliminarán estos registros')}</h4><ul>{categories.map(key=><li key={key}>{label(key)}: <strong>{preview.counts[key]}</strong></li>)}</ul><p>{t('Temporary recovery copies also removed: ','Copias temporales que también se eliminarán: ')}{preview.recoveryCopies||0}</p><p>{t('Includes','Incluye')} {preview.derivedNotes} {t('notes generated from selected conversations. Your profile is kept. Active conversations will end and this page will reload; other tabs will need to sign in again.','notas generadas de las conversaciones seleccionadas. Se conserva tu perfil. Las conversaciones activas terminarán y esta página se recargará; las otras pestañas deberán iniciar sesión de nuevo.')}</p><label>{t('Type DELETE to confirm','Escribe DELETE para confirmar')}<input autoComplete="off" value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/></label><button className="account-save" disabled={busy||confirm!=='DELETE'||!(Object.values(preview.counts).some(Boolean)||preview.recoveryCopies)} onClick={()=>void act('erase')}>{t('Delete selected records','Eliminar registros seleccionados')}</button></div>}
   <h4>{t('How long to keep conversations','Cuánto tiempo conservar conversaciones')}</h4><p>{t('Automatic cleanup removes saved conversations and their generated notes. It keeps separate plans, notes and worksheets. Choosing a shorter time also applies to older conversations already saved.','La limpieza automática elimina conversaciones guardadas y sus notas generadas. Conserva planes, notas independientes y hojas. Elegir un plazo menor también se aplica a las conversaciones antiguas ya guardadas.')}</p>
   <label>{t('Keep saved conversations for','Conservar conversaciones durante')}<select value={days} disabled={busy} onChange={e=>setDays(e.target.value)}><option value="keep">{t('Until I delete them','Hasta que las elimine')}</option>{[30,90,365].map(d=><option key={d} value={d}>{d} {t('days after saving','días desde que se guardan')}</option>)}</select></label><button className="account-save" disabled={busy||days===(overview.days===null?'keep':String(overview.days))} onClick={()=>void act('retention')}>{t('Save retention choice','Guardar plazo de conservación')}</button>
  </>}
  <p className="privacy-footnote">{t('Deletion removes active records. Backup copies expire under the hosting provider’s schedule. Minimal deletion receipts remain to prevent deleted data from returning after recovery.','La eliminación borra los registros activos. Las copias de seguridad caducan según el calendario del proveedor. Se conservan comprobantes mínimos para impedir que los datos eliminados regresen tras una recuperación.')}</p>
  {busy&&<p role="status">{t('Working…','Procesando…')}</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}{reauth&&<button className="account-save" disabled={busy} onClick={()=>void loginWithRedirect({appState:{returnTo:'#app'},authorizationParams:{max_age:0,prompt:'login'}}).catch(failure)}>{t('Sign in again','Iniciar sesión de nuevo')}</button>}
 </section>;
}
