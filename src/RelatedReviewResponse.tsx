import type {ReviewResponseReference} from './reviewResponseConnection.mjs';
export type RelatedResponse={availability:'current'|'unavailable';source:ReviewResponseReference|null;responseVersion:number;question?:string;coordinatorName?:string;respondedAt?:string};
export default function RelatedReviewResponse({value,t,onOpen}:{value?:RelatedResponse|null;t:(en:string,es:string)=>string;onOpen?:(id:string)=>void}){
 if(!value)return null;
 return <aside className="review-request-context review-request-related">
  <strong>{t('About an earlier response','Sobre una respuesta anterior')}</strong>
  {value.availability==='current'?<>
   <p>{value.coordinatorName} · {t('Response','Respuesta')} {value.responseVersion}{value.respondedAt&&<> · <time dateTime={value.respondedAt}>{new Date(value.respondedAt).toLocaleDateString(t('en-US','es-US'),{dateStyle:'long',timeZone:'UTC'})}</time></>}</p>
   <p>{t('Earlier approved question:','Pregunta anterior aprobada:')} {value.question}</p>
   <p>{t('This reference includes the earlier question and identifies the response. The conversation, response text and other notes are not attached.','Esta referencia incluye la pregunta anterior e identifica la respuesta. No se adjuntan la conversación, el texto de la respuesta ni otras notas.')}</p>
   {onOpen&&value.source&&<button type="button" className="text-button" onClick={()=>onOpen(value.source!.requestId)}>{t('View original request','Ver solicitud original')}</button>}
  </>:<p>{t('The source response changed or is unavailable. My question remains in my history. Open the current response to prepare a new linked request.','La respuesta de origen cambió o ya no está disponible. Mi pregunta permanece en mi historial. Abre la respuesta vigente para preparar una nueva solicitud vinculada.')}</p>}
 </aside>;
}
