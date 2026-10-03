import {useState} from 'react';
import ProfileVoice from './ProfileVoice';
import {type StudentProfile} from './planning';

export default function Welcome({language,setLanguage,complete,cloud=false}:{language:'en'|'es';setLanguage:(v:'en'|'es')=>void;cloud?:boolean;complete:(firstName:string,student?:StudentProfile)=>Promise<boolean>}){
 const t=(en:string,es:string)=>language==='es'?es:en;
 const [name,setName]=useState('');
 const [step,setStep]=useState<'name'|'choice'|'voice'|'manual'>('name');
 const [active,setActive]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState<StudentProfile>({id:crypto.randomUUID(),name:'',stage:'',interest:'',gpa:'',color:'lilac'});
 const [saving,setSaving]=useState(false);
 const finish=async(student?:StudentProfile)=>{if(saving)return;setSaving(true);if(!await complete(name.trim(),student))setError(t('Could not save. Your profile has not been confirmed; please try again.','No se pudo guardar. Tu perfil no se ha confirmado; intenta de nuevo.'));setSaving(false);};
 return <main className="application-panel" style={{maxWidth:760,margin:'40px auto',padding:28}}>
 <button className="button outline" onClick={()=>setLanguage(language==='en'?'es':'en')}>{language==='en'?'Español':'English'}</button>
 <p className="eyebrow">{t('WELCOME TO ORIGEN','BIENVENIDO A ORIGEN')}</p>
 <h1>{step==='name'?t('What should we call you?','¿Cómo te llamas?'):t(`Welcome, ${name.trim()}.`,`Bienvenido, ${name.trim()}.`)}</h1>
 {step==='name'?<form onSubmit={e=>{e.preventDefault();if(name.trim())setStep('choice');}}><label className="field">{t('Your first name','Tu nombre')}<input required autoComplete="given-name" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button className="button primary" disabled={!name.trim()}>{t('Continue','Continuar')}</button></form>:<>
 <h2>{t('Tell us about your student','Cuéntanos sobre tu estudiante')}</h2>
 {step==='choice'?<><p>{t('Talk naturally with Origen, or type what you know. You will review everything before saving.','Conversa naturalmente con Origen o escribe lo que sabes. Revisarás todo antes de guardar.')}</p><div className="card-actions"><button className="button primary" onClick={()=>setStep('voice')}>{t('Talk with Origen','Hablar con Origen')}</button><button className="button outline" onClick={()=>setStep('manual')}>{t('Enter details myself','Ingresar los datos')}</button></div><button className="text-button" onClick={()=>finish()}>{t('Add a student later','Agregar un estudiante después')}</button></>:<>
 {step==='voice'&&<ProfileVoice key={language} profile={draft} language={language} role="parent" t={t} onActive={setActive} apply={changes=>setDraft(prev=>({...prev,...changes}))}/>}
 <h3>{t('Review your student’s profile','Revisa el perfil de tu estudiante')}</h3>
 <p>{t('Leave anything you don’t know blank. Nothing is saved until you choose Save profile.','Deja en blanco lo que no sabes. Nada se guarda hasta que selecciones Guardar perfil.')}</p>
 <fieldset disabled={active||saving} style={{border:0,padding:0}}><form onSubmit={e=>{e.preventDefault();if(!active&&draft.name.trim())finish({...draft,name:draft.name.trim()});}}>
 <label className="field">{t('Student name','Nombre del estudiante')}<input required maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label className="field">{t('Education stage','Etapa educativa')}<select value={draft.stage} onChange={e=>setDraft({...draft,stage:e.target.value})}><option value="">{t('Not sure yet','No lo sé todavía')}</option>{['9th grade','10th grade','11th grade','12th grade','Community college','College'].map(s=><option key={s} value={s}>{t(s,s==='Community college'?'Colegio comunitario':s==='College'?'Universidad':`${s.match(/\d+/)?.[0]}.º grado`)}</option>)}</select></label>
 {([['interest','Interests','Intereses'],['activities','Activities and responsibilities','Actividades y responsabilidades'],['goals','Goals','Metas'],['school','School or college','Escuela o colegio'],['institutions','Colleges of interest','Universidades de interés'],['entryTerm','Intended entry term','Período de ingreso'],['needs','Practical needs','Necesidades prácticas'],['notes','Notes and who shared them','Notas y quién las compartió'],['gpa','Reported GPA (optional)','GPA reportado (opcional)']] as const).map(([field,en,es])=><label className="field" key={field}>{t(en,es)}<textarea maxLength={2000} value={draft[field]||''} onChange={e=>setDraft({...draft,[field]:e.target.value})}/></label>)}
 <p className="small-text muted">{cloud?t('Saved to your account after you confirm.','Se guarda en tu cuenta después de confirmar.'):t('Saved on this device’s browser.','Se guarda en el navegador de este dispositivo.')}</p>
 <div className="card-actions"><button className="button primary" disabled={active||saving||!draft.name.trim()}>{t('Save profile','Guardar perfil')}</button><button type="button" className="button outline" disabled={active||saving} onClick={()=>setStep(step==='voice'?'manual':'voice')}>{step==='voice'?t('Continue by typing','Continuar escribiendo'):t('Use voice instead','Usar voz')}</button></div>
 </form></fieldset></> }</>}
 {error&&<p role="alert">{error}</p>}
 </main>;
}
