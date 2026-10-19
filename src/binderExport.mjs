import {distinctConversationPoints} from './binderKeyPoints.mjs';

export const binderTopicTitles={options:['College options','Opciones universitarias'],transfer:['Transfer & courses','Transferencias y cursos'],costs:['Paying for college','Pagar la universidad'],applications:['Applications','Solicitudes']};
export function binderExportData({studentId,name,language,notes,summary='',topic,originalIds=[],includeGuidance=false,coordinatorGuidance=[]}){
 const es=language==='es',t=(en,sp)=>es?sp:en;
 const scoped=notes.filter(note=>note.studentId===studentId&&(!topic||note.topic===topic));
 const original=new Set(originalIds);
 const content=note=>note.language!==language&&!original.has(note.id)&&note.translations?.[language]?note.translations[language]:note.content;
 const groups=[['note',t('My notes','Mis notas')],['explanation',t('Things to remember','Para recordar')],['question',t('Questions to ask','Preguntas por hacer')],['decision',t('My decisions','Mis decisiones')]];
 return {
  language,name,title:topic?binderTopicTitles[topic][es?1:0]:t('My binder','Mi carpeta'),summary:topic?'':summary,
  topics:Object.entries(binderTopicTitles).filter(([id])=>!topic||id===topic).map(([id,titles])=>({
   title:titles[es?1:0],sections:[
    {title:t('From our conversations','De nuestras conversaciones'),recap:true,entries:distinctConversationPoints(scoped.filter(note=>note.topic===id)).map(note=>({text:content(note),translated:content(note)!==note.content}))},
    ...(includeGuidance&&studentId!==null?[{title:t('Coordinator guidance','Orientación de coordinadores'),recap:false,entries:coordinatorGuidance.filter(f=>f.topic===id&&!f.hidden&&!f.withdrawn&&!f.removed).map(f=>({text:`${t('Coordinator guidance','Orientación de coordinadores')} · ${f.authorName} · ${f.organizationName}\n${f.kind==='resource'?t('Resource','Recurso'):f.kind==='suggested-step'?t('Suggested step','Paso sugerido'):t('Guidance','Orientación')} · ${new Date(f.editedAt||f.createdAt).toLocaleDateString(es?'es-US':'en-US')} · v${f.version}${f.connectionEnded?' · '+t('Sharing ended','Acceso compartido finalizado'):''}\n${f.body}${f.resourceUrl?'\n'+f.resourceUrl:''}`,translated:false}))}]:[]),
    ...groups.map(([kind,title])=>({title,recap:false,entries:scoped.filter(note=>note.topic===id&&note.status==='saved'&&note.kind===kind).map(note=>({text:content(note),translated:content(note)!==note.content}))}))
   ].filter(section=>section.entries.length)})),
  caption:t('Conversation points are recaps, not confirmed decisions. Translated notes are marked. Confirm requirements and dates with the college.','Los puntos de conversación son resúmenes, no decisiones confirmadas. Las notas traducidas están marcadas. Confirma requisitos y fechas con la universidad.'),
  copy:t('A downloaded copy of your saved notes. Unsaved edits are not included.','Una copia descargada de tus notas guardadas. No incluye cambios sin guardar.')
 };
}
