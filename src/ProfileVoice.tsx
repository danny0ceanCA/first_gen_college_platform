import {apiFetch} from './api';
import {useConversationHistory} from './ConversationHistory';
import {voiceTurns} from './voiceTurns.mjs';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import type { StudentProfile } from './planning';
import './ProfileVoice.css';

const labels = {
  name:['Student name','Nombre'],stage:['Education stage','Etapa educativa'],gpa:['Reported GPA','GPA reportado'],school:['School','Escuela'],interest:['Academic interests','Intereses académicos'],activities:['Activities and responsibilities','Actividades y responsabilidades'],goals:['Goals','Metas'],needs:['Practical needs','Necesidades prácticas'],notes:['Attributed notes','Notas con atribución'],institutions:['Institutions of interest','Instituciones de interés'],entryTerm:['Intended entry term','Período de ingreso'],
} as const;
type Field = keyof typeof labels;
type Suggestions = Partial<Record<Field,string>>;
export default function ProfileVoice({profile,language,role,apply,onActive,t,mode='profile'}:{mode?:'profile'|'finance'|'admissions';profile:StudentProfile;language:'en'|'es';role:'parent'|'student';apply:(changes:Suggestions)=>void;onActive:(active:boolean)=>void;t:(en:string,es:string)=>string}) {
  const history=useConversationHistory();
  const sessionTurns=useRef<{role:'user'|'assistant';text:string}[]>([]);
  const sessionSources=useRef<{title:string;url:string;checkedAt:string}[]>([]);
  const memorySaved=useRef(true);
  const [savingSummary,setSavingSummary]=useState(false);
  async function saveSummary(){
    if(memorySaved.current||!profile.id||!sessionTurns.current.some(t=>t.role==='user'))return;
    memorySaved.current=true;const turns=[...sessionTurns.current];const sources=[...sessionSources.current];const id=crypto.randomUUID();setSavingSummary(true);
    try{const response=await apiFetch('/api/conversation-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns,language}),keepalive:true});if(!response.ok)throw new Error();const {summary}=await response.json();history.add({id,studentId:profile.id,date:new Date().toISOString(),mode,summary,sources});}catch{setNotice(t('Conversation summary could not be saved.','No se pudo guardar el resumen de la conversación.'));}finally{setSavingSummary(false);}
  }
  const informational=mode!=='profile';
  const [state,setState]=useState<'idle'|'connecting'|'live'>('idle');
  const [muted,setMuted]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [changes,setChanges]=useState<Suggestions>({});
  const [transcript,setTranscript]=useState<{who:string;text:string}[]>([]);
  const [sources,setSources]=useState<{title:string;url:string;checkedAt:string}[]>([]);
  const [diagnosticId,setDiagnosticId]=useState('');
  useEffect(()=>{sessionSources.current=sources;},[sources]);
  const logSession=useRef('');
  const logSequence=useRef(0);
  function log(event:string,details:Record<string,unknown>={}){
    if(!logSession.current)return;
    void apiFetch('/api/voice-diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:logSession.current,sequence:++logSequence.current,event,...details}),keepalive:true}).catch(()=>{});
  }
  const [researching,setResearching]=useState(false);
  const [seconds,setSeconds]=useState(0);
  const resources=useRef<{pc?:RTCPeerConnection;stream?:MediaStream;dc?:RTCDataChannel;abort?:AbortController;timer?:ReturnType<typeof setInterval>;deadline?:ReturnType<typeof setTimeout>}>({});
  const generation=useRef(0);
  const audio=useRef<HTMLAudioElement>(null);
  function cleanup(){
    void saveSummary();
    log('session_cleanup');logSession.current='';
    generation.current++;
    const r=resources.current;resources.current={};
    r.abort?.abort();clearInterval(r.timer);clearTimeout(r.deadline);
    if(r.dc){r.dc.onclose=null;r.dc.close();}
    if(r.pc){r.pc.onconnectionstatechange=null;r.pc.close();}
    r.stream?.getTracks().forEach(track=>track.stop());
    if(audio.current){audio.current.pause();audio.current.srcObject=null;}
  }
  function end(){cleanup();setResearching(false);setState('idle');setMuted(false);onActive(false);}
  useEffect(()=>()=>{cleanup();onActive(false);},[]);
  async function start(){
    if(resources.current.abort)return;
    const sessionId=crypto.randomUUID();logSession.current=sessionId;logSequence.current=0;setDiagnosticId(sessionId);
    log('session_start',{mode,language});
    sessionTurns.current=[];sessionSources.current=[];memorySaved.current=false;setTranscript([]);setSources([]);
    setError('');setNotice('');setSeconds(0);setState('connecting');onActive(true);
    const version=++generation.current;
    const abort=new AbortController();resources.current.abort=abort;
    resources.current.deadline=setTimeout(()=>{if(generation.current===version){end();setError(t('Connection timed out. Please try again.','La conexión tardó demasiado. Inténtalo de nuevo.'));}},35000);
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(generation.current!==version){stream.getTracks().forEach(track=>track.stop());return;}
      resources.current.stream=stream;
      const pc=new RTCPeerConnection();resources.current.pc=pc;
      pc.ontrack=e=>{if(audio.current){audio.current.srcObject=e.streams[0];void audio.current.play().catch(()=>setNotice(t('Use the audio play control to hear Origen.','Usa el control de reproducción para escuchar a Origen.')));}};
      stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const dc=pc.createDataChannel('oai-events');resources.current.dc=dc;
      const sentEvents=new Map<string,string>();
      const send=(event:unknown)=>{
        if(dc.readyState!=='open')return;
        const payload=event as {type:string};
        const event_id=crypto.randomUUID();
        log('client_event',{eventId:event_id,operation:payload.type});
        sentEvents.set(event_id,payload.type);
        if(sentEvents.size>100)sentEvents.delete(sentEvents.keys().next().value!);
        dc.send(JSON.stringify({...payload,event_id}));
      };
      const turns=voiceTurns(send,()=>log('empty_interruption_recovered'));
      dc.onopen=()=>{
        if(generation.current!==version)return;
        clearTimeout(resources.current.deadline);setState('live');
        const started=Date.now();
        resources.current.timer=setInterval(()=>{const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=600){end();setNotice(informational?t('The 10-minute conversation has ended.','La conversación de 10 minutos terminó.'):t('The 10-minute conversation has ended. Review your suggestions below.','La conversación de 10 minutos terminó. Revisa las sugerencias abajo.'));}},1000);
        turns.request();
      };
      dc.onclose=()=>{if(generation.current===version){end();setNotice(informational?t('Conversation ended.','La conversación terminó.'):t('Conversation ended. Your suggestions are still available below.','La conversación terminó. Tus sugerencias siguen disponibles abajo.'));}};
      dc.onmessage=async event=>{
        if(generation.current!==version)return;
        let e;try{e=JSON.parse(event.data);}catch{log('malformed_event');return;}
        if(['error','response.created','response.done','input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','conversation.item.input_audio_transcription.completed','conversation.item.input_audio_transcription.failed'].includes(e.type))
          log('server_event',{operation:e.type,eventId:e.event_id,responseId:e.response?.id,status:e.response?.status,reason:e.response?.status_details?.reason});
        if(e.type==='response.created')turns.created();
        if(e.type==='input_audio_buffer.speech_started')turns.speechStarted(e.item_id);
        if(e.type==='conversation.item.input_audio_transcription.failed')turns.transcript(e.item_id,'');
        if(e.type==='conversation.item.input_audio_transcription.completed' || e.type==='response.output_audio_transcript.done') {
          const valid=e.type.startsWith('conversation')?turns.transcript(e.item_id,e.transcript):typeof e.transcript==='string'&&e.transcript.trim().length>0;
          if(valid)sessionTurns.current=[...sessionTurns.current,{role:e.type.startsWith('conversation')?'user' as const:'assistant' as const,text:e.transcript}].slice(-40);
          if(valid)setTranscript(prev=>[...prev,{who:e.type.startsWith('conversation')?t('You','Tú'):'Origen',text:e.transcript}].slice(-40));
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
          if(e.response?.status==='failed')log('response_failed',{responseId:e.response.id,code:e.response.status_details?.error?.code});
          const hasTools=(e.response?.output||[]).some((item:{type:string})=>item.type==='function_call');
          if(!turns.beginDone(e.response?.id,hasTools,e.response?.status==='cancelled'))return;
          let called=false;
          for(const item of e.response?.output||[]) {
            if(item.type!=='function_call')continue;
            called=true;let accepted=false;
            if((mode==='finance'&&item.name==='lookup_financial_aid')||(mode==='admissions'&&item.name==='lookup_college_applications')){
              let output:unknown={error:'lookup_failed',instruction:'Explain that current official information could not be verified. Do not invent facts.'};
              log('lookup_start',{callId:item.call_id});
              setResearching(true);
              try{
                const args=JSON.parse(item.arguments);
                const response=await apiFetch(mode==='admissions'?'/api/admissions-research':'/api/finance-research',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId},body:JSON.stringify({question:args.question,institution:args.institution,language}),signal:abort.signal});
                const result=await response.json();
                if(generation.current!==version)return;
                if(!response.ok)throw new Error('lookup_failed');
                log('lookup_success',{callId:item.call_id,sourceCount:result.sources?.length});
                output=result;
                setSources(prev=>[...prev,...result.sources].filter((source,index,all)=>all.findIndex(s=>s.url===source.url)===index));
                setNotice('');
              }catch{
                if(generation.current!==version)return;
                log('lookup_failure',{callId:item.call_id});
                setNotice(t('The lookup could not verify official sources. You can keep talking or try another question.','No se pudieron verificar fuentes oficiales. Puedes seguir conversando o hacer otra pregunta.'));
              }
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
      pc.onconnectionstatechange=()=>{log('connection_state',{connectionState:pc.connectionState});if(generation.current===version&&['failed','disconnected'].includes(pc.connectionState)){end();setError(informational?t('Voice disconnected. Start another conversation to reconnect.','Se desconectó la voz. Inicia otra conversación para reconectar.'):t('Voice disconnected. You can reconnect or review the suggestions collected so far.','Se desconectó la voz. Puedes reconectar o revisar las sugerencias recibidas.'));}};
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json','X-Origen-Session':sessionId},body:JSON.stringify({sdp:offer.sdp,profile:informational?{name:profile.name,stage:profile.stage,institutions:profile.institutions,entryTerm:profile.entryTerm}:profile,language,role,mode,memory:history.items.filter(x=>x.studentId===profile.id).slice(-6).map(x=>({date:x.date,mode:x.mode,summary:x.summary}))}),signal:abort.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      if(generation.current!==version)return;
      await pc.setRemoteDescription({type:'answer',sdp:data.sdp});
    }catch(err){
      if(generation.current!==version)return;
      log('connection_failure',{code:err instanceof DOMException?err.name:'connection_failed'});
      const code=err instanceof Error?err.message:'';
      end();setError(err instanceof DOMException&&err.name==='NotAllowedError'?t('Microphone access was not allowed. Enable it in your browser to start, or keep typing below.','No se permitió el micrófono. Actívalo en el navegador o sigue escribiendo abajo.'):code==='quota_exceeded'?t('Your API account needs credits before voice can connect.','Tu cuenta de API necesita créditos para conectar la voz.'):code==='model_unavailable'?t('The voice model is unavailable to this API project. Check voice model access.','El modelo de voz no está disponible para este proyecto de API.'):t('Could not start voice. Check your microphone, connection and OpenAI API setup, then try again.','No se pudo iniciar la voz. Revisa el micrófono, la conexión y la configuración de la API de OpenAI.'));
    }
  }
  return <section className="profile-voice" aria-labelledby={`${mode}-voice-title`}>
    <h3 id={`${mode}-voice-title`}>{mode==='admissions'?t('Talk through college applications','Conversemos sobre las solicitudes universitarias'):mode==='finance'?t('Talk through college costs','Conversemos sobre los costos universitarios'):role==='student'?t('Tell us about yourself','Cuéntanos sobre ti'):t('Tell us about your student','Cuéntanos sobre tu estudiante')}</h3>
    <p>{mode==='admissions'?t('Ask about UC applications, Cal State Apply, Common App or community college. We can explain a form field, check requirements, or help you understand your next step—in English or Spanish.','Pregunta sobre solicitudes de UC, Cal State Apply, Common App o colegios comunitarios. Podemos explicar una pregunta del formulario, consultar requisitos o ayudarte a entender el siguiente paso, en español o inglés.'):mode==='finance'?t('New to college financial aid? Start here. Ask out loud, pause, or ask Origen to explain it another way—in English or Spanish.','¿Es tu primera vez con la ayuda económica universitaria? Empieza aquí. Pregunta en voz alta, haz una pausa o pide otra explicación, en español o inglés.'):t('Have a live conversation with Origen. You can interrupt, ask questions and correct details. Suggested updates appear here for your review.','Conversa en vivo con Origen. Puedes interrumpir, hacer preguntas y corregir detalles. Las sugerencias aparecerán aquí para que las revises.')}</p>
    <p className="small-text">{informational?t('AI-generated voice · Starting sends microphone audio and the selected student’s name, education stage, institutions and entry term to OpenAI. This conversation does not update the profile. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían a OpenAI el audio y el nombre, la etapa educativa, las instituciones y el período de ingreso del estudiante. La conversación no modifica el perfil. Las sesiones terminan a los 10 minutos.'):t('AI-generated voice · Starting sends microphone audio and this profile to OpenAI. Nothing is saved automatically. Sessions end after 10 minutes.','Voz generada por IA · Al comenzar, se envían el audio del micrófono y este perfil a OpenAI. Nada se guarda automáticamente. La sesión termina a los 10 minutos.')}</p>
    <div className="voice-controls">
      {state==='idle'?<button type="button" className="button primary" onClick={()=>void start()}><Mic size={18}/>{t('Start live conversation','Iniciar conversación en vivo')}</button>:<>
        <span role="status">{state==='connecting'?t('Connecting…','Conectando…'):t(muted?'Microphone muted':'Microphone on',muted?'Micrófono silenciado':'Micrófono activo')} · {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>
        {state==='live'&&<button type="button" className="button outline" aria-pressed={muted} onClick={()=>{resources.current.stream?.getAudioTracks().forEach(track=>track.enabled=muted);setMuted(!muted);}}>{muted?<MicOff size={18}/>:<Mic size={18}/>} {t(muted?'Unmute':'Mute',muted?'Activar micrófono':'Silenciar')}</button>}
        <button type="button" className="button outline" onClick={end}><PhoneOff size={18}/>{t('End conversation','Terminar conversación')}</button>
      </>}
    </div>
    <audio ref={audio} autoPlay controls hidden={state!=='live'} aria-label={t('Origen voice playback','Reproducción de voz de Origen')}/>
    {savingSummary&&<p role="status">{t('Saving conversation summary…','Guardando el resumen…')}</p>}
    {diagnosticId&&<details className="small-text"><summary>{t('Diagnostic session','Sesión de diagnóstico')}</summary><p>{diagnosticId}</p><p>{t('Technical events are logged locally without audio, transcripts or student details.','Los eventos técnicos se registran localmente sin audio, transcripciones ni datos del estudiante.')}</p></details>}
    {researching&&<p role="status">{t('Checking official sources…','Consultando fuentes oficiales…')}</p>}
    {sources.length>0&&<section className="voice-sources"><h4>{t('Sources from this conversation','Fuentes de esta conversación')}</h4><ul>{sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small> · {t('Checked','Consultado')} {new Date(source.checkedAt).toLocaleDateString(language)}</small></li>)}</ul></section>}
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {transcript.length>0&&<details className="voice-transcript"><summary>{t('Conversation transcript','Transcripción de la conversación')}</summary><div>{transcript.map((entry,i)=><p key={i}><strong>{entry.who}: </strong>{entry.text}</p>)}</div></details>}
    {Object.keys(changes).length>0&&<div className="voice-review"><h4>{t('Review suggested changes','Revisa los cambios sugeridos')}</h4><p>{t('Edit or remove any suggestion. End the conversation, add the changes to the form, then select Save profile.','Edita o elimina cualquier sugerencia. Termina la conversación, agrega los cambios al formulario y selecciona Guardar perfil.')}</p>
      {(Object.keys(changes) as Field[]).map(field=><div key={field}><label className="field">{labels[field][language==='es'?1:0]}<textarea value={changes[field]} maxLength={field==='name'?100:field==='gpa'?30:2000} onChange={e=>setChanges(prev=>({...prev,[field]:e.target.value}))}/></label><button type="button" className="text-button" onClick={()=>setChanges(prev=>{const next={...prev};delete next[field];return next;})}>{t('Remove suggestion','Eliminar sugerencia')}</button></div>)}
      <button type="button" className="button primary" disabled={state!=='idle'} onClick={()=>{
        if(changes.stage!==undefined&&!['9th grade','10th grade','11th grade','12th grade','Community college','College'].includes(changes.stage)){
          setError(t('Use an education stage from the form, or remove that suggestion and select it in the form.','Usa una etapa educativa del formulario, o elimina esa sugerencia y selecciónala en el formulario.'));return;
        }
        apply(changes);setChanges({});setError('');setNotice(t('Suggestions added to the form. Review the fields and select Save profile.','Sugerencias agregadas al formulario. Revisa los campos y selecciona Guardar perfil.'));
      }}>{t('Add changes to form','Agregar cambios al formulario')}</button>
    </div>}
  </section>;
}
