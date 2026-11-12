import {validatedResearchFindings} from './researchFindings.mjs';
import {sourceIsCurrent} from './researchSourceValidity.mjs';

const population=budget=>budget.population.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
 .replace(/\s*\/\s*ab540 eligible/gu,'').replace(/20\d{2}[-–](?:20)?\d{2}/gu,year=>
  year.replace('–','-').replace(/^(20\d{2})-20(\d{2})$/u,'$1-$2')===budget.year?'':year)
 .replace(/[^a-z0-9]+/gu,' ').trim();
const house=budget=>['renting','off_campus'].includes(budget.housing)?'off_campus':budget.housing;
const label=f=>f.subject.replace(/\s+—\s+(?:Renting off campus|Living with family|Published off-campus benchmark|Alquiler fuera del campus|Vivir con familiares|Referencia publicada fuera del campus).*$/u,'');
const cents=n=>Number.isFinite(n)?Math.round(n*100):null;
const tuition=b=>cents(b.components.find(c=>c.key==='tuition_fees'&&c.role==='component')?.amount);
const relation=difference=>difference<0?'lower':difference>0?'higher':'equal';

// Pure arithmetic over source amounts. This does not verify a source, infer a
// personal bill, or silently equate different living arrangements or cohorts.
export function costComparisonFacts(result,retained=[],now=Date.now()){
 const findings=report=>validatedResearchFindings(report).filter(f=>f.status!=='unverified'&&f.budget&&f.sourceIds.length&&
  f.sourceIds.every(id=>sourceIsCurrent((report.sources||[]).find((source,index)=>(source.id??index+1)===id),now)));
 const current=findings(result);
 const left=current[0];if(!left)return null;
 const b=left.budget,seen=new Set([left.subject]);
 const candidates=[...current.slice(1),...retained.flatMap(findings)].filter(f=>{
  if(f.status==='unverified'||!f.budget||!f.sourceIds.length||seen.has(f.subject))return false;
  const other=f.budget;
  if(other.year!==b.year||other.currency!==b.currency||other.period!==b.period||population(other)!==population(b)||house(other)!==house(b))return false;
  seen.add(f.subject);return true;
 }).slice(0,2);
 const peers=candidates.flatMap(f=>{
  const a=cents(b.total),other=cents(f.budget.total),fees=tuition(b),otherFees=tuition(f.budget);
  if(a===null||other===null)return [];
  return [{subject:label(f),housing:f.budget.housing,totalDifference:(a-other)/100,totalRelation:relation(a-other),
   ...(fees!==null&&otherFees!==null?{tuitionFeesDifference:(fees-otherFees)/100,tuitionFeesRelation:relation(fees-otherFees)}:{})}];
 });
 if(!peers.length)return null;
 return {subject:label(left),year:b.year,currency:b.currency,period:b.period,housing:b.housing,
  basis:'Published benchmarks; retain source caveats. Negative difference means this subject is lower; positive means higher.',peers};
}
