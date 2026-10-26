import {onboardingEvents,onboardingFieldPresence,type OnboardingTracker} from './onboardingEvents.mjs';
import {SharedVoiceContext} from './SharedVoiceContext';
import WelcomeWriting from './WelcomeWriting';
import {welcomeStageLabel} from './welcomeLanguage.mjs';
import {validOnboardingDraft} from './onboardingRecovery.mjs';
import {privateRecovery} from './privateRecovery';
import {browserPrivacy} from './browserPrivacy.mjs';
import {useAuth0} from '@auth0/auth0-react';
import {useContext,useEffect,useRef,useState} from 'react';
import './Welcome.css';
import ProfileVoice from './ProfileVoice';
import {apiFetch,onboardingTransport} from './api';
import {useOnboardingDelivery,onboardingStorage} from './useOnboardingDelivery';
import {type StudentProfile} from './planning';

export default function Welcome({language,setLanguage,complete,cloud=false,hasStudents=false,onRole,initialName="",initialRole,onComplete,tracker:providedTracker,surface='web',addStudent=false,testMode=false,initialStudent,onSkip}:{addStudent?:boolean;testMode?:boolean;initialStudent?:StudentProfile;onSkip?:()=>Promise<boolean>;surface?:'web'|'native';tracker?:OnboardingTracker;language:'en'|'es';setLanguage:(v:'en'|'es')=>void;cloud?:boolean;hasStudents?:boolean;onRole?:(role:'parent'|'student')=>void;initialName?:string;initialRole?:'parent'|'student';onComplete:()=>void;complete:(firstName:string,role:'parent'|'student',student?:StudentProfile,options?:{keepOpen:boolean;attemptId?:string})=>Promise<boolean>}){
 const sharedVoice=useContext(SharedVoiceContext);
 const t=(en:string,es:string)=>language==='es'?es:en;
 const {user,logout,getAccessTokenSilently}=useAuth0();
 useEffect(()=>{if(!cloud||addStudent)return;void apiFetch('/api/family',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'onboarding-start'})}).catch(()=>{});},[cloud,user?.sub,addStudent]);
 const [tracker]=useState(()=>providedTracker||onboardingEvents(onboardingTransport(user?.sub,()=>getAccessTokenSilently()),{enabled:cloud,storage:onboardingStorage(),scope:user?.sub}));
 useOnboardingDelivery(tracker,!providedTracker);
 const track=tracker.event;
 const [leaving,setLeaving]=useState(false);
 const [recovery]=useState(()=>privateRecovery(`origen.onboarding.${cloud?user?.sub:'preview'}.${addStudent?'add-student.':''}v1`));
 const [restored]=useState(()=>recovery.read<{name:string;step:'name'|'choice'|'voice'|'manual';role:'parent'|'student'|'';draft:StudentProfile}|null>(null,validOnboardingDraft));
 const [name,setName]=useState(restored?.name||initialName);
 const [step,setStep]=useState<'name'|'choice'|'voice'|'manual'>('voice');
 const [role,setRole]=useState<'parent'|'student'|''>(restored?.role||initialRole||'');
 const [storageError,setStorageError]=useState(false);
 const completed=useRef(false);
 const [active,setActive]=useState(false),[voiceBusy,setVoiceBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState<StudentProfile>(restored?.draft||initialStudent||{id:crypto.randomUUID(),name:'',stage:'',interest:'',gpa:'',color:'lilac'});
 const [saving,setSaving]=useState(false);
 useEffect(()=>{tracker.open({language,restored:!!restored,method:'voice',captureVersion:3,surface});const visibility=()=>{track(document.hidden?'page_hidden':'page_visible');void tracker.flush();};const pageLeaving=()=>{track('page_leaving');void tracker.flush();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pageLeaving);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pageLeaving);};},[tracker]);
 useEffect(()=>{const timer=setTimeout(()=>tracker.fields(onboardingFieldPresence(name,role,draft)),500);return()=>clearTimeout(timer);},[name,role,draft,tracker]);
 useEffect(()=>{track('setup_method_changed',{method:step,language});},[step,language,track]);
 const review=useRef<HTMLHeadingElement>(null),story=useRef<HTMLElement>(null);
 const liveValues=useRef({name,role,draft});liveValues.current={name,role,draft};
 const saveLock=useRef(false);
 const [savedSnapshot,setSavedSnapshot]=useState('');
 const updateAccount=(details:{firstName:string;role:'parent'|'student'})=>{if(addStudent)return;liveValues.current={...liveValues.current,name:details.firstName,role:details.role};setName(details.firstName);setRole(details.role);};
 const updateDraft=(changes:Partial<StudentProfile>)=>{const next={...liveValues.current.draft,...changes};liveValues.current={...liveValues.current,draft:next};setDraft(next);};
 useEffect(()=>{if(step!=='voice')return;const frame=requestAnimationFrame(()=>{const node=story.current;if(node)node.scrollTo({top:node.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});return()=>cancelAnimationFrame(frame);},[name,role,draft,step]);
 useEffect(()=>{if(!completed.current)setStorageError(!recovery.write({name,step,role,draft}));},[name,step,role,draft,recovery]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(!completed.current&&(name.trim()||draft.name.trim()||active)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[name,draft,active]);
 const signOut=async()=>{if(leaving)return;completed.current=true;browserPrivacy.stop('logout');setLeaving(true);setActive(false);setError('');try{await logout({logoutParams:{returnTo:window.location.origin}});}catch{setLeaving(false);setError(t('Could not log out. Please try again.','No se pudo cerrar sesión. Inténtalo de nuevo.'));}};
 const logoutButton=cloud?<button type="button" className="button outline welcome-logout" disabled={leaving} onClick={()=>void signOut()}>{leaving?t('Logging out…','Cerrando sesión…'):t('Log out','Cerrar sesión')}</button>:null;
 const skip=async()=>{
  if(!onSkip||active||voiceBusy||saving||leaving)return;
  setSaving(true);setError('');
  try{if(await onSkip()){completed.current=true;recovery.clear();}else setError(t('Could not open your binder. Please try again.','No se pudo abrir tu carpeta. Intenta de nuevo.'));}
  catch{setError(t('Could not open your binder. Please try again.','No se pudo abrir tu carpeta. Intenta de nuevo.'));}
  finally{setSaving(false);}
 };
 const skipButton=onSkip?<button type="button" className="button outline" title={active?t('End your current conversation to open the binder.','Termina tu conversación actual para abrir la carpeta.'):undefined} disabled={active||voiceBusy||saving||leaving} onClick={()=>void skip()}>{addStudent?t('Back to my binder','Volver a mi carpeta'):t('Skip to my binder','Ir a mi carpeta')}</button>:null;
 const finish=async(student?:StudentProfile,keepOpen=false,method:'voice'|'manual'='manual')=>{
  if(saveLock.current||leaving)return false;
  const current=liveValues.current;
  track('save_requested',{method,language});tracker.fields(onboardingFieldPresence(current.name,current.role,current.draft));
  if(!current.role||!current.name.trim()||(student&&!student.name.trim())){track('validation_failed',{reason:'missing_details'});setError(t('Tell Origen your name, whether you are a student or parent, and the student’s name to save.','Dile a Origen tu nombre, si eres estudiante o madre/padre, y el nombre del estudiante para guardar.'));return false;}
  saveLock.current=true;setSaving(true);setError('');
  const firstName=current.name.trim(),accountRole=current.role;
  const snapshot=student?{...student,name:student.name.trim()}:undefined;
  try{
   if(await complete(firstName,accountRole,snapshot,{keepOpen,attemptId:cloud?tracker.id:undefined})){
    track('save_succeeded',{method,language});void tracker.flush();
    setSavedSnapshot(JSON.stringify({name:firstName,role:accountRole,draft:snapshot}));
    completed.current=true;recovery.clear();onRole?.(accountRole);
    return true;
   }
   track('save_failed',{reason:'request_failed'});setError(t('Could not save. Your details are still here. Please try again.','No se pudo guardar. Tus datos siguen aquí. Intenta de nuevo.'));return false;
  }catch{track('save_failed',{reason:'request_failed'});setError(t('Could not save. Please try again.','No se pudo guardar. Intenta de nuevo.'));return false;}
  finally{saveLock.current=false;setSaving(false);}
 };
 const saveByVoice=async()=>{
  const current=liveValues.current;
  if(!current.name.trim()||!current.role||!current.draft.name.trim()){track('save_requested',{method:'voice',language});track('validation_failed',{reason:'missing_details'});return {status:'missing_details' as const,instruction:'Ask only for the missing account-holder name, student/parent role or student name. After receiving the missing details, ask for an explicit save request again. Never save merely because details were supplied.'};}
  if(saveLock.current)return {status:'save_in_progress' as const,instruction:'A save is already in progress. Continue naturally; do not claim it succeeded yet.'};
  return await finish(current.draft,true,'voice')?{status:'saved' as const,instruction:'The profile was saved successfully. Say one brief confirmation in the current conversation language and explain that the home page is opening next. Do not ask another question. The app waits until your confirmation finishes playing.'}:{status:'save_failed' as const,instruction:'The profile could not be saved. Tell the user and offer to retry. Keep talking without claiming a successful save.'};
 };
 const saveFromButton=async()=>{
  if(voiceBusy)return;
  if(await finish(liveValues.current.draft,!!sharedVoice?.active)){
   if(sharedVoice?.active&&!sharedVoice.profileSaved())onComplete();
  }
 };
 const latestVoiceSave=useRef(saveByVoice);latestVoiceSave.current=saveByVoice;
 const saved=savedSnapshot===JSON.stringify({name:name.trim(),role,draft:{...draft,name:draft.name.trim()}});
 if(step==='voice')return <main className="welcome-conversation">
  <header className="welcome-conversation-header"><a href="#" onClick={e=>e.preventDefault()} className="welcome-wordmark" aria-label="Origen">origen<span>.</span></a><div className="welcome-header-actions"><button className="button outline" disabled={active||saving||leaving} onClick={()=>setLanguage(language==='en'?'es':'en')}>{language==='en'?'Español':'English'}</button>{skipButton}{logoutButton}</div></header>
  <section ref={story} className="welcome-story" aria-labelledby="welcome-story-title"><h1 id="welcome-story-title">{addStudent?t('Add another student','Agregar otro estudiante'):name.trim()?t('Welcome, '+name.trim()+'.','Bienvenido, '+name.trim()+'.'):t('Welcome to Origen.','Bienvenido a Origen.')}</h1>
  <div className="welcome-live-notes" aria-label={t('Profile draft','Borrador del perfil')}>
   {name.trim()&&<section className="welcome-live-note"><h2>{t('About you','Sobre ti')}</h2><WelcomeWriting text={name.trim()+(role?' · '+(role==='student'?t('Student','Estudiante'):t('Parent or guardian','Madre, padre o tutor')):'')}/></section>}
   {!Object.entries(draft).some(([field,value])=>field!=='id'&&field!=='color'&&typeof value==='string'&&value.trim())&&<p className="welcome-empty-note">{role==='student'?t('We’ll start with your name and education stage, then any details you’d like to add.','Empezaremos con tu nombre y etapa educativa, y luego los detalles que quieras agregar.'):t('We’ll start with your student’s name and education stage, then any details you’d like to add.','Empezaremos con el nombre y la etapa educativa de tu estudiante, y luego los detalles que quieras agregar.')}</p>}
   {([['name','Name','Nombre'],['stage','Education stage','Etapa educativa'],['school','School or college','Escuela o colegio'],['interest','Interests','Intereses'],['goals','Goals','Metas'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes','Notas'],['gpa','Reported GPA','GPA reportado']] as const).filter(([field])=>draft[field]?.trim()).map(([field,en,es])=><section className="welcome-live-note" key={field}><h2>{t(en,es)}</h2><WelcomeWriting text={field==='stage'?welcomeStageLabel(draft[field]||'',language):draft[field]||''}/></section>)}
  </div><p className="welcome-draft-status" role="status">{saved?t('Profile saved.','Perfil guardado.'):voiceBusy?t('Wait for Origen to finish your last reply before saving.','Espera a que Origen termine la última respuesta antes de guardar.'):active?t('Drafting your profile · You can correct a detail out loud.','Creando tu perfil · Puedes corregir un dato en voz alta.'):draft.name.trim()?t('Your draft is ready to review. You can edit details before saving.','Tu borrador está listo para revisar. Puedes editarlo antes de guardar.'):t('Press below to start the conversation.','Presiona abajo para iniciar la conversación.')}</p></section>
  <footer className="welcome-conversation-dock">{!leaving&&<ProfileVoice onBusy={setVoiceBusy} onOnboardingEvent={track} onProfileSaveComplete={onComplete} onSaveProfile={()=>latestVoiceSave.current()} onLanguageChanged={setLanguage} onboarding autoStart={addStudent} replayWelcome={!cloud||testMode} recoveryKey={`origen.onboarding.voice.${cloud?user?.sub:'preview'}.${draft.id}`} profile={draft} language={language} role={role||'parent'} t={t} onActive={setActive} onAccountDraft={addStudent?undefined:updateAccount} onDraft={updateDraft} apply={updateDraft}/>}
   <div className="welcome-conversation-actions"><button className="text-button" disabled={active||saving} onClick={()=>setStep('manual')}>{t('Edit details','Editar datos')}</button><button className="button primary" disabled={saving||voiceBusy} onClick={()=>void saveFromButton()}>{saving?t('Saving…','Guardando…'):t('Save profile','Guardar perfil')}</button></div>
   {storageError&&<p role="alert">{t('Your draft could not be backed up. Keep this page open until you save.','No se pudo conservar el borrador. Mantén esta página abierta hasta guardar.')}</p>}{error&&<p role="alert">{error}</p>}
  </footer></main>;
 return <main className={`application-panel welcome-panel${step==='manual'?' welcome-profile-step':''}`}>
 <div className="welcome-header-actions">{skipButton}{logoutButton}</div>
 <button className="button outline" disabled={active||saving} onClick={()=>setLanguage(language==='en'?'es':'en')}>{language==='en'?'Español':'English'}</button>
 <p className="eyebrow">{t('WELCOME TO ORIGEN','BIENVENIDO A ORIGEN')}</p>
 <h1>{addStudent?t('Add another student','Agregar otro estudiante'):step==='name'?t('What should we call you?','¿Cómo te llamas?'):t(`Welcome, ${name.trim()}.`,`Bienvenido, ${name.trim()}.`)}</h1>
 {step==='name'?<form onSubmit={e=>{e.preventDefault();if(name.trim()&&role)setStep('choice');}}><label className="field">{t('Your first name','Tu nombre')}<input required autoComplete="given-name" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><fieldset className="welcome-role"><legend>{t('Who are you here for?','¿Para quién buscas ayuda?')}</legend><label><input type="radio" name="welcome-role" checked={role==='student'} onChange={()=>setRole('student')}/>{t('I am a student','Soy estudiante')}</label><label><input type="radio" name="welcome-role" checked={role==='parent'} onChange={()=>setRole('parent')}/>{t('I am a parent or guardian','Soy madre, padre o tutor')}</label></fieldset><button className="button primary" disabled={!name.trim()||!role||saving}>{t('Continue','Continuar')}</button></form>:<>
 <p>{t('Origen helps you understand college, paying for it, and your next steps. Ask in English or Spanish.','Origen te ayuda a entender la universidad, cómo pagarla y tus próximos pasos. Pregunta en español o inglés.')}</p>
 {!addStudent&&<button type="button" className="text-button" disabled={active||saving} onClick={()=>setStep('name')}>{t('Edit my name or role','Editar mi nombre o rol')}</button>}
 <h2>{role==='student'?t('Tell us about yourself','Cuéntanos sobre ti'):t('Tell us about your student','Cuéntanos sobre tu estudiante')}</h2>
 {step==='choice'?<><div className="welcome-tour"><p>{t('Home keeps your profile and conversation summary together. Origen uses those summaries to help you pick up where you left off.','Inicio reúne tu perfil y el resumen de tus conversaciones. Origen usa esos resúmenes para retomar lo que hablaron.')}</p><p>{t('Paying for college explains costs and financial help. Loans covers borrowing and repayment. Applications helps with forms and deadlines. Planning helps you choose classes and next steps.','Pagar la universidad explica costos y ayudas. Préstamos trata de dinero prestado y pagos. Solicitudes ayuda con formularios y fechas. Planificación ayuda con clases y próximos pasos.')}</p></div><p>{t('Talk naturally with Origen, or type what you know. You can review profile details before saving. Conversation summaries save separately and automatically.','Conversa naturalmente con Origen o escribe lo que sabes. Puedes revisar los datos del perfil antes de guardarlos. Los resúmenes se guardan por separado y automáticamente.')}</p><div className="card-actions"><button className="button primary" onClick={()=>setStep('voice')}>{t('Talk with Origen','Hablar con Origen')}</button><button className="button outline" onClick={()=>setStep('manual')}>{t('Enter details myself','Ingresar los datos')}</button></div><button className="text-button" disabled={saving} onClick={()=>void finish()}>{hasStudents?t('Continue to home','Continuar a Inicio'):role==='student'?t('Add my details later','Agregar mis datos después'):t('Add a student later','Agregar un estudiante después')}</button></>:<>
 {(step==='manual')&&<div className={step==='manual'?'welcome-voice-review-only':''}>{!leaving&&<ProfileVoice onBusy={setVoiceBusy} onOnboardingEvent={track} onProfileSaveComplete={onComplete} onSaveProfile={()=>latestVoiceSave.current()} onLanguageChanged={setLanguage} onboarding replayWelcome={!cloud||testMode} recoveryKey={`origen.onboarding.voice.${cloud?user?.sub:'preview'}.${draft.id}`}  profile={draft} language={language} role={role||'parent'} t={t} onActive={setActive} onAccountDraft={addStudent?undefined:updateAccount} onDraft={updateDraft} apply={changes=>{setDraft(prev=>({...prev,...changes}));requestAnimationFrame(()=>review.current?.scrollIntoView({block:'start',behavior:'smooth'}));}}/>}</div>}
 <p className="small-text muted">{t('After you speak in a voice conversation, Origen normally generates a summary automatically when the call ends, without separate approval. During setup, saving it to your account may wait until you save the profile. Find saved summaries in Home.','Después de que hables en una conversación de voz, Origen normalmente genera un resumen automáticamente al terminar la llamada, sin aprobación adicional. Durante el registro, guardarlo en tu cuenta puede esperar hasta que guardes el perfil. Encontrarás los resúmenes guardados en Inicio.')}</p>
 <h3 ref={review} className="welcome-review-heading">{role==='student'?t('Review your profile','Revisa tu perfil'):t('Review your student’s profile','Revisa el perfil de tu estudiante')}</h3>
 <p>{t('Leave anything you don’t know blank. Your student details are saved when you choose Save profile.','Deja en blanco lo que no sabes. Los datos del estudiante se guardan cuando seleccionas Guardar perfil.')}</p>
 <fieldset disabled={active||saving} style={{border:0,padding:0}}><form id="welcome-profile-form" onSubmit={e=>{e.preventDefault();if(!active&&draft.name.trim())finish({...draft,name:draft.name.trim()});}}>
 <label className="field">{role==='student'?t('Your name','Tu nombre'):t('Student name','Nombre del estudiante')}<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label className="field">{t('Education stage','Etapa educativa')}<select value={draft.stage} onChange={e=>setDraft({...draft,stage:e.target.value})}><option value="">{t('Not sure yet','No lo sé todavía')}</option>{['9th grade','10th grade','11th grade','12th grade','Community college','College'].map(s=><option key={s} value={s}>{welcomeStageLabel(s,language)}</option>)}</select></label>
 {([['interest','Interests','Intereses'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['goals','Goals','Metas'],['school','School or college','Escuela o colegio'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes and who shared them','Notas y quién las compartió'],['gpa','Reported GPA (optional)','GPA reportado (opcional)']] as const).map(([field,en,es])=><label className="field" key={field}>{t(en,es)}<textarea maxLength={field==='gpa'?30:2000} value={draft[field]||''} onChange={e=>setDraft({...draft,[field]:e.target.value})}/></label>)}
 <p className="small-text muted">{cloud?t('Saved to your account after you confirm.','Se guarda en tu cuenta después de confirmar.'):t('Saved on this device’s browser.','Se guarda en el navegador de este dispositivo.')}</p>
 <div className="card-actions"><button type="button" className="button outline" disabled={active||saving} onClick={()=>setStep('voice')}>{t('Use voice instead','Usar voz')}</button></div>
 </form></fieldset><div className="welcome-save-bar"><p className="small-text" role="status">{active?t('End the conversation to review and save.','Termina la conversación para revisar y guardar.'):!draft.name.trim()?t('Add voice suggestions to the form or enter a student name to save.','Agrega las sugerencias al formulario o escribe el nombre del estudiante para guardar.'):t('Review the profile before saving.','Revisa el perfil antes de guardar.')}</p><button type="submit" form="welcome-profile-form" className="button primary" disabled={active||saving||!draft.name.trim()||!name.trim()||!role}>{saving?t('Saving…','Guardando…'):t('Save profile','Guardar perfil')}</button></div></> }</>}
 {storageError&&<p role="alert">{t('This browser could not keep your draft. Keep this page open until you save.','Este navegador no pudo conservar el borrador. Mantén esta página abierta hasta guardar.')}</p>}
 {restored&&<p className="small-text">{t('Your unfinished setup was restored on this device.','Se recuperaron tus datos sin terminar en este dispositivo.')}</p>}
 {error&&<p role="alert">{error}</p>}
 </main>;
}
