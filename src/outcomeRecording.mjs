import {outcomeDefinition,validateOutcomeReportLink,validateOutcomeEventDate} from './outcomeEvidence.mjs';
const invalid=()=>{throw Object.assign(Error('invalid_outcome_evidence'),{status:400});};
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();};
export function validateOutcomeRecording(value){
 exact(value,['link','correction','replaces']);const link=validateOutcomeReportLink(value.link);
 let correction=null;
 if(value.correction!==null){
  exact(value.correction,['detail','occurredOn','timeZone']);
  if(link.responseState!=='answered'||typeof value.correction.detail!=='string'||value.correction.detail.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.correction.detail))invalid();
  const date=validateOutcomeEventDate({on:value.correction.occurredOn,precision:value.correction.occurredOn===null?'unknown':'day',timeZone:value.correction.timeZone});
  correction={...value.correction,timeZone:date.timeZone};
 }
 if(value.replaces!==null){exact(value.replaces,['id','version']);if(typeof value.replaces.id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.replaces.id)||!Number.isSafeInteger(value.replaces.version)||value.replaces.version<1||value.replaces.version>2147483647)invalid();}
 return {link,correction,replaces:value.replaces};
}
const normalize=v=>String(v||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
export function outcomeRecordingIntent(value){
 const text=normalize(value).replace(/^(please |por favor )/,'').replace(/^(can you |could you |i want you to |puedes |podrias |quiero que )/,'').replace(/^(please |por favor )/,'');
 return !/\b(don t|do not|not yet|never mind|no guardes|no registres|todavia no|aun no|olvidalo)\b/.test(text)&&/^(save|record|correct|update|guarda|registra|corrige|actualiza)\b/.test(text)&&/\b(outcome|evidence|specific result|resultado|evidencia)\b/.test(text);
}
export const outcomeLabels={en:{occurred:'happened',not_occurred:'did not happen',pending:'pending',unknown:'unknown',goal_changed:'my goal changed',declined:'I chose not to answer',approved:'approved',denied:'denied',other:'another decision'},es:{occurred:'ocurrió',not_occurred:'no ocurrió',pending:'pendiente',unknown:'no lo sé',goal_changed:'cambió mi meta',declined:'elegí no responder',approved:'aprobada',denied:'denegada',other:'otra decisión'}};
export function outcomeStatement(snapshot,language){
 const es=language==='es',l=outcomeLabels[es?'es':'en'],d=outcomeDefinition(snapshot.definitionId,snapshot.definitionVersion);
 if(!d)throw Error('outcome_definition_unavailable');
 return es?`Resultado que reporto: ${d.label.es}. Estado: ${l[snapshot.claimStatus||snapshot.responseState]}. ${snapshot.decision?`Decisión: ${l[snapshot.decision]}. `:''}Institución: ${snapshot.scope.institution}. Período: ${snapshot.scope.term}. Trámite: ${snapshot.scope.cycle}. Mis palabras: ${snapshot.statement||'sin detalle adicional'}. Fecha: ${snapshot.eventOn||'no indicada'}. Zona horaria: ${snapshot.timeZone}.`:`Outcome I report: ${d.label.en}. Status: ${l[snapshot.claimStatus||snapshot.responseState]}. ${snapshot.decision?`Decision: ${l[snapshot.decision]}. `:''}Institution: ${snapshot.scope.institution}. Term: ${snapshot.scope.term}. Process: ${snapshot.scope.cycle}. My words: ${snapshot.statement||'no additional detail'}. Date: ${snapshot.eventOn||'not specified'}. Time zone: ${snapshot.timeZone}.`;
}
export function outcomeReadback(preview,language,spoken=true){
 const es=language==='es',p=preview.payload,s=p.snapshot;
 return (es?`Revisa este resultado privado para: ${preview.action.title}. `:`Review this private outcome for: ${preview.action.title}. `)+outcomeStatement(s,language)+(es?` Ventana de observación: ${p.input.link.episode.window.start} a ${p.input.link.episode.window.end}. `:` Observation window: ${p.input.link.episode.window.start} through ${p.input.link.episode.window.end}. `)+(p.input.correction?(es?'También corregirá las palabras y la fecha de la actualización privada seleccionada e invalidará sus otros enlaces de evidencia. Las copias compartidas aprobadas se conservan. ':'It also corrects the selected private update’s wording and date and invalidates its other evidence links. Approved shared copies remain unchanged. '):'')+(p.renew?(es?'Renovará este resultado y eliminará sus enlaces de evidencia anteriores; las actualizaciones privadas originales se conservan. ':'It renews this outcome and removes its previous evidence links; the original private updates remain. '):'')+(p.input.replaces?(es?'Reemplazará el enlace de evidencia seleccionado. ':'It replaces the selected evidence link. '):'')+(p.recommendation?(es?'También vincula este resultado a la recomendación exacta que aceptaste para esta acción. Este vínculo documenta tu recorrido; no prueba que la recomendación causó el resultado ni permite evaluar recomendaciones. ':'It also links this outcome to the exact recommendation you accepted for this action. This records your journey; it does not prove the recommendation caused the result or permit recommendation evaluation. '):'')+(es?'Esto es lo que tú reportas; no está verificado por la institución ni evaluado como éxito. No cambia el progreso de tu acción ni tus seguimientos. No se comparte con tu coordinador y no autoriza evaluación ni entrenamiento. ':'This is student-reported, not institution-verified or assessed as success. It does not change your action progress or check-ins. It is not shared with your coordinator and grants no evaluation or training permission. ')+(spoken?(es?'Para guardar esta selección exacta, di: sí, guárdalo.':'To save this exact selection, say: yes, save it.'):'');
}
export function outcomeShareWording(snapshot,language){return outcomeStatement(snapshot,language)+(language==='es'?' Quiero que mi coordinador revise la evidencia de este resultado.':' I would like my coordinator to review the evidence for this outcome.');}
