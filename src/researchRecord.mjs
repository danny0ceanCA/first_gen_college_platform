// Public source-backed facts across college topics. These records never decide
// whether an individual student qualifies or authorize an application action.
export const researchTopics=['admissions','financial_aid','scholarships','housing','programs','student_support','enrollment','careers','process','other'];
const string={type:'string'},nullableString={type:['string','null']},number={type:['number','null'],minimum:0,maximum:100000000};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const factProperties={key:string,label:string,kind:{type:'string',enum:['date','amount','number','rule','requirement','step','text','link']},status:{type:'string',enum:['verified','partial','unverified']},
 value:{...nullableString,maxLength:500},amount:number,upperAmount:number,bound:{type:['string','null'],enum:['exact','up_to','at_least','range',null]},currency:{type:['string','null'],pattern:'^[A-Z]{3}$'},unit:nullableString,
 date:nullableString,time:nullableString,timeZone:nullableString,order:{type:['integer','null'],minimum:1,maximum:50},sourceCitation:string,qualification:{...string,maxLength:300}};
const absent={type:'null'};
const nonNumeric={amount:absent,upperAmount:absent,bound:absent,currency:absent,unit:absent};
const nonDate={date:absent,time:absent,timeZone:absent};
// Constrain generation to the same field relationships the validator requires.
// A numeric fact cannot also carry an incompatible prose value. Conditions
// remain in qualification or separate cited facts, never silently discarded.
const factSchema={anyOf:[
 object({...factProperties,kind:{type:'string',enum:['amount','number']},value:absent,...nonDate,order:absent}),
 object({...factProperties,kind:{type:'string',enum:['date']},value:absent,...nonNumeric,order:absent}),
 object({...factProperties,kind:{type:'string',enum:['step']},...nonNumeric,...nonDate}),
 object({...factProperties,kind:{type:'string',enum:['rule','requirement','text','link']},...nonNumeric,...nonDate,order:absent}),
]};
export const researchRecordSchema={...object({topic:{type:'string',enum:researchTopics},scope:object({cycle:{...nullableString,pattern:'^20[0-9]{2}(?:[-–][0-9]{2})?$'},term:{type:['string','null'],enum:['fall','spring','summer','winter','year_round',null]},population:string,program:nullableString,jurisdiction:nullableString,
 enrollment:{type:['string','null'],enum:['full_time','part_time','both',null]},delivery:{type:['string','null'],enum:['online','in_person','hybrid','any',null]},validThrough:nullableString}),
 complete:{type:'boolean'},expectedFacts:{type:'array',maxItems:8,items:string},facts:{type:'array',maxItems:8,items:factSchema}}),type:['object','null']};
export const normalizedText=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const text=(value,max,nullable=false)=>nullable&&value===null||typeof value==='string'&&value.trim().length>0&&value.length<=max;
const numeric=value=>value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100000000;
export function calendarDate(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/u.test(value))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
function zone(value){try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return typeof value==='string'&&value.length<=80;}catch{return false;}}
// Some providers repeat the requested category as each step's identifier.
// Normalize identifiers only when the ordered steps are unambiguous. All values,
// sources, qualifications and completeness still pass the normal validator.
function uniqueStepKeys(value){
 if(!Array.isArray(value?.facts)||!Array.isArray(value.expectedFacts))return value;
 const groups=new Map();for(const fact of value.facts){if(typeof fact?.key!=='string')return value;const group=groups.get(fact.key)||[];group.push(fact);groups.set(fact.key,group);}
 const duplicated=[...groups].filter(([,facts])=>facts.length>1);if(!duplicated.length)return value;
 if(duplicated.some(([,facts])=>facts.some(f=>f.kind!=='step'||!Number.isSafeInteger(f.order)||f.order<1||f.order>50)||new Set(facts.map(f=>f.order)).size!==facts.length))return value;
 const remapped=new Map(duplicated.map(([key,facts])=>[key,facts.map(f=>key.slice(0,56)+'_'+f.order)]));
 const facts=value.facts.map(f=>remapped.has(f.key)?{...f,key:f.key.slice(0,56)+'_'+f.order}:f);
 if(new Set(facts.map(f=>f.key)).size!==facts.length)return value;
 return {...value,facts,expectedFacts:value.expectedFacts.flatMap(key=>remapped.get(key)||[key])};
}
export function validatedResearchRecord(value,sourceIds){
 value=uniqueStepKeys(value);
 if(!value||!researchTopics.includes(value.topic)||typeof value.complete!=='boolean')return null;
 // Lossless compatibility: keep supplied years/terms, never invent a cycle.
 if(typeof value.scope?.cycle==='string'){
  let cycle=value.scope.cycle.trim().replace(/[–—]/gu,'-'),term=value.scope.term;
  const long=cycle.match(/^(20\d{2})\s*-\s*(20\d{2})$/u);
  if(long&&long[1].slice(0,2)===long[2].slice(0,2))cycle=long[1]+'-'+long[2].slice(-2);
  const season=cycle.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/^(fall|otono|spring|primavera|summer|verano|winter|invierno)\s+(20\d{2})$/u);
  if(season){
   const mapped={fall:'fall',otono:'fall',spring:'spring',primavera:'spring',summer:'summer',verano:'summer',winter:'winter',invierno:'winter'}[season[1]];
   if(term&&term!==mapped)return null;
   cycle=season[2];term=mapped;
  }
  value={...value,scope:{...value.scope,cycle,term}};
 }
 const scope=value.scope,p=researchRecordSchema.properties.scope.properties;
 if(!scope||!text(scope.population,160)||!text(scope.program,160,true)||!text(scope.jurisdiction,100,true)||
  !(scope.cycle===null||typeof scope.cycle==='string'&&/^20\d{2}(?:[-–]\d{2})?$/u.test(scope.cycle))||
  !p.term.enum.includes(scope.term)||!p.enrollment.enum.includes(scope.enrollment)||!p.delivery.enum.includes(scope.delivery)||!(scope.validThrough===null||calendarDate(scope.validThrough)))return null;
 if(!Array.isArray(value.expectedFacts)||!value.expectedFacts.length||value.expectedFacts.length>8||new Set(value.expectedFacts).size!==value.expectedFacts.length||value.expectedFacts.some(key=>!/^\p{L}[\p{L}\p{N}_-]{0,63}$/u.test(key))||
  !Array.isArray(value.facts)||!value.facts.length||value.facts.length>8||new Set(value.facts.map(f=>f?.key)).size!==value.facts.length)return null;
 const facts=[];
 for(const f of value.facts){
  if(!f||!text(f.key,64)||!/^\p{L}[\p{L}\p{N}_-]*$/u.test(f.key)||!text(f.label,100)||!factProperties.kind.enum.includes(f.kind)||!factProperties.status.enum.includes(f.status)||
   !text(f.value,500,true)||!numeric(f.amount)||!numeric(f.upperAmount)||!factProperties.bound.enum.includes(f.bound)||!(f.currency===null||Intl.supportedValuesOf('currency').includes(f.currency))||!text(f.unit,80,true)||
   !(f.date===null||calendarDate(f.date))||!(f.time===null||typeof f.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/u.test(f.time))||!(f.timeZone===null||zone(f.timeZone))||
   !(f.order===null||Number.isSafeInteger(f.order)&&f.order>=1&&f.order<=50)||typeof f.sourceCitation!=='string'||f.sourceCitation.length>100||typeof f.qualification!=='string'||f.qualification.length>300)return null;
  const ids=[...f.sourceCitation.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
  if(ids.some(id=>!sourceIds.has(id))||f.status!=='unverified'&&!ids.length)return null;
  const valued=f.kind==='date'?f.date!==null:['amount','number'].includes(f.kind)?f.amount!==null:f.value!==null;
  if(f.status!=='unverified'&&!valued||f.status==='unverified'&&valued)return null;
  if(f.kind==='date'?(f.value!==null||f.amount!==null||f.upperAmount!==null||f.currency!==null||f.unit!==null||f.bound!==null||f.order!==null):f.date!==null||f.time!==null||f.timeZone!==null)return null;
  if(['amount','number'].includes(f.kind)){
   const invalidRange=f.bound==='range'?f.amount===null||f.upperAmount===null||f.upperAmount<f.amount:f.upperAmount!==null;
   if(f.value!==null||f.order!==null||f.status!=='unverified'&&(!f.bound||!f.unit||f.kind==='amount'&&!f.currency)||f.kind==='number'&&f.currency!==null||
    invalidRange)return null;
  }else if(f.amount!==null||f.upperAmount!==null||f.bound!==null||f.currency!==null||f.kind!=='date'&&f.unit!==null)return null;
  if(f.kind==='step'?f.status!=='unverified'&&f.order===null:f.order!==null)return null;
  if(f.kind==='link'&&f.value!==null){try{const url=new URL(f.value);if(url.protocol!=='https:'||url.username||url.password)return null;}catch{return null;}}
  facts.push({...Object.fromEntries(Object.keys(factProperties).map(key=>[key,f[key]])),sourceCitation:[...new Set(ids)].map(id=>`[${id}]`).join(' ')});
 }
 const steps=facts.filter(f=>f.kind==='step'&&f.order!==null);if(new Set(steps.map(f=>f.order)).size!==steps.length)return null;
 return {topic:value.topic,scope:{...Object.fromEntries(Object.keys(p).map(key=>[key,scope[key]])),cycle:scope.cycle?.replace('–','-')??null},complete:value.complete,expectedFacts:[...value.expectedFacts],facts};
}
export function researchRecordAudit(record){
 const missing=record.expectedFacts.filter(key=>!record.facts.some(f=>f.key===key&&f.status==='verified'));
 const unknownCutoffs=record.facts.filter(f=>f.kind==='date'&&f.time!==null&&f.timeZone===null).map(f=>f.key);
 const steps=record.facts.filter(f=>f.kind==='step'&&f.status!=='unverified').map(f=>f.order).sort((a,b)=>a-b);
 const incompleteSteps=steps.some((step,index)=>step!==index+1);
 return {missing,unknownCutoffs,incompleteSteps,complete:record.complete&&!missing.length&&!unknownCutoffs.length&&!incompleteSteps};
}
export function remapResearchRecord(record,remap){return record?{...record,facts:record.facts.map(f=>({...f,sourceCitation:remap(f.sourceCitation)}))}:undefined;}
export function withoutRecordAuditNotes(value){return String(value||'').replace(/The requested answer still has unverified details\.|La respuesta solicitada aún tiene detalles sin verificar\.|The cutoff time zone was not verified\.|No se verificó la zona horaria del plazo\.|The sequence of steps is incomplete\.|La secuencia de pasos está incompleta\./gu,'').replace(/\s+/gu,' ').trim();}
export function researchFactValue(fact,language='en'){
 const es=language==='es';if(fact.status==='unverified')return es?'Sin verificar':'Unverified';
 if(['amount','number'].includes(fact.kind)){
  const n=value=>fact.kind==='amount'?new Intl.NumberFormat('en-US',{style:'currency',currency:fact.currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(value):String(value);
  const prefixes=es?{exact:'',up_to:'Hasta ',at_least:'Al menos ',range:''}:{exact:'',up_to:'Up to ',at_least:'At least ',range:''};
  return prefixes[fact.bound]+n(fact.amount)+(fact.bound==='range'?'–'+n(fact.upperAmount):'')+(fact.currency?' '+fact.currency:'')+' '+fact.unit;
 }
 if(fact.kind==='date'){
  const date=new Date(fact.date+'T12:00:00Z');let value=new Intl.DateTimeFormat(es?'es-US':'en-US',{timeZone:'UTC',dateStyle:'medium'}).format(date);
  if(fact.time&&fact.timeZone){const zoneName=new Intl.DateTimeFormat(es?'es-US':'en-US',{timeZone:fact.timeZone,timeZoneName:'longGeneric'}).formatToParts(date).find(p=>p.type==='timeZoneName')?.value;value+=' '+fact.time+' '+zoneName;}
  return value;
 }
 return fact.value;
}
export function researchScopeLabel(record,language='en'){
 const es=language==='es',labels=es?{fall:'otoño',spring:'primavera',summer:'verano',winter:'invierno',year_round:'todo el año',full_time:'tiempo completo',part_time:'tiempo parcial',both:'tiempo completo o parcial',online:'en línea',in_person:'presencial',hybrid:'híbrido',any:'cualquier modalidad'}:{full_time:'full time',part_time:'part time',both:'full or part time',online:'online',in_person:'in person',hybrid:'hybrid',any:'any format',year_round:'year round'};
 return [record.scope.cycle,record.scope.term,record.scope.population,record.scope.program,record.scope.jurisdiction,record.scope.enrollment,record.scope.delivery].filter(Boolean).map(value=>labels[value]||value).join(' · ');
}
export function researchRecordFinding(record,qualification,language='en'){
 const audit=researchRecordAudit(record),es=language==='es';
 const scope=researchScopeLabel(record,language);
 const facts=[...record.facts].sort((a,b)=>(a.order??99)-(b.order??99));
 const details=facts.map(f=>`${f.label}: ${researchFactValue(f,language)}${f.qualification?' ('+f.qualification+')':''} ${f.sourceCitation}`).join('; ');
 const notes=[qualification];
 if(!audit.complete)notes.push(es?'La respuesta solicitada aún tiene detalles sin verificar.':'The requested answer still has unverified details.');
 if(audit.unknownCutoffs.length)notes.push(es?'No se verificó la zona horaria del plazo.':'The cutoff time zone was not verified.');
 if(audit.incompleteSteps)notes.push(es?'La secuencia de pasos está incompleta.':'The sequence of steps is incomplete.');
 const full=scope+'. '+details;
 const first=facts[0];
 const short=scope+'. '+first.label+': '+researchFactValue(first,language)+(first.qualification?' ('+first.qualification+')':'')+' '+first.sourceCitation;
 const suffix=es?' Más detalles en la referencia guardada.':' Additional facts in the saved reference.';
 // Do not trim a qualification off a factual claim to fit the voice unit.
 const summary=full.length<=700?full:short.length+suffix.length<=700?short+suffix:es?'Hay información verificada; consulta los detalles y sus condiciones.':'Verified information is available; consult the facts and their conditions.';
 return {answer:summary,qualification:notes.filter(Boolean).join(' '),audit,report:full};
}
