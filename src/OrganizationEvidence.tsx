export type OrganizationInfo={version:string;topic?:string;category:string;certainty:'tentative'|'stated'|'unresolved';reportedBy:'student'|'parent'|'unknown';evidenceKind:'saved_summary';sourceVersion:string};
type T=(en:string,es:string)=>string;
export default function OrganizationEvidence({value,t,reviewOptional=false}:{value?:OrganizationInfo;t:T;reviewOptional?:boolean}){
 if(!value)return null;
 const label=value.certainty==='tentative'?t('Still exploring','Por explorar'):value.certainty==='unresolved'?t('Open question','Pregunta pendiente'):value.category==='decision'?t('Reported decision · To review','Decisión mencionada · Por revisar'):reviewOptional?t('Conversation note','Nota de conversación'):t('From a conversation · To review','De una conversación · Por revisar');
 return <span className="organization-evidence">{label}{value.reportedBy==='parent'?t(' · Parent report',' · Informe del padre o tutor'):value.reportedBy==='unknown'?t(' · Speaker unconfirmed',' · Autor sin confirmar'):''}</span>;
}
