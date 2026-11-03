// Reviewed library data, never instructions or evidence of a student's eligibility.
export const actionGoals=Object.freeze(['understand_requirement','prepare_document','submit_document','check_decision']);
export const actionProcesses=Object.freeze(['office_contact','aid_documents','insurance_waiver']);
export const actionPrerequisites=Object.freeze(['campus_confirmed','term_confirmed','current_official_requirement','document_requested','document_prepared','submission_reported','decision_pending']);
export const actionExclusions=Object.freeze(['already_completed','declined','deferred','conflicting_evidence','expired_requirement','decision_received']);
const fail=()=>{throw Object.assign(Error('invalid_action_template'),{status:400});};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();};
const string=(v,max)=>{if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))fail();return v;};
const bilingual=(v,max)=>{exact(v,['en','es']);string(v.en,max);string(v.es,max);};
export const officialHost=v=>typeof v==='string'&&v.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:edu|gov)$/.test(v);
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail();};
export function validateActionTemplate(v){
 exact(v,['version','mode','action','explanation','goal','process','prerequisites','exclusions','campus','term','sources','reviewedOn','reviewBy']);
 if(v.version!==1||!['general_question','institution_requirement'].includes(v.mode)||!actionGoals.includes(v.goal)||!actionProcesses.includes(v.process))fail();
 bilingual(v.action,500);bilingual(v.explanation,1000);
 for(const [key,allowed] of [['prerequisites',actionPrerequisites],['exclusions',actionExclusions]])if(!Array.isArray(v[key])||v[key].length>12||new Set(v[key]).size!==v[key].length||v[key].some(x=>!allowed.includes(x)))fail();
 if(!['already_completed','declined','deferred','conflicting_evidence','expired_requirement'].every(x=>v.exclusions.includes(x)))fail();
 if(!Array.isArray(v.sources)||v.sources.length>8)fail();
 if(v.mode==='general_question'){if(v.campus!==null||v.term!==null||v.sources.length)fail();}
 else{
  exact(v.campus,['name','officialHost']);string(v.campus.name,160);if(!officialHost(v.campus.officialHost))fail();string(v.term,80);
  if(!v.sources.length||!['campus_confirmed','term_confirmed','current_official_requirement'].every(x=>v.prerequisites.includes(x)))fail();
 }
 date(v.reviewedOn);date(v.reviewBy);if(v.reviewBy<v.reviewedOn||Date.parse(v.reviewBy)-Date.parse(v.reviewedOn)>366*86400000)fail();
 for(const s of v.sources){
  exact(s,['id','url','claim','checkedOn','reviewBy']);if(typeof s.id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s.id))fail();
  string(s.url,2000);if(/\s/.test(s.url)||!/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:edu|gov)(?:[/?#]|$)/.test(s.url))fail();bilingual(s.claim,1000);date(s.checkedOn);date(s.reviewBy);
  let u;try{u=new URL(s.url);}catch{fail();}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!officialHost(u.hostname)||!(u.hostname===v.campus.officialHost||u.hostname.endsWith('.'+v.campus.officialHost)))fail();
  if(s.checkedOn>v.reviewedOn||s.reviewBy<v.reviewBy||s.reviewBy<s.checkedOn||Date.parse(s.reviewBy)-Date.parse(s.checkedOn)>366*86400000)fail();
 }
 if(new Set(v.sources.map(s=>s.id)).size!==v.sources.length||new TextEncoder().encode(JSON.stringify(v)).length>24000)fail();
 return structuredClone(v);
}

// Independently authored starting points. No institution-specific claims or
// private records, no automatic publication, no implied measured effectiveness.
export function actionTemplateDrafts(day=new Date().toISOString().slice(0,10)){
 const reviewBy=new Date(Date.parse(day)+90*86400000).toISOString().slice(0,10);
 const base={version:1,mode:'general_question',campus:null,term:null,sources:[],reviewedOn:day,reviewBy,
  exclusions:['already_completed','declined','deferred','conflicting_evidence','expired_requirement'],prerequisites:[]};
 return [
  {key:'office',title:'Identify the responsible office',goal:'understand_requirement',process:'office_contact',
   action:{en:'Ask which campus office handles your specific financial aid or student health insurance question.',es:'Pregunta qué oficina del campus atiende tu pregunta específica sobre ayuda financiera o seguro médico estudiantil.'},
   explanation:{en:'Confirming the responsible office can help you decide whom to contact next.',es:'Confirmar cuál es la oficina responsable puede ayudarte a decidir a quién contactar después.'}},
  {key:'documents',title:'Clarify a requested document',goal:'prepare_document',process:'aid_documents',prerequisites:['document_requested'],
   action:{en:'Ask the office that requested the document which document and format it needs before preparing it.',es:'Antes de prepararlo, pregunta a la oficina que solicitó el documento qué documento y formato necesita.'},
   explanation:{en:'An exact description helps you prepare what the office requested without guessing.',es:'Una descripción exacta te ayuda a preparar lo que pidió la oficina sin tener que adivinar.'}},
  {key:'submission',title:'Confirm how to submit',goal:'submit_document',process:'aid_documents',prerequisites:['document_requested','document_prepared'],
   action:{en:'Ask the requesting office to confirm its official submission method and how to check that your document was received.',es:'Pide a la oficina que solicitó el documento que confirme su método oficial de entrega y cómo verificar que lo recibió.'},
   explanation:{en:'Confirming the submission method and receipt avoids assuming that a prepared document has been received.',es:'Confirmar el método de entrega y la recepción evita suponer que un documento preparado ya fue recibido.'}},
  {key:'decision',title:'Ask about a pending insurance decision',goal:'check_decision',process:'insurance_waiver',prerequisites:['submission_reported','decision_pending'],exclusions:[...base.exclusions,'decision_received'],
   action:{en:'Ask the campus office handling your health insurance waiver how to check its status and whether it needs anything else from you.',es:'Pregunta a la oficina del campus que tramita tu exención del seguro médico cómo consultar su estado y si necesita algo más de tu parte.'},
   explanation:{en:'A pending request does not establish approval or rejection. The responsible office can clarify its current status.',es:'Una solicitud pendiente no indica aprobación ni rechazo. La oficina responsable puede aclarar su estado actual.'}}
 ].map(({key,title,...content})=>({key,title,content:{...structuredClone(base),...content}}));
}
