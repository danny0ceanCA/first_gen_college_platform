export const OUTCOME_EVALUATION_PURPOSE='service_quality';
export const OUTCOME_EVALUATION_VERSION=1;
export const evaluationNotice=Object.freeze({
 en:'Optional: allow Origen’s authorized service-quality reviewers for this organization to include this outcome’s structured evidence information in protected group statistics.\n\nThis includes the result category, evidence availability, date completeness, observation-period length and corrections observed after opting in.\n\nYour written updates, conversations, names, contact details and private report identifiers are excluded from report output.\n\nThis is not permission for partner export, research or model training.\n\nYou can withdraw at any time; changes to the evidence require a new approval. Declining does not affect your guidance, binder or coordinator support.',
 es:'Opcional: permite que las personas autorizadas por Origen para evaluar la calidad del servicio de esta organización incluyan la información estructurada de evidencia de este resultado en estadísticas grupales protegidas.\n\nIncluye la categoría del resultado, disponibilidad de evidencia, integridad de fechas, duración del período de observación y correcciones observadas después de aceptar.\n\nLos reportes excluyen tus textos, conversaciones, nombre, datos de contacto e identificadores privados.\n\nEsto no autoriza exportaciones a socios, investigación ni entrenamiento de modelos.\n\nPuedes retirar tu permiso en cualquier momento; los cambios en la evidencia requieren una nueva aprobación. Rechazar no afecta tu orientación, carpeta ni apoyo del coordinador.'
});
const fail=()=>{throw Object.assign(Error('invalid_outcome_evaluation'),{status:400});};
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function validateEvaluationCommand(raw,report=false){
 const fields=report?{report:['organizationId','definitionId']}:{load:['studentId','episodeId'],prepare:['studentId','episodeId','version','operationId'],confirm:['studentId','episodeId','previewId','digest','confirmed'],decline:['studentId','episodeId','version','confirmed'],withdraw:['studentId','episodeId','version','confirmed']};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(fields,raw.action))fail();
 const keys=['action','purpose','contractVersion',...fields[raw.action]];
 if(Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k))||raw.purpose!==OUTCOME_EVALUATION_PURPOSE||raw.contractVersion!==OUTCOME_EVALUATION_VERSION)fail();
 for(const k of ['organizationId','episodeId','operationId','previewId'])if(k in raw&&!uuid(raw[k]))fail();
 if('studentId'in raw&&(typeof raw.studentId!=='string'||!raw.studentId.trim()||raw.studentId.length>128||/[\x00-\x1f\x7f]/.test(raw.studentId)))fail();
 if('version'in raw&&(!Number.isSafeInteger(raw.version)||raw.version<0||raw.version>=2147483647))fail();
 if('confirmed'in raw&&raw.confirmed!==true||'digest'in raw&&(typeof raw.digest!=='string'||!/^[a-f\d]{64}$/.test(raw.digest)))fail();
 if(report&&!['office_contacted','document_submitted','document_accepted','decision_received','waiver_approved'].includes(raw.definitionId))fail();
 return {...raw};
}
