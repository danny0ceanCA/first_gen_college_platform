import {validatedResearchFindings,researchSubjectIdentity} from '../../src/researchFindings.mjs';
import {researchRecordFinding} from '../../src/researchRecord.mjs';
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/gu,' ').trim();
const identity=(finding,fact)=>JSON.stringify([researchSubjectIdentity(finding.subject),finding.evidence.topic,finding.evidence.scope,fact.key,fact.kind]);
const valueKey=fact=>JSON.stringify(['value','amount','upperAmount','bound','currency','unit','date','time','timeZone','order'].map(k=>typeof fact[k]==='string'?normalize(fact[k]):fact[k]));

// A call-scoped evidence ledger, not a source database or student memory store.
// Never overwrite the primary report to make an optional result look complete.
export function createSupplementStore(){
 const records=new Map();let revision=0;
 return {
  revision:()=>revision,
  put(key,result){records.set(key,result);if(records.size>16)records.delete(records.keys().next().value);},
  records:()=>[...records.values()],
  evaluate(result,{language='en',excludeKey}={}){
   const known=[...records].filter(([key])=>key!==excludeKey).flatMap(([,r])=>validatedResearchFindings(r).flatMap(f=>f.evidence?f.evidence.facts.filter(x=>x.status==='verified').map(fact=>({finding:f,fact})):[]));
   const findings=[];let duplicates=0,conflicts=0,unverified=0,alternatives=0;
   for(const f of validatedResearchFindings(result)){
    if(!f.evidence)continue;
    const facts=[];
    for(const fact of f.evidence.facts){
     if(fact.status!=='verified'){unverified++;continue;}
     const old=known.filter(k=>identity(k.finding,k.fact)===identity(f,fact));
     if(old.some(k=>valueKey(k.fact)===valueKey(fact)&&normalize(k.fact.qualification)===normalize(fact.qualification))){duplicates++;continue;}
     if(old.length){
      // Typed numeric/date contradictions are conflicts; prose differences
      // are ambiguous variants, not permission to replace a verified fact.
      if(old.some(k=>valueKey(k.fact)!==valueKey(fact))){if(['amount','number','date'].includes(fact.kind))conflicts++;else alternatives++;continue;}
     }
     facts.push(fact);
    }
    if(!facts.length)continue;
    const evidence={...f.evidence,facts,expectedFacts:facts.map(x=>x.key),complete:true};
    const normalized=researchRecordFinding(evidence,f.qualification,language);
    findings.push({...f,evidence,status:'verified',answer:normalized.answer,qualification:normalized.qualification});
   }
   if(!findings.length)return {accepted:false,reason:conflicts?'conflict':alternatives?'ambiguous_variant':duplicates?'already_known':'no_new_verified_fact',duplicates,conflicts,unverified,alternatives};
   const first=findings[0];
   return {accepted:true,reason:'new_verified_information',duplicates,conflicts,unverified,alternatives,
    result:{...result,supplementalDelta:true,voiceBrief:{...result.voiceBrief,status:'verified',answer:first.answer,qualification:first.qualification,nextStep:'',findings},text:findings.map(f=>f.answer+' '+f.qualification).join('\n')}};
  },
  invalidate(){revision++;records.clear();},
 };
}
