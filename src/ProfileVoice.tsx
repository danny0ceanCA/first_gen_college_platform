import {studentLivePlayback} from './studentLivePlayback.mjs';
import {studentLiveChannel} from './studentLiveChannel.mjs';
import {conversationCheckpoint,type CheckpointState} from './conversationCheckpoint.mjs';
import {recoveryChoice,recoveryRequest,activeCheckpoints} from './conversationRecovery';
import {coordinatorVoiceTools} from './coordinatorVoiceTools.mjs';
import {CoordinatorConfirm,connectionRequest,type ConnectionCard} from './CoordinatorConnection';
import {redactCoordinatorCodes,redactCoordinatorTurns} from './coordinatorCodes.mjs';
import {voiceStartup} from './voiceStartup.mjs';
import {voiceMemoryTools} from './voiceMemoryTools.mjs';
import {notifyMemoryContext,subscribeMemoryContext,watchMemoryRevision} from './memoryContext.mjs';
import {workspaceGuide,voiceWorkspaceQueue,type WorkspaceSelection} from './voiceWorkspace.mjs';
import {voiceSaveCompletion} from './voiceSaveCompletion.mjs';
import {voiceClosing,isVoiceGoodbye,canEndVoiceConversation} from './voiceClosing.mjs';
import {onboardingVoiceDiagnostics} from './onboardingVoiceDiagnostics.mjs';
import {voiceProfileSaveTools,voiceProfileSaveConsent,type VoiceProfileSaveResult} from './voiceProfileSave.mjs';
import {holdConversation,releaseConversation,researchModeForTool} from './liveConversation.mjs';
import {binderActivity} from './binderActivity';
import type {BinderTopic} from './binderSignals.mjs';
import {voiceBinderTopics} from './voiceBinderTopics.mjs';
import {voiceDraft} from './voiceDraft.mjs';
import {guidanceHistory} from './guidanceHistory.mjs';
import {privateRecovery} from './privateRecovery';
import {browserPrivacy} from './browserPrivacy.mjs';
import {voiceLanguageControl,voiceLanguageTools,spokenLanguageFromText} from './voiceLanguage.mjs';
import {onboardingWelcome,homeVoiceIntroduction} from './voiceWelcome.mjs';
import VoiceWave from './VoiceWave';
import VoiceStartButton from './VoiceStartButton';
import {SharedVoiceContext} from './SharedVoiceContext';
import {voiceResearchCache,voiceResearchBudget,wantsFreshLookup} from './voiceResearchCache.mjs';
import {voiceResearchProgress,researchEvidence} from './voiceResearchProgress.mjs';
import {voiceResearchRequest} from './voiceResearchRequest.mjs';
import {useFamily} from './FamilyStore';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {apiFailure,responseReference,diagnosticHint} from './diagnosticClient.mjs';
import {ErrorReference} from './ErrorReference';
import {withRequestDeadline} from './requestDeadline.mjs';
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
export type VoiceProps={onBusy?:(busy:boolean)=>void;workspaceFocus?:WorkspaceSelection;onOnboardingEvent?:(name:string,metadata?:Record<string,unknown>)=>void;profileSaved?:number;onProfileSaveComplete?:()=>void;onSaveProfile?:()=>Promise<VoiceProfileSaveResult>;onLanguageChanged?:(language:'en'|'es')=>void;onAccountDraft?:(details:{firstName:string;role:'parent'|'student'})=>void;onDraft?:(changes:Suggestions)=>void;recoveryKey?:string;onGuideChanged?:(mode:'finance'|'admissions'|'planning'|'loans')=>void;switchGuideMode?:'finance'|'admissions'|'planning'|'loans';detailsOpen?:boolean;onCloseDetails?:()=>void;continuity?:VoiceHandoff;onHandoff?:(mode:'finance'|'admissions'|'planning'|'loans',context:VoiceHandoff)=>void;onSwitchGuide?:(context:VoiceHandoff)=>void;switchGuideLabel?:string;onRestart?:()=>void;ownerId?:string;autoStart?:boolean;onboarding?:boolean;replayWelcome?:boolean;mode?:'profile'|'finance'|'admissions'|'planning'|'loans';profile:StudentProfile;language:'en'|'es';role:'parent'|'student';apply:(changes:Suggestions)=>void;onActive:(active:boolean)=>void;t:(en:string,es:string)=>string};
export default function ProfileVoice(props:VoiceProps){
 const shared=useContext(SharedVoiceContext);
 const localOwner=useRef(crypto.randomUUID());
 const setupStarted=useRef(false);
 useEffect(()=>{if(shared&&props.onboarding&&props.autoStart&&!setupStarted.current){setupStarted.current=true;shared.launch(props);}},[props.autoStart,props.onboarding]);
 useEffect(()=>{if(props.onboarding)shared?.syncOnboarding(props);},[props.profile,props.role,props.language]);
 if(shared&&props.onboarding)return <section className="profile-voice voice-launcher onboarding-voice-launcher"><VoiceStartButton label={shared.active?props.t('Open current conversation','Abrir conversación actual'):props.t('Talk with Origen','Hablar con Origen')} onClick={()=>{if(!shared.active)props.onOnboardingEvent?.('voice_button_pressed',{language:props.language});shared.active?shared.open():shared.launch(props);}}/></section>;
 if(!shared)return <LocalProfileVoice {...props}/>;
 if(props.mode&&props.mode!=='profile')return <section className="profile-voice voice-launcher"><h3>{props.t('Talk with Origen','Hablar con Origen')}</h3><p>{props.t('Keep talking while you explore the app. Your current guide stays with you until you end the conversation.','Sigue conversando mientras exploras la app. Tu guía continúa contigo hasta que termines la conversación.')}</p><VoiceStartButton label={shared.active?props.t('Open current conversation','Abrir conversación actual'):props.t('Talk with Origen','Hablar con Origen')} onClick={()=>shared.active?shared.open():shared.launch(props)}/></section>;
 if(shared.active&&shared.owner!==localOwner.current)return <p role="status">{props.t('End your current voice conversation before starting profile setup.','Termina la conversacion actual antes de iniciar el perfil.')} <button className="text-button" onClick={shared.open}>{props.t('Open conversation','Abrir conversacion')}</button></p>;
 return <LocalProfileVoice {...props} ownerId={localOwner.current}/>;
}
export function LocalProfileVoice({onBusy,workspaceFocus,onOnboardingEvent,profileSaved,onProfileSaveComplete,onSaveProfile,onLanguageChanged,onAccountDraft,onDraft,profile:initialProfile,language,role,apply,onActive,t,mode:initialMode='profile',onboarding=false,replayWelcome=false,autoStart=false,ownerId='shared',onRestart,onSwitchGuide,onHandoff,continuity,switchGuideLabel,detailsOpen=false,onCloseDetails,onGuideChanged,switchGuideMode,recoveryKey}:VoiceProps) {
  const [connectionCard,setConnectionCard]=useState<ConnectionCard>();
  const connectionController=useRef<ReturnType<typeof coordinatorVoiceTools>|undefined>(undefined);
  useEffect(()=>{connectionController.current?.stop();setConnectionCard(undefined);},[initialProfile.id]);
  useEffect(()=>{if(workspaceFocus&&workspaceFocus.studentId!==initialProfile.id){connectionController.current?.stop();setConnectionCard(undefined);}},[initialProfile.id,workspaceFocus?.studentId]);
   const workspaceSeen=useRef<string|undefined>(undefined);
  const currentWorkspace=useRef<WorkspaceSelection|undefined>(workspaceFocus);
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
  const closing=useRef<ReturnType<typeof voiceClosing>|null>(null);
  const homeClosing=useRef(false);
  const latestProfileSave=useRef(onSaveProfile);latestProfileSave.current=onSaveProfile;
  const [mode,setMode]=useState(initialMode);
  const liveMode=useRef(initialMode);
  const [switchingGuide,setSwitchingGuide]=useState(false);
  const shared=useContext(SharedVoiceContext);
  const history=useConversationHistory();
  const latestHistory=useRef(history);latestHistory.current=history;
  const family=useFamily();const latestFamily=useRef(family);latestFamily.current=family;const {getAccessTokenSilently,user}=useAuth0();
  const [privacyLease]=useState(()=>browserPrivacy.capture());
  const voiceUsageKey=user?.sub?`origen.user.${user.sub}.voice-used.v1`:'camino.voice-used.v1';
  const spokenLanguage=useRef(continuity?.language||language);
  const screenLanguage=useRef(language);
  const routing=role==='parent'&&mode!=='profile';
  const [target,setTarget]=useState<{id:string|null;confirmed:boolean}>({id:workspaceFocus?workspaceFocus.studentId:continuity?continuity.studentId:initialProfile.id||null,confirmed:continuity?.confirmed||!!workspaceFocus});

  const scopePending=useRef(false);
  const profile=voiceProfile(mode,initialProfile,family.students,target.id);
  const summaryScope=useRef<{id:string|null;name:string;confirmed:boolean}>({id:initialProfile.id||null,name:initialProfile.name,confirmed:!routing});
  const summaryToken=useRef<string|undefined>(undefined);const summaryId=useRef('');
  const binderSource=useRef('');
  function publishBinderActivity(topics:BinderTopic[]=[]){
    if(!user?.sub||!privacyLease.valid()||liveMode.current==='profile'||!summaryScope.current.confirmed||scopePending.current)return;
    binderActivity.begin(binderSource.current,user.sub,summaryScope.current.id,topics);
  }
  const guidanceTokens=useRef(new Map<string,string>());
  const guidance=useRef(guidanceHistory(body=>{const token=guidanceTokens.current.get((body as {sessionId:string}).sessionId);if(!token)return Promise.resolve();return apiFetch('/api/guidance-history',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),keepalive:true}).then(response=>{if(!response.ok)throw new Error('guidance_event_failed');});}));
  const sessionTurns=useRef<{role:'user'|'assistant';text:string;topic?:string;language?:'en'|'es';expectedLanguage?:'en'|'es'}[]>([]);
  const sessionSources=useRef<{title:string;url:string;checkedAt:string}[]>([]);
  const memorySaved=useRef(true);
  const checkpoint=useRef<ReturnType<typeof conversationCheckpoint>|undefined>(undefined);
  const [recoveryState,setRecoveryState]=useState<CheckpointState>();
  const [savingSummary,setSavingSummary]=useState(false);
  const summaryQueue=useRef(shared?.queue||summarySaveQueue());
  const [summaryFailed,setSummaryFailed]=useState(false);
  const [summarySaved,setSummarySaved]=useState(false);
  const summarySaveState=shared?.saveState||{failed:summaryFailed,saving:savingSummary};
  async function retrySummaries(){
    setSavingSummary(true);setSummaryFailed(false);shared?.reportSave(false,true);
    try{await summaryQueue.current.flush();}
    catch{setSummaryFailed(true);shared?.reportSave(true,false);}
    finally{setSavingSummary(false);if(!summaryQueue.current.size)shared?.reportSave(false,false);}
  }
  function checkpointSummary(){
    if(!privacyLease.valid()||!sessionTurns.current.some(turn=>turn.role==='user')||!summaryId.current||!summaryScope.current.confirmed)return;
    sessionTurns.current=redactCoordinatorTurns(sessionTurns.current);
    const store=privateRecovery(`origen.onboarding-summaries.${history.cloud?user?.sub:'preview'}`);
    const records=store.read<Record<string,unknown>>({});
    records[summaryId.current]={id:summaryId.current,studentId:summaryScope.current.id,scopeName:summaryScope.current.name,mode:liveMode.current,language:spokenLanguage.current,date:new Date().toISOString(),turns:sessionTurns.current,qualitySessionId:logSession.current,qualityComplete:false,sources:sessionSources.current,guidance:guidance.current.attribution()};
    if(history.cloud&&summaryScope.current.confirmed&&memoryRevisionRef.current!==null&&(summaryScope.current.id===null||family.students.some(s=>s.id===summaryScope.current.id))&&(checkpoint.current||recoveryChoice.enabled&&recoveryChoice.available&&!recoveryChoice.stopping)){
      if(!checkpoint.current){checkpoint.current=conversationCheckpoint({epoch:recoveryChoice.epoch,contextRevision:memoryRevisionRef.current,post:recoveryRequest,onState:setRecoveryState});activeCheckpoints.add(summaryId.current);}
      checkpoint.current.update(records[summaryId.current]);
      // The durable transport owns this ID. Never let the old in-memory summary
      // retry path independently finalize a different version of the discussion.
      store.removeEntry(summaryId.current);return;
    }
    if(!store.write(records))setNotice(t('Keep this page open until the summary saves.','Mantén esta página abierta hasta guardar el resumen.'));
  }
  async function saveSummary(){
    if(!privacyLease.valid()||memorySaved.current||!summaryScope.current.confirmed||!sessionTurns.current.some(t=>t.role==='user'))return;
    const studentId=summaryScope.current.id,scopeName=summaryScope.current.name;
    checkpointSummary();
    if(checkpoint.current){
      const stream=checkpoint.current,id=summaryId.current;checkpoint.current=undefined;memorySaved.current=true;
      const lease=browserPrivacy.capture({id,studentId,mode:liveMode.current});
      lease.signal.addEventListener('abort',()=>{stream.stop();activeCheckpoints.delete(id);summaryQueue.current.remove(id);lease.release();},{once:true});
      summaryQueue.current.add(id,async()=>{lease.assert();await stream.finish();lease.assert();activeCheckpoints.delete(id);stream.stop();privateRecovery(`origen.onboarding-summaries.${user?.sub||'preview'}`).removeEntry(id);lease.release();});
      await retrySummaries();return;
    }
    memorySaved.current=true;const turns=[...sessionTurns.current];const sources=[...sessionSources.current];const id=summaryId.current||crypto.randomUUID();setSavingSummary(true);
    const body=JSON.stringify({turns,qualitySessionId:logSession.current,qualityComplete:true,language:spokenLanguage.current,id,scopeName,defer:studentId!==null&&history.cloud&&!family.students.some(student=>student.id===studentId),studentId,date:new Date().toISOString(),mode:liveMode.current,sources,guidance:guidance.current.attribution()});
    const savedMode=liveMode.current;
    const subject=history.cloud?user?.sub:undefined,date=new Date().toISOString();
    const lease=browserPrivacy.capture({id,studentId,mode:savedMode});
    lease.signal.addEventListener('abort',()=>{summaryQueue.current.remove(id);lease.release();},{once:true});
    summaryQueue.current.add(id,async signal=>{privacyLease.assert();lease.assert();let token:string|undefined;if(subject){token=await getAccessTokenSilently();if(!token)throw new Error('authentication_required');let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}if(tokenSubject!==subject)throw new Error('summary_account_changed');}privacyLease.assert();lease.assert();const response=await apiFetch('/api/conversation-summary',{diagnostic:{kind:'summary',studentId,hint:diagnosticHint('summary',studentId,id)},method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body,signal:AbortSignal.any([signal,lease.signal]),keepalive:new TextEncoder().encode(body).length<60000});if(!response.ok){if(response.status===410){summaryQueue.current.remove(id);privateRecovery(`origen.onboarding-summaries.${subject||'preview'}`).removeEntry(id);return;}setErrorReference(responseReference(response));throw apiFailure(response,'summary_unavailable');}const {summary}=await response.json();privacyLease.assert();lease.assert();const result=await latestHistory.current.add({id,studentId,date,mode:savedMode,summary,sources});lease.assert();setSummarySaved(result==='saved');privateRecovery(`origen.onboarding-summaries.${subject||'preview'}`).removeEntry(id);lease.release();});
    await retrySummaries();
  }
  const informational=mode!=='profile';
  const [memoryRevision,setMemoryRevision]=useState<number|null>(null);
  const memoryRevisionRef=useRef<number|null>(null);
  const memoryPolicyRef=useRef<string|undefined>(undefined);
  const liveMemorySaving=useRef(false);
  const [checkingMemorySave,setCheckingMemorySave]=useState(false);
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
  const invalidateMemoryPlayback=useRef<()=>void>(()=>{});
  const [wakeStatus,setWakeStatus]=useState<VoiceWakeLockStatus>('hidden');
  const [draftRecovery]=useState(()=>recoveryKey?privateRecovery(recoveryKey):null);
  const [draftSuggestions]=useState(()=>voiceDraft<Suggestions>(draftRecovery,!!onDraft));
  const [changes,setChanges]=useState<Suggestions>(()=>draftSuggestions.read());
  useEffect(()=>{if(!draftSuggestions.write(changes))setNotice(t('Keep this page open until you save; voice suggestions could not be backed up.','Mantén la página abierta hasta guardar; no se pudo conservar las sugerencias.'));},[changes,draftSuggestions]);
  const [sources,setSources]=useState<{title:string;url:string;checkedAt:string}[]>([]);
  const [diagnosticId,setDiagnosticId]=useState('');
  const [errorReference,setErrorReference]=useState<string|undefined>();
  const logOperation=useRef('');const logTarget=useRef<string|null|undefined>(undefined);
  const [failureCode,setFailureCode]=useState('');

  const usage=useRef<{id:string;timer?:ReturnType<typeof setInterval>}>({id:''});
  const usageQueue=useRef(Promise.resolve());
  function usageEvent(action:string,id=usage.current.id){if(!id)return;const body=JSON.stringify({action,id,topic:liveMode.current,...(action==='voice_start'?{segmentId:guidance.current.current()?.segmentId??null}:{})});usageQueue.current=usageQueue.current.catch(()=>{}).then(()=>{privacyLease.assert();return apiFetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true});}).then(()=>{}).catch(()=>{});}
  const logSession=useRef('');
  const logAttempt=useRef('');
  const logSequence=useRef(0);
  function log(event:string,details:Record<string,unknown>={}){
    if(!logSession.current)return;
    if(event==='connection_failure'){onboardingEndReason.current=details.code==='connection_timeout'?'connection_timeout':details.code==='connection_lost'?'connection_lost':'connection_failed';trackOnboarding('voice_connection_failed',details);}
    void apiFetch('/api/voice-diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Operation':logOperation.current},body:JSON.stringify({operationKind:'voice',studentId:logTarget.current,sessionId:logSession.current,attemptId:logAttempt.current,sequence:++logSequence.current,event,...details}),keepalive:true}).catch(()=>{});
  }
  const researchStarted=useRef(0);
  const [researching,setResearching]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const resources=useRef<{pc?:RTCPeerConnection;stream?:MediaStream;dc?:RTCDataChannel;abort?:AbortController;timer?:ReturnType<typeof setInterval>;deadline?:ReturnType<typeof setTimeout>;stopWake?:()=>void;stopProgress?:()=>void;stopMemory?:()=>void;cancelResearch?:()=>void;stopConnection?:()=>void;stopTurns?:()=>void;turnsBusy?:()=>boolean;stopGuide?:()=>void;stopTopics?:()=>void;workspace?:{select:(selection:WorkspaceSelection)=>void;stop:()=>void};studentSelection?:{select:(id:string|null)=>void;stop:()=>void};switchGuide?:(mode:'finance'|'admissions'|'planning'|'loans',initialScope?:{id:string|null;confirmed:true},focus?:WorkspaceSelection,isCurrent?:()=>boolean)=>Promise<boolean>}>({});
  const generation=useRef(0);
  const finalReason=useRef<'completed'|'disconnected'|'failed'>('disconnected');
  const preserveLogicalSession=useRef(false);
  const audio=useRef<HTMLAudioElement>(null);
  function resumeAudio(){
    const element=audio.current,version=generation.current;
    if(!element)return;
    element.muted=false;if(element.volume===0)element.volume=1;
    void element.play().then(()=>{if(generation.current===version)setAudioBlocked(false);}).catch(()=>{
      if(generation.current===version){setAudioBlocked(true);onboardingVoice.current?.playback('blocked');}
    });
  }
  function cleanup(){
    binderActivity.end(binderSource.current);binderSource.current='';
    resources.current.workspace?.stop();
    resources.current.studentSelection?.stop();
    void saveSummary();releaseConversation(summaryId.current);
    if(!preserveLogicalSession.current)void guidance.current.event('voice.ended',{reason:finalReason.current})?.catch(()=>{});
    clearInterval(usage.current.timer);usageEvent('voice_end');usage.current={id:''};
    closing.current?.stop();closing.current=null;
    onboardingVoice.current?.stop();onboardingVoice.current=null;
    if(logSession.current)trackOnboarding('voice_ended',{reason:onboardingEndReason.current});
    log('session_cleanup');logSession.current='';
    generation.current++;
    const r=resources.current;resources.current={};
    r.abort?.abort();clearInterval(r.timer);clearTimeout(r.deadline);
    transitionToHome.current=null;
    r.stopWake?.();r.stopProgress?.();r.stopMemory?.();
    r.stopConnection?.();r.stopTurns?.();r.stopTopics?.();r.stopGuide?.();onBusy?.(false);
    if(r.dc){r.dc.onclose=null;r.dc.close();}
    if(r.pc){r.pc.onconnectionstatechange=null;r.pc.close();}
    r.stream?.getTracks().forEach(track=>track.stop());
    if(audio.current){audio.current.pause();audio.current.srcObject=null;}
  }
  useEffect(()=>browserPrivacy.subscribe(event=>{
    if(event.type==='forget'){
      if(!browserPrivacy.matches(event.target!,{id:summaryId.current,studentId:summaryScope.current.id,mode:liveMode.current}))return;
      summaryQueue.current.remove(summaryId.current);
    }else summaryQueue.current.clear();
    checkpoint.current?.stop();checkpoint.current=undefined;activeCheckpoints.delete(summaryId.current);setRecoveryState(undefined);
    memorySaved.current=true;sessionTurns.current=[];sessionSources.current=[];
    cleanup();setLatestAnswer('');setChanges({});setSources([]);setState('idle');onActive(false);shared?.claim(ownerId,false);
  }),[]);
  function invalidateRememberedContext(unavailable=false){
    if(!resources.current.pc)return;
    // Keep an acknowledged checkpoint for explicit review; never automatically
    // summarize stale assistant context after an external edit or deletion.
    checkpoint.current?.stop();checkpoint.current=undefined;activeCheckpoints.delete(summaryId.current);
    // Do not summarize an assistant reply containing information just removed.
    memorySaved.current=true;sessionTurns.current=[];sessionSources.current=[];
    summaryQueue.current.remove(summaryId.current);
    privateRecovery(`origen.onboarding-summaries.${user?.sub||'preview'}`).removeEntry(summaryId.current);
    end();setLatestAnswer('');setChanges({});setSources([]);
    setNotice(unavailable?t('We could not verify your saved information. Start a new conversation to reload it. This interrupted call was not saved.','No pudimos verificar tu información guardada. Inicia otra conversación para cargarla. Esta llamada interrumpida no se guardó.'):t('Your saved information changed. Start a new conversation to use the updated details. This interrupted call was not saved.','Tu información guardada cambió. Inicia otra conversación para usar los datos actualizados. Esta llamada interrumpida no se guardó.'));
  }
  useEffect(()=>subscribeMemoryContext(user?.sub,studentId=>{
    if(summaryScope.current.confirmed&&summaryScope.current.id===studentId)invalidateRememberedContext();
  }),[user?.sub]);
  useEffect(()=>{
    if(state!=='live'||memoryRevision===null||!summaryScope.current.confirmed)return;
    const studentId=summaryScope.current.id;
    return watchMemoryRevision({revision:memoryRevision,read:async signal=>{
      if(liveMemorySaving.current)return memoryRevisionRef.current!;
      const response=await apiFetch('/api/student-memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revision',studentId}),signal});
      const data=await response.json();if(!response.ok||typeof data.revision!=='number')throw new Error('memory_unavailable');return memoryPolicyRef.current!==undefined&&data.memoryPolicy!==memoryPolicyRef.current?-1:data.revision;
    },onChange:()=>{if(!liveMemorySaving.current&&memoryRevisionRef.current===memoryRevision)invalidateRememberedContext();},onUnavailable:()=>{if(!liveMemorySaving.current)invalidateRememberedContext(true);}});
  },[state,memoryRevision]);
  useEffect(()=>{if(state==='live'&&workspaceFocus&&workspaceSeen.current!==workspaceFocus.serial&&resources.current.workspace){workspaceSeen.current=workspaceFocus.serial;resources.current.workspace.select(workspaceFocus);}},[workspaceFocus?.serial,state]);
  function end(){setFinishing(false);resources.current.workspace?.stop();saveCompletion.current?.ended(onboardingEndReason.current);cleanup();preserveLogicalSession.current=false;setResearching(false);setState('idle');setNotice('');setMuted(false);scopePending.current=false;setTarget(previous=>({...previous,confirmed:false}));onActive(false);shared?.claim(ownerId,false);}
  function closeWithFarewell(instructions?:string){
    if(closing.current?.active())return;
    if(!closing.current||resources.current.dc?.readyState!=='open'){end();return;}
    setFinishing(true);setMuted(true);setResearching(false);
    const current=closing.current;const dc=resources.current.dc as ReturnType<typeof studentLiveChannel>|undefined;void (dc?.flush?.()||Promise.resolve()).then(()=>{if(closing.current===current)current.begin(instructions);});
  }
  function handoffContext():VoiceHandoff{return {studentId:summaryScope.current.id,confirmed:summaryScope.current.confirmed,language:spokenLanguage.current,turns:sessionTurns.current.slice(-8).map(turn=>({...turn,text:turn.text.slice(0,2000)}))};}
  function finishCall(drain=true,preserveSession=false){
    if(finishPromise.current)return finishPromise.current;
    setFinishing(true);
    resources.current.cancelResearch?.();
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
    const id=initialProfile.id||null;
    if(routing&&state==='live'){
      selectedProfileId.current=initialProfile.id;resources.current.studentSelection?.select(id);
    }else if(state==='idle'){selectedProfileId.current=initialProfile.id;setTarget({id,confirmed:false});}
  },[initialProfile.id,routing,state]);
  const latestCleanup=useRef(cleanup);
  useEffect(()=>{latestCleanup.current=cleanup;});
  useEffect(()=>()=>{latestCleanup.current();onActive(false);shared?.claim(ownerId,false);},[]);
  async function start(scope=target,sessionLanguage=spokenLanguage.current,spokenRequest='',continuingSession='',memoryResume=false){
    if(!privacyLease.valid())return;
    if(resources.current.abort)return;
    if(shared&&!shared.claim(ownerId,true))return;
    const livePlayback=studentLivePlayback();void livePlayback.prime();resources.current.stopConnection=()=>livePlayback.stop();
    const focus=!memoryResume&&workspaceFocus?.studentId===scope.id?workspaceFocus:undefined;
    currentWorkspace.current=focus;
    if(focus)workspaceSeen.current=focus.serial;
    const profile=voiceProfile(mode,initialProfile,family.students,scope.id);
    summaryScope.current={id:scope.id,name:profile.name,confirmed:!routing||scope.confirmed};

    scopePending.current=false;
    spokenLanguage.current=sessionLanguage;
    awaitingTranscription.current.clear();speechInProgress.current=false;assistantSpeaking.current=false;
    memoryRevisionRef.current=null;memoryPolicyRef.current=undefined;setMemoryRevision(null);
    const sessionId=continuingSession||crypto.randomUUID();logSession.current=sessionId;logAttempt.current=crypto.randomUUID();logSequence.current=0;setDiagnosticId('');setErrorReference(undefined);logOperation.current=crypto.randomUUID();logTarget.current=scope.confirmed?scope.id:undefined;
    if(continuingSession)guidance.current.resetScope();else guidance.current.reset();const segmentId=crypto.randomUUID();finalReason.current='disconnected';
    onboardingEndReason.current='unknown';trackOnboarding('voice_start_requested',{language:sessionLanguage});
    onboardingVoice.current?.stop();onboardingVoice.current=onboardingVoiceDiagnostics(trackOnboarding);
    log('session_start',{mode,language:sessionLanguage});
    const carriedRequest=spokenRequest||(!memoryResume&&continuity&&scope.id===continuity.studentId?[...continuity.turns].reverse().find(turn=>turn.role==='user')?.text:'')||'';
    sessionTurns.current=carriedRequest&&(!routing||scope.confirmed)?[{role:'user',text:carriedRequest}]:[];sessionSources.current=[];memorySaved.current=!summaryScope.current.confirmed;setSources([]);
    setSummarySaved(false);setActivity('listening');setLatestAnswer('');setError('');setFailureCode('');setNotice('');setAudioBlocked(false);setSeconds(0);setState('connecting');onActive(true);onBusy?.(true);
    const version=++generation.current;
    binderSource.current=crypto.randomUUID();
    // A confirmed student can follow along while the connection is starting.
    publishBinderActivity(focus?[focus.topic]:[]);
    saveCompletion.current=voiceSaveCompletion(reason=>{if(reason!=='drained')void Promise.resolve(latestSaveComplete.current?.()).catch(()=>{});else if(transitionToHome.current)void transitionToHome.current();else void Promise.resolve(latestSaveComplete.current?.()).catch(()=>{});},{onEvent:(name,metadata)=>{trackOnboarding(name,{...metadata,...(name==='save_confirmation_finished'?{playbackReady:onboardingVoice.current?.ready()===true}:{})});if(name==='save_confirmation_finished')log('profile_save_confirmation_finished');}});
    const abort=new AbortController();resources.current.abort=abort;
    const memoryTools=voiceMemoryTools({signal:abort.signal,isCurrent:()=>generation.current===version&&!closing.current?.active(),canHear:()=>onboardingVoice.current?.ready()===true,
      post:async(body,signal)=>{const response=await apiFetch('/api/live-memory',{method:'POST',headers:{'Content-Type':'application/json',...(summaryToken.current?{Authorization:`Bearer ${summaryToken.current}`}:{})},body:JSON.stringify(body),signal});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'live_memory_unavailable'),{status:response.status});return data;},
      onWriting:value=>{liveMemorySaving.current=value;setCheckingMemorySave(value);},
      onConflict:()=>invalidateRememberedContext(),
      onUncertain:()=>{invalidateRememberedContext();setNotice(t('The save result could not be confirmed. Check your binder before trying again.','No se pudo confirmar el resultado. Revisa tu carpeta antes de volver a intentarlo.'));},
      onSaved:async result=>{
        if(generation.current!==version||closing.current?.active())return;
        const nextScope={id:summaryScope.current.id,confirmed:true},nextLanguage=spokenLanguage.current;
        const hasRecovery=!!checkpoint.current;
        if(hasRecovery)await saveSummary();
        memorySaved.current=true;sessionTurns.current=[];sessionSources.current=[];
        if(!hasRecovery)summaryQueue.current.remove(summaryId.current);
        privateRecovery(`origen.onboarding-summaries.${user?.sub||'preview'}`).removeEntry(summaryId.current);
        end();if(user?.sub)notifyMemoryContext(user.sub,nextScope.id);
        setNotice(t('Saved. Reconnecting with your updated information…','Guardado. Reconectando con tu información actualizada…'));
        await start(nextScope,nextLanguage,'',sessionId,true);
        setNotice(result.kind==='next-step'?t('Your next step was saved.','Se guardó tu próximo paso.'):t('Your memory change was saved.','Se guardó el cambio en tus recuerdos.'));
      },
    });
    const linkTools=coordinatorVoiceTools({post:connectionRequest,studentId:scope.id,onPrepared:card=>setConnectionCard(card),onClear:()=>setConnectionCard(undefined),onCode:()=>{const last=[...sessionTurns.current].reverse().find(turn=>turn.role==='user');if(last)last.text='[Connection code omitted]';checkpointSummary();}});connectionController.current=linkTools;
    resources.current.stopMemory=()=>{memoryTools.stop();linkTools.stop();};
    invalidateMemoryPlayback.current=()=>memoryTools.event({type:'output_audio_buffer.cleared'});
    const memoryResponseTurns=new Map<string,number>();
    const linkResponseTurns=new Map<string,number>();
    const research=voiceResearchRequest({signal:abort.signal});
    resources.current.cancelResearch=()=>research.cancel();
    resources.current.deadline=setTimeout(()=>{if(generation.current===version){log('connection_failure',{code:'connection_timeout'});end();setError(t('Connection timed out. Please try again.','La conexión tardó demasiado. Inténtalo de nuevo.'));}},35000);
    try {
      if(summaryQueue.current.size){setNotice(t('Your previous conversation is still saving. You can start talking while it finishes.','Tu conversación anterior sigue guardándose. Puedes empezar a hablar mientras termina.'));void retrySummaries();}
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const voiceInput={voiceProtocol:'live-v1',enableLiveMemory:history.cloud&&informational,continuing:memoryResume,workspaceFocus:focus,routeConversations:routing,targetConfirmed:scope.confirmed,scopeRestart:scope.confirmed&&!focus,students:family.students.map(({id,name})=>({id,name})),studentId:routing?(scope.confirmed?scope.id:undefined):scope.id===null?null:history.cloud&&family.students.some(student=>student.id===profile.id)?profile.id:undefined,profile:informational?{name:profile.name,stage:profile.stage,institutions:profile.institutions,entryTerm:profile.entryTerm,...(mode==='planning'?{school:profile.school,interest:profile.interest,goals:profile.goals}:{})}:profile,language:sessionLanguage,role,mode:liveMode.current,allowGuideHandoff:!!onGuideChanged,continuity:!memoryResume&&continuity&&scope.id===continuity.studentId?continuity.turns:undefined,collectAccount:!!onAccountDraft,saveOnboarding:!!onSaveProfile,onboarding,replayWelcome,experience:{usedApp:family.returningUser===true,usedVoice:family.account.usedVoice===true||loadLocal<boolean>(voiceUsageKey,false)===true||latestHistory.current.items.length>0},memory:(routing&&!scope.confirmed?[]:recentConversationMemory(latestHistory.current.items,scope.id,liveMode.current)).map(x=>({date:x.date,mode:x.mode,summary:x.summary}))};
      const startup=await voiceStartup({signal:abort.signal,
        getToken:async()=>history.cloud?getAccessTokenSilently():undefined,
        getMedia:()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}).catch(error=>{if(generation.current===version)trackOnboarding(['NotAllowedError','SecurityError'].includes(error?.name)?'microphone_denied':'microphone_failed',{code:error?.name||'other'});throw error;}),
        prepare:history.cloud&&informational&&(!routing||scope.confirmed)&&voiceInput.studentId!==undefined?async(token,signal)=>{
          const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({...voiceInput,action:'prepare'}),signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
          if(!response.ok)return undefined;const data=await response.json();return typeof data.preparedContextId==='string'?data.preparedContextId:undefined;
        }:undefined,
      });
      const {stream}=startup;summaryToken.current=startup.token;if(startup.token)guidanceTokens.current.set(sessionId,startup.token);summaryId.current=continuingSession?crypto.randomUUID():sessionId;holdConversation(summaryId.current);
      if(generation.current!==version){stream.getTracks().forEach(track=>track.stop());return;}
      trackOnboarding('microphone_allowed');
      resources.current.stream=stream;
      const pc=new RTCPeerConnection();resources.current.pc=pc;const stopPlaybackTimer=setInterval(()=>livePlayback.idle(),100);const priorStopConnection=resources.current.stopConnection;resources.current.stopConnection=()=>{clearInterval(stopPlaybackTimer);priorStopConnection?.();};
      pc.ontrack=e=>{if(generation.current!==version||closing.current?.active())return;void livePlayback.attach(e.streams[0]);if(audio.current){audio.current.srcObject=e.streams[0];void audio.current.play().then(()=>{if(generation.current===version)setAudioBlocked(false);}).catch(()=>{if(generation.current===version){onboardingVoice.current?.playback('blocked');setAudioBlocked(true);}});}};
      stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const dc=studentLiveChannel(pc.createDataChannel('oai-events'),{getTurn:()=>saveConsent.token(),isPlaybackIdle:()=>livePlayback.idle()&&audio.current?.paused===false&&!audio.current.muted});resources.current.dc=dc;
      let openingRequested=false;
      let playWelcome=onboarding;
      const saveConsent=voiceProfileSaveConsent();
      let welcomeResponseId:string|undefined,welcomeCompleted=false,welcomeRecorded=false,welcomeInterrupted=false;
      const sentEvents=new Map<string,string>();
      const send=(event:unknown)=>{
        if(dc.readyState!=='open')return;
        const payload=event as {type:string};
        if(closing.current?.active())return;
        if(payload.type==='response.create'&&!openingRequested){openingRequested=true;if(playWelcome)event={...payload,response:{instructions:onboardingWelcome(sessionLanguage,{preview:!history.cloud,role,hasName:!!profile.name.trim(),canSaveProfile:!!onSaveProfile,newStudent:!onAccountDraft})+(onAccountDraft?' For profile setup, ask the account holder what they would like to be called, then whether they are a student or parent/guardian. Collect these through propose_account before collecting the student profile. This replaces the earlier instruction to ask the student name first.':' The account is already set up. Collect only this new student; never ask for the account-holder name or role.')}};}
        if(payload.type==='response.create'){const response=(event as {response?:Record<string,unknown>}).response||{};event={...event as Record<string,unknown>,response:{...response,metadata:{...response.metadata as Record<string,unknown>,origen_user_turn:saveConsent.token()}}};}
        const event_id=crypto.randomUUID();
        log('client_event',{eventId:event_id,operation:payload.type});
        sentEvents.set(event_id,payload.type);
        if(sentEvents.size>100)sentEvents.delete(sentEvents.keys().next().value!);
        dc.send(JSON.stringify({...event as Record<string,unknown>,event_id}));
        return event_id;
      };
      const languageControl=voiceLanguageControl(event=>dc.send(JSON.stringify(event)),{language:sessionLanguage,onLanguage:next=>{if(generation.current===version){spokenLanguage.current=next;checkpointSummary();onLanguageChanged?.(next);void guidance.current.event('guidance.language_changed',{language:next,basis:'model-detection'})?.catch(()=>{});}}});resources.current.stopGuide=()=>languageControl.stop();
      let changingGuide=false;
      resources.current.switchGuide=async (next,initialScope,focus,isCurrent)=>{
        if(isCurrent&&!isCurrent())return false;
        if(next===liveMode.current&&!initialScope&&!focus)return true;
        if((!summaryScope.current.confirmed&&!initialScope)||changingGuide)return false;
        const updateScope=initialScope||summaryScope.current;
        const contextFocus=focus||(currentWorkspace.current?.studentId===updateScope.id?currentWorkspace.current:undefined);
        const currentStudents=latestFamily.current.students;
        const updateProfile=voiceProfile(next,latestSetup.current.profile,currentStudents,updateScope.id);
        changingGuide=true;
        let nextGuidance:ReturnType<typeof guidance.current.current>;
        logTarget.current=updateScope.confirmed?updateScope.id:undefined;setSwitchingGuide(true);log('guide_update_start',{mode:next});
        try{
          await languageControl.configure(currentLanguage=>withRequestDeadline(async signal=>{
            const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,'X-Origen-Operation':logOperation.current,'X-Origen-Segment':crypto.randomUUID()},body:JSON.stringify({action:'update-guide',enableLiveMemory:history.cloud,memorySessionId:memoryTools.session()?.id,workspaceFocus:contextFocus,workspaceRefreshOnly:!focus,mode:next,language:currentLanguage,role:latestSetup.current.role,routeConversations:latestSetup.current.role==='parent',targetConfirmed:updateScope.confirmed,studentId:updateScope.id,students:currentStudents.map(({id,name})=>({id,name})),profile:updateProfile,allowGuideHandoff:true,memory:recentConversationMemory(latestHistory.current.items,updateScope.id,next)}),signal});
            const data=await response.json();if(!response.ok)setErrorReference(responseReference(response));if(!response.ok||!data.session?.instructions||!Array.isArray(data.session.tools))throw new Error(data.error||'guide_config_unavailable');
            signal.throwIfAborted();
            if(generation.current!==version)throw new Error('voice_session_stopped');
            if(isCurrent&&!isCurrent())throw new Error('topic_superseded');
            if(memoryPolicyRef.current!==undefined&&data.memoryPolicy!==memoryPolicyRef.current){invalidateRememberedContext();throw new Error('voice_session_stopped');}memoryPolicyRef.current=data.memoryPolicy;
            if(typeof data.memoryRevision==='number'){if(memoryRevisionRef.current!==null&&memoryRevisionRef.current!==data.memoryRevision){invalidateRememberedContext();throw new Error('voice_session_stopped');}memoryRevisionRef.current=data.memoryRevision;setMemoryRevision(data.memoryRevision);}
            memoryTools.configure(data.liveMemorySession);linkTools.configure(data.coordinatorLinking===true);
            nextGuidance=data.guidance;
            return data.session;
          },{signal:abort.signal}),()=>{
            if(generation.current!==version||closing.current?.active())return;
            if(focus&&(!isCurrent||isCurrent()))currentWorkspace.current=focus;
            guidance.current.accept(nextGuidance);void guidance.current.event('guidance.configuration_applied')?.catch(()=>{});
            if(initialScope){summaryScope.current={...initialScope,name:updateProfile.name};memorySaved.current=false;setTarget(initialScope);log('initial_target_confirmed');}
            liveMode.current=next;checkpointSummary();setMode(next);onGuideChanged?.(next);setNotice('');log('guide_update_complete',{mode:next});
            if(!isCurrent||isCurrent())publishBinderActivity(focus?[focus.topic]:next==='finance'||next==='loans'?['costs']:next==='admissions'?['applications']:[]);
          });
          if(generation.current!==version)return false;
          // A specialty change remains one conversation and one recovery record.
          return true;
        }catch(error){if(focus)throw error;if(generation.current===version){log('guide_update_failed',{mode:next});setNotice(t('I could not change topics yet. You can keep talking or try again.','No pude cambiar de tema todavía. Puedes seguir hablando o intentar de nuevo.'));}return false;}
        finally{changingGuide=false;if(generation.current===version)setSwitchingGuide(false);}
      };
      const topicControl=voiceBinderTopics({
        getTurn:()=>saveConsent.token(),
        canApply:()=>generation.current===version&&privacyLease.valid()&&!closing.current?.active()&&!scopePending.current&&summaryScope.current.confirmed&&liveMode.current!=='profile',
        getGuide:()=>liveMode.current,
        getFocusTopic:()=>currentWorkspace.current?.topic,
        highlight:topics=>binderActivity.update(binderSource.current,topics),
        switchGuide:(next,topic,isCurrent)=>onGuideChanged?resources.current.switchGuide!(next,undefined,{kind:'topic',studentId:summaryScope.current.id,topic,serial:crypto.randomUUID()},isCurrent):Promise.resolve(false),
        onGuideUnavailable:()=>setNotice(t('I could not change guides yet. You can keep talking or try again.','No pude cambiar de guía todavía. Puedes seguir hablando o intentar de nuevo.')),
      });
      resources.current.stopTopics=()=>topicControl.stop();
      transitionToHome.current=async()=>{
        if(transitioned.current||generation.current!==version||closing.current?.active())return;
        transitioned.current=true;
        const complete=latestSetup.current.onProfileSaveComplete;
        const release=turns.holdReply();
        try{
          await complete?.();
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          if(generation.current!==version||closing.current?.active())return;
          homeClosing.current=true;trackOnboarding('home_introduction_requested');
          closeWithFarewell(homeVoiceIntroduction(spokenLanguage.current,{preview:!history.cloud}));
        }catch{transitioned.current=false;trackOnboarding('home_introduction_failed',{reason:'request_failed'});setNotice(t('Your profile is saved, but home could not open yet. Please try again.','Tu perfil está guardado, pero no se pudo abrir el inicio. Intenta de nuevo.'));}finally{release();}
      };
      const cache=voiceResearchCache();const researchBudget=voiceResearchBudget();const speechTimes=new Map<string,number>();const handledTranscripts=new Set<string>();
      const turns=voiceTurns(send,()=>log('empty_interruption_recovered'),{onBusy,onMissing:itemId=>{onboardingVoice.current?.transcript(itemId,'timeout');setActivity('listening');awaitingTranscription.current.delete(itemId);log('transcription_timeout');setNotice(t('I could not hear part of that. Please repeat any missing detail.','No pude escuchar una parte. Repite cualquier detalle que falte.'));}});resources.current.stopTurns=()=>turns.stop();resources.current.turnsBusy=()=>turns.busy();
      resources.current.studentSelection=voiceWorkspaceQueue<string|null>({
        busy:()=>turns.busy()||changingGuide,
        apply:async id=>{
          if(generation.current!==version||latestSetup.current.profile.id!==id||summaryScope.current.id===id)return;
          const selected=latestFamily.current.students.find(student=>student.id===id);if(!selected)return;
          send({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:`The parent selected another student on screen: ${JSON.stringify({scope:'student:'+selected.id,name:selected.name})}. Ask one short spoken question to clarify whether they want to discuss that student. Keep the current conversation language and do not greet again. Selection alone does not authorize changing the saved conversation target or loading that student's private context. Only after a clear spoken answer, call request_conversation_target. No on-screen confirmation is needed.`}]}});
          turns.request();
        }
      });
      resources.current.workspace=voiceWorkspaceQueue<WorkspaceSelection>({
        busy:()=>turns.busy()||changingGuide,
        onPending:pending=>{if(pending)setNotice(t('We’ll pick this up after the current reply.','Retomaremos esto después de la respuesta actual.'));},
        apply:async selection=>{
          if(generation.current!==version||closing.current?.active())return;
          if(summaryScope.current.confirmed&&summaryScope.current.id!==selection.studentId){setNotice(t('This call is about a different person or family scope. End it, then press Talk about this again for the selected plan or note.','Esta llamada trata de otra persona o del grupo familiar. Termínala y luego presiona Hablemos de esto para el plan o la nota elegida.'));return;}
          if(liveMode.current==='profile'){setNotice(t('Save the profile before discussing saved work.','Guarda el perfil antes de hablar de tus notas o acciones.'));return;}
          const release=turns.holdReply();
          try{
            const applied=await resources.current.switchGuide?.(workspaceGuide(selection.topic),summaryScope.current.confirmed?undefined:{id:selection.studentId,confirmed:true},selection);
            if(applied&&generation.current===version){
              send({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:'The person pressed Talk about this. Use the selected item or topic in the freshly loaded saved workspace context. This is a screen selection, not transcribed speech. Keep the current language and conversation. Do not repeat Hola or recap the previous answer. If a new spoken question is pending, address that first.'}]}});
              turns.request();
            }
          }catch(error){if(generation.current===version)setNotice(t('Could not open that saved item. It may have changed or been deleted. Refresh your notes or plan and try again. Your call is still connected.','No se pudo abrir ese elemento guardado. Tal vez cambió o se eliminó. Actualiza tus notas o tu plan e inténtalo de nuevo. La llamada sigue conectada.'));}finally{release();}
        }
      });
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
      const stopProgress=()=>{progress.stop();turns.endProgress();};
      resources.current.stopProgress=stopProgress;
      homeClosing.current=false;
      closing.current=voiceClosing({
        send:event=>{if(dc.readyState!=='open')throw new Error('voice_closed');dc.send(JSON.stringify(event));},
        stopInput:()=>{resources.current.stream?.getAudioTracks().forEach(track=>track.stop());awaitingTranscription.current.clear();speechInProgress.current=false;saveConsent.clear();},
        stopWork:()=>{clearInterval(resources.current.timer);turns.stop();resources.current.cancelResearch?.();resources.current.stopProgress?.();resources.current.stopMemory?.();resources.current.stopGuide?.();resources.current.workspace?.stop();resources.current.studentSelection?.stop();},
        language:()=>spokenLanguage.current,
        disconnect:reason=>{
          if(generation.current!==version)return;
          if(homeClosing.current){trackOnboarding(reason==='drained'?'home_introduction_finished':'home_introduction_failed',{reason});if(reason==='drained')void family.recordVoiceExperience?.(true).catch(()=>{});}
          finalReason.current=reason==='drained'?'completed':'disconnected';end();
        },
      });
      dc.onopen=()=>{
        if(generation.current!==version||closing.current?.active())return;
        publishBinderActivity(focus?[focus.topic]:[]);
        trackOnboarding('voice_connected');clearTimeout(resources.current.deadline);setState('live');saveLocal(voiceUsageKey,true);void family.recordVoiceExperience?.(false).catch(()=>log('voice_usage_save_failed'));
        if(!resources.current.stopWake){
          const wake=voiceWakeLock(status=>{if(generation.current===version)setWakeStatus(status);});
          resources.current.stopWake=()=>wake.stop();
        }
        const started=Date.now();
        resources.current.timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=600){onboardingEndReason.current='time_limit';closeWithFarewell();setNotice(informational?t('The 10-minute conversation has ended.','La conversación de 10 minutos terminó.'):t('The 10-minute conversation has ended. Review your suggestions below.','La conversación de 10 minutos terminó. Revisa las sugerencias abajo.'));}},1000);
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
        if(closing.current?.active()){closing.current.event(e);return;}
        onboardingVoice.current?.provider(e);
        turns.playback(e);
        saveCompletion.current?.event(e);
        if(generation.current!==version||closing.current?.active())return;
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
        memoryTools.event(e);
        if(['output_audio_buffer.started','output_audio_buffer.stopped','output_audio_buffer.cleared','error','response.created','response.done','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(e.type))
          log('server_event',{operation:e.type,eventId:e.event_id,responseId:e.response?.id,status:e.response?.status,reason:e.response?.status_details?.reason});
        if(e.type==='response.created'){assistantSpeaking.current=true;setActivity('thinking');turns.created();void guidance.current.event('response.started')?.catch(()=>{});}
        if(e.type==='response.done'){assistantSpeaking.current=false;setActivity(current=>current==='thinking'?'listening':current);if(['completed','failed','cancelled','incomplete'].includes(e.response?.status))void guidance.current.event('response.finished',{status:e.response.status})?.catch(()=>{});}
        if(e.type==='input_audio_buffer.speech_started'){saveConsent.begin(e.item_id);memoryTools.begin(e.item_id,spokenLanguage.current);linkTools.begin(e.item_id);speechInProgress.current=true;if(e.item_id)awaitingTranscription.current.add(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){speechInProgress.current=false;turns.speechStopped(e.item_id);}
        if(e.type==='conversation.item.input_audio_transcription.completed'||e.type==='conversation.item.input_audio_transcription.failed')awaitingTranscription.current.delete(e.item_id);
        if(finishPromise.current&&e.type==='error'&&e.error?.code==='input_audio_buffer_commit_empty')return;
        if(e.type==='input_audio_buffer.speech_started'){speechTimes.set(e.item_id,Date.now());turns.speechStarted(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){const started=speechTimes.get(e.item_id);if(started!==undefined){log('speech_segment',{speechDurationMs:Date.now()-started});speechTimes.delete(e.item_id);}}
        if(e.type==='response.created'&&e.response?.id){memoryResponseTurns.set(e.response.id,memoryTools.sequence());linkResponseTurns.set(e.response.id,linkTools.sequence());}
        if(e.type==='response.done'&&e.response?.status==='cancelled')log('response_cancelled',{responseId:e.response.id,reason:e.response.status_details?.reason,toolCount:(e.response.output||[]).filter((item:{type:string})=>item.type==='function_call').length});
        if(e.type==='conversation.item.input_audio_transcription.failed'){onboardingVoice.current?.transcript(e.item_id,'failed');turns.transcript(e.item_id,'');}
        if(e.type==='conversation.item.input_audio_transcription.completed' || e.type==='response.output_audio_transcript.done') {
          const userTurn=e.type.startsWith('conversation');
          if(userTurn&&e.item_id){if(handledTranscripts.has(e.item_id))return;handledTranscripts.add(e.item_id);}
          const release=userTurn?turns.holdReply():()=>{};
          try{
            if(userTurn){
              // Replies and clarifications must not abort ongoing research.
              // Only an explicit search-stop command cancels the tool batch;
              // the reply hold still records this turn before any next answer.
              research.spokenTurn(e.transcript);
              const next=spokenLanguageFromText(e.transcript,languageControl.language());
              if(next!==languageControl.language()){
                try{await languageControl.change(next);log('spoken_language_changed',{language:next});}
                catch{log('spoken_language_update_failed');}
                if(generation.current!==version||closing.current?.active())return;
              }
            }
            if(userTurn){
              const latestTurn=saveConsent.transcript(e.item_id,e.transcript);
              if(latestTurn&&isVoiceGoodbye(e.transcript)){
                sessionTurns.current=appendConversationTurn(sessionTurns.current,{role:'user',text:redactCoordinatorCodes(e.transcript),topic:liveMode.current,language:spokenLanguage.current});
                checkpointSummary();onboardingEndReason.current='user_end';closeWithFarewell();return;
              }
            }
            if(userTurn){linkTools.begin(e.item_id);memoryTools.transcript(e.item_id,e.transcript,spokenLanguage.current);}
            const valid=userTurn?turns.transcript(e.item_id,e.transcript):typeof e.transcript==='string'&&e.transcript.trim().length>0;
            if(userTurn)onboardingVoice.current?.transcript(e.item_id,valid?'accepted':'empty');
            if(valid&&userTurn){replyRecoveryUsed=false;setNotice('');}
            if(valid&&!scopePending.current){sessionTurns.current=appendConversationTurn(sessionTurns.current,{role:userTurn?'user':'assistant',text:redactCoordinatorCodes(e.transcript),topic:liveMode.current,...(userTurn?{language:spokenLanguage.current}:{expectedLanguage:spokenLanguage.current})});checkpointSummary();}
            if(valid&&!userTurn&&!scopePending.current){setLatestAnswer(e.transcript);}
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
          const researchRevision=research.revision();
          const memoryTurn=memoryResponseTurns.get(e.response?.id)??memoryTools.sequence();
          let called=await voiceLanguageTools(e.response?.output||[],languageControl,send)>0;
          if(generation.current!==version||closing.current?.active())return;
          for(const item of e.response?.output||[]) {
            if(item.type!=='function_call')continue;
            if(closing.current?.active())return;
            called=true;let accepted=false;
            if(['propose_account','propose_profile','end_conversation','highlight_binder_topics','switch_college_guide'].includes(item.name)&&e.response?.metadata?.origen_user_turn!==saveConsent.token()){
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'superseded_turn',instruction:'A newer user turn arrived. Follow the latest user words; do not apply an older draft or end the call.'})}});continue;
            }
            if(item.name==='end_conversation'){
              let requested=false;try{requested=JSON.parse(item.arguments).requested_by_user===true;}catch{}
              const latestWords=[...sessionTurns.current].reverse().find(turn=>turn.role==='user')?.text;
              if(requested&&canEndVoiceConversation(latestWords)){onboardingEndReason.current='user_end';closeWithFarewell();return;}
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'end_not_requested'})}});continue;
            }
            if(item.name==='highlight_binder_topics'){
              let topics:unknown;try{topics=JSON.parse(item.arguments).topics;}catch{}
              const applied=await topicControl.update(topics,e.response?.metadata?.origen_user_turn);
              if(generation.current!==version||closing.current?.active())return;
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:applied?'topics_highlighted':'highlight_unavailable',guide:liveMode.current,instruction:'No notes were edited or saved. The guide field identifies the currently acknowledged specialist. Continue the conversation naturally without announcing the highlight.'})}});continue;
            }
            if(linkTools.isTool(item.name)){
              const output=await linkTools.invoke(item,linkResponseTurns.get(e.response?.id)??linkTools.sequence());if(generation.current!==version||closing.current?.active())return;
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});continue;
            }
            if(memoryTools.isTool(item.name)){
              const output=await memoryTools.invoke(item,memoryTurn);if(generation.current!==version||closing.current?.active())return;
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});continue;
            }
            if(item.name==='set_conversation_language'||item.name==='save_onboarding_profile')continue;
            if(item.name==='switch_college_guide'&&onGuideChanged){
              let next:string|undefined;try{next=JSON.parse(item.arguments).guide;}catch{}
              const accepted=!!next&&['finance','admissions','planning','loans'].includes(next)&&await resources.current.switchGuide?.(next as 'finance'|'admissions'|'planning'|'loans');
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'guide_updated':'continue_current_guide',instruction:accepted?'Continue the pending question in this same call. Do not greet or say Hola again.':'Continue here; do not retry the same handoff repeatedly.'})}});continue;
            }
            if(latestSetup.current.role==='parent'&&liveMode.current!=='profile'&&item.name==='request_conversation_target'){
              let next:string|null|undefined;
              try{next=resolveScope(JSON.parse(item.arguments).scope,latestFamily.current.students);}catch{/* Invalid model proposals cannot change storage scope. */}
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
                const {result,reused,query}=await research.run(async signal=>{
                  const args=JSON.parse(item.arguments);
                  const lookupLanguage=languageControl.language();
                  if(typeof args.question!=='string'||!args.question.trim()||args.question.length>3000||typeof args.institution!=='string'||args.institution.length>300)throw new Error('invalid_lookup');
                  const latestQuestion=[...sessionTurns.current].reverse().find(turn=>turn.role==='user')?.text||'';
                  const query={mode:researchMode,language:lookupLanguage,question:args.question,institution:researchMode==='loans'?'':args.institution,forceRefresh:args.forceRefresh===true||wantsFreshLookup(latestQuestion)};
                  let result=cache.get(query);
                  const reused=Boolean(result);
                  if(result)log('lookup_cache_hit',{callId:item.call_id,sourceCount:result.sources.length});
                  else {
                    if(!researchBudget.take(query)){budgetExceeded=true;throw new Error('research_budget_reached');}
                    progress.start();
                    const response=await apiFetch((researchMode==='finance'||researchMode==='loans')?'/api/finance-research':'/api/admissions-research',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,...(guidance.current.current()?{'X-Origen-Segment':guidance.current.current()!.segmentId}:{})},body:JSON.stringify({question:args.question,institution:researchMode==='loans'?'':args.institution,language:lookupLanguage,purpose:researchMode==='planning'?'planning':undefined}),signal});
                    result=await response.json();
                    signal.throwIfAborted();
                    if(!response.ok||!result||!Array.isArray(result.sources)||!result.sources.length)throw new Error(result?.error==='private_search_details'?'private_search_details':'lookup_failed');
                  }
                  return {result,reused,query};
                },researchRevision);
                if(generation.current!==version||closing.current?.active())return;
                if(!reused)cache.put(query,result);
                log('lookup_success',{callId:item.call_id,sourceCount:result.sources.length,durationMs:Date.now()-researchStarted.current});
                output=researchEvidence(result,reused);
                sessionSources.current=mergeConversationSources(sessionSources.current,result.sources);
                setSources(sessionSources.current);
                setNotice('');
              }catch(error){
                if(generation.current!==version||closing.current?.active())return;
                const privateQuery=error instanceof Error&&error.message==='private_search_details';
                const cancelled=error instanceof Error&&error.name==='AbortError';
                const timedOut=error instanceof Error&&error.name==='TimeoutError';
                if(cancelled)output={error:'lookup_cancelled',instruction:'The previous lookup was cancelled by the user or superseded by a newer spoken turn. Follow their latest request. Do not retry the cancelled lookup unless asked, and do not claim results.'};
                if(timedOut)output={error:'lookup_timeout',instruction:'The source check timed out. Briefly explain that it could not be verified and continue the conversation. Do not retry this lookup automatically or invent findings.'};
                if(privateQuery)output={error:'private_search_details',instruction:'This lookup was blocked before searching. Do not repeat these arguments. Explain briefly that searches should use a general college or aid question without private details or instructions to reveal data. Continue the conversation; do not read the blocked text aloud.'};
                log('lookup_failure',{callId:item.call_id});
                if(budgetExceeded)output={error:'research_budget_reached',instruction:'Do not retry research in this call. Explain the limit briefly and use already verified evidence only when its scope and year match; otherwise offer the official source or counselor as the next step. Keep the conversation open and never invent a policy.'};
                setNotice(cancelled?t('Search stopped. You can keep talking.','Búsqueda detenida. Puedes seguir hablando.'):timedOut?t('The search took too long. You can keep talking or ask to try again.','La búsqueda tardó demasiado. Puedes seguir hablando o pedir otro intento.'):privateQuery?t('Please use a general college or aid question for this search.','Para esta búsqueda, usa una pregunta general sobre la universidad o ayuda financiera.'):budgetExceeded?t('We have reached the lookup limit for this call. You can keep talking about what we found.','Llegamos al límite de consultas de esta llamada. Puedes seguir hablando sobre lo que encontramos.'):t('The lookup could not verify official sources. You can keep talking or try another question.','No se pudieron verificar fuentes oficiales. Puedes seguir conversando o hacer otra pregunta.'));
              }finally{stopProgress();}
              if(generation.current!==version||closing.current?.active())return;
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
          called=(await voiceProfileSaveTools(e.response?.output||[],latestProfileSave.current?async()=>{const result=await latestProfileSave.current!();if(result.status==='saved'&&generation.current===version){saveCompletion.current?.arm();log('profile_saved_awaiting_confirmation');}return result;}:undefined,send,()=>generation.current===version&&!closing.current?.active(),()=>saveConsent.consume(e.response?.metadata?.origen_user_turn))>0)||called;
          if(generation.current!==version||closing.current?.active())return;
          if(called)turns.toolsCompleted();else turns.completed();
        }
      };
      const connection=voiceConnectionRecovery(()=>{if(generation.current!==version)return;log('connection_failure',{code:'connection_lost'});end();setError(informational?t('Voice disconnected. Start another conversation to reconnect.','Se desconectó la voz. Inicia otra conversación para reconectar.'):t('Voice disconnected. You can reconnect or review the suggestions collected so far.','Se desconectó la voz. Puedes reconectar o revisar las sugerencias recibidas.'));});
      const stopPlayback=resources.current.stopConnection;resources.current.stopConnection=()=>{stopPlayback?.();connection.stop();};
      let connectedRecorded=false;
      pc.onconnectionstatechange=()=>{if(generation.current===version&&pc.connectionState==='connected'&&!usage.current.id){usage.current.id=crypto.randomUUID();usageEvent('voice_start');usage.current.timer=setInterval(()=>{if(pc.connectionState==='connected')usageEvent('voice_heartbeat');},15000);}
      log('connection_state',{connectionState:pc.connectionState});if(generation.current===version){if(pc.connectionState==='connected'&&!connectedRecorded&&guidance.current.current()){connectedRecorded=true;void guidance.current.event('voice.connected')?.catch(()=>{});}connection.change(pc.connectionState);}};
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId,'X-Origen-Operation':logOperation.current,'X-Origen-Segment':segmentId},body:JSON.stringify({...voiceInput,sdp:offer.sdp,preparedContextId:startup.prepared()}),signal:abort.signal});
      const data=await response.json().catch(()=>null);
      if(generation.current!==version||closing.current?.active())return;
      setDiagnosticId(responseReference(response)||'');
      guidance.current.accept(data?.guidance);
      if(!response.ok)throw apiFailure(response,data?.error || (response.status===401?'authentication_required':'voice_unavailable'));
      if(typeof data?.sdp!=='string'||!data.sdp.startsWith('v=0'))throw new Error('invalid_voice_response');
      if(typeof data.playWelcome==='boolean')playWelcome=data.playWelcome;
      if(generation.current!==version||closing.current?.active())return;
      memoryTools.configure(data.liveMemorySession);linkTools.configure(data.coordinatorLinking===true);
      memoryPolicyRef.current=data.memoryPolicy;
      if(typeof data.memoryRevision==='number'){memoryRevisionRef.current=data.memoryRevision;setMemoryRevision(data.memoryRevision);}
      dc.configure(data);await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    }catch(err){
      if(generation.current!==version||closing.current?.active())return;
      const code=err instanceof Error?err.message:'';
      finalReason.current='failed';void guidance.current.event('voice.start_failed',{phase:'transport'})?.catch(()=>{});
      const messages:Record<string,[string,string]>={
        memory_changed:['Your saved information changed while connecting. Start again to load the latest details.','Tu información cambió durante la conexión. Inicia de nuevo para cargar los datos actuales.'],
        workspace_item_changed:['This saved item changed. Refresh your notebook or plan, then choose Talk about this again.','Este elemento guardado cambió. Actualiza tu cuaderno o plan y vuelve a elegir Hablemos de esto.'],
        workspace_item_unavailable:['This saved item is no longer available. Refresh your notebook or plan.','Este elemento guardado ya no está disponible. Actualiza tu cuaderno o plan.'],
        workspace_unavailable:['Your saved work could not be loaded. Please try again.','No se pudieron cargar tus notas y acciones. Inténtalo de nuevo.'],
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
    {connectionCard&&<CoordinatorConfirm card={connectionCard} t={t} onClose={()=>setConnectionCard(undefined)} onSent={()=>setNotice(t('Request sent. Your binder is still private.','Solicitud enviada. Tu carpeta sigue privada.'))}/>}
    <div className="voice-controls">
      {state==='idle'?<VoiceStartButton label={t('Talk with Origen','Hablar con Origen')} onClick={()=>{trackOnboarding('voice_button_pressed',{language});onRestart?onRestart():void start();}}/>:<>
        <span className={`voice-activity activity-${activity}`} role="status"><VoiceWave speaking={state==='live'&&activity==='speaking'&&!audioBlocked&&!finishing}/>{finishing?t('Finishing conversation…','Terminando la conversación…'):state==='connecting'?t('Connecting…','Conectando…'):switchingGuide?t('Following your question…','Siguiendo tu pregunta…'):audioBlocked?t('Tap Play to hear Origen','Toca Reproducir para escuchar a Origen'):researching?(mode==='loans'||mode==='finance'?t('Checking official financial aid sources…','Consultando fuentes oficiales de ayuda económica…'):t('Checking official sources…','Consultando fuentes oficiales…')):activity==='speaking'?t('Origen is speaking','Origen está hablando'):activity==='thinking'?t('Preparing an answer…','Preparando una respuesta…'):muted?t('Microphone muted','Micrófono silenciado'):t('Listening · You can speak naturally','Escuchando · Habla con naturalidad')}<small aria-hidden="true"> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</small></span>
        {state==='live'&&<button type="button" className="button outline voice-mute" aria-label={t(muted?'Unmute microphone':'Mute microphone',muted?'Activar micrófono':'Silenciar micrófono')} disabled={finishing} aria-pressed={muted} onClick={()=>{trackOnboarding(muted?'microphone_unmuted':'microphone_muted');resources.current.stream?.getAudioTracks().forEach(track=>track.enabled=muted);setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} <span className="voice-control-label">{t(muted?'Unmute':'Mute',muted?'Activar micrófono':'Silenciar')}</span></button>}
        <button type="button" className="button outline voice-end" aria-label={finishing?t('Disconnect now','Desconectar ahora'):t('End conversation','Terminar conversación')} onClick={()=>{onboardingEndReason.current='user_end';if(closing.current?.active())closing.current.force();else closeWithFarewell();}}><PhoneOff size={18}/><span className="voice-control-label">{finishing?t('Disconnect now','Desconectar ahora'):t('End conversation','Terminar conversación')}</span></button>
      </>}
      {state==='live'&&audioBlocked&&<button type="button" className="button outline voice-audio-recovery" onClick={resumeAudio}>{t('Play Origen audio','Reproducir audio de Origen')}</button>}
      {state==='live'&&researching&&<button type="button" className="button outline voice-research-cancel" onClick={()=>resources.current.cancelResearch?.()}>{t('Cancel search','Cancelar búsqueda')}</button>}
      {state==='live'&&wakeStatus==='unavailable'&&<p className="small-text voice-wake-notice" role="status">{t('Keep this screen open during your conversation. Your browser could not keep the display awake.','Mantén esta pantalla abierta durante la conversación. Tu navegador no pudo mantener la pantalla encendida.')}</p>}
    </div>
    <p className="voice-progress-status" role="status">{summarySaveState.failed?t('Summary not saved · retry below','Resumen sin guardar · reintenta abajo'):summarySaveState.saving?t('Saving your conversation…','Guardando tu conversación…'):recoveryState==='pending'?t('Preparing your summary…','Preparando tu resumen…'):summarySaved||recoveryState==='complete'?t('Summary saved · binder notes are organized separately','Resumen guardado · las notas se organizan por separado'):' '}</p>
    {error&&<p role="alert" className="error">{error} <ErrorReference reference={errorReference||diagnosticId} language={language}/></p>}
    {notice&&<p className="voice-notice" role="status">{notice}</p>}
    {recoveryState&&<p className="voice-notice" role="status">{recoveryState==='protected'?t('Recovery copy acknowledged. New words may still be uploading.','Copia de recuperación confirmada. Las palabras nuevas pueden estar subiendo.'):recoveryState==='failed'?t('Recent words are not protected yet. Keep this page open and retry saving before leaving.','Las palabras recientes aún no están protegidas. Mantén esta página abierta y reintenta guardar antes de salir.'):recoveryState==='review'?t('Your earlier discussion is kept for review because your binder changed.','Tu conversación anterior se conserva para revisar porque tu carpeta cambió.'):recoveryState==='pending'?t('Conversation received. Your summary is being prepared.','Conversación recibida. Se está preparando tu resumen.'):recoveryState==='complete'?t('Conversation summary saved.','Resumen de conversación guardado.'):t('Updating your temporary recovery copy.','Actualizando tu copia temporal de recuperación.')}</p>}
    <audio ref={audio} autoPlay controls onPlaying={event=>{setAudioBlocked(false);const silent=event.currentTarget.muted||event.currentTarget.volume===0;if(silent)invalidateMemoryPlayback.current();onboardingVoice.current?.playback(silent?'silent':'playing');}} onPause={()=>{invalidateMemoryPlayback.current();onboardingVoice.current?.playback('paused');}} onVolumeChange={event=>{invalidateMemoryPlayback.current();onboardingVoice.current?.playback(event.currentTarget.muted||event.currentTarget.volume===0||event.currentTarget.paused?'silent':'playing');}} onError={()=>{invalidateMemoryPlayback.current();onboardingVoice.current?.playback('blocked');}} hidden={state!=='live'||(onboarding&&!audioBlocked)} aria-label={t('Origen voice playback','Reproducción de voz de Origen')}/>
    {checkingMemorySave&&<p className="voice-save-status" role="status">{t('Checking your save request…','Revisando tu solicitud para guardar…')}</p>}
    <div className="voice-session-details" hidden={ownerId==='shared'&&!detailsOpen}>
    {ownerId==='shared'&&<div className="voice-details-heading"><h3>{t('Conversation details','Detalles de la conversación')}</h3><button type="button" className="button outline" onClick={onCloseDetails}>{t('Close','Cerrar')}</button></div>}
    <p className="small-text">{history.cloud?t('Relevant saved notes, accepted actions and past summaries are shared with OpenAI as context. A summary is saved to your account when the conversation ends; for a new student, save the profile first.','Las notas guardadas, las acciones aceptadas y los resúmenes pertinentes se comparten con OpenAI como contexto. Al terminar, se guarda un resumen en tu cuenta; para un estudiante nuevo, guarda primero el perfil.'):t('Conversation summaries stay in this browser preview.','Los resúmenes de ejemplo se quedan en este navegador.')}</p>
    {summarySaveState.saving&&<p className="voice-save-status" role="status">{t('Saving conversation summary…','Guardando el resumen…')}</p>}
    {summarySaveState.failed&&<div className="summary-save-error"><p role="alert">{t('Conversation summary could not be saved. Retry before leaving this page.','No se pudo guardar el resumen. Intenta de nuevo antes de salir de esta página.')}</p><ErrorReference reference={errorReference} language={language}/><button type="button" className="button outline" disabled={summarySaveState.saving} onClick={()=>void retrySummaries()}>{t('Retry saving summary','Volver a guardar el resumen')}</button></div>}
    {diagnosticId&&<details className="small-text"><summary>{t('Diagnostic session','Sesión de diagnóstico')}</summary><p>{diagnosticId}</p>{failureCode&&<p>{t('Connection error: ','Error de conexión: ')}{failureCode}</p>}<p>{t('When the server is reachable, technical events are logged without audio, transcripts or student details.','Cuando el servidor está disponible, se registran eventos técnicos sin audio, transcripciones ni datos del estudiante.')}</p></details>}
    {researching&&<p role="status">{Date.now()-researchStarted.current>=20000?t('Still checking the official guidance. You can keep speaking while I look.','Sigo consultando la guía oficial. Puedes seguir hablando mientras busco.'):t('Checking official sources…','Consultando fuentes oficiales…')} <span>{Math.max(0,Math.floor((Date.now()-researchStarted.current)/1000))}s</span></p>}
    {latestAnswer&&<details className="voice-answer"><summary>{t('Latest answer','Última respuesta')}</summary><p>{latestAnswer}</p></details>}
    {sources.length>0&&<details className="voice-sources"><summary>{t('Official sources','Fuentes oficiales')} · {sources.length}</summary><h4>{t('Sources from this conversation','Fuentes de esta conversación')}</h4><ul>{sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small> · {t('Checked','Consultado')} {new Date(source.checkedAt).toLocaleDateString(language)}</small></li>)}</ul></details>}

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
