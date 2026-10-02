import { useState, useRef, useEffect } from 'react';
import { LockKeyhole, Send, Sparkles } from 'lucide-react';
import { liveGateway, type AIResponse } from './ai';

type Student = {id:string;name:string;stage:string;interest:string;gpa:string};
type Entry = {role:'parent'|'assistant';text:string;research?:AIResponse};
export default function StudentGuidance({student,language,t,role,topic,topicTitle,review,placeholder}:{placeholder?:string;review?:(text:string,kind:'profile'|'step')=>void;topic:number;topicTitle:string;role:'parent'|'student';student:Student;language:'en'|'es';t:(en:string,es:string)=>string}) {
  const [threads,setThreads]=useState<Record<string,Entry[]>>({});
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [pending,setPending]=useState<Record<string,boolean>>({});
  const inFlight=useRef(new Set<string>());
  const [errors,setErrors]=useState<Record<string,string>>({});
  const id=`${role}:${student.id}:${topic}`;
  const threadEnd=useRef<HTMLDivElement>(null);
  useEffect(()=>{const log=threadEnd.current;if(log)log.scrollTop=log.scrollHeight;},[id,threads]);
  const busy=!!pending[id];
  const error=errors[id]||'';
  const send=async()=>{
    const message=(drafts[id]||'').trim();if(!message||busy||inFlight.current.has(id))return;
    inFlight.current.add(id);
    const history=threads[id]||[];
    setThreads(p=>({...p,[id]:[...history,{role:'parent',text:message}]}));
    setDrafts(p=>({...p,[id]:''}));setPending(p=>({...p,[id]:true}));setErrors(p=>({...p,[id]:''}));
    try {
      const response=await liveGateway.respond({purpose:'conversation',audience:role,studentId:student.id,message,language,studentContext:{...student,parentNotes:history.filter(e=>e.role==='parent').map(e=>e.text).join('\n')},history:history.map(e=>({role:e.role,text:e.text})),guidanceTopic:topicTitle,guidanceMode:(['interests','pathways','affordability'] as const)[topic]});
      setThreads(p=>({...p,[id]:[...(p[id]||[]),{role:'assistant',text:response.text+(response.sources.length?'\nSources: '+response.sources.map(source=>source.title+': '+source.url).join('\n'):''),research:response.sources.length?response:undefined}]}));
    } catch (err) {
      const code=err instanceof Error?err.message:'';
      const messageText=code==='quota_exceeded'?t('Your OpenAI account needs API credits. Check API billing.','Tu cuenta necesita créditos de API. Revisa la facturación.'):code==='invalid_api_key'?t('The API key was rejected. Check .env.local and restart the server.','La clave fue rechazada. Revisa .env.local y reinicia el servidor.'):code==='model_unavailable'?t('Astra is not available to this API project. Check model access.','Astra no está disponible para este proyecto. Revisa el acceso al modelo.'):code==='missing_api_key'?t('Add your API key to .env.local and restart the server.','Agrega la clave en .env.local y reinicia el servidor.'):t('Could not get a response. Try again in a moment.','No se pudo obtener una respuesta. Inténtalo de nuevo.');
      setErrors(p=>({...p,[id]:messageText}));setDrafts(p=>({...p,[id]:message}));
      setThreads(p=>({...p,[id]:history}));
    } finally {inFlight.current.delete(id);setPending(p=>({...p,[id]:false}));}
  };
  return <section className="student-guidance integrated-guidance" aria-label={t('Student guidance','Orientación del estudiante')}>
    <div className="integrated-guidance-heading"><span className="round-icon"><Sparkles size={18}/></span><div><small>{t(`GUIDANCE FOR ${student.name.toUpperCase()}`,`ORIENTACIÓN PARA ${student.name.toUpperCase()}`)}</small><h3>{topicTitle}</h3></div></div>
    {!!threads[id]?.length&&<div ref={threadEnd} className="guidance-thread" role="log" aria-live="polite">{threads[id].map((entry,i)=><div key={i} className={`guidance-entry ${entry.role}`}><small>{entry.role==='parent'?t('You','Tú'):t('Origen · AI guidance','Origen · Orientación con IA')}</small>{entry.research?<><p>{entry.research.parts?.map((part,j)=>part.url?<a key={j} href={part.url} title={part.title} target="_blank" rel="noreferrer">{part.text}</a>:<span key={j}>{part.text}</span>)}</p><small>{t('Searched','Búsqueda realizada')}: {new Date(entry.research.checkedAt!).toLocaleString(language)}</small><ul className="chat-sources">{entry.research.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></>:<p>{entry.text}</p>}{review&&entry.role==='parent'&&<button className="text-button chat-save" onClick={()=>review((entry.role==='parent'?t('Reported in chat: ','Compartido en el chat: '):t('AI suggestion: ','Sugerencia de IA: '))+entry.text,entry.role==='parent'?'profile':'step')}>{entry.role==='parent'?t('Review for profile','Revisar para el perfil'):t('Review as a roadmap step','Revisar como paso del plan')}</button>}</div>)}</div>}
    <form className="guidance-composer unified-composer" onSubmit={e=>{e.preventDefault();void send();}}><label className="field"><span className="visually-hidden">{t(`Message about ${student.name}`,`Mensaje sobre ${student.name}`)}</span><textarea value={drafts[id]||''} onChange={e=>setDrafts(p=>({...p,[id]:e.target.value}))} placeholder={placeholder??t(`Ask a question or tell us about ${student.name}…`,`Haz una pregunta o cuéntanos sobre ${student.name}…`)}/></label><button className="button primary" aria-label={t('Send message','Enviar mensaje')} disabled={busy||!(drafts[id]||'').trim()}><Send size={16}/></button></form>
    {busy&&<p role="status" className="guidance-disclosure">{t('Origen is working on your question…','Origen está trabajando en tu pregunta…')}</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="guidance-disclosure"><LockKeyhole size={14}/>{t('AI guidance · Messages and this student’s context are sent to OpenAI. Not shared with the community.','Orientación con IA · Los mensajes y el contexto se envían a OpenAI. No se comparten con la comunidad.')}</p>
  </section>;
}

