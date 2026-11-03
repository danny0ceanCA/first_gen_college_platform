import type {TopicRecapState} from './topicRecapQueue.mjs';
import './TopicRecap.css';

type Props={state:TopicRecapState|undefined;onRetry:()=>void;language:'en'|'es';t:(en:string,es:string)=>string;openableNoteIds:string[];onOpenNote:(id:string)=>void};
export default function TopicRecap({state,onRetry,language,t,openableNoteIds,onOpenNote}:Props){
 const current=state?.status==='ready'||state?.status==='error'?state:null;
 return <section className="topic-story" aria-label={t('Your topic recap','Resumen de tu tema')}>
  {!current?<div className="topic-story-loading" role="status"><span className="topic-story-loading-label">{t('Bringing the story together…','Uniendo las ideas…')}</span><span aria-hidden="true"/><span aria-hidden="true"/><span aria-hidden="true"/></div>:current.status==='error'?<div className="topic-story-unavailable" role="status"><p>{t('Your recap couldn’t load. Your original notes are still available.','No se pudo cargar el resumen. Tus notas originales siguen disponibles.')}</p><button type="button" className="text-button" onClick={onRetry}>{t('Try again','Intentar de nuevo')}</button></div>:!current.data?.paragraphs.length?<p>{t('There isn’t enough connected information for a recap yet. You can read the original notes below.','Todavía no hay suficiente información relacionada para un resumen. Puedes leer las notas originales abajo.')}</p>:<>
   <div className="topic-story-writing" lang={language}>{current.data.paragraphs.map((paragraph,index)=><p key={index}>{paragraph.text}</p>)}</div>
   <div className="topic-story-footnote">{t('A recap of your saved notes. You can check the originals below.','Un resumen de tus notas guardadas. Puedes consultar los originales abajo.')}{current.data.omitted>0&&' '+t('Based on a selection of recent notes; older notes are still available.','Basado en una selección de notas recientes; las anteriores siguen disponibles.')}</div>
   <details className="topic-story-sources"><summary>{t('Notes behind this recap','Notas que sustentan este resumen')} <span>{current.data.sources.length}</span></summary><ol>{current.data.sources.map(source=><li key={source.ref}><small>{source.kind==='memory'?t('Profile detail','Dato del perfil'):t('Binder note','Nota del cuaderno')}{source.evidence.reportedBy==='parent'?' · '+t('Parent report','Información de un padre o tutor'):''}</small><p>{source.content}</p>{source.kind==='note'&&openableNoteIds.includes(source.id)&&<button type="button" className="text-button" onClick={()=>onOpenNote(source.id)}>{t('Open original note','Abrir nota original')}</button>}</li>)}</ol></details>
  </>}
 </section>;
}
