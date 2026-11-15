// Public, same-scope budgets with explicit application-owned estimate bases.
// Never personal aid calculations or an invented university-published total.
export const budgetKeys=['tuition_fees','housing','food','housing_and_food','books','transportation','personal','health_insurance','document_fee','other_expenses','systemwide_fees','campus_fees'];
const str={type:'string'},money={type:['number','null'],minimum:0,maximum:10000000};
export const publishedBudgetSchema={type:['object','null'],additionalProperties:false,properties:{
 year:str,population:str,currency:{type:'string',enum:['USD','CAD','EUR','GBP','MXN']},period:{type:'string',enum:['academic_year','calendar_year','semester','quarter','month']},
 housing:{type:'string',enum:['renting','with_family','on_campus','off_campus','unspecified']},assumed:{type:'boolean'},total:money,sourceCitation:str,
 complete:{type:'boolean'},expectedCategories:{type:'array',maxItems:12,items:{type:'string',enum:budgetKeys}},
 components:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:budgetKeys},sourceLabel:str,amount:money,role:{type:'string',enum:['component','subtotal','excluded','additional','missing']},qualification:str},required:['key','sourceLabel','amount','role','qualification']}},
},required:['year','population','currency','period','housing','assumed','total','sourceCitation','complete','expectedCategories','components']};
const amount=n=>n===null||Number.isFinite(n)&&n>=0&&n<=10000000;
// Application-owned catalog annotation. It is deliberately absent from the
// hosted research JSON schema: external/model output cannot assert this basis.
export function validatedCatalogEstimate(value,budget){
 if(!value||value.version!==1||!['calculated','partial'].includes(value.basis)||!Number.isFinite(value.amount)||!amount(value.amount)||
  budget.total!==null||!Array.isArray(value.unresolved)||value.unresolved.length>20)return null;
 const cents=n=>Math.round(n*100);
 const known=budget.components.filter(c=>c.role==='component'&&c.amount!==null);
 if(cents(value.amount)!==known.reduce((sum,c)=>sum+cents(c.amount),0))return null;
 const missing=budget.expectedCategories.filter(key=>!known.some(c=>c.key===key));
 if(value.basis==='calculated'&&(!budget.complete||value.unresolved.length||missing.length||known.length<3||budget.components.some(c=>c.role==='missing')))return null;
 if(value.basis==='partial'&&(budget.complete||!value.unresolved.length))return null;
 if(value.unresolved.some(u=>!u||!budgetKeys.includes(u.key)||typeof u.label!=='string'||!u.label.trim()||u.label.length>120||
  !(u.rate===null||Number.isFinite(u.rate)&&u.rate>=0&&u.rate<=10000000)||typeof u.unit!=='string'||u.unit.length>100||
  typeof u.qualification!=='string'||u.qualification.length>500))return null;
 return {version:1,basis:value.basis,amount:value.amount,unresolved:value.unresolved.map(u=>({...u}))};
}
export function catalogEstimateSources(sources=[],citation){
 const ids=citation===undefined?null:[...String(citation).matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
 const selected=ids?ids.map(id=>sources.find((s,index)=>(s.id??index+1)===id)):sources;
 return selected.length>0&&selected.every(s=>s?.catalogValidity&&['local_testing_catalog','published_catalog'].includes(s.catalogValidity.kind)&&
  /^[a-f0-9]{64}$/u.test(s.catalogValidity.batchId||'')&&/^[a-f0-9]{64}$/u.test(s.catalogValidity.recordDigest||''));
}
export function validatedBudget(value,sourceIds){
 if(!value||!/^20\d{2}[-–]\d{2}$/u.test(value.year)||typeof value.population!=='string'||!value.population.trim()||value.population.length>160||
  !publishedBudgetSchema.properties.currency.enum.includes(value.currency)||!publishedBudgetSchema.properties.period.enum.includes(value.period)||
  !publishedBudgetSchema.properties.housing.enum.includes(value.housing)||typeof value.assumed!=='boolean'||typeof value.complete!=='boolean'||!amount(value.total)||
  typeof value.sourceCitation!=='string'||value.sourceCitation.length>100)return null;
 const ids=[...value.sourceCitation.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
 if(!ids.length||ids.some(id=>!sourceIds.has(id)))return null;
 if(!Array.isArray(value.expectedCategories)||!value.expectedCategories.length||value.expectedCategories.length>12||new Set(value.expectedCategories).size!==value.expectedCategories.length||value.expectedCategories.some(key=>!budgetKeys.includes(key))||
  !Array.isArray(value.components)||value.components.length>20||!value.components.length)return null;
 if(value.components.some(c=>!c||!budgetKeys.includes(c.key)||!amount(c.amount)||!['component','subtotal','excluded','additional','missing'].includes(c.role)||
  typeof c.sourceLabel!=='string'||!c.sourceLabel.trim()||c.sourceLabel.length>120||typeof c.qualification!=='string'||c.qualification.length>300))return null;
 if(new Set(value.components.map(c=>c.key)).size!==value.components.length)return null;
 const keys=value.components.filter(c=>c.role==='component').map(c=>c.key);
 if(keys.includes('tuition_fees')&&(keys.includes('systemwide_fees')||keys.includes('campus_fees')))return null;
 if(keys.includes('housing_and_food')&&(keys.includes('housing')||keys.includes('food')))return null;
 const estimate=value.catalogEstimate===undefined?undefined:validatedCatalogEstimate(value.catalogEstimate,value);
 if(value.catalogEstimate!==undefined&&!estimate)return null;
 return {year:value.year.replace('–','-'),population:value.population,currency:value.currency,period:value.period,housing:value.housing,assumed:value.assumed,total:value.total,sourceCitation:ids.map(id=>`[${id}]`).join(' '),complete:value.complete,expectedCategories:[...value.expectedCategories],components:value.components.map(c=>({...c})),...(estimate?{catalogEstimate:estimate}:{})};
}
export function budgetAudit(budget){
 const missing=budget.expectedCategories.filter(key=>!budget.components.some(c=>c.key===key&&c.role==='component'&&c.amount!==null));
 const items=budget.components.filter(c=>c.role==='component'&&c.amount!==null);
 const sum=Math.round(items.reduce((n,c)=>n+c.amount,0)*100)/100;
 const difference=budget.total===null?null:Math.round((budget.total-sum)*100)/100;
 const matches=difference!==null&&Math.abs(difference)<=0.01;
 const listed=items.every(c=>budget.expectedCategories.includes(c.key));
 return {missing,sum,difference,complete:budget.complete&&budget.total!==null&&!missing.length&&listed&&items.length>=3&&matches,
  ...(budget.catalogEstimate?{calculatedComplete:!!(budget.catalogEstimate.basis==='calculated'&&validatedCatalogEstimate(budget.catalogEstimate,budget))}:{})};
}
export function remapBudget(budget,remap){return budget?{...budget,sourceCitation:remap(budget.sourceCitation)}:undefined;}
export const budgetLabels={en:['Tuition and fees','Housing','Food','Housing and food','Books','Transportation','Personal','Health insurance','Document fee','Other expenses','Systemwide fees','Campus fees'],es:['Matrícula y cuotas','Vivienda','Alimentación','Vivienda y alimentación','Libros','Transporte','Gastos personales','Seguro médico','Cuota de documentos','Otros gastos','Cuotas del sistema','Cuotas del campus']};
export function budgetHeadline(budget,language='en'){
 const es=language==='es';
 const format=n=>budget.currency+' $'+n.toLocaleString('en-US',{maximumFractionDigits:2});
 const housing={renting:es?'alquiler fuera del campus':'renting off campus',with_family:es?'viviendo con familiares':'living with family',off_campus:es?'fuera del campus':'off campus',on_campus:es?'en el campus':'on campus',unspecified:es?'vivienda sin especificar':'housing unspecified'}[budget.housing];
 const period={academic_year:es?'año académico':'academic year',calendar_year:es?'año calendario':'calendar year',semester:es?'semestre':'semester',quarter:es?'trimestre':'quarter',month:es?'mes':'month'}[budget.period];
 const scope=[budget.year,budget.population,period,housing].join(' · ');
 const estimate=budget.catalogEstimate;
 const headline=estimate?(estimate.basis==='calculated'?(es?'Estimación calculada: ':'Calculated estimate: '):(es?'Costos conocidos hasta ahora: ':'Known costs so far: '))+format(estimate.amount):
  budget.total===null?(es?'Total sin verificar':'Total unverified'):format(budget.total);
 return headline+': '+scope+'. '+budget.sourceCitation;
}
export function budgetFinding(budget,qualification,language='en'){
 const es=language==='es',audit=budgetAudit(budget),labels=budgetLabels[es?'es':'en'];
 const format=n=>budget.currency+' $'+n.toLocaleString('en-US',{maximumFractionDigits:2});
 const summary=budgetHeadline(budget,language);
 const details=budget.components.filter(c=>c.role==='component'&&c.amount!==null).map(c=>labels[budgetKeys.indexOf(c.key)]+': '+format(c.amount)).join('; ');
 const full=summary+' '+(es?'Desglose publicado: ':'Published breakdown: ')+details+'. '+budget.sourceCitation;
 const notes=[qualification];
 if(audit.missing.length||!budget.complete)notes.push(es?'El desglose publicado está incompleto.':'The published breakdown is incomplete.');
 if(audit.difference!==null&&Math.abs(audit.difference)>0.01)notes.push((es?'Diferencia entre total publicado y componentes: ':'Published total minus components: ')+format(audit.difference)+'.');
 return {answer:full.length<=700?full:summary,qualification:notes.filter(Boolean).join(' '),audit};
}
