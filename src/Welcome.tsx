import {onboardingEvents,onboardingFieldPresence,type OnboardingTracker} from './onboardingEvents.mjs';
import {SharedVoiceContext} from './SharedVoiceContext';
import WelcomeWriting from './WelcomeWriting';
import {onboardingFormIntroduction} from './onboardingIntroduction.mjs';
import {onboardingSavedConfirmation} from './voiceWelcome.mjs';
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
 const [restored]=useState(()=>recovery.read<{name:string;step:'name'|'choice'|'voice'|'manual'|'review';role:'parent'|'student'|'';draft:StudentProfile}|null>(null,validOnboardingDraft));
 const [name,setName]=useState(restored?.name||initialName);
 const [step,setStep]=useState<'name'|'choice'|'voice'|'manual'|'review'>(restored?.step==='manual'||restored?.step==='review'?restored.step:'voice');
 const [role,setRole]=useState<'parent'|'student'|''>(restored?.role||initialRole||'');
 const [storageError,setStorageError]=useState(false);
 const completed=useRef(false);
 const [active,setActive]=useState(false),[voiceBusy,setVoiceBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState<StudentProfile>(restored?.draft||initialStudent||{id:crypto.randomUUID(),name:'',stage:'',interest:'',gpa:'',color:'lilac'});
 const [saving,setSaving]=useState(false);
 useEffect(()=>{tracker.open({language,restored:!!restored,method:'voice',captureVersion:3,surface});const visibility=()=>{track(document.hidden?'page_hidden':'page_visible');void tracker.flush();};const pageLeaving=()=>{track('page_leaving');void tracker.flush();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pageLeaving);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pageLeaving);};},[tracker]);
 useEffect(()=>{const timer=setTimeout(()=>tracker.fields(onboardingFieldPresence(name,role,draft)),500);return()=>clearTimeout(timer);},[name,role,draft,tracker]);
 useEffect(()=>{track('setup_method_changed',{method:step==='review'?'manual':step,language});},[step,language,track]);
 const review=useRef<HTMLHeadingElement>(null),story=useRef<HTMLElement>(null);
 const readingUntil=useRef(0),shownFields=useRef<Record<string,string>>({});
 const liveValues=useRef({name,role,draft});liveValues.current={name,role,draft};
 const saveLock=useRef(false);
 const [savedSnapshot,setSavedSnapshot]=useState('');
 const updateAccount=(details:{firstName?:string;role?:'parent'|'student'})=>{if(addStudent)return;const next={...liveValues.current,...(details.firstName===undefined?{}:{name:details.firstName}),...(details.role===undefined?{}:{role:details.role})};liveValues.current=next;setName(next.name);setRole(next.role);};
 const updateDraft=(changes:Partial<StudentProfile>)=>{const next={...liveValues.current.draft,...changes};liveValues.current={...liveValues.current,draft:next};setDraft(next);};
 useEffect(()=>{
  const values:Record<string,string>={account:name+'|'+role,...Object.fromEntries(Object.entries(draft).filter(([key,value])=>!['id','color'].includes(key)&&typeof value==='string'))};
  const changed=Object.keys(values).filter(key=>values[key]&&values[key]!==shownFields.current[key]);shownFields.current=values;
  if(step!=='voice'||!changed.length)return;
  const frame=requestAnimationFrame(()=>{
   const node=story.current;if(!node||performance.now()<readingUntil.current||document.activeElement?.matches('input,textarea,select,[contenteditable=true]')||window.getSelection()?.isCollapsed===false)return;
   const field=Array.from(node.querySelectorAll<HTMLElement>('[data-welcome-field]')).find(element=>changed.includes(element.dataset.welcomeField||''));if(!field)return;
   const bounds=node.getBoundingClientRect(),target=field.getBoundingClientRect();
   if(target.top>=bounds.top+16&&target.bottom<=bounds.bottom-16)return;
   node.scrollTo({top:Math.max(0,node.scrollTop+target.top-bounds.top-24),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });return()=>cancelAnimationFrame(frame);
 },[name,role,draft,step]);
 useEffect(()=>{if(!completed.current)setStorageError(!recovery.write({name,step,role,draft}));},[name,step,role,draft,recovery]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(!completed.current&&(name.trim()||draft.name.trim()||active)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[name,draft,active]);
 const signOut=async()=>{if(leaving)return;completed.current=true;setLeaving(true);setActive(false);setError('');try{await logout({logoutParams:{returnTo:window.location.origin}});if(browserPrivacy.valid()){completed.current=false;setLeaving(false);}}catch{completed.current=false;setLeaving(false);setError(t('Could not log out. Please try again.','No se pudo cerrar sesión. Inténtalo de nuevo.'));}};
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
  return await finish(current.draft,true,'voice')?{status:'saved' as const,instruction:onboardingSavedConfirmation()}:{status:'save_failed' as const,instruction:'The profile could not be saved. Tell the user and offer to retry. Keep talking without claiming a successful save.'};
 };
 const saveFromButton=async()=>{
  if(voiceBusy)return;
  if(await finish(liveValues.current.draft,!!sharedVoice?.active)){
   if(sharedVoice?.active&&!sharedVoice.profileSaved())onComplete();
  }
 };
 const latestVoiceSave=useRef(saveByVoice);latestVoiceSave.current=saveByVoice;
 const saved=savedSnapshot===JSON.stringify({name:name.trim(),role,draft:{...draft,name:draft.name.trim()}});
 const currentProgress=saved?'binder':step==='review'||name.trim()&&role&&draft.name.trim()?'review':'details';
 const progress=<ol className="welcome-progress" aria-label={t('Profile setup','Configuración del perfil')}>{[[t('Student details','Datos del estudiante'),'details'],[t('Review & save','Revisar y guardar'),'review'],[t('Your binder','Tu carpeta'),'binder']].map(([label,id],i)=><li key={id} aria-current={id===currentProgress?'step':undefined}><span aria-hidden="true">{i+1}</span>{label}</li>)}</ol>;
 const profileDetails=([['name','Student name','Nombre del estudiante'],['stage','Education stage','Etapa educativa'],['school','School or college','Escuela o colegio'],['interest','Interests','Intereses'],['goals','Goals','Metas'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes','Notas'],['gpa','Reported GPA','GPA reportado']] as const).filter(([field])=>draft[field]?.trim());
 useEffect(()=>{if(step==='review'){const frame=requestAnimationFrame(()=>{review.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});});return()=>cancelAnimationFrame(frame);}},[step]);
 if(step==='review')return <main className="application-panel welcome-panel welcome-profile-review">
  <header className="welcome-header-actions">{skipButton}{logoutButton}</header>{progress}
  <h1 ref={review} tabIndex={-1}>{t('Ready for your binder?','¿Listo para tu carpeta?')}</h1><p>{t('Check your details, then save to open your home page. You can update them later.','Revisa tus datos y guárdalos para abrir tu página de inicio. Puedes actualizarlos después.')}</p>
  <dl className="welcome-review-details"><div><dt>{t('Account holder','Titular de la cuenta')}</dt><dd>{name} · {role==='student'?t('Student','Estudiante'):t('Parent or guardian','Madre, padre o tutor')}</dd></div>{profileDetails.map(([field,en,es])=><div key={field}><dt>{t(en,es)}</dt><dd>{field==='stage'?welcomeStageLabel(draft[field]||'',language):draft[field]}</dd></div>)}</dl>
  {error&&<p role="alert">{error}</p>}{storageError&&<p role="alert">{t('Keep this page open until your profile is saved.','Mantén esta página abierta hasta guardar el perfil.')}</p>}
  <div className="welcome-review-actions"><button type="button" className="button outline" disabled={saving} onClick={()=>setStep('manual')}>{t('Edit details','Editar datos')}</button><button type="button" className="button primary" disabled={saving||!name.trim()||!role||!draft.name.trim()} onClick={()=>void saveFromButton()}>{saving?t('Saving…','Guardando…'):t('Save profile','Guardar perfil')}</button></div>
 </main>;
 if(step==='voice')return <main className={`welcome-conversation${saved?' welcome-save-complete':''}`} aria-busy={saving}>
  <header className="welcome-conversation-header"><a href="#" data-navigation-ignore onClick={e=>e.preventDefault()} className="welcome-wordmark" aria-label="Origen">origen<span>.</span></a><div className="welcome-header-actions"><button className="button outline" disabled={active||saving||leaving} onClick={()=>setLanguage(language==='en'?'es':'en')}>{language==='en'?'Español':'English'}</button>{skipButton}{logoutButton}</div></header>
  {progress}<section ref={story} className="welcome-story" aria-labelledby="welcome-story-title" onWheel={()=>{readingUntil.current=performance.now()+4500;}} onTouchStart={()=>{readingUntil.current=performance.now()+4500;}} onKeyDown={event=>{if(['PageUp','PageDown','ArrowUp','ArrowDown','Home','End'].includes(event.key))readingUntil.current=performance.now()+4500;}}><h1 id="welcome-story-title">{addStudent?t('Add another student','Agregar otro estudiante'):name.trim()?t('Welcome, '+name.trim()+'.','Bienvenido, '+name.trim()+'.'):t('Welcome to Origen.','Bienvenido a Origen.')}</h1>
  <p className="welcome-story-intro">{onboardingFormIntroduction(language)}</p>
  <div className="welcome-live-notes" aria-label={t('Profile draft','Borrador del perfil')}>
   {!addStudent&&<section className="welcome-live-note" data-welcome-field="account"><h2>{t('About you','Sobre ti')}</h2>{name.trim()?<WelcomeWriting text={name.trim()+(role?' · '+(role==='student'?t('Student','Estudiante'):t('Parent or guardian','Madre, padre o tutor')):'')}/>:<p className="welcome-field-placeholder">{t('What should we call you?','¿Cómo te llamamos?')}</p>}</section>}
   {([['name','Student name','Nombre del estudiante'],['stage','Education stage','Etapa educativa'],['school','School or college','Escuela o colegio'],['interest','Interests','Intereses'],['goals','Goals','Metas'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes','Notas'],['gpa','Reported GPA','GPA reportado']] as const).filter(([field])=>field==='name'||field==='stage'||draft[field]?.trim()).map(([field,en,es])=><section className="welcome-live-note" data-welcome-field={field} key={field}><h2>{t(en,es)}</h2>{draft[field]?.trim()?<WelcomeWriting text={field==='stage'?welcomeStageLabel(draft[field]||'',language):draft[field]||''}/>:<p className="welcome-field-placeholder">{field==='name'?t('We’ll start here.','Empezaremos aquí.'):t('High school, community college, or college','Secundaria, colegio comunitario o universidad')}</p>}</section>)}
  </div><p className="welcome-draft-status" role="status">{saved?t('Profile saved.','Perfil guardado.'):voiceBusy?t('Wait for Origen to finish your last reply before saving.','Espera a que Origen termine la última respuesta antes de guardar.'):active?t('Drafting your profile · You can correct a detail out loud.','Creando tu perfil · Puedes corregir un dato en voz alta.'):draft.name.trim()?t('Your draft is ready to review. You can edit details before saving.','Tu borrador está listo para revisar. Puedes editarlo antes de guardar.'):t('Press below to start the conversation.','Presiona abajo para iniciar la conversación.')}</p></section>
  <footer className="welcome-conversation-dock">{!leaving&&<ProfileVoice onBusy={setVoiceBusy} onOnboardingEvent={track} onProfileSaveComplete={onComplete} onSaveProfile={()=>latestVoiceSave.current()} onLanguageChanged={setLanguage} onboarding autoStart={addStudent} replayWelcome={!cloud||testMode} recoveryKey={`origen.onboarding.voice.${cloud?user?.sub:'preview'}.${draft.id}`} profile={draft} language={language} role={role||'parent'} t={t} onActive={setActive} onAccountDraft={addStudent?undefined:updateAccount} onDraft={updateDraft} apply={updateDraft}/>}
   <div className="welcome-conversation-actions"><button className="text-button" disabled={active||saving} onClick={()=>setStep('manual')}>{t('Edit details','Editar datos')}</button><button className="button primary" disabled={saving||voiceBusy} onClick={()=>{if(active)void saveFromButton();else setStep(name.trim()&&role&&draft.name.trim()?'review':'manual');}}>{saving?t('Saving…','Guardando…'):active?t('Save profile','Guardar perfil'):t('Review profile','Revisar perfil')}</button></div>
   {storageError&&<p role="alert">{t('Your draft could not be backed up. Keep this page open until you save.','No se pudo conservar el borrador. Mantén esta página abierta hasta guardar.')}</p>}{error&&<p role="alert">{error}</p>}
  </footer></main>;
 return <main className={`application-panel welcome-panel${step==='manual'?' welcome-profile-step':''}`}>
 <div className="welcome-header-actions">{skipButton}{logoutButton}</div>
 <button className="button outline" disabled={active||saving} onClick={()=>setLanguage(language==='en'?'es':'en')}>{language==='en'?'Español':'English'}</button>
 {progress}<p className="eyebrow">{t('WELCOME TO ORIGEN','BIENVENIDO A ORIGEN')}</p>
 <h1 ref={step==='manual'?review:undefined} tabIndex={-1}>{addStudent?t('Add another student','Agregar otro estudiante'):step==='manual'?t('Student details','Datos del estudiante'):step==='name'?t('What should we call you?','¿Cómo te llamas?'):t(`Welcome, ${name.trim()}.`,`Bienvenido, ${name.trim()}.`)}</h1>
 {step==='name'?<form onSubmit={e=>{e.preventDefault();if(name.trim()&&role)setStep('choice');}}><label className="field">{t('Account first name','Nombre de la cuenta')}<input required autoComplete="given-name" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><fieldset className="welcome-role"><legend>{t('Who are you here for?','¿Para quién buscas ayuda?')}</legend><label><input type="radio" name="welcome-role" checked={role==='student'} onChange={()=>setRole('student')}/>{t('I am a student','Soy estudiante')}</label><label><input type="radio" name="welcome-role" checked={role==='parent'} onChange={()=>setRole('parent')}/>{t('I am a parent or guardian','Soy madre, padre o tutor')}</label></fieldset><button className="button primary" disabled={!name.trim()||!role||saving}>{t('Continue','Continuar')}</button></form>:<>
 {step==='choice'&&<p>{t('Origen helps you understand college, paying for it, and your next steps. Ask in English or Spanish.','Origen te ayuda a entender la universidad, cómo pagarla y tus próximos pasos. Pregunta en español o inglés.')}</p>}
 {!addStudent&&step==='choice'&&<button type="button" className="text-button" disabled={active||saving} onClick={()=>setStep('name')}>{t('Edit my name or role','Editar mi nombre o rol')}</button>}
 {step==='choice'&&<h2>{role==='student'?t('Tell us about yourself','Cuéntanos sobre ti'):t('Tell us about your student','Cuéntanos sobre tu estudiante')}</h2>}
 {step==='choice'?<><div className="welcome-tour"><p>{t('Home keeps your profile and conversation summary together. Origen uses those summaries to help you pick up where you left off.','Inicio reúne tu perfil y el resumen de tus conversaciones. Origen usa esos resúmenes para retomar lo que hablaron.')}</p><p>{t('Paying for college explains costs and financial help. Loans covers borrowing and repayment. Applications helps with forms and deadlines. Planning helps you choose classes and next steps.','Pagar la universidad explica costos y ayudas. Préstamos trata de dinero prestado y pagos. Solicitudes ayuda con formularios y fechas. Planificación ayuda con clases y próximos pasos.')}</p></div><p>{t('Talk naturally with Origen, or type what you know. You can review profile details before saving. Conversation summaries save separately and automatically.','Conversa naturalmente con Origen o escribe lo que sabes. Puedes revisar los datos del perfil antes de guardarlos. Los resúmenes se guardan por separado y automáticamente.')}</p><div className="card-actions"><button className="button primary" onClick={()=>setStep('voice')}>{t('Talk with Origen','Hablar con Origen')}</button><button className="button outline" onClick={()=>setStep('manual')}>{t('Enter details myself','Ingresar los datos')}</button></div><button className="text-button" disabled={saving} onClick={()=>void finish()}>{hasStudents?t('Continue to home','Continuar a Inicio'):role==='student'?t('Add my details later','Agregar mis datos después'):t('Add a student later','Agregar un estudiante después')}</button></>:<>
 {(step==='manual')&&<div className={step==='manual'?'welcome-voice-review-only':''}>{!leaving&&<ProfileVoice onBusy={setVoiceBusy} onOnboardingEvent={track} onProfileSaveComplete={onComplete} onSaveProfile={()=>latestVoiceSave.current()} onLanguageChanged={setLanguage} onboarding replayWelcome={!cloud||testMode} recoveryKey={`origen.onboarding.voice.${cloud?user?.sub:'preview'}.${draft.id}`}  profile={draft} language={language} role={role||'parent'} t={t} onActive={setActive} onAccountDraft={addStudent?undefined:updateAccount} onDraft={updateDraft} apply={changes=>{setDraft(prev=>({...prev,...changes}));requestAnimationFrame(()=>review.current?.scrollIntoView({block:'start',behavior:'smooth'}));}}/>}</div>}
 <p>{t('Leave anything you don’t know blank. Your student details are saved when you choose Save profile.','Deja en blanco lo que no sabes. Los datos del estudiante se guardan cuando seleccionas Guardar perfil.')}</p>
 <fieldset disabled={active||saving} style={{border:0,padding:0}}><form id="welcome-profile-form" onSubmit={e=>{e.preventDefault();if(!active&&draft.name.trim()&&name.trim()&&role){setError('');setStep('review');}}}>
 {!addStudent&&<div className="welcome-account-fields"><label className="field">{t('Account first name','Nombre de la cuenta')}<input required autoComplete="given-name" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="field">{t('I am a','Soy')}<select required value={role} onChange={e=>setRole(e.target.value as 'parent'|'student')}><option value="" disabled>{t('Choose one','Elige una opción')}</option><option value="student">{t('Student','Estudiante')}</option><option value="parent">{t('Parent or guardian','Madre, padre o tutor')}</option></select></label></div>}
 <label className="field">{role==='student'?t('Your name','Tu nombre'):t('Student name','Nombre del estudiante')}<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label className="field">{t('Education stage','Etapa educativa')}<select value={draft.stage} onChange={e=>setDraft({...draft,stage:e.target.value})}><option value="">{t('Not sure yet','No lo sé todavía')}</option>{['9th grade','10th grade','11th grade','12th grade','Community college','College'].map(s=><option key={s} value={s}>{welcomeStageLabel(s,language)}</option>)}</select></label>
 <details className="welcome-optional-details"><summary>{t('More about the student (optional)','Más sobre el estudiante (opcional)')}</summary>
 {([['interest','Interests','Intereses'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['goals','Goals','Metas'],['school','School or college','Escuela o colegio'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes and who shared them','Notas y quién las compartió'],['gpa','Reported GPA (optional)','GPA reportado (opcional)']] as const).map(([field,en,es])=><label className="field" key={field}>{t(en,es)}<textarea maxLength={field==='gpa'?30:2000} value={draft[field]||''} onChange={e=>setDraft({...draft,[field]:e.target.value})}/></label>)}</details>
 <p className="small-text muted">{cloud?t('Saved to your account after you confirm.','Se guarda en tu cuenta después de confirmar.'):t('Saved on this device’s browser.','Se guarda en el navegador de este dispositivo.')}</p>
 <div className="card-actions"><button type="button" className="button outline" disabled={active||saving} onClick={()=>setStep('voice')}>{t('Use voice instead','Usar voz')}</button></div>
 </form></fieldset><div className="welcome-save-bar"><p className="small-text" role="status">{active?t('End the conversation to review and save.','Termina la conversación para revisar y guardar.'):!draft.name.trim()?t('Add voice suggestions to the form or enter a student name to save.','Agrega las sugerencias al formulario o escribe el nombre del estudiante para guardar.'):t('Review the profile before saving.','Revisa el perfil antes de guardar.')}</p><button type="submit" form="welcome-profile-form" className="button primary" disabled={active||saving||!draft.name.trim()||!name.trim()||!role}>{t('Review profile','Revisar perfil')}</button></div></> }</>}
 {storageError&&<p role="alert">{t('This browser could not keep your draft. Keep this page open until you save.','Este navegador no pudo conservar el borrador. Mantén esta página abierta hasta guardar.')}</p>}
 {restored&&<p className="small-text">{t('Your unfinished setup was restored on this device.','Se recuperaron tus datos sin terminar en este dispositivo.')}</p>}
 {error&&<p role="alert">{error}</p>}
 </main>;
}
