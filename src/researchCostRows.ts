import {validatedBudget} from './publishedBudget.mjs';
type CostCell={evidence?:unknown;scope:string;answer:string;qualification:string;status?:string;sources?:unknown[];budget?:NonNullable<ReturnType<typeof validatedBudget>>};
type EvidenceRow<Cell extends CostCell>={aspect:string;cells:(Cell|null)[]};

const currency=String.raw`(?:(?:US|CA|MX|AU|NZ)\$|[$€£])\s*\d(?:[\d,.]*\d)?`;
const amounts=new RegExp(currency,'gu');
const money=new RegExp(`^(?:${currency})$`,'u');
const direct=String.raw`(?:direct university (?:costs|charges)|direct (?:costs|charges)|cargos directos(?: de la universidad)?)`;
const other=String.raw`(?:estimated,? non[- ]billed (?:personal )?expenses|non[- ]billed (?:personal )?expenses|(?:otros )?gastos(?: personales)? (?:estimados )?no facturados)`;
const housing=String.raw`(?:housing(?:\s*(?:/|and|&)\s*utilities)?|(?:alojamiento|vivienda)(?: y servicios(?: públicos)?)?)`;
const housingAndFood=String.raw`(?:(?:housing|room) (?:and|&) (?:food|meals|board)|(?:alojamiento|vivienda) y (?:alimentación|comidas))`;
const meals=String.raw`(?:(?:the )?meal plan|(?:el )?plan de comidas)`;
const total=String.raw`(?:cost of attendance|academic[- ]year budget|estimated total (?:cost|budget)|total (?:cost|budget)|costo (?:total|de asistencia)|presupuesto total)`;
const tuition=String.raw`(?:tuition(?:\s*/\s*| and )(?:mandatory[- ]+)?fees?|matrícula y cuotas(?: obligatorias)?)`;
const annualTuition=String.raw`(?:(?:annual|academic[- ]year) (?:(?:fall/(?:winter/)?spring|scheduled|recurring) )?(?:base charges|${tuition})(?: subtotal)?|two semesters total|matrícula y cuotas anuales)`;
const academicYear=/\b(?:annual|academic[- ]year|fall(?:,? winter,?)? and spring|anual(?:es)?|año académico|otoño(?:,? invierno,?)? y primavera)\b/iu;
const tuitionSubtotal=String.raw`(?:these sum to|these add up to|estos conceptos suman|estas partidas suman)`;
const rentedBudget=String.raw`(?:off[- ]campus(?: apartment)?(?: (?:without|not with) (?:parents|family)|\s*[—–-]\s*not with (?:parents|family))?(?: budget)?|fuera del campus(?: sin (?:los )?padres)?|apartamento fuera del campus)`;
const familyBudget=String.raw`(?:relatives|living with family|con familiares)`;
const semester= /\b(?:semester|per term|per quarter|semestre|trimestre|cuatrimestre)\b/iu;
const systemwideFees=String.raw`(?:systemwide tuition(?:\s*/\s*| and )fees|matrícula y cuotas del sistema)`;
const campusFees=String.raw`(?:campus(?:[- ]based)? fees|cuotas del campus)`;

const specs=[
 ['direct_costs','total_budget',direct],
 ['tuition_fees','tuition_fees',tuition],
 ['housing_and_food','housing',housingAndFood],['housing','housing',housing],['meals','housing',meals],['food','housing',String.raw`(?:food(?: allowance)?|alimentación)`],
 ['books','housing',String.raw`(?:books(?:\s*(?:/|and|&)\s*supplies|/(?:course )?materials/supplies/equipment|,\s*(?:course )?materials,\s*supplies,? and equipment)?|libros(?: y materiales)?)`],
 ['transportation','housing',String.raw`(?:transportation|transporte)`],
 ['personal','housing',String.raw`(?:(?:miscellaneous(?:\s*/\s*| and ))?personal(?: expenses)?|gastos personales)`],
 ['health_insurance','housing',String.raw`(?:(?:student )?health insurance(?: plan)?|insurance|SHIP(?: insurance)?|seguro (?:médico|de salud))`],
 ['document_fee','housing',String.raw`(?:document(?: management)? fee|records management fee|cuota (?:de documentos|por documentación))`],
 ['other_expenses','total_budget',other],
 ['residence_hall_total','total_budget',String.raw`(?:residence[- ]halls?|residencias universitarias)`],
 ['campus_apartment_total','total_budget',String.raw`(?:(?<!off )campus apartment|apartamento en el campus)`],
 ['off_campus_apartment_total','total_budget',rentedBudget],
 ['with_family_total','total_budget',familyBudget],
 ['total_budget','total_budget',total],
] as const;

function labeledAmount(text:string,label:string,allowBareSuffix=false){
 const before=new RegExp(String.raw`(?<![\p{L}\p{N}-])(?:${label})\s*(?:(?:is|are|es|son|de|of|total(?:s|ing)?)\s+|:\s*)?(?:USD\s+)?(${currency})(?![\d,.]*\d)`,'giu');
 const after=new RegExp(String.raw`(${currency})\s+(?:(?:in|for|en|para|por)\s+)(?:${label})\b`,'giu');
 const matches=new Set([...text.matchAll(before),...text.matchAll(after)].map(match=>match[1]));
 if(allowBareSuffix){
  const bare=new RegExp(String.raw`(${currency})\s+(?:${label})(?=\s*(?:[.,;:!?]|$|(?:and|y)\s+(?:USD\s+)?${currency}))`,'giu');
  for(const match of text.matchAll(bare))matches.add(match[1]);
 }
 return matches.size===1?[...matches][0]:null;
}

function breakdownAmount(text:string,label:string,base:boolean,allowBareSuffix:boolean){
 // Leave ranges and alternatives in the full evidence rather than presenting
 // one of their endpoints as a verified cost.
 const values=[...text.matchAll(amounts)].map(match=>match[0]);
 if(values.length>1&&/(?:\b(?:from|between|ranging from|entre|desde)\b[^.!?]{0,80}\d|\d\s*(?:[–—-]|to|or|a|o)\s*(?:US|CA|MX|AU|NZ)?[$€£])/iu.test(text))return null;
 return labeledAmount(text,label,allowBareSuffix)||(base&&money.test(text.trim().replace(/\.$/u,''))?text.trim().replace(/\.$/u,''):null);
}

const breakdownMarker=/\b(?:published breakdown|desglose publicado)\s*:/iu;
const leadingAnnualFee=new RegExp(String.raw`^\s*(?:(?:annual|anual)\s+)?(?:USD\s+)?(${currency})(?:\s+USD)?\s+(?:for (?:full[- ]time )?fall(?:,\s*winter,?)?\s+and spring|para (?:tiempo completo en )?otoño(?:,\s*invierno,?)?\s+y primavera)\b`,'iu');
function publishedComponent(breakdown:string|undefined,label:string){
 if(!breakdown)return null;
 const pair=new RegExp(String.raw`^\s*(?:${label})\s*:\s*(?:USD\s+)?(${currency})\s*\.?\s*$`,'iu');
 // A source may finish its final line item with a sentence, then give
 // subtotals. Split sentences too, while preserving decimal amounts.
 const amounts=new Set(breakdown.replace(/\[\d+\]/gu,'').split(/;|\.(?=\s+\p{L})/u).flatMap(part=>{
  const match=pair.exec(part);
  return match?[match[1]]:[];
 }));
 return amounts.size===1?[...amounts][0]:null;
}

function tuitionFeeAmount(cell:CostCell|null|undefined){
 if(!cell)return null;
 const [answer]=cell.answer.replace(/\s*\[\d+\]/gu,'').split(breakdownMarker);
 const firstSentence=answer.split(/[.;](?=\s+\p{L})/u,1)[0];
 const annual=labeledAmount(firstSentence,annualTuition)||
  labeledAmount(firstSentence,String.raw`(?:annually in recurring tuition/mandatory fees|al año en matrícula y cuotas obligatorias)`,true);
 // A stated full-year subtotal remains annual when a later sentence explains
 // that the source publishes semester rates.
 const periodTotal=academicYear.test(firstSentence)&&!semester.test(firstSentence)
  ?labeledAmount(firstSentence,tuition)
  :null;
 const subtotal=academicYear.test(answer)&&/\b(?:tuition|matrícula)\b/iu.test(answer)&&/\b(?:fees?|cuotas?)\b/iu.test(answer)?
  labeledAmount(answer,tuitionSubtotal):null;
 return annual||periodTotal||subtotal||leadingAnnualFee.exec(firstSentence)?.[1]||(!semester.test(answer+' '+cell.scope)?breakdownAmount(answer,tuition,true,false):null);
}

// Sum only explicitly labeled components of the same published breakdown.
// Never infer a total, mix a billing schedule with a budget, or guess separators.
function combinedPublishedFees(breakdown:string|undefined){
 const values=[publishedComponent(breakdown,systemwideFees),publishedComponent(breakdown,campusFees)];
 const parsed=values.map(value=>value&&/^(US\$|\$|€|£)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)$/u.exec(value));
 if(parsed.some(value=>!value))return null;
 const parts=parsed as RegExpExecArray[];
 const currency=parts[0][1].replace(/^US/u,'');
 if(parts.some(part=>part[1].replace(/^US/u,'')!==currency))return null;
 const cents=parts.reduce((sum,part)=>sum+Math.round(Number(part[2].replaceAll(',',''))*100),0);
 return currency+new Intl.NumberFormat('en-US',{minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2}).format(cents/100);
}
function budgetFeeDetail(budget:string|null,schedule:string|null,qualification:string){
 if(!budget||!schedule)return;
 const parse=(value:string)=>/^(?:US)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)$/u.exec(value)?.[1];
 const a=parse(budget),b=parse(schedule);
 if(!a||!b)return;
 const cents=Math.abs(Math.round(Number(a.replaceAll(',',''))*100)-Math.round(Number(b.replaceAll(',',''))*100));
 if(!cents)return;
 return {budget,schedule,difference:'$'+(cents/100).toFixed(2),rounded:/\b(?:round(?:s|ed|ing)?|redonde\w*)\b/iu.test(qualification)};
}
function appliesToHousing(scope:string,scenario?:'off_campus'|'renting'|'with_family'){
 if(!scenario)return true;
 const offCampus=/\b(?:off[- ]campus|fuera del campus)\b/iu.test(scope);
 const renting=/\b(?:off[- ]campus (?:apartment|rent\w*|(?:without|not with) (?:parents|family))|rent\w* off[- ]campus|(?:alquil\w*|apartamento) fuera del campus|fuera del campus sin (?:los )?padres)\b/iu.test(scope)||
  offCampus&&/\b(?:not (?:living )?with parents|sin (?:los )?padres)\b/iu.test(scope);
 const family=/\b(?:living with family|with relatives|con familiares)\b/iu.test(scope.replace(/\b(?:without|not (?:living )?with) (?:family|relatives)\b|\bsin familiares\b/giu,''));
 if(scenario==='renting')return renting&&!family;
 if(scenario==='with_family')return family&&!renting;
 return offCampus&&!renting&&!family;
}

const leadingBudgetAmount=new RegExp(String.raw`^\s*(?:USD\s+)?(${currency})(?:\s+USD)?\s+(?:before (?:financial )?aid|antes de (?:la )?ayuda|(?:(?:for|per) (?:the )?)?(?:academic[- ]year|20\d{2}\b)|(?:para|por) (?:el )?(?:año académico|20\d{2}\b))`, 'iu');
const annualBudgetAmount=new RegExp(String.raw`^\s*(?:20\d{2}[-–]\d{2}\s+)?(?:annual|academic[- ]year|anual)\s+(?:USD\s+)?(?:before[- ]aid\s+)?budget\s*:\s*(${currency})`, 'iu');

export function publishedCostHousing(answer:string,heading:string){
 const [scope,breakdown]=answer.split(breakdownMarker);
 if(!breakdown)return;
 return (['renting','with_family','off_campus'] as const).find(scenario=>appliesToHousing(scope,scenario)&&!appliesToHousing(heading,scenario));
}

export function researchCostRows<Cell extends CostCell>(inputRows:EvidenceRow<Cell>[],columnCount:number,housingScenario?:'off_campus'|'renting'|'with_family'){
 const byAspect=new Map(inputRows.map(row=>[row.aspect,row.cells]));
 const isCost=inputRows.some(row=>specs.some(([,aspect])=>aspect===row.aspect)&&row.cells.some(cell=>cell&&!cell.evidence));
 if(!isCost)return null;
 const rows=specs.flatMap(([id,aspect,label])=>{
  if(housingScenario&&['residence_hall_total','campus_apartment_total','off_campus_apartment_total','with_family_total'].includes(id)){
   if(housingScenario==='off_campus'||housingScenario==='renting'&&id!=='off_campus_apartment_total'||
    housingScenario==='with_family'&&id!=='with_family_total')return [];
  }
  const evidence=byAspect.get(aspect);
  const budget=byAspect.get('total_budget');
  if(!evidence&&!(budget&&['housing','tuition_fees'].includes(aspect)))return [];
  const cells=Array.from({length:columnCount},(_,index)=>{
   const structured=budget?.[index]?.budget;
   if(structured){
    const cell=budget![index]!;
    const compatible=!housingScenario||columnCount>1||housingScenario===structured.housing||housingScenario==='off_campus'&&['off_campus','renting','with_family'].includes(structured.housing);
    if(!compatible||cell.status==='unverified'||!cell.sources?.length)return null;
    const component=structured.components.find((entry:{key:string;role:string})=>entry.key===id&&entry.role==='component');
    let amount=id==='total_budget'?structured.total:component?.amount;
    if(id==='tuition_fees'&&amount==null){
     const system=structured.components.find((entry:{key:string;role:string})=>entry.key==='systemwide_fees'&&entry.role==='component');
     const campus=structured.components.find((entry:{key:string;role:string})=>entry.key==='campus_fees'&&entry.role==='component');
     if(system?.amount!=null&&campus?.amount!=null)amount=system.amount+campus.amount;
    }
    if(amount==null)return null;
    return {value:new Intl.NumberFormat('en-US',{style:'currency',currency:structured.currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(amount),evidence:cell,feeScheduleOnly:false,included:false};
   }
   const cell=evidence?.[index];
   const totalCell=budget?.[index];
   const parts=(cell?.answer.replace(/\s*\[\d+\]/gu,'')||'').split(breakdownMarker);
   const [answer,ownBreakdown]=parts;
   const selectedScenario=columnCount>1&&ownBreakdown?undefined:housingScenario;
   const bareSuffix=id==='direct_costs'||id==='other_expenses'||id==='housing'||id==='meals';
   const scope=answer+' '+cell?.scope;
   const apartment=appliesToHousing(scope,'renting')||/\boff[- ]campus.{0,5}(?:without|not with) (?:parents|family)\b/iu.test(scope);
   const family=/\b(?:relatives|living with family|con familiares)\b/iu.test(scope);
   const genericOutOfScope=id==='total_budget'&&selectedScenario&&(
    selectedScenario==='renting'&&(!apartment||labeledAmount(answer,rentedBudget))||
    selectedScenario==='with_family'&&(!family||labeledAmount(answer,familyBudget))||
    selectedScenario==='off_campus'&&(apartment||family||!/\b(?:off[- ]campus|fuera del campus)\b/iu.test(scope)));
   const genericOffCampus=id==='total_budget'&&selectedScenario==='off_campus'&&!genericOutOfScope?
    labeledAmount(answer,rentedBudget):null;
   const leadingBudget=id==='total_budget'&&ownBreakdown&&(cell?.status==='verified'||cell?.status==='partial'&&!!cell.sources?.length)&&[...answer.matchAll(amounts)].length===1?
    leadingBudgetAmount.exec(answer)?.[1]||annualBudgetAmount.exec(answer)?.[1]:null;
   const directValue=cell&&!genericOutOfScope&&(genericOffCampus||leadingBudget||breakdownAmount(answer,label,id===aspect,bareSuffix));
   // Line items travel with the same cited finding through comparisons and
   // cache reuse. A total in a different or ambiguous scenario cannot supply
   // this column's costs. Older free-form reports use the original row path.
   const [budgetAnswer,budgetBreakdown]=(totalCell?.answer||'').split(breakdownMarker);
   const budgetScope=budgetAnswer+' '+totalCell?.scope;
   const applicableBudget=appliesToHousing(budgetScope,columnCount===1?housingScenario:undefined);
   const component=aspect==='housing'||id==='tuition_fees';
   const ownValue=component&&appliesToHousing(scope,columnCount===1?housingScenario:undefined)?publishedComponent(ownBreakdown,label):null;
   const budgetValue=component&&applicableBudget?publishedComponent(budgetBreakdown,label):null;
   if(id==='tuition_fees'){
    const feeCell=byAspect.get('tuition_fees')?.[index];
    const schedule=tuitionFeeAmount(feeCell);
    const budgetFees=budgetValue||(applicableBudget?combinedPublishedFees(budgetBreakdown):null);
    const ownFees=ownValue||combinedPublishedFees(ownBreakdown);
    // One comparable row belongs to the COA budget. Exact billing subtotals
    // and constituent fees remain in the source details below the table.
    const value=budgetFees||ownFees||schedule;
    if(!value)return null;
    return {value,evidence:budgetFees?totalCell:ownFees?cell:feeCell,feeScheduleOnly:false,included:false,
     feeDetail:budgetFeeDetail(budgetFees||ownFees,schedule,(totalCell?.qualification||'')+' '+(feeCell?.qualification||''))};
   }
   const value=budgetValue||ownValue||directValue;
   if(!value)return null;
   const sourceCell=budgetValue?totalCell:cell;
   const billed=/\b(?:as direct university charges|included in direct university charges|(?:annual )?direct charges include|como cargos directos)\b/iu.test(answer);
   const totalAnswer=totalCell?.answer||'';
   const period=(answer+' '+cell?.scope).match(/\b20\d{2}\s*[–—-]\s*(?:20)?\d{2}\b/u)?.[0];
   const onCampus=/\b(?:residence[- ]halls?|on[- ]campus|residencias universitarias)\b/iu;
   const sameScenario=!!period&&(totalAnswer+' '+totalCell?.scope).includes(period)&&onCampus.test(answer+' '+cell?.scope)&&onCampus.test(totalAnswer);
   return {value,evidence:sourceCell,feeScheduleOnly:false,included:(id==='housing'||id==='meals')&&billed&&sameScenario&&!!labeledAmount(totalAnswer,direct,true)};
  });
  const expected=budget?.some(cell=>cell?.budget?.expectedCategories.includes(id));
  return cells.some(Boolean)||expected?[{id,aspect,cells}]:[];
 });
 // Align combined and separate source categories without inventing a split.
 if(rows.some(row=>row.id==='housing_and_food')&&byAspect.get('total_budget')?.every(cell=>cell?.budget)){
  const budgets=byAspect.get('total_budget');
  const combined=rows.find(row=>row.id==='housing_and_food')!;
  const cells=combined.cells.map((cell,index)=>{
   if(cell)return cell;
   const source=budgets?.[index],parts=source?.budget?.components;
   const housing=parts?.find(p=>p.key==='housing'&&p.role==='component'),food=parts?.find(p=>p.key==='food'&&p.role==='component');
   if(housing?.amount==null||food?.amount==null||!source||!rows.find(r=>r.id==='housing')?.cells[index]||!rows.find(r=>r.id==='food')?.cells[index])return null;
   return {value:new Intl.NumberFormat('en-US',{style:'currency',currency:source.budget!.currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(housing.amount+food.amount),evidence:source,feeScheduleOnly:false,included:false,derived:true};
  });
  return rows.filter(row=>!['housing','food'].includes(row.id)).map(row=>row.id==='housing_and_food'?{...row,cells}:row);
 }
 return rows;
}
