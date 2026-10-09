import {voiceSaveCompletion} from './voiceSaveCompletion.mjs';
import {onboardingVoiceDiagnostics} from './onboardingVoiceDiagnostics.mjs';
import {voiceProfileSaveTools,type VoiceProfileSaveResult} from './voiceProfileSave.mjs';
import {holdConversation,releaseConversation,researchModeForTool} from './liveConversation.mjs';
import {voiceDraft} from './voiceDraft.mjs';
import {guidanceHistory} from './guidanceHistory.mjs';
import {onboardingRecovery} from './onboardingRecovery.mjs';
import {voiceLanguageControl,voiceLanguageTools,spokenLanguageFromText} from './voiceLanguage.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from './voiceWelcome.mjs';
import VoiceWave from './VoiceWave';
import {SharedVoiceContext} from './SharedVoiceContext';
import {voiceResearchCache,voiceResearchBudget,wantsFreshLookup} from './voiceResearchCache.mjs';
import {voiceResearchProgress,researchEvidence} from './voiceResearchProgress.mjs';
import {useFamily} from './FamilyStore';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {useConversationHistory} from './ConversationHistory';
import {voiceTurns} from './voiceTurns.mjs';
import {voiceErrorEndsSession,voiceReplyCanRetry} from './voiceErrors.mjs';
import {voiceConnectionRecovery,voiceProfile} from './voiceConnection.mjs';
import {voiceWakeLock,type VoiceWakeLockStatus} from './voiceWakeLock.mjs';
import {summarySaveQueue} from './summarySaveQueue.mjs';
import {appendConversationTurn,mergeConversationSources,recentConversationMemory} from './voiceMemory.mjs';
import {resolveScope,beforeScopeRequest} from './conversationScope.mjs';
import { useContext, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import {loadLocal,saveLocal,type StudentProfile} from './planning';
import './ProfileVoice.css';

const labels = {
  name:['Student name','Nombre'],stage:['Education stage','Etapa educativa'],gpa:['Reported GPA','GPA reportado'],school:['School','Escuela'],interest:['Academic interests','Intereses académicos'],activities:['Activities and responsibilities','Actividades y responsabilidades'],goals:['Goals','Metas'],needs:['Practical needs','Necesidades prácticas'],notes:['Attributed notes','Notas con atribución'],institutions:['Institutions of interest','Instituciones de interés'],entryTerm:['Intended entry term','Período de ingreso'],
} as const;
type Field = keyof typeof labels;
type Suggestions = Partial<Record<Field,string>>;
export type VoiceHandoff={studentId:string|null;confirmed:boolean;language:'en'|'es';turns:{role:'user'|'assistant';text:string}[]};
export type VoiceProps={onOnboardingEvent?:(name:string,metadata?:Record<string,unknown>)=>void;profileSaved?:number;onProfileSaveComplete?:()=>void;onSaveProfile?:()=>Promise<VoiceProfileSaveResult>;onLanguageChanged?:(language:'en'|'es')=>void;onAccountDraft?:(details:{firstName:string;role:'parent'|'student'})=>void;onDraft?:(changes:Suggestions)=>void;recoveryKey?:string;onGuideChanged?:(mode:'finance'|'admissions'|'planning'|'loans')=>void;switchGuideMode?:'finance'|'admissions'|'planning'|'loans';detailsOpen?:boolean;onCloseDetails?:()=>void;continuity?:VoiceHandoff;onHandoff?:(mode:'finance'|'admissions'|'planning'|'loans',context:VoiceHandoff)=>void;onSwitchGuide?:(context:VoiceHandoff)=>void;switchGuideLabel?:string;onRestart?:()=>void;ownerId?:string;autoStart?:boolean;onboarding?:boolean;replayWelcome?:boolean;mode?:'profile'|'finance'|'admissions'|'planning'|'loans';profile:StudentProfile;language:'en'|'es';role:'parent'|'student';apply:(changes:Suggestions)=>void;onActive:(active:boolean)=>void;t:(en:string,es:string)=>string};
export default function ProfileVoice(props:VoiceProps){
 const shared=useContext(SharedVoiceContext);
 const localOwner=useRef(crypto.randomUUID());
 useEffect(()=>{if(props.onboarding)shared?.syncOnboarding(props);},[props.profile,props.role,props.language]);
 if(shared&&props.onboarding)return <section className="profile-voice voice-launcher"><button type="button" className="button primary" onClick={()=>{if(!shared.active)props.onOnboardingEvent?.('voice_button_pressed',{language:props.language});shared.active?shared.open():shared.launch(props);}}>{shared.active?props.t('Open current conversation','Abrir conversación actual'):props.t('Start live conversation','Iniciar conversación en vivo')}</button></section>;
 if(!shared)return <LocalProfileVoice {...props}/>;
 if(props.mode&&props.mode!=='profile')return <section className="profile-voice voice-launcher"><h3>{props.t('Talk with Origen','Hablar con Origen')}</h3><p>{props.t('Keep talking while you explore the app. Your current guide stays with you until you end the conversation.','Sigue conversando mientras exploras la app. Tu guia continua contigo hasta que termines la conversacion.')}</p><button className="button primary" onClick={()=>shared.active?shared.open():shared.launch(props)}>{shared.active?props.t('Open current conversation','Abrir conversacion actual'):props.t('Start live conversation','Iniciar conversacion en vivo')}</button></section>;
 if(shared.active&&shared.owner!==localOwner.current)return <p role="status">{props.t('End your current voice conversation before starting profile setup.','Termina la conversacion actual antes de iniciar el perfil.')} <button className="text-button" onClick={shared.open}>{props.t('Open conversation','Abrir conversacion')}</button></p>;
 return <LocalProfileVoice {...props} ownerId={localOwner.current}/>;
}
export function LocalProfileVoice({onOnboardingEvent,profileSaved,onProfileSaveComplete,onSaveProfile,onLanguageChanged,onAccountDraft,onDraft,profile:initialProfile,language,role,apply,onActive,t,mode:initialMode='profile',onboarding=false,replayWelcome=false,autoStart=false,ownerId='shared',onRestart,onSwitchGuide,onHandoff,continuity,switchGuideLabel,detailsOpen=false,onCloseDetails,onGuideChanged,switchGuideMode,recoveryKey}:VoiceProps) {
  const latestOnboardingEvent=useRef(onOnboardingEvent);latestOnboardingEvent.current=onOnboardingEvent;
  const onboardingEndReason=useRef('unknown');
  function trackOnboarding(name:string,metadata:Record<string,unknown>={}){try{latestOnboardingEvent.current?.(name,{...metadata,voiceSessionId:logSession.current,voiceAttemptId:logAttempt.current});}catch{/* Tracking never interrupts a conversation. */}}
  const latestSetup=useRef({profile:initialProfile,role,onProfileSaveComplete});latestSetup.current={profile:initialProfile,role,onProfileSaveComplete};
  const transitioned=useRef(false);
  const transitionToHome=useRef<(()=>Promise<void>)|null>(null);
  useEffect(()=>{if(profileSaved)void transitionToHome.current?.();},[profileSaved]);
  const latestSaveComplete=useRef(onProfileSaveComplete);latestSaveComplete.current=onProfileSaveComplete;
  const saveCompletion=useRef<ReturnType<typeof voiceSaveCompletion>|null>(null);
  const onboardingVoice=useRef<ReturnType<typeof onboardingVoiceDiagnostics>|null>(null);
  const homeIntroduction=useRef<ReturnType<typeof voiceSaveCompletion>|null>(null);
  const latestProfileSave=useRef(onSaveProfile);latestProfileSave.current=onSaveProfile;
  const [mode,setMode]=useState(initialMode);
  const liveMode=useRef(initialMode);
  const [switchingGuide,setSwitchingGuide]=useState(false);
  const shared=useContext(SharedVoiceContext);
  const history=useConversationHistory();
  const latestHistory=useRef(history);latestHistory.current=history;
  const family=useFamily();const {getAccessTokenSilently,user}=useAuth0();
  const voiceUsageKey=user?.sub?`origen.user.${user.sub}.voice-used.v1`:'camino.voice-used.v1';
  const spokenLanguage=useRef(continuity?.language||language);
  const screenLanguage=useRef(language);
  const routing=role==='parent'&&mode!=='profile';
  const [target,setTarget]=useState<{id:string|null;confirmed:boolean}>({id:continuity?continuity.studentId:initialProfile.id||null,confirmed:continuity?.confirmed||false});

  const scopePending=useRef(false);
  const profile=voiceProfile(mode,initialProfile,family.students,target.id);
  const summaryScope=useRef<{id:string|null;name:string;confirmed:boolean}>({id:initialProfile.id||null,name:initialProfile.name,confirmed:!routing});
  const summaryToken=useRef<string|undefined>(undefined);const summaryId=useRef('');
  const guidanceTokens=useRef(new Map<string,string>());
  const guidance=useRef(guidanceHistory(body=>{const token=guidanceTokens.current.get((body as {sessionId:string}).sessionId);if(!token)return Promise.resolve();return apiFetch('/api/guidance-history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),keepalive:true}).then(response=>{if(!response.ok)throw new Error('guidance_event_failed');});}));
  const sessionTurns=useRef<{role:'user'|'assistant';text:string;topic?:string;language?:'en'|'es';expectedLanguage?:'en'|'es'}[]>([]);
  const sessionSources=useRef<{title:string;url:string;checkedAt:string}[]>([]);
  const memorySaved=useRef(true);
  const [savingSummary,setSavingSummary]=useState(false);
  const summaryQueue=useRef(shared?.queue||summarySaveQueue());
  const [summaryFailed,setSummaryFailed]=useState(false);
  async function retrySummaries(){
    setSavingSummary(true);setSummaryFailed(false);shared?.reportSave(false,true);
    try{await summaryQueue.current.flush();}
    catch{setSummaryFailed(true);shared?.reportSave(true,false);}
    finally{setSavingSummary(false);if(!summaryQueue.current.size)shared?.reportSave(false,false);}
  }
  function checkpointSummary(){
    if(!sessionTurns.current.some(turn=>turn.role==='user')||!summaryId.current||!summaryScope.current.confirmed)return;
    const store=onboardingRecovery(localStorage,`origen.onboarding-summaries.${history.cloud?user?.sub:'preview'}`);
    const records=store.read<Record<string,unknown>>({});
    records[summaryId.current]={id:summaryId.current,studentId:summaryScope.current.id,scopeName:summaryScope.current.name,mode:liveMode.current,language:spokenLanguage.current,date:new Date().toISOString(),turns:sessionTurns.current,qualitySessionId:logSession.current,qualityComplete:false,sources:sessionSources.current,guidance:guidance.current.attribution()};
    if(!store.write(records))setNotice(t('Keep this page open until the summary saves.','Mantén esta página abierta hasta guardar el resumen.'));
  }
  async function saveSummary(){
    if(memorySaved.current||!summaryScope.current.confirmed||!sessionTurns.current.some(t=>t.role==='user'))return;
    const studentId=summaryScope.current.id,scopeName=summaryScope.current.name;
    checkpointSummary();
    memorySaved.current=true;const turns=[...sessionTurns.current];const sources=[...sessionSources.current];const id=summaryId.current||crypto.randomUUID();setSavingSummary(true);
    const body=JSON.stringify({turns,qualitySessionId:logSession.current,qualityComplete:true,language:spokenLanguage.current,id,scopeName,defer:studentId!==null&&history.cloud&&!family.students.some(student=>student.id===studentId),studentId,date:new Date().toISOString(),mode:liveMode.current,sources,guidance:guidance.current.attribution()});
    const savedMode=liveMode.current;
    const subject=history.cloud?user?.sub:undefined,date=new Date().toISOString();
    summaryQueue.current.add(id,async()=>{let token:string|undefined;if(subject){token=await getAccessTokenSilently();if(!token)throw new Error('authentication_required');let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}if(tokenSubject!==subject)throw new Error('summary_account_changed');}const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body,keepalive:new TextEncoder().encode(body).length<60000});if(!response.ok)throw new Error();const {summary}=await response.json();await latestHistory.current.add({id,studentId,date,mode:savedMode,summary,sources});{const store=onboardingRecovery(localStorage,`origen.onboarding-summaries.${subject||'preview'}`);store.removeEntry(id);}});
    await retrySummaries();
  }
  const informational=mode!=='profile';
  const [state,setState]=useState<'idle'|'connecting'|'live'>('idle');
  useEffect(()=>{if(state==='idle'&&screenLanguage.current!==language){screenLanguage.current=language;spokenLanguage.current=language;}},[language,state]);
  const [muted,setMuted]=useState(false);
  const [activity,setActivity]=useState<'listening'|'thinking'|'speaking'>('listening');
  const [latestAnswer,setLatestAnswer]=useState('');


  const [finishing,setFinishing]=useState(false);
  const finishPromise=useRef<Promise<void>|null>(null);
  const awaitingTranscription=useRef(new Set<string>());
  const speechInProgress=useRef(false);
  const assistantSpeaking=useRef(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [audioBlocked,setAudioBlocked]=useState(false);
  const [wakeStatus,setWakeStatus]=useState<VoiceWakeLockStatus>('hidden');
  const [draftRecovery]=useState(()=>recoveryKey?onboardingRecovery(localStorage,recoveryKey):null);
  const [draftSuggestions]=useState(()=>voiceDraft<Suggestions>(draftRecovery,!!onDraft));
  const [changes,setChanges]=useState<Suggestions>(()=>draftSuggestions.read());
  useEffect(()=>{if(!draftSuggestions.write(changes))setNotice(t('Keep this page open until you save; voice suggestions could not be backed up.','Mantén la página abierta hasta guardar; no se pudo conservar las sugerencias.'));},[changes,draftSuggestions]);
  const [sources,setSources]=useState<{title:string;url:string;checkedAt:string}[]>([]);
  const [diagnosticId,setDiagnosticId]=useState('');
  const [failureCode,setFailureCode]=useState('');

  const usage=useRef<{id:string;timer?:ReturnType<typeof setInterval>}>({id:''});
  const usageQueue=useRef(Promise.resolve());
  function usageEvent(action:string,id=usage.current.id){if(!id)return;usageQueue.current=usageQueue.current.catch(()=>{}).then(()=>apiFetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,topic:liveMode.current}),keepalive:true})).then(()=>{});}
  const logSession=useRef('');
  const logAttempt=useRef('');
  const logSequence=useRef(0);
  function log(event:string,details:Record<string,unknown>={}){
    if(!logSession.current)return;
    if(event==='connection_failure'){onboardingEndReason.current=details.code==='connection_timeout'?'connection_timeout':details.code==='connection_lost'?'connection_lost':'connection_failed';trackOnboarding('voice_connection_failed',details);}
    void apiFetch('/api/voice-diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:logSession.current,attemptId:logAttempt.current,sequence:++logSequence.current,event,...details}),keepalive:true}).catch(()=>{});
  }
  const researchStarted=useRef(0);
  const [researching,setResearching]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const resources=useRef<{pc?:RTCPeerConnection;stream?:MediaStream;dc?:RTCDataChannel;abort?:AbortController;timer?:ReturnType<typeof setInterval>;deadline?:ReturnType<typeof setTimeout>;stopWake?:()=>void;stopProgress?:()=>void;stopConnection?:()=>void;stopTurns?:()=>void;turnsBusy?:()=>boolean;stopGuide?:()=>void;switchGuide?:(mode:'finance'|'admissions'|'planning'|'loans',initialScope?:{id:string|null;confirmed:true})=>Promise<boolean>}>({});
  const generation=useRef(0);
  const finalReason=useRef<'completed'|'disconnected'|'failed'>('disconnected');
  const preserveLogicalSession=useRef(false);
  const audio=useRef<HTMLAudioElement>(null);
  function cleanup(){
    void saveSummary();releaseConversation(summaryId.current);
    if(!preserveLogicalSession.current)void guidance.current.event('voice.ended',{reason:finalReason.current})?.catch(()=>{});
    clearInterval(usage.current.timer);usageEvent('voice_end');usage.current={id:''};
    homeIntroduction.current?.ended(onboardingEndReason.current);homeIntroduction.current=null;
    onboardingVoice.current?.stop();onboardingVoice.current=null;
    if(logSession.current)trackOnboarding('voice_ended',{reason:onboardingEndReason.current});
    log('session_cleanup');logSession.current='';
    generation.current++;
    const r=resources.current;resources.current={};
    r.abort?.abort();clearInterval(r.timer);clearTimeout(r.deadline);
    transitionToHome.current=null;
    r.stopWake?.();r.stopProgress?.();
    r.stopConnection?.();r.stopTurns?.();r.stopGuide?.();
    if(r.dc){r.dc.onclose=null;r.dc.close();}
    if(r.pc){r.pc.onconnectionstatechange=null;r.pc.close();}
    r.stream?.getTracks().forEach(track=>track.stop());
    if(audio.current){audio.current.pause();audio.current.srcObject=null;}
  }
  function end(){saveCompletion.current?.ended(onboardingEndReason.current);cleanup();preserveLogicalSession.current=false;setResearching(false);setState('idle');setMuted(false);scopePending.current=false;setTarget(previous=>({...previous,confirmed:false}));onActive(false);shared?.claim(ownerId,false);}
  function handoffContext():VoiceHandoff{return {studentId:summaryScope.current.id,confirmed:summaryScope.current.confirmed,language:spokenLanguage.current,turns:sessionTurns.current.slice(-8).map(turn=>({...turn,text:turn.text.slice(0,2000)}))};}
  function finishCall(drain=true,preserveSession=false){
    if(finishPromise.current)return finishPromise.current;
    setFinishing(true);
    resources.current.stream?.getAudioTracks().forEach(track=>{track.enabled=false;});
    const dc=resources.current.dc;
    if(speechInProgress.current&&dc?.readyState==='open')dc.send(JSON.stringify({type:'input_audio_buffer.commit'}));
    const task=Promise.resolve().then(async()=>{
      const deadline=Date.now()+15000;
      while(drain&&resources.current.dc?.readyState==='open'&&(awaitingTranscription.current.size||assistantSpeaking.current||resources.current.turnsBusy?.())&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
      if(drain&&resources.current.dc?.readyState==='open'&&(awaitingTranscription.current.size||resources.current.turnsBusy?.()))setError(t('The last reply did not finish. Review your profile for missing details before saving.','La última respuesta no terminó. Revisa si faltan datos en tu perfil antes de guardar.'));
      preserveLogicalSession.current=preserveSession;finalReason.current=drain?'completed':'disconnected';end();
    });
    finishPromise.current=task.finally(()=>{setFinishing(false);finishPromise.current=null;});
    return finishPromise.current;
  }
  const selectedProfileId=useRef(initialProfile.id);
  useEffect(()=>{
    if(selectedProfileId.current===initialProfile.id)return;
    selectedProfileId.current=initialProfile.id;
    const id=initialProfile.id||null;
    if(routing&&state==='live'){


      const dc=resources.current.dc;
      if(dc?.readyState==='open'){
        dc.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'The parent selected another student on screen. Ask one short spoken question to clarify whether they want to discuss that student. Once they answer clearly, call request_conversation_target. No on-screen confirmation is needed.'}]}}));
      }
    }else if(state==='idle')setTarget({id,confirmed:false});
  },[initialProfile.id,routing,state]);
  const latestCleanup=useRef(cleanup);
  useEffect(()=>{latestCleanup.current=cleanup;});
  useEffect(()=>()=>{latestCleanup.current();onActive(false);shared?.claim(ownerId,false);},[]);
  async function start(scope=target,sessionLanguage=spokenLanguage.current,spokenRequest='',continuingSession=''){
    if(resources.current.abort)return;
    if(shared&&!shared.claim(ownerId,true))return;
    const profile=voiceProfile(mode,initialProfile,family.students,scope.id);
    summaryScope.current={id:scope.id,name:profile.name,confirmed:!routing||scope.confirmed};

    scopePending.current=false;
    spokenLanguage.current=sessionLanguage;
    awaitingTranscription.current.clear();speechInProgress.current=false;assistantSpeaking.current=false;
    const sessionId=continuingSession||crypto.randomUUID();logSession.current=sessionId;logAttempt.current=crypto.randomUUID();logSequence.current=0;setDiagnosticId(sessionId);
    if(continuingSession)guidance.current.resetScope();else guidance.current.reset();const segmentId=crypto.randomUUID();finalReason.current='disconnected';
    onboardingEndReason.current='unknown';trackOnboarding('voice_start_requested',{language:sessionLanguage});
    onboardingVoice.current?.stop();onboardingVoice.current=onboardingVoiceDiagnostics(trackOnboarding);
    log('session_start',{mode,language:sessionLanguage});
    const carriedRequest=spokenRequest||(continuity&&scope.id===continuity.studentId?[...continuity.turns].reverse().find(turn=>turn.role==='user')?.text:'')||'';
    sessionTurns.current=carriedRequest&&(!routing||scope.confirmed)?[{role:'user',text:carriedRequest}]:[];sessionSources.current=[];memorySaved.current=!summaryScope.current.confirmed;setSources([]);
    setActivity('listening');setLatestAnswer('');setError('');setFailureCode('');setNotice('');setAudioBlocked(false);setSeconds(0);setState('connecting');onActive(true);
    const version=++generation.current;
    saveCompletion.current=voiceSaveCompletion(reason=>{if(reason!=='drained')void Promise.resolve(latestSaveComplete.current?.()).catch(()=>{});else if(transitionToHome.current)void transitionToHome.current();else void Promise.resolve(latestSaveComplete.current?.()).catch(()=>{});},{onEvent:(name,metadata)=>{trackOnboarding(name,{...metadata,...(name==='save_confirmation_finished'?{playbackReady:onboardingVoice.current?.ready()===true}:{})});if(name==='save_confirmation_finished')log('profile_save_confirmation_finished');}});
    const abort=new AbortController();resources.current.abort=abort;
    resources.current.deadline=setTimeout(()=>{if(generation.current===version){log('connection_failure',{code:'connection_timeout'});end();setError(t('Connection timed out. Please try again.','La conexión tardó demasiado. Inténtalo de nuevo.'));}},35000);
    try {
      if(summaryQueue.current.size){setNotice(t('Saving your previous conversation before reconnecting…','Guardando la conversacion anterior antes de reconectar…'));try{await summaryQueue.current.flush();await new Promise(resolve=>setTimeout(resolve,0));}catch{shared?.reportSave(true,false);setNotice(t('Some previous summaries could not be saved. You can talk, but those discussions may not be available to this guide yet.','Algunos resumenes anteriores no se guardaron. Puedes conversar, pero la guia puede no recordar esas conversaciones todavia.'));}if(generation.current!==version)return;}
      summaryToken.current=history.cloud?await getAccessTokenSilently():undefined;if(summaryToken.current)guidanceTokens.current.set(sessionId,summaryToken.current);summaryId.current=continuingSession?crypto.randomUUID():sessionId;holdConversation(summaryId.current);
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}).catch(error=>{if(generation.current===version)trackOnboarding(['NotAllowedError','SecurityError'].includes(error?.name)?'microphone_denied':'microphone_failed',{code:error?.name||'other'});throw error;});
      if(generation.current!==version){stream.getTracks().forEach(track=>track.stop());return;}
      trackOnboarding('microphone_allowed');
      resources.current.stream=stream;
      const pc=new RTCPeerConnection();resources.current.pc=pc;
      pc.ontrack=e=>{if(generation.current!==version)return;if(audio.current){audio.current.srcObject=e.streams[0];void audio.current.play().then(()=>{if(generation.current===version)setAudioBlocked(false);}).catch(()=>{if(generation.current===version){onboardingVoice.current?.playback('blocked');setAudioBlocked(true);}});}};
      stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const dc=pc.createDataChannel('oai-events');resources.current.dc=dc;
      let openingRequested=false,homeIntroductionPending=false;
      let playWelcome=onboarding&&(!family.account.welcomeHeard||replayWelcome);
      let welcomeResponseId:string|undefined,welcomeCompleted=false,welcomeRecorded=false,welcomeInterrupted=false;
      const sentEvents=new Map<string,string>();
      const send=(event:unknown)=>{
        if(dc.readyState!=='open')return;
        const payload=event as {type:string};
        if(payload.type==='response.create'&&homeIntroductionPending){homeIntroductionPending=false;playWelcome=true;welcomeResponseId=undefined;welcomeCompleted=false;welcomeRecorded=false;welcomeInterrupted=false;trackOnboarding('home_introduction_requested');homeIntroduction.current=voiceSaveCompletion(()=>{},{retryAfterInterruption:false,onEvent:(name,metadata)=>{const mapped:Record<string,string>={save_confirmation_started:'home_introduction_started',save_confirmation_finished:'home_introduction_finished',save_confirmation_interrupted:'home_introduction_failed',save_confirmation_skipped:'home_introduction_failed'};if(mapped[name])trackOnboarding(mapped[name],{...metadata,...(name==='save_confirmation_finished'?{playbackReady:onboardingVoice.current?.ready()===true}:{})});}});homeIntroduction.current.arm();event={...payload,response:{instructions:homeVoiceIntroduction(spokenLanguage.current,{preview:!history.cloud})}};}
        else if(payload.type==='response.create'&&!openingRequested){openingRequested=true;if(playWelcome)event={...payload,response:{instructions:onboardingWelcome(sessionLanguage,{preview:!history.cloud,role,hasName:!!profile.name.trim(),canSaveProfile:!!onSaveProfile})+(onAccountDraft?' For profile setup, ask the account holder what they would like to be called, then whether they are a student or parent/guardian. Collect these through propose_account before collecting the student profile. This replaces the earlier instruction to ask the student name first.':'')}};}
        const event_id=crypto.randomUUID();
        log('client_event',{eventId:event_id,operation:payload.type});
        sentEvents.set(event_id,payload.type);
        if(sentEvents.size>100)sentEvents.delete(sentEvents.keys().next().value!);
        dc.send(JSON.stringify({...event as Record<string,unknown>,event_id}));
        return event_id;
      };
      const languageControl=voiceLanguageControl(event=>dc.send(JSON.stringify(event)),{language:sessionLanguage,onLanguage:next=>{if(generation.current===version){spokenLanguage.current=next;checkpointSummary();onLanguageChanged?.(next);void guidance.current.event('guidance.language_changed',{language:next,basis:'model-detection'})?.catch(()=>{});}}});resources.current.stopGuide=()=>languageControl.stop();
      let changingGuide=false;
      resources.current.switchGuide=async (next,initialScope)=>{
        if(next===liveMode.current&&!initialScope)return true;
        if((!summaryScope.current.confirmed&&!initialScope)||changingGuide)return false;
        const updateScope=initialScope||summaryScope.current;
        const updateProfile=voiceProfile(next,latestSetup.current.profile,family.students,updateScope.id);
        changingGuide=true;
        let nextGuidance:ReturnType<typeof guidance.current.current>;
        setSwitchingGuide(true);log('guide_update_start',{mode:next});
        try{
          await languageControl.configure(async currentLanguage=>{
            const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,'X-Origen-Segment':crypto.randomUUID()},body:JSON.stringify({action:'update-guide',mode:next,language:currentLanguage,role:latestSetup.current.role,routeConversations:routing,targetConfirmed:updateScope.confirmed,studentId:updateScope.id,students:family.students.map(({id,name})=>({id,name})),profile:updateProfile,allowGuideHandoff:true,memory:recentConversationMemory(latestHistory.current.items,updateScope.id,next)}),signal:abort.signal});
            const data=await response.json();if(!response.ok||!data.session?.instructions||!Array.isArray(data.session.tools))throw new Error('guide_config_unavailable');
            if(generation.current!==version)throw new Error('voice_session_stopped');
            nextGuidance=data.guidance;
            return data.session;
          },()=>{
            if(generation.current!==version)return;
            guidance.current.accept(nextGuidance);void guidance.current.event('guidance.configuration_applied')?.catch(()=>{});
            if(initialScope){summaryScope.current={...initialScope,name:updateProfile.name};memorySaved.current=false;setTarget(initialScope);log('initial_target_confirmed');}
            liveMode.current=next;checkpointSummary();setMode(next);onGuideChanged?.(next);setNotice('');log('guide_update_complete',{mode:next});
          });
          if(generation.current!==version)return false;
          // A specialty change remains one conversation and one recovery record.
          return true;
        }catch{if(generation.current===version){log('guide_update_failed',{mode:next});setNotice(t('I could not change topics yet. You can keep talking or try again.','No pude cambiar de tema todavía. Puedes seguir hablando o intentar de nuevo.'));}return false;}
        finally{changingGuide=false;if(generation.current===version)setSwitchingGuide(false);}
      };
      transitionToHome.current=async()=>{
        if(transitioned.current||generation.current!==version)return;
        transitioned.current=true;
        const complete=latestSetup.current.onProfileSaveComplete;
        const release=turns.holdReply();
        try{
          trackOnboarding('home_guide_update_started');
          const accepted=await resources.current.switchGuide?.('planning',{id:latestSetup.current.profile.id,confirmed:true});
          if(generation.current!==version)return;
          trackOnboarding(accepted?'home_guide_update_finished':'home_guide_update_failed');
          await complete?.();
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          if(generation.current!==version)return;
          if(accepted){homeIntroductionPending=true;turns.request();}
          else {trackOnboarding('home_introduction_failed',{reason:'request_failed'});setNotice(t('Your profile is saved. You can keep talking; the app introduction is unavailable right now.','Tu perfil está guardado. Puedes seguir hablando; la introducción no está disponible ahora.'));}
        }catch{transitioned.current=false;trackOnboarding('home_introduction_failed',{reason:'request_failed'});setNotice(t('Your profile is saved, but home could not open yet. Please try again.','Tu perfil está guardado, pero no se pudo abrir el inicio. Intenta de nuevo.'));}finally{release();}
      };
      const cache=voiceResearchCache();const researchBudget=voiceResearchBudget();const speechTimes=new Map<string,number>();const handledTranscripts=new Set<string>();
      const turns=voiceTurns(send,()=>log('empty_interruption_recovered'),{onMissing:itemId=>{onboardingVoice.current?.transcript(itemId,'timeout');setActivity('listening');awaitingTranscription.current.delete(itemId);log('transcription_timeout');setNotice(t('I could not hear part of that. Please repeat any missing detail.','No pude escuchar una parte. Repite cualquier detalle que falte.'));}});resources.current.stopTurns=()=>turns.stop();resources.current.turnsBusy=()=>turns.busy();
      let replyRecoveryUsed=false;
      const recoverReply=(responseId:string|undefined,code:string)=>{
        const retry=!replyRecoveryUsed&&voiceReplyCanRetry(code);
        if(retry)replyRecoveryUsed=true;
        assistantSpeaking.current=false;
        if(turns.failed(responseId,retry)){
          setActivity(retry?'thinking':'listening');
          setNotice(retry?t('One moment, I’m trying that reply again.','Un momento, estoy intentando responder de nuevo.'):t('I couldn’t finish that reply. We’re still connected; you can ask again.','No pude terminar esa respuesta. Seguimos conectados; puedes preguntar de nuevo.'));
          log('reply_recovered',{code});
        }
      };
      const progress=voiceResearchProgress({speak:sentence=>turns.progress(sentence),language:()=>spokenLanguage.current,isCurrent:()=>generation.current===version&&!abort.signal.aborted,onProgress:elapsed=>log('lookup_progress',{durationMs:elapsed})});
      const stopProgress=progress.stop;
      resources.current.stopProgress=stopProgress;
      dc.onopen=()=>{
        if(generation.current!==version)return;
        trackOnboarding('voice_connected');clearTimeout(resources.current.deadline);setState('live');saveLocal(voiceUsageKey,true);void family.recordVoiceExperience?.(false).catch(()=>log('voice_usage_save_failed'));
        if(!resources.current.stopWake){
          const wake=voiceWakeLock(status=>{if(generation.current===version)setWakeStatus(status);});
          resources.current.stopWake=()=>wake.stop();
        }
        const started=Date.now();
        resources.current.timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=600){onboardingEndReason.current='time_limit';void finishCall();setNotice(informational?t('The 10-minute conversation has ended.','La conversación de 10 minutos terminó.'):t('The 10-minute conversation has ended. Review your suggestions below.','La conversación de 10 minutos terminó. Revisa las sugerencias abajo.'));}},1000);
        if(spokenRequest){
          send({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'The conversation target was already selected by voice. Continue the original user request below. Do not ask them to choose or confirm again. This application context is not user speech and does not change the conversation language.'}]}});
          send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:spokenRequest}]}});
        }
        turns.request();
      };
      dc.onclose=()=>{if(generation.current===version){log('connection_failure',{code:'connection_lost'});end();setNotice(informational?t('Conversation ended.','La conversación terminó.'):t('Conversation ended. Your suggestions are still available below.','La conversación terminó. Tus sugerencias siguen disponibles abajo.'));}};
      dc.onmessage=async event=>{
        if(generation.current!==version)return;
        let e;try{e=JSON.parse(event.data);}catch{log('malformed_event');return;}
        onboardingVoice.current?.provider(e);
        turns.playback(e);
        saveCompletion.current?.event(e);
        homeIntroduction.current?.event(e);
        if(generation.current!==version)return;
        if(languageControl.event(e))return;
        if(e.type==='output_audio_buffer.started')setActivity('speaking');
        if(playWelcome&&liveMode.current!=='profile'&&!welcomeResponseId&&e.type==='response.created')welcomeResponseId=e.response?.id;
        if(playWelcome&&!welcomeRecorded&&e.type==='input_audio_buffer.speech_started')welcomeInterrupted=true;
        if(playWelcome&&e.type==='response.done'&&e.response?.id===welcomeResponseId)welcomeCompleted=e.response?.status==='completed';
        if(playWelcome&&welcomeCompleted&&!welcomeInterrupted&&!welcomeRecorded&&e.type==='output_audio_buffer.stopped'&&e.response_id===welcomeResponseId){welcomeRecorded=true;void family.recordVoiceExperience?.(true).catch(()=>{welcomeRecorded=false;log('welcome_save_failed');});}
        if(e.type==='output_audio_buffer.stopped'||e.type==='output_audio_buffer.cleared')setActivity('listening');
        if(e.type==='input_audio_buffer.speech_started')setActivity('listening');
        if(e.type==='input_audio_buffer.speech_stopped')setActivity('thinking');
        // Status audio is outside the conversation: never save it as an answer.
        if(turns.progressEvent(e))return;
        if(['output_audio_buffer.started','output_audio_buffer.stopped','output_audio_buffer.cleared','error','response.created','response.done','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(e.type))
          log('server_event',{operation:e.type,eventId:e.event_id,responseId:e.response?.id,status:e.response?.status,reason:e.response?.status_details?.reason});
        if(e.type==='response.created'){assistantSpeaking.current=true;setActivity('thinking');turns.created();void guidance.current.event('response.started')?.catch(()=>{});}
        if(e.type==='response.done'){assistantSpeaking.current=false;setActivity(current=>current==='thinking'?'listening':current);if(['completed','failed','cancelled','incomplete'].includes(e.response?.status))void guidance.current.event('response.finished',{status:e.response.status})?.catch(()=>{});}
        if(e.type==='input_audio_buffer.speech_started'){speechInProgress.current=true;if(e.item_id)awaitingTranscription.current.add(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){speechInProgress.current=false;turns.speechStopped(e.item_id);}
        if(e.type==='conversation.item.input_audio_transcription.completed'||e.type==='conversation.item.input_audio_transcription.failed')awaitingTranscription.current.delete(e.item_id);
        if(finishPromise.current&&e.type==='error'&&e.error?.code==='input_audio_buffer_commit_empty')return;
        if(e.type==='input_audio_buffer.speech_started'){speechTimes.set(e.item_id,Date.now());turns.speechStarted(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){const started=speechTimes.get(e.item_id);if(started!==undefined){log('speech_segment',{speechDurationMs:Date.now()-started});speechTimes.delete(e.item_id);}}
        if(e.type==='response.done'&&e.response?.status==='cancelled')log('response_cancelled',{responseId:e.response.id,reason:e.response.status_details?.reason,toolCount:(e.response.output||[]).filter((item:{type:string})=>item.type==='function_call').length});
        if(e.type==='conversation.item.input_audio_transcription.failed'){onboardingVoice.current?.transcript(e.item_id,'failed');turns.transcript(e.item_id,'');}
        if(e.type==='conversation.item.input_audio_transcription.completed' || e.type==='response.output_audio_transcript.done') {
          const userTurn=e.type.startsWith('conversation');
          if(userTurn&&e.item_id){if(handledTranscripts.has(e.item_id))return;handledTranscripts.add(e.item_id);}
          const release=userTurn?turns.holdReply():()=>{};
          try{
            if(userTurn){
              const next=spokenLanguageFromText(e.transcript,languageControl.language());
              if(next!==languageControl.language()){
                try{await languageControl.change(next);log('spoken_language_changed',{language:next});}
                catch{log('spoken_language_update_failed');}
                if(generation.current!==version)return;
              }
            }
            const valid=userTurn?turns.transcript(e.item_id,e.transcript):typeof e.transcript==='string'&&e.transcript.trim().length>0;
            if(userTurn)onboardingVoice.current?.transcript(e.item_id,valid?'accepted':'empty');
            if(valid&&userTurn){replyRecoveryUsed=false;setNotice('');}
            if(valid&&!scopePending.current){sessionTurns.current=appendConversationTurn(sessionTurns.current,{role:userTurn?'user':'assistant',text:e.transcript,topic:liveMode.current,...(userTurn?{language:spokenLanguage.current}:{expectedLanguage:spokenLanguage.current})});checkpointSummary();}
            if(valid&&!userTurn&&!scopePending.current)setLatestAnswer(e.transcript);
          }finally{release();}
        }
        if(e.type==='error'){
          const code=String(e.error?.code||'unknown_error').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
          log('api_error',{code,eventId:e.error?.event_id,operation:sentEvents.get(e.error?.event_id)||'server',parameter:e.error?.param});
          if(turns.recover(code)){log('error_recovered',{code});return;}
          const operation=sentEvents.get(e.error?.event_id)||'server';
          const parameter=String(e.error?.param||'').replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,100);
          if(!voiceErrorEndsSession(code)){
            if(operation==='response.create')recoverReply(undefined,code);
            else setNotice(t('That request could not finish. We’re still connected; you can keep talking.','No se pudo completar esa petición. Seguimos conectados; puedes seguir hablando.'));
            log('request_error_recovered',{code,operation});return;
          }
          setError(t('Voice stopped. Please start a new conversation. Error code: ','La voz se detuvo. Inicia otra conversación. Código: ')+code+' · '+operation+(parameter?' · '+parameter:''));end();return;
        }
        if(e.type==='response.done'){
          if(e.response?.status==='failed'){
            const code=String(e.response.status_details?.error?.code||'response_failed');
            log('response_failed',{responseId:e.response.id,code});
            if(voiceErrorEndsSession(code)){end();setError(t('The voice session ended. Please reconnect.','La sesión de voz terminó. Vuelve a conectar.'));return;}
            recoverReply(e.response.id,code);return;
          }
          const hasTools=(e.response?.output||[]).some((item:{type:string})=>item.type==='function_call');
          if(!turns.beginDone(e.response?.id,hasTools,e.response?.status==='cancelled'))return;
          let called=await voiceLanguageTools(e.response?.output||[],languageControl,send)>0;
          if(generation.current!==version)return;
          for(const item of e.response?.output||[]) {
            if(item.type!=='function_call')continue;
            called=true;let accepted=false;
            if(item.name==='set_conversation_language'||item.name==='save_onboarding_profile')continue;
            if(item.name==='switch_college_guide'&&onGuideChanged){
              let next:string|undefined;try{next=JSON.parse(item.arguments).guide;}catch{}
              const accepted=!!next&&['finance','admissions','planning','loans'].includes(next)&&await resources.current.switchGuide?.(next as 'finance'|'admissions'|'planning'|'loans');
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'guide_updated':'continue_current_guide',instruction:accepted?'Continue the pending question in this same call. Do not greet or say Hola again.':'Continue here; do not retry the same handoff repeatedly.'})}});continue;
            }
            if(routing&&item.name==='request_conversation_target'){
              let next:string|null|undefined;
              try{next=resolveScope(JSON.parse(item.arguments).scope,family.students);}catch{/* Invalid model proposals cannot change storage scope. */}
              if(next!==undefined){
                if(summaryScope.current.confirmed&&next===summaryScope.current.id){
                  send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'target_confirmed',instruction:'Continue with the current target. No screen confirmation is needed.'})}});continue;
                }
                // The first confirmation has no prior student's private context to discard.
                // Keep the microphone, output track and conversation instead of reconnecting.
                if(!summaryScope.current.confirmed){
                  const accepted=await resources.current.switchGuide?.(liveMode.current as 'planning'|'finance'|'loans'|'admissions',{id:next,confirmed:true});
                  send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'target_confirmed':'target_update_failed',instruction:accepted?'Continue the pending question in this same call. Do not greet again.':'The target is not confirmed yet. Ask them to try again; do not use private student information.'})}});
                  continue;
                }
                log('student_scope_restart');
                const spokenRequest=[...sessionTurns.current].reverse().find(turn=>turn.role==='user')?.text||'';
                if(summaryScope.current.confirmed&&!scopePending.current)sessionTurns.current=beforeScopeRequest(sessionTurns.current);

                scopePending.current=true;
                const nextScope={id:next,confirmed:true};
                const nextLanguage=spokenLanguage.current;
                await finishCall(false,true);setTarget(nextScope);void start(nextScope,nextLanguage,spokenRequest,sessionId);return;
              }
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'invalid_target',instruction:'Ask one short spoken clarification. Do not request an on-screen confirmation.'})}});
              continue;
            }
            const researchMode=researchModeForTool(item.name,liveMode.current);
            if(researchMode){
              let budgetExceeded=false;
              let output:unknown={error:'lookup_failed',instruction:'Explain that current official information could not be verified. Do not invent facts.'};
              log('lookup_start',{callId:item.call_id});
              researchStarted.current=Date.now();setResearching(true);
              try{
                const args=JSON.parse(item.arguments);
                const lookupLanguage=languageControl.language();
                if(typeof args.question!=='string'||!args.question.trim()||args.question.length>3000||typeof args.institution!=='string'||args.institution.length>300)throw new Error('invalid_lookup');
                const latestQuestion=[...sessionTurns.current].reverse().find(turn=>turn.role==='user')?.text||'';
                const query={mode:researchMode,language:lookupLanguage,question:args.question,institution:researchMode==='loans'?'':args.institution,forceRefresh:args.forceRefresh===true||wantsFreshLookup(latestQuestion)};
                let result=cache.get(query);
                const reused=Boolean(result);
                if(result){log('lookup_cache_hit',{callId:item.call_id,sourceCount:result.sources.length});}
                else {
                  if(!researchBudget.take(query)){budgetExceeded=true;throw new Error('research_budget_reached');}
                  progress.start();
                  const response=await apiFetch((researchMode==='finance'||researchMode==='loans')?'/api/finance-research':'/api/admissions-research',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,...(guidance.current.current()?{'X-Origen-Segment':guidance.current.current()!.segmentId}:{})},body:JSON.stringify({question:args.question,institution:researchMode==='loans'?'':args.institution,language:lookupLanguage,purpose:researchMode==='planning'?'planning':undefined}),signal:abort.signal});
                  result=await response.json();
                  if(generation.current!==version)return;
                  if(!response.ok||!result||!Array.isArray(result.sources)||!result.sources.length)throw new Error('lookup_failed');
                  cache.put(query,result);
                }
                log('lookup_success',{callId:item.call_id,sourceCount:result.sources.length,durationMs:Date.now()-researchStarted.current});
                output=researchEvidence(result,reused);
                sessionSources.current=mergeConversationSources(sessionSources.current,result.sources);
                setSources(sessionSources.current);
                setNotice('');
              }catch{
                if(generation.current!==version)return;
                log('lookup_failure',{callId:item.call_id});
                if(budgetExceeded)output={error:'research_budget_reached',instruction:'Do not retry research in this call. Explain the limit briefly and use already verified evidence only when its scope and year match; otherwise offer the official source or counselor as the next step. Keep the conversation open and never invent a policy.'};
                setNotice(budgetExceeded?t('We have reached the lookup limit for this call. You can keep talking about what we found.','Llegamos al límite de consultas de esta llamada. Puedes seguir hablando sobre lo que encontramos.'):t('The lookup could not verify official sources. You can keep talking or try another question.','No se pudieron verificar fuentes oficiales. Puedes seguir conversando o hacer otra pregunta.'));
              }finally{stopProgress();}
              if(generation.current!==version)return;
              setResearching(false);
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});
              continue;
            }
            if(item.name==='propose_account'&&onAccountDraft){
              let accepted=false;
              try{const details=JSON.parse(item.arguments);if(typeof details.firstName==='string'&&details.firstName.trim()&&details.firstName.length<=100&&['parent','student'].includes(details.role)){onAccountDraft({firstName:details.firstName.trim(),role:details.role});accepted=true;}}catch{}
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'account_draft_updated_not_saved':'invalid_account_draft'})}});continue;
            }
            if(mode==='profile'&&item.name==='propose_profile')try{
              const parsed=JSON.parse(item.arguments);const next:Suggestions={};
              if(!Array.isArray(parsed.changes)||parsed.changes.length>11)throw new Error();
              for(const change of parsed.changes){
                if(!Object.hasOwn(labels,change.field)||typeof change.value!=='string'||change.value.length>2000)throw new Error();
                if(change.field==='stage'&&!['9th grade','10th grade','11th grade','12th grade','Community college','College'].includes(change.value))throw new Error();
                if(change.field==='name'&&(!change.value.trim()||change.value.length>100))throw new Error();
                if(change.field==='gpa'&&change.value.length>30)throw new Error();
                next[change.field as Field]=change.value;
              }
              if(onDraft){draftSuggestions.accept({},next,onDraft);setChanges({});}else setChanges(prev=>draftSuggestions.accept(prev,next,()=>{}));accepted=true;
            }catch{/* Invalid suggestions never reach the form. */}
            send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'proposed_for_review_not_saved':'invalid_proposal'})}});
          }
          called=(await voiceProfileSaveTools(e.response?.output||[],latestProfileSave.current?async()=>{const result=await latestProfileSave.current!();if(result.status==='saved'&&generation.current===version){saveCompletion.current?.arm();log('profile_saved_awaiting_confirmation');}return result;}:undefined,send,()=>generation.current===version)>0)||called;
          if(generation.current!==version)return;
          if(called)turns.toolsCompleted();else turns.completed();
        }
      };
      const connection=voiceConnectionRecovery(()=>{if(generation.current!==version)return;log('connection_failure',{code:'connection_lost'});end();setError(informational?t('Voice disconnected. Start another conversation to reconnect.','Se desconectó la voz. Inicia otra conversación para reconectar.'):t('Voice disconnected. You can reconnect or review the suggestions collected so far.','Se desconectó la voz. Puedes reconectar o revisar las sugerencias recibidas.'));});
      resources.current.stopConnection=()=>connection.stop();
      let connectedRecorded=false;
      pc.onconnectionstatechange=()=>{if(generation.current===version&&pc.connectionState==='connected'&&!usage.current.id){usage.current.id=crypto.randomUUID();usageEvent('voice_start');usage.current.timer=setInterval(()=>{if(pc.connectionState==='connected')usageEvent('voice_heartbeat');},15000);}
      log('connection_state',{connectionState:pc.connectionState});if(generation.current===version){if(pc.connectionState==='connected'&&!connectedRecorded&&guidance.current.current()){connectedRecorded=true;void guidance.current.event('voice.connected')?.catch(()=>{});}connection.change(pc.connectionState);}};
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,'X-Origen-Segment':segmentId},body:JSON.stringify({sdp:offer.sdp,routeConversations:routing,targetConfirmed:scope.confirmed,scopeRestart:scope.confirmed,students:family.students.map(({id,name})=>({id,name})),studentId:routing?(scope.confirmed?scope.id:undefined):scope.id===null?null:history.cloud&&family.students.some(student=>student.id===profile.id)?profile.id:undefined,profile:informational?{name:profile.name,stage:profile.stage,institutions:profile.institutions,entryTerm:profile.entryTerm,...(mode==='planning'?{school:profile.school,interest:profile.interest,goals:profile.goals}:{})}:profile,language:sessionLanguage,role,mode:liveMode.current,allowGuideHandoff:!!onGuideChanged,continuity:continuity&&scope.id===continuity.studentId?continuity.turns:undefined,collectAccount:!!onAccountDraft,saveOnboarding:!!onSaveProfile,onboarding:onboarding&&(!family.account.welcomeHeard||replayWelcome),replayWelcome,experience:{usedApp:family.returningUser===true,usedVoice:family.account.usedVoice===true||loadLocal<boolean>(voiceUsageKey,false)===true||latestHistory.current.items.length>0},memory:(routing&&!scope.confirmed?[]:recentConversationMemory(latestHistory.current.items,scope.id,liveMode.current)).map(x=>({date:x.date,mode:x.mode,summary:x.summary}))}),signal:abort.signal});
      const data=await response.json().catch(()=>null);
      if(generation.current!==version)return;
      guidance.current.accept(data?.guidance);
      if(!response.ok)throw new Error(data?.error || (response.status===401?'authentication_required':'voice_unavailable'));
      if(typeof data?.sdp!=='string'||!data.sdp.startsWith('v=0'))throw new Error('invalid_voice_response');
      if(typeof data.playWelcome==='boolean')playWelcome=data.playWelcome;
      if(generation.current!==version)return;
      await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    }catch(err){
      if(generation.current!==version)return;
      const code=err instanceof Error?err.message:'';
      finalReason.current='failed';void guidance.current.event('voice.start_failed',{phase:'transport'})?.catch(()=>{});
      const messages:Record<string,[string,string]>={
        summary_pending:['Your previous conversation could not be saved yet. Retry saving its summary before reconnecting.','La conversacion anterior aun no se ha guardado. Intenta guardar su resumen antes de reconectar.'],
        authentication_required:['Sign in to Origen before starting a voice conversation.','Inicia sesión en Origen antes de comenzar una conversación de voz.'],
        invalid_token:['Your sign-in could not be verified. Sign out and sign in again.','No se pudo verificar tu sesión. Cierra la sesión e inicia sesión de nuevo.'],
        quota_exceeded:['Voice is unavailable because the service’s OpenAI API account needs credits.','La voz no está disponible porque la cuenta de API de OpenAI del servicio necesita créditos.'],
        model_unavailable:['The service’s voice model is unavailable. Its OpenAI model configuration needs to be checked.','El modelo de voz del servicio no está disponible. Es necesario revisar su configuración de OpenAI.'],
        missing_api_key:['Voice is not configured on the server yet.','La voz aún no está configurada en el servidor.'],
        invalid_api_key:['The server’s OpenAI credentials could not be verified.','No se pudieron verificar las credenciales de OpenAI del servidor.'],
        busy:['Voice is busy right now. Wait a moment and try again.','La voz está ocupada en este momento. Espera un momento e inténtalo de nuevo.'],
        rate_limited:['Too many requests. Wait a minute before trying again.','Hay demasiadas solicitudes. Espera un minuto antes de intentarlo de nuevo.'],
        unsupported:['Voice requires a supported browser and a secure HTTPS connection.','La voz requiere un navegador compatible y una conexión HTTPS segura.'],
        network_error:['Could not reach the voice server. Check your connection and try again. If this continues, the service’s API address or network settings need to be checked.','No se pudo conectar con el servidor de voz. Revisa tu conexión e inténtalo de nuevo. Si continúa, es necesario revisar la dirección de API o la configuración de red del servicio.'],
        NotAllowedError:['Microphone access was not allowed. Enable it in your browser to start.','No se permitió el micrófono. Actívalo en el navegador para comenzar.'],
        NotFoundError:['No microphone was found. Connect a microphone and try again.','No se encontró un micrófono. Conecta uno e inténtalo de nuevo.'],
        NotReadableError:['Your microphone could not be opened. Close other apps using it and try again.','No se pudo abrir el micrófono. Cierra otras aplicaciones que lo estén usando e inténtalo de nuevo.'],
      };
      const reason=err instanceof DOMException?err.name:code==='Sign in to use Origen AI.'?'authentication_required':err instanceof TypeError?'network_error':Object.hasOwn(messages,code)||code==='invalid_voice_response'?code:'voice_unavailable';
      setFailureCode(reason);log('connection_failure',{code:reason});
      end();setError(t(...(messages[reason]||['Voice could not connect. Please try again. If it continues, share the diagnostic session below with support.','No se pudo conectar la voz. Inténtalo de nuevo. Si continúa, comparte la sesión de diagnóstico con soporte.'])));
    }
  }
  const startedAutomatically=useRef(false);
  useEffect(()=>{
    if(!detailsOpen||!onCloseDetails)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onCloseDetails();};
    document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);
  },[detailsOpen,onCloseDetails]);
  useEffect(()=>{if(!autoStart||startedAutomatically.current)return;const timer=setTimeout(()=>{startedAutomatically.current=true;void start();},0);return()=>clearTimeout(timer);},[autoStart]);
  return <section className="profile-voice" aria-labelledby={`${mode}-voice-title`}>
    <h3 id={`${mode}-voice-title`}>{mode==='loans'?t('Talk through student loans','Conversemos sobre los préstamos estudiantiles'):mode==='planning'?t('Talk through your plan','Conversemos sobre tu plan'):mode==='admissions'?t('Talk through college applications','Conversemos sobre las solicitudes universitarias'):mode==='finance'?t('Talk through college costs','Conversemos sobre los costos universitarios'):role==='student'?t('Tell us about yourself','Cuéntanos sobre ti'):t('Tell us about your student','Cuéntanos sobre tu estudiante')}</h3>
    <p>{mode==='loans'?t('Ask about loan types, interest, repayment or pausing payments. Origen checks official Federal Student Aid guidance.','Pregunta sobre tipos de préstamos, intereses, pagos o pausas. Origen consulta la información oficial de Federal Student Aid.'):mode==='planning'?t('Talk through course choices, college paths, transfer, degree goals or next steps. Build a plan that fits your stage and interests—in English or Spanish.','Conversa sobre cursos, caminos universitarios, transferencias, metas o próximos pasos. Crea un plan para tu etapa e intereses, en español o inglés.'):mode==='admissions'?t('Ask about UC applications, Cal State Apply, Common App or community college. We can explain a form field, check requirements, or help you understand your next step—in English or Spanish.','Pregunta sobre solicitudes de UC, Cal State Apply, Common App o colegios comunitarios. Podemos explicar una pregunta del formulario, consultar requisitos o ayudarte a entender el siguiente paso, en español o inglés.'):mode==='finance'?t('New to college financial aid? Start here. Ask out loud, pause, or ask Origen to explain it another way—in English or Spanish.','¿Es tu primera vez con la ayuda económica universitaria? Empieza aquí. Pregunta en voz alta, haz una pausa o pide otra explicación, en español o inglés.'):t('Have a live conversation with Origen. You can interrupt, ask questions and correct details. Suggested updates appear here for your review.','Conversa en vivo con Origen. Puedes interrumpir, hacer preguntas y corregir detalles. Las sugerencias aparecerán aquí para que las revises.')}</p>
    {!onboarding&&<p className="small-text">{routing?t('AI-generated voice · Starting sends microphone audio and student names to OpenAI. After you confirm whom you mean, their profile context and previous summaries are included. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían a OpenAI el audio y los nombres de estudiantes. Después de confirmar de quién hablas, se incluye su contexto y los resúmenes anteriores. Las sesiones terminan a los 10 minutos.'):informational?t('AI-generated voice · Starting sends microphone audio and the selected student’s name, education stage, institutions and entry term to OpenAI. This conversation does not update the profile. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían a OpenAI el audio y el nombre, la etapa educativa, las instituciones y el período de ingreso del estudiante. La conversación no modifica el perfil. Las sesiones terminan a los 10 minutos.'):t('AI-generated voice · Starting sends microphone audio and this profile to OpenAI. Profile changes require your review. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían el audio del micrófono y este perfil a OpenAI. Los cambios del perfil requieren tu revisión. La sesión termina a los 10 minutos.')}</p>}
    {history.cloud&&<p className="small-text">{t('When enabled, private session details are kept for 90 days to diagnose problems. This adds no stored audio or transcript and does not enroll you in research.','Cuando está habilitado, los detalles privados de la sesión se conservan durante 90 días para diagnosticar problemas. Esto no agrega audio ni transcripciones guardadas y no te inscribe en investigación.')}</p>}
    {state==='live'&&switchGuideMode&&<div className="voice-guide-switch"><span>{t('This page has a different guide: ','Esta página tiene otra guía: ')}{switchGuideLabel}</span><button type="button" className="text-button" disabled={finishing||switchingGuide||researching||activity!=='listening'} onClick={()=>void resources.current.switchGuide?.(switchGuideMode)}>{t('Switch guide','Cambiar guía')}</button></div>}
    <div className="voice-controls">
      {state==='idle'?<button type="button" className="button primary" onClick={()=>{trackOnboarding('voice_button_pressed',{language});onRestart?onRestart():void start();}}><Mic size={18}/>{t('Start live conversation','Iniciar conversación en vivo')}</button>:<>
        <span className={`voice-activity activity-${activity}`} role="status"><VoiceWave speaking={state==='live'&&activity==='speaking'&&!audioBlocked&&!finishing}/>{finishing?t('Finishing conversation…','Terminando la conversación…'):state==='connecting'?t('Connecting…','Conectando…'):switchingGuide?t('Following your question…','Siguiendo tu pregunta…'):audioBlocked?t('Tap Play to hear Origen','Toca Reproducir para escuchar a Origen'):researching?(mode==='loans'||mode==='finance'?t('Checking official financial aid sources…','Consultando fuentes oficiales de ayuda económica…'):t('Checking official sources…','Consultando fuentes oficiales…')):activity==='speaking'?t('Origen is speaking','Origen está hablando'):activity==='thinking'?t('Preparing an answer…','Preparando una respuesta…'):muted?t('Microphone muted','Micrófono silenciado'):t('Listening · You can speak naturally','Escuchando · Habla con naturalidad')}<small aria-hidden="true"> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</small></span>
        {state==='live'&&<button type="button" className="button outline voice-mute" aria-label={t(muted?'Unmute microphone':'Mute microphone',muted?'Activar micrófono':'Silenciar micrófono')} disabled={finishing} aria-pressed={muted} onClick={()=>{trackOnboarding(muted?'microphone_unmuted':'microphone_muted');resources.current.stream?.getAudioTracks().forEach(track=>track.enabled=muted);setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} <span className="voice-control-label">{t(muted?'Unmute':'Mute',muted?'Activar micrófono':'Silenciar')}</span></button>}
        <button type="button" className="button outline voice-end" aria-label={t('End conversation','Terminar conversación')} disabled={finishing} onClick={()=>{onboardingEndReason.current='user_end';void finishCall();}}><PhoneOff size={18}/><span className="voice-control-label">{t('End conversation','Terminar conversación')}</span></button>
      </>}
      {state==='live'&&wakeStatus==='unavailable'&&<p className="small-text voice-wake-notice" role="status">{t('Keep this screen open during your conversation. Your browser could not keep the display awake.','Mantén esta pantalla abierta durante la conversación. Tu navegador no pudo mantener la pantalla encendida.')}</p>}
    </div>
    <audio ref={audio} autoPlay controls onPlaying={event=>{setAudioBlocked(false);onboardingVoice.current?.playback(event.currentTarget.muted||event.currentTarget.volume===0?'silent':'playing');}} onPause={()=>onboardingVoice.current?.playback('paused')} onVolumeChange={event=>onboardingVoice.current?.playback(event.currentTarget.muted||event.currentTarget.volume===0||event.currentTarget.paused?'silent':'playing')} onError={()=>onboardingVoice.current?.playback('blocked')} hidden={state!=='live'||(onboarding&&!audioBlocked)} aria-label={t('Origen voice playback','Reproducción de voz de Origen')}/>
    <div className="voice-session-details" hidden={ownerId==='shared'&&!detailsOpen}>
    {ownerId==='shared'&&<div className="voice-details-heading"><h3>{t('Conversation details','Detalles de la conversación')}</h3><button type="button" className="button outline" onClick={onCloseDetails}>{t('Close','Cerrar')}</button></div>}
    <p className="small-text">{history.cloud?t('Relevant past summaries are shared with OpenAI as context. A summary is saved to your account when the conversation ends; for a new student, save the profile first.','Los resúmenes anteriores pertinentes se comparten con OpenAI como contexto. Al terminar, se guarda un resumen en tu cuenta; para un estudiante nuevo, guarda primero el perfil.'):t('Conversation summaries stay in this browser preview.','Los resúmenes de ejemplo se quedan en este navegador.')}</p>
    {savingSummary&&<p className="voice-save-status" role="status">{t('Saving conversation summary…','Guardando el resumen…')}</p>}
    {summaryFailed&&<div className="summary-save-error"><p role="alert">{t('Conversation summary could not be saved. Retry before leaving this page.','No se pudo guardar el resumen. Intenta de nuevo antes de salir de esta página.')}</p><button type="button" className="button outline" disabled={savingSummary} onClick={()=>void retrySummaries()}>{t('Retry saving summary','Volver a guardar el resumen')}</button></div>}
    {diagnosticId&&<details className="small-text"><summary>{t('Diagnostic session','Sesión de diagnóstico')}</summary><p>{diagnosticId}</p>{failureCode&&<p>{t('Connection error: ','Error de conexión: ')}{failureCode}</p>}<p>{t('When the server is reachable, technical events are logged without audio, transcripts or student details.','Cuando el servidor está disponible, se registran eventos técnicos sin audio, transcripciones ni datos del estudiante.')}</p></details>}
    {researching&&<p role="status">{Date.now()-researchStarted.current>=20000?t('Still checking the official guidance. You can keep speaking while I look.','Sigo consultando la guía oficial. Puedes seguir hablando mientras busco.'):t('Checking official sources…','Consultando fuentes oficiales…')} <span>{Math.max(0,Math.floor((Date.now()-researchStarted.current)/1000))}s</span></p>}
    {latestAnswer&&<details className="voice-answer"><summary>{t('Latest answer','Última respuesta')}</summary><p>{latestAnswer}</p></details>}
    {sources.length>0&&<details className="voice-sources"><summary>{t('Official sources','Fuentes oficiales')} · {sources.length}</summary><h4>{t('Sources from this conversation','Fuentes de esta conversación')}</h4><ul>{sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small> · {t('Checked','Consultado')} {new Date(source.checkedAt).toLocaleDateString(language)}</small></li>)}</ul></details>}
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!onDraft&&Object.keys(changes).length>0&&<div className="voice-review"><h4>{t('Review suggested changes','Revisa los cambios sugeridos')}</h4><p>{t('Edit or remove any suggestion. End the conversation, add the changes to the form, then select Save profile.','Edita o elimina cualquier sugerencia. Termina la conversación, agrega los cambios al formulario y selecciona Guardar perfil.')}</p>
      {(Object.keys(changes) as Field[]).map(field=><div key={field}><label className="field">{labels[field][language==='es'?1:0]}<textarea value={changes[field]} maxLength={field==='name'?100:field==='gpa'?30:2000} onChange={e=>setChanges(prev=>({...prev,[field]:e.target.value}))}/></label><button type="button" className="text-button" onClick={()=>setChanges(prev=>{const next={...prev};delete next[field];return next;})}>{t('Remove suggestion','Eliminar sugerencia')}</button></div>)}
      <button type="button" className="button primary" disabled={state!=='idle'} onClick={()=>{
        if(changes.stage!==undefined&&!['9th grade','10th grade','11th grade','12th grade','Community college','College'].includes(changes.stage)){
          setError(t('Use an education stage from the form, or remove that suggestion and select it in the form.','Usa una etapa educativa del formulario, o elimina esa sugerencia y selecciónala en el formulario.'));return;
        }
        apply(changes);setChanges({});setError('');setNotice(t('Suggestions added to the form. Review the fields and select Save profile.','Sugerencias agregadas al formulario. Revisa los campos y selecciona Guardar perfil.'));
      }}>{t('Add changes to form','Agregar cambios al formulario')}</button>
    </div>}
    </div>
  </section>;
}
