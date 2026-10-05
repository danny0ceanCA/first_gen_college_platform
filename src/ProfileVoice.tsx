import {onboardingRecovery} from './onboardingRecovery.mjs';
import {voiceGuideUpdate} from './voiceGuideUpdate.mjs';
import {onboardingWelcome} from './voiceWelcome.mjs';
import VoiceWave from './VoiceWave';
import {SharedVoiceContext} from './SharedVoiceContext';
import {voiceResearchCache} from './voiceResearchCache.mjs';
import {useFamily} from './FamilyStore';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {useConversationHistory} from './ConversationHistory';
import {voiceTurns} from './voiceTurns.mjs';
import {voiceConnectionRecovery,voiceProfile} from './voiceConnection.mjs';
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
export type VoiceProps={recoveryKey?:string;onGuideChanged?:(mode:'finance'|'admissions'|'planning'|'loans')=>void;switchGuideMode?:'finance'|'admissions'|'planning'|'loans';detailsOpen?:boolean;onCloseDetails?:()=>void;continuity?:VoiceHandoff;onHandoff?:(mode:'finance'|'admissions'|'planning'|'loans',context:VoiceHandoff)=>void;onSwitchGuide?:(context:VoiceHandoff)=>void;switchGuideLabel?:string;onRestart?:()=>void;ownerId?:string;autoStart?:boolean;onboarding?:boolean;replayWelcome?:boolean;mode?:'profile'|'finance'|'admissions'|'planning'|'loans';profile:StudentProfile;language:'en'|'es';role:'parent'|'student';apply:(changes:Suggestions)=>void;onActive:(active:boolean)=>void;t:(en:string,es:string)=>string};
export default function ProfileVoice(props:VoiceProps){
 const shared=useContext(SharedVoiceContext);
 const localOwner=useRef(crypto.randomUUID());
 if(!shared)return <LocalProfileVoice {...props}/>;
 if(props.mode&&props.mode!=='profile')return <section className="profile-voice voice-launcher"><h3>{props.t('Talk with Origen','Hablar con Origen')}</h3><p>{props.t('Keep talking while you explore the app. Your current guide stays with you until you end the conversation.','Sigue conversando mientras exploras la app. Tu guia continua contigo hasta que termines la conversacion.')}</p><button className="button primary" onClick={()=>shared.active?shared.open():shared.launch(props)}>{shared.active?props.t('Open current conversation','Abrir conversacion actual'):props.t('Start live conversation','Iniciar conversacion en vivo')}</button></section>;
 if(shared.active&&shared.owner!==localOwner.current)return <p role="status">{props.t('End your current voice conversation before starting profile setup.','Termina la conversacion actual antes de iniciar el perfil.')} <button className="text-button" onClick={shared.open}>{props.t('Open conversation','Abrir conversacion')}</button></p>;
 return <LocalProfileVoice {...props} ownerId={localOwner.current}/>;
}
export function LocalProfileVoice({profile:initialProfile,language,role,apply,onActive,t,mode:initialMode='profile',onboarding=false,replayWelcome=false,autoStart=false,ownerId='shared',onRestart,onSwitchGuide,onHandoff,continuity,switchGuideLabel,detailsOpen=false,onCloseDetails,onGuideChanged,switchGuideMode,recoveryKey}:VoiceProps) {
  const [mode,setMode]=useState(initialMode);
  const liveMode=useRef(initialMode);
  const [switchingGuide,setSwitchingGuide]=useState(false);
  const shared=useContext(SharedVoiceContext);
  const history=useConversationHistory();
  const latestHistory=useRef(history);latestHistory.current=history;
  const family=useFamily();const {getAccessTokenSilently,user}=useAuth0();
  const voiceUsageKey=user?.sub?`origen.user.${user.sub}.voice-used.v1`:'camino.voice-used.v1';
  const spokenLanguage=useRef(continuity?.language||language);
  const routing=role==='parent'&&mode!=='profile';
  const [target,setTarget]=useState<{id:string|null;confirmed:boolean}>({id:continuity?continuity.studentId:initialProfile.id||null,confirmed:continuity?.confirmed||false});

  const scopePending=useRef(false);
  const profile=voiceProfile(mode,initialProfile,family.students,target.id);
  const summaryScope=useRef<{id:string|null;name:string;confirmed:boolean}>({id:initialProfile.id||null,name:initialProfile.name,confirmed:!routing});
  const summaryToken=useRef<string|undefined>(undefined);const summaryId=useRef('');
  const sessionTurns=useRef<{role:'user'|'assistant';text:string}[]>([]);
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
    if(!onboarding||!sessionTurns.current.some(turn=>turn.role==='user')||!summaryId.current)return;
    const store=onboardingRecovery(localStorage,`origen.onboarding-summaries.${history.cloud?user?.sub:'preview'}`);
    const records=store.read<Record<string,unknown>>({});
    records[summaryId.current]={id:summaryId.current,studentId:summaryScope.current.id,scopeName:summaryScope.current.name,mode:liveMode.current,language:spokenLanguage.current,date:new Date().toISOString(),turns:sessionTurns.current,sources:sessionSources.current};
    if(!store.write(records))setNotice(t('Keep this page open until the summary saves.','Mantén esta página abierta hasta guardar el resumen.'));
  }
  async function saveSummary(){
    if(memorySaved.current||!summaryScope.current.confirmed||!sessionTurns.current.some(t=>t.role==='user'))return;
    const studentId=summaryScope.current.id,scopeName=summaryScope.current.name;
    checkpointSummary();
    memorySaved.current=true;const turns=[...sessionTurns.current];const sources=[...sessionSources.current];const id=summaryId.current||crypto.randomUUID();setSavingSummary(true);
    const body=JSON.stringify({turns,language:spokenLanguage.current,id,scopeName,defer:studentId!==null&&history.cloud&&!family.students.some(student=>student.id===studentId),studentId,date:new Date().toISOString(),mode:liveMode.current,sources});
    const savedMode=liveMode.current;
    const subject=history.cloud?user?.sub:undefined,date=new Date().toISOString();
    summaryQueue.current.add(id,async()=>{let token:string|undefined;if(subject){token=await getAccessTokenSilently();if(!token)throw new Error('authentication_required');let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}if(tokenSubject!==subject)throw new Error('summary_account_changed');}const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body,keepalive:new TextEncoder().encode(body).length<60000});if(!response.ok)throw new Error();const {summary}=await response.json();await history.add({id,studentId,date,mode:savedMode,summary,sources});if(onboarding){const store=onboardingRecovery(localStorage,`origen.onboarding-summaries.${subject||'preview'}`);const records=store.read<Record<string,unknown>>({});delete records[id];store.write(records);}});
    await retrySummaries();
  }
  const informational=mode!=='profile';
  const [state,setState]=useState<'idle'|'connecting'|'live'>('idle');
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
  const [draftRecovery]=useState(()=>recoveryKey?onboardingRecovery(localStorage,recoveryKey):null);
  const [changes,setChanges]=useState<Suggestions>(()=>draftRecovery?.read<Suggestions>({})||{});
  useEffect(()=>{if(draftRecovery&&!draftRecovery.write(changes))setNotice(t('Keep this page open until you save; voice suggestions could not be backed up.','Mantén la página abierta hasta guardar; no se pudo conservar las sugerencias.'));},[changes,draftRecovery]);
  const [sources,setSources]=useState<{title:string;url:string;checkedAt:string}[]>([]);
  const [diagnosticId,setDiagnosticId]=useState('');
  const [failureCode,setFailureCode]=useState('');

  const logSession=useRef('');
  const logSequence=useRef(0);
  function log(event:string,details:Record<string,unknown>={}){
    if(!logSession.current)return;
    void apiFetch('/api/voice-diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:logSession.current,sequence:++logSequence.current,event,...details}),keepalive:true}).catch(()=>{});
  }
  const researchStarted=useRef(0);
  const [researching,setResearching]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const resources=useRef<{pc?:RTCPeerConnection;stream?:MediaStream;dc?:RTCDataChannel;abort?:AbortController;timer?:ReturnType<typeof setInterval>;deadline?:ReturnType<typeof setTimeout>;stopProgress?:()=>void;stopConnection?:()=>void;stopTurns?:()=>void;stopGuide?:()=>void;switchGuide?:(mode:'finance'|'admissions'|'planning'|'loans')=>Promise<boolean>}>({});
  const generation=useRef(0);
  const audio=useRef<HTMLAudioElement>(null);
  function cleanup(){
    void saveSummary();
    log('session_cleanup');logSession.current='';
    generation.current++;
    const r=resources.current;resources.current={};
    r.abort?.abort();clearInterval(r.timer);clearTimeout(r.deadline);
    r.stopProgress?.();
    r.stopConnection?.();r.stopTurns?.();r.stopGuide?.();
    if(r.dc){r.dc.onclose=null;r.dc.close();}
    if(r.pc){r.pc.onconnectionstatechange=null;r.pc.close();}
    r.stream?.getTracks().forEach(track=>track.stop());
    if(audio.current){audio.current.pause();audio.current.srcObject=null;}
  }
  function end(){cleanup();setResearching(false);setState('idle');setMuted(false);scopePending.current=false;setTarget(previous=>({...previous,confirmed:false}));onActive(false);shared?.claim(ownerId,false);}
  function handoffContext():VoiceHandoff{return {studentId:summaryScope.current.id,confirmed:summaryScope.current.confirmed,language:spokenLanguage.current,turns:sessionTurns.current.slice(-8).map(turn=>({...turn,text:turn.text.slice(0,2000)}))};}
  function finishCall(){
    if(finishPromise.current)return finishPromise.current;
    setFinishing(true);
    resources.current.stream?.getAudioTracks().forEach(track=>{track.enabled=false;});
    const dc=resources.current.dc;
    if(speechInProgress.current&&dc?.readyState==='open')dc.send(JSON.stringify({type:'input_audio_buffer.commit'}));
    const task=Promise.resolve().then(async()=>{
      const deadline=Date.now()+2500;
      while(resources.current.dc?.readyState==='open'&&(awaitingTranscription.current.size||assistantSpeaking.current)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
      end();
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
        dc.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'The parent selected another student on screen. Ask one short spoken question to clarify whether they want to discuss that student. Once they answer clearly, call request_conversation_target. No on-screen confirmation is needed.'}]}}));
      }
    }else if(state==='idle')setTarget({id,confirmed:false});
  },[initialProfile.id,routing,state]);
  const latestCleanup=useRef(cleanup);
  useEffect(()=>{latestCleanup.current=cleanup;});
  useEffect(()=>()=>{latestCleanup.current();onActive(false);shared?.claim(ownerId,false);},[]);
  async function start(scope=target,sessionLanguage=continuity?.language||language,spokenRequest=''){
    if(resources.current.abort)return;
    if(shared&&!shared.claim(ownerId,true))return;
    const profile=voiceProfile(mode,initialProfile,family.students,scope.id);
    summaryScope.current={id:scope.id,name:profile.name,confirmed:!routing||scope.confirmed};

    scopePending.current=false;
    spokenLanguage.current=sessionLanguage;
    awaitingTranscription.current.clear();speechInProgress.current=false;assistantSpeaking.current=false;
    const sessionId=crypto.randomUUID();logSession.current=sessionId;logSequence.current=0;setDiagnosticId(sessionId);
    log('session_start',{mode,language});
    const carriedRequest=spokenRequest||(continuity&&scope.id===continuity.studentId?[...continuity.turns].reverse().find(turn=>turn.role==='user')?.text:'')||'';
    sessionTurns.current=carriedRequest&&(!routing||scope.confirmed)?[{role:'user',text:carriedRequest}]:[];sessionSources.current=[];memorySaved.current=!summaryScope.current.confirmed;setSources([]);
    setActivity('listening');setLatestAnswer('');setError('');setFailureCode('');setNotice('');setAudioBlocked(false);setSeconds(0);setState('connecting');onActive(true);
    const version=++generation.current;
    const abort=new AbortController();resources.current.abort=abort;
    resources.current.deadline=setTimeout(()=>{if(generation.current===version){end();setError(t('Connection timed out. Please try again.','La conexión tardó demasiado. Inténtalo de nuevo.'));}},35000);
    try {
      if(summaryQueue.current.size){setNotice(t('Saving your previous conversation before reconnecting…','Guardando la conversacion anterior antes de reconectar…'));try{await summaryQueue.current.flush();await new Promise(resolve=>setTimeout(resolve,0));}catch{shared?.reportSave(true,false);setNotice(t('Some previous summaries could not be saved. You can talk, but those discussions may not be available to this guide yet.','Algunos resumenes anteriores no se guardaron. Puedes conversar, pero la guia puede no recordar esas conversaciones todavia.'));}if(generation.current!==version)return;}
      summaryToken.current=history.cloud?await getAccessTokenSilently():undefined;summaryId.current=sessionId;
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(generation.current!==version){stream.getTracks().forEach(track=>track.stop());return;}
      resources.current.stream=stream;
      const pc=new RTCPeerConnection();resources.current.pc=pc;
      pc.ontrack=e=>{if(audio.current){audio.current.srcObject=e.streams[0];void audio.current.play().then(()=>setAudioBlocked(false)).catch(()=>setAudioBlocked(true));}};
      stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const dc=pc.createDataChannel('oai-events');resources.current.dc=dc;
      let openingRequested=false;
      let playWelcome=onboarding&&(!family.account.welcomeHeard||replayWelcome);
      let welcomeResponseId:string|undefined,welcomeCompleted=false,welcomeRecorded=false,welcomeInterrupted=false;
      const sentEvents=new Map<string,string>();
      const send=(event:unknown)=>{
        if(dc.readyState!=='open')return;
        const payload=event as {type:string};
        if(finishPromise.current&&payload.type==='response.create')return;
        if(payload.type==='response.create'&&!openingRequested){openingRequested=true;if(playWelcome)event={...payload,response:{instructions:onboardingWelcome(sessionLanguage,{preview:!history.cloud,role,hasName:!!profile.name.trim()})}};}
        const event_id=crypto.randomUUID();
        log('client_event',{eventId:event_id,operation:payload.type});
        sentEvents.set(event_id,payload.type);
        if(sentEvents.size>100)sentEvents.delete(sentEvents.keys().next().value!);
        dc.send(JSON.stringify({...event as Record<string,unknown>,event_id}));
        return event_id;
      };
      const guideUpdate=voiceGuideUpdate(event=>dc.send(JSON.stringify(event)));resources.current.stopGuide=()=>guideUpdate.stop();
      let changingGuide=false;
      resources.current.switchGuide=async next=>{
        if(next===liveMode.current)return true;
        if(!summaryScope.current.confirmed||changingGuide)return false;
        changingGuide=true;
        setSwitchingGuide(true);log('guide_update_start',{mode:next});
        try{
          const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId},body:JSON.stringify({action:'update-guide',mode:next,language:spokenLanguage.current,role,routeConversations:routing,targetConfirmed:summaryScope.current.confirmed,studentId:summaryScope.current.id,students:family.students.map(({id,name})=>({id,name})),profile,allowGuideHandoff:true,memory:recentConversationMemory(latestHistory.current.items,summaryScope.current.id)}),signal:abort.signal});
          const data=await response.json();if(!response.ok||!data.session?.instructions||!Array.isArray(data.session.tools))throw new Error('guide_config_unavailable');
          if(generation.current!==version)return false;
          await guideUpdate.update(data.session);
          if(generation.current!==version)return false;
          const lastUser=[...sessionTurns.current].reverse().find(turn=>turn.role==='user');
          void saveSummary();
          summaryId.current=crypto.randomUUID();sessionTurns.current=lastUser?[lastUser]:[];sessionSources.current=[];memorySaved.current=false;
          liveMode.current=next;setMode(next);onGuideChanged?.(next);log('guide_update_complete',{mode:next});return true;
        }catch{if(generation.current===version){log('guide_update_failed',{mode:next});setNotice(t('I could not change topics yet. You can keep talking or try again.','No pude cambiar de tema todavía. Puedes seguir hablando o intentar de nuevo.'));}return false;}
        finally{changingGuide=false;if(generation.current===version)setSwitchingGuide(false);}
      };
      const cache=voiceResearchCache();const speechTimes=new Map<string,number>();
      const turns=voiceTurns(send,()=>log('empty_interruption_recovered'),{onMissing:itemId=>{setActivity('listening');awaitingTranscription.current.delete(itemId);log('transcription_timeout');setNotice(t('I could not hear part of that. Please repeat any missing detail.','No pude escuchar una parte. Repite cualquier detalle que falte.'));}});resources.current.stopTurns=()=>turns.stop();
      let progressTimer:ReturnType<typeof setInterval>|undefined;
      const stopProgress=()=>{clearInterval(progressTimer);progressTimer=undefined;};
      resources.current.stopProgress=stopProgress;
      const startProgress=()=>{
        stopProgress();const started=Date.now();let count=0;
        progressTimer=setInterval(()=>{
          if(generation.current!==version||abort.signal.aborted){stopProgress();return;}
          const elapsed=Date.now()-started;
          if(count<3&&elapsed>=[10000,35000,65000][count]){
            const spoken=(en:string,es:string)=>spokenLanguage.current==='es'?es:en;
            const sentence=count===0?spoken('I’m still checking the official guidance for your question.','Sigo consultando la guía oficial para tu pregunta.'):spoken('This is taking a little longer. I’m still checking the official sources.','Está tardando un poco más. Sigo consultando las fuentes oficiales.');
            if(turns.progress(sentence)){count++;log('lookup_progress',{durationMs:elapsed});}
          }
        },1000);
      };
      dc.onopen=()=>{
        if(generation.current!==version)return;
        clearTimeout(resources.current.deadline);setState('live');saveLocal(voiceUsageKey,true);void family.recordVoiceExperience?.(false).catch(()=>log('voice_usage_save_failed'));
        const started=Date.now();
        resources.current.timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=600){void finishCall();setNotice(informational?t('The 10-minute conversation has ended.','La conversación de 10 minutos terminó.'):t('The 10-minute conversation has ended. Review your suggestions below.','La conversación de 10 minutos terminó. Revisa las sugerencias abajo.'));}},1000);
        if(spokenRequest)send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:`The parent already chose the conversation target by voice. Their latest spoken request was: ${JSON.stringify(spokenRequest)}. Continue with that request if it includes a question; otherwise briefly acknowledge the target and ask how you can help. Do not ask them to choose or confirm again.`}]}});
        turns.request();
      };
      dc.onclose=()=>{if(generation.current===version){end();setNotice(informational?t('Conversation ended.','La conversación terminó.'):t('Conversation ended. Your suggestions are still available below.','La conversación terminó. Tus sugerencias siguen disponibles abajo.'));}};
      dc.onmessage=async event=>{
        if(generation.current!==version)return;
        let e;try{e=JSON.parse(event.data);}catch{log('malformed_event');return;}
        if(guideUpdate.event(e))return;
        if(e.type==='output_audio_buffer.started')setActivity('speaking');
        if(playWelcome&&!welcomeResponseId&&e.type==='response.created')welcomeResponseId=e.response?.id;
        if(playWelcome&&!welcomeRecorded&&e.type==='input_audio_buffer.speech_started')welcomeInterrupted=true;
        if(playWelcome&&e.type==='response.done'&&e.response?.id===welcomeResponseId)welcomeCompleted=e.response?.status==='completed';
        if(playWelcome&&welcomeCompleted&&!welcomeInterrupted&&!welcomeRecorded&&e.type==='output_audio_buffer.stopped'&&e.response_id===welcomeResponseId){welcomeRecorded=true;void family.recordVoiceExperience?.(true).catch(()=>{welcomeRecorded=false;log('welcome_save_failed');});}
        if(e.type==='output_audio_buffer.stopped'||e.type==='output_audio_buffer.cleared')setActivity('listening');
        if(e.type==='input_audio_buffer.speech_started')setActivity('listening');
        if(e.type==='input_audio_buffer.speech_stopped')setActivity('thinking');
        // Status audio is outside the conversation: never save it as an answer.
        if(turns.progressEvent(e))return;
        if(['error','response.created','response.done','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(e.type))
          log('server_event',{operation:e.type,eventId:e.event_id,responseId:e.response?.id,status:e.response?.status,reason:e.response?.status_details?.reason});
        if(e.type==='response.created'){assistantSpeaking.current=true;setActivity('thinking');turns.created();}
        if(e.type==='response.done'){assistantSpeaking.current=false;setActivity(current=>current==='thinking'?'listening':current);}
        if(e.type==='input_audio_buffer.speech_started'){speechInProgress.current=true;if(e.item_id)awaitingTranscription.current.add(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){speechInProgress.current=false;turns.speechStopped(e.item_id);}
        if(e.type==='conversation.item.input_audio_transcription.completed'||e.type==='conversation.item.input_audio_transcription.failed')awaitingTranscription.current.delete(e.item_id);
        if(finishPromise.current&&e.type==='error'&&e.error?.code==='input_audio_buffer_commit_empty')return;
        if(e.type==='input_audio_buffer.speech_started'){speechTimes.set(e.item_id,Date.now());turns.speechStarted(e.item_id);}
        if(e.type==='input_audio_buffer.speech_stopped'){const started=speechTimes.get(e.item_id);if(started!==undefined){log('speech_segment',{speechDurationMs:Date.now()-started});speechTimes.delete(e.item_id);}}
        if(e.type==='response.done'&&e.response?.status==='cancelled')log('response_cancelled',{responseId:e.response.id,reason:e.response.status_details?.reason,toolCount:(e.response.output||[]).filter((item:{type:string})=>item.type==='function_call').length});
        if(e.type==='conversation.item.input_audio_transcription.failed')turns.transcript(e.item_id,'');
        if(e.type==='conversation.item.input_audio_transcription.completed' || e.type==='response.output_audio_transcript.done') {
          const valid=e.type.startsWith('conversation')?turns.transcript(e.item_id,e.transcript):typeof e.transcript==='string'&&e.transcript.trim().length>0;
          if(valid&&!scopePending.current){sessionTurns.current=appendConversationTurn(sessionTurns.current,{role:e.type.startsWith('conversation')?'user':'assistant',text:e.transcript});checkpointSummary();}
          if(valid&&!e.type.startsWith('conversation')&&!scopePending.current)setLatestAnswer(e.transcript);
        }
        if(e.type==='error'){
          const code=String(e.error?.code||'unknown_error').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
          log('api_error',{code,eventId:e.error?.event_id,operation:sentEvents.get(e.error?.event_id)||'server',parameter:e.error?.param});
          if(turns.recover(code)){log('error_recovered',{code});return;}
          const operation=sentEvents.get(e.error?.event_id)||'server';
          const parameter=String(e.error?.param||'').replace(/[^a-zA-Z0-9_.\[\]-]/g,'').slice(0,100);
          setError(t('Voice stopped. Please start a new conversation. Error code: ','La voz se detuvo. Inicia otra conversación. Código: ')+code+' · '+operation+(parameter?' · '+parameter:''));end();return;
        }
        if(e.type==='response.done'){
          if(e.response?.status==='failed'){
            log('response_failed',{responseId:e.response.id,code:e.response.status_details?.error?.code});
            end();setError(t('Origen could not finish that reply. Start another conversation to reconnect. Your discussion so far will be summarized.','Origen no pudo terminar esa respuesta. Inicia otra conversacion para reconectar. Se resumira lo que conversamos hasta ahora.'));return;
          }
          const hasTools=(e.response?.output||[]).some((item:{type:string})=>item.type==='function_call');
          if(!turns.beginDone(e.response?.id,hasTools,e.response?.status==='cancelled'))return;
          let called=false;
          for(const item of e.response?.output||[]) {
            if(item.type!=='function_call')continue;
            called=true;let accepted=false;
            if(item.name==='set_conversation_language'){
              let accepted=false;try{const args=JSON.parse(item.arguments);if(args.language==='en'||args.language==='es'){spokenLanguage.current=args.language;accepted=true;}}catch{}
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'language_updated':'invalid_language',language:spokenLanguage.current})}});continue;
            }
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
                const spokenRequest=[...sessionTurns.current].reverse().find(turn=>turn.role==='user')?.text||'';
                if(summaryScope.current.confirmed&&!scopePending.current)sessionTurns.current=beforeScopeRequest(sessionTurns.current);

                scopePending.current=true;
                const nextScope={id:next,confirmed:true};
                const nextLanguage=spokenLanguage.current;
                await finishCall();setTarget(nextScope);void start(nextScope,nextLanguage,spokenRequest);return;
              }
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'invalid_target',instruction:'Ask one short spoken clarification. Do not request an on-screen confirmation.'})}});
              continue;
            }
            if(((liveMode.current==='finance'||liveMode.current==='loans')&&item.name==='lookup_financial_aid')||(liveMode.current==='admissions'&&item.name==='lookup_college_applications')||(liveMode.current==='planning'&&item.name==='lookup_education_planning')){
              let output:unknown={error:'lookup_failed',instruction:'Explain that current official information could not be verified. Do not invent facts.'};
              log('lookup_start',{callId:item.call_id});
              researchStarted.current=Date.now();setResearching(true);
              try{
                const args=JSON.parse(item.arguments);
                const lookupLanguage=args.language==='en'||args.language==='es'?args.language:spokenLanguage.current;spokenLanguage.current=lookupLanguage;
                if(typeof args.question!=='string'||!args.question.trim()||args.question.length>3000||typeof args.institution!=='string'||args.institution.length>300)throw new Error('invalid_lookup');
                const query={mode:liveMode.current,language:lookupLanguage,question:args.question,institution:liveMode.current==='loans'?'':args.institution};
                let result=cache.get(query);
                if(result){log('lookup_cache_hit',{callId:item.call_id,sourceCount:result.sources.length});}
                else {
                  startProgress();
                  const response=await apiFetch((liveMode.current==='finance'||liveMode.current==='loans')?'/api/finance-research':'/api/admissions-research',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId},body:JSON.stringify({question:args.question,institution:liveMode.current==='loans'?'':args.institution,language:lookupLanguage,purpose:liveMode.current==='planning'?'planning':undefined}),signal:abort.signal});
                  result=await response.json();
                  if(generation.current!==version)return;
                  if(!response.ok||!result||!Array.isArray(result.sources)||!result.sources.length)throw new Error('lookup_failed');
                  cache.put(query,result);
                }
                log('lookup_success',{callId:item.call_id,sourceCount:result.sources.length,durationMs:Date.now()-researchStarted.current});
                output={text:result.text,sources:result.sources,checkedAt:result.checkedAt};
                sessionSources.current=mergeConversationSources(sessionSources.current,result.sources);
                setSources(sessionSources.current);
                setNotice('');
              }catch{
                if(generation.current!==version)return;
                log('lookup_failure',{callId:item.call_id});
                setNotice(t('The lookup could not verify official sources. You can keep talking or try another question.','No se pudieron verificar fuentes oficiales. Puedes seguir conversando o hacer otra pregunta.'));
              }finally{stopProgress();}
              if(generation.current!==version)return;
              setResearching(false);
              send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});
              continue;
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
              setChanges(prev=>({...prev,...next}));accepted=true;
            }catch{/* Invalid suggestions never reach the form. */}
            send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:accepted?'proposed_for_review_not_saved':'invalid_proposal'})}});
          }
          if(called)turns.toolsCompleted();else turns.completed();
        }
      };
      const connection=voiceConnectionRecovery(()=>{if(generation.current!==version)return;end();setError(informational?t('Voice disconnected. Start another conversation to reconnect.','Se desconectó la voz. Inicia otra conversación para reconectar.'):t('Voice disconnected. You can reconnect or review the suggestions collected so far.','Se desconectó la voz. Puedes reconectar o revisar las sugerencias recibidas.'));});
      resources.current.stopConnection=()=>connection.stop();
      pc.onconnectionstatechange=()=>{log('connection_state',{connectionState:pc.connectionState});if(generation.current===version)connection.change(pc.connectionState);};
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId},body:JSON.stringify({sdp:offer.sdp,routeConversations:routing,targetConfirmed:scope.confirmed,scopeRestart:scope.confirmed,students:family.students.map(({id,name})=>({id,name})),studentId:routing?(scope.confirmed?scope.id:undefined):scope.id===null?null:history.cloud&&family.students.some(student=>student.id===profile.id)?profile.id:undefined,profile:informational?{name:profile.name,stage:profile.stage,institutions:profile.institutions,entryTerm:profile.entryTerm,...(mode==='planning'?{school:profile.school,interest:profile.interest,goals:profile.goals}:{})}:profile,language:sessionLanguage,role,mode:liveMode.current,allowGuideHandoff:!!onGuideChanged,continuity:continuity&&scope.id===continuity.studentId?continuity.turns:undefined,onboarding:onboarding&&(!family.account.welcomeHeard||replayWelcome),replayWelcome,experience:{usedApp:family.returningUser===true,usedVoice:family.account.usedVoice===true||loadLocal<boolean>(voiceUsageKey,false)===true||latestHistory.current.items.length>0},memory:(routing&&!scope.confirmed?[]:recentConversationMemory(latestHistory.current.items,scope.id)).map(x=>({date:x.date,mode:x.mode,summary:x.summary}))}),signal:abort.signal});
      const data=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(data?.error || (response.status===401?'authentication_required':'voice_unavailable'));
      if(typeof data?.sdp!=='string'||!data.sdp.startsWith('v=0'))throw new Error('invalid_voice_response');
      if(typeof data.playWelcome==='boolean')playWelcome=data.playWelcome;
      if(generation.current!==version)return;
      await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    }catch(err){
      if(generation.current!==version)return;
      const code=err instanceof Error?err.message:'';
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
    <p className="small-text">{routing?t('AI-generated voice · Starting sends microphone audio and student names to OpenAI. After you confirm whom you mean, their profile context and previous summaries are included. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían a OpenAI el audio y los nombres de estudiantes. Después de confirmar de quién hablas, se incluye su contexto y los resúmenes anteriores. Las sesiones terminan a los 10 minutos.'):informational?t('AI-generated voice · Starting sends microphone audio and the selected student’s name, education stage, institutions and entry term to OpenAI. This conversation does not update the profile. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían a OpenAI el audio y el nombre, la etapa educativa, las instituciones y el período de ingreso del estudiante. La conversación no modifica el perfil. Las sesiones terminan a los 10 minutos.'):t('AI-generated voice · Starting sends microphone audio and this profile to OpenAI. Profile changes require your review. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían el audio del micrófono y este perfil a OpenAI. Los cambios del perfil requieren tu revisión. La sesión termina a los 10 minutos.')}</p>
    {state==='live'&&switchGuideMode&&<div className="voice-guide-switch"><span>{t('This page has a different guide: ','Esta página tiene otra guía: ')}{switchGuideLabel}</span><button type="button" className="text-button" disabled={finishing||switchingGuide||researching||activity!=='listening'} onClick={()=>void resources.current.switchGuide?.(switchGuideMode)}>{t('Switch guide','Cambiar guía')}</button></div>}
    <div className="voice-controls">
      {state==='idle'?<button type="button" className="button primary" onClick={()=>onRestart?onRestart():void start()}><Mic size={18}/>{t('Start live conversation','Iniciar conversación en vivo')}</button>:<>
        <span className={`voice-activity activity-${activity}`} role="status"><VoiceWave speaking={state==='live'&&activity==='speaking'&&!audioBlocked&&!finishing}/>{finishing?t('Finishing conversation…','Terminando la conversación…'):state==='connecting'?t('Connecting…','Conectando…'):switchingGuide?t('Following your question…','Siguiendo tu pregunta…'):audioBlocked?t('Tap Play to hear Origen','Toca Reproducir para escuchar a Origen'):researching?(mode==='loans'||mode==='finance'?t('Checking official financial aid sources…','Consultando fuentes oficiales de ayuda económica…'):t('Checking official sources…','Consultando fuentes oficiales…')):activity==='speaking'?t('Origen is speaking','Origen está hablando'):activity==='thinking'?t('Preparing an answer…','Preparando una respuesta…'):muted?t('Microphone muted','Micrófono silenciado'):t('Listening · You can speak naturally','Escuchando · Habla con naturalidad')}<small aria-hidden="true"> {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</small></span>
        {state==='live'&&<button type="button" className="button outline voice-mute" aria-label={t(muted?'Unmute microphone':'Mute microphone',muted?'Activar micrófono':'Silenciar micrófono')} disabled={finishing} aria-pressed={muted} onClick={()=>{resources.current.stream?.getAudioTracks().forEach(track=>track.enabled=muted);setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} <span className="voice-control-label">{t(muted?'Unmute':'Mute',muted?'Activar micrófono':'Silenciar')}</span></button>}
        <button type="button" className="button outline voice-end" aria-label={t('End conversation','Terminar conversación')} disabled={finishing} onClick={()=>void finishCall()}><PhoneOff size={18}/><span className="voice-control-label">{t('End conversation','Terminar conversación')}</span></button>
      </>}
    </div>
    <audio ref={audio} autoPlay controls hidden={state!=='live'} aria-label={t('Origen voice playback','Reproducción de voz de Origen')}/>
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
    {Object.keys(changes).length>0&&<div className="voice-review"><h4>{t('Review suggested changes','Revisa los cambios sugeridos')}</h4><p>{t('Edit or remove any suggestion. End the conversation, add the changes to the form, then select Save profile.','Edita o elimina cualquier sugerencia. Termina la conversación, agrega los cambios al formulario y selecciona Guardar perfil.')}</p>
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
