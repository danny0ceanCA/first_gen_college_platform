import {researchBriefSelection} from '../src/researchBrief.mjs';
import {researchSubjectIdentity} from '../src/researchFindings.mjs';

const campuses={
 'uc berkeley':{name:'UC Berkeley',alias:/\bberkeley\b/u,url:'https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/'},
 'uc davis':{name:'UC Davis',alias:/\bdavis\b/u,url:'https://financialaid.ucdavis.edu/undergraduate/cost/2627-entering'},
};
const fold=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const family=/\b(?:liv(?:e|es|ed|ing) (?:at home|with (?:(?:his|her|their|the) )?(?:family|parents|relatives))|viv(?:e|a|ir|iria|iendo) (?:en casa|con (?:(?:su|la|sus) )?(?:familia|padres|familiares))|living.with.family|commuter.{0,25}with parents)\b/u;
const dorm=/\b(?:residence hall|dorm(?:itory)?|residencia universitaria|residencia estudiantil)\b/u;
const newStudent=/\b(?:new |entering |first year |newly entering |ingreso|nuevos? |nuevas? )\b/u;
const resident=/\b(?:california.resident|residents? of california|residentes? de california)\b/u;
const undergraduate=/\b(?:undergraduates?|pregrado|licenciatura)\b/u;
const beforeAid=/\b(?:before (?:financial )?aid|antes de (?:la )?ayuda(?: financiera)?)\b/u;
const notBill=/\b(?:not (?:a |the |an individual |a personal )?bill|no (?:es |constituye )?(?:una )?factura)\b/u;
const near=/\b(?:closer to (?:our |the |his |her )?family|mas cerca de (?:nosotros|nuestra familia|la familia))\b/u;
const far=/\b(?:farther from (?:our |the |his |her )?family|mas lejos de (?:nosotros|nuestra familia|la familia))\b/u;
const byYear=text=>[...new Set([...text.matchAll(/\b(20\d{2})\s*[-–—]\s*(?:20)?(\d{2})\b/gu)].map(m=>m[1]+'–'+m[2]))];
function samePage(value,expected){
 try{
  const a=new URL(value),b=new URL(expected);
  return a.protocol==='https:'&&a.host===b.host&&a.pathname.replace(/\/$/u,'')===b.pathname.replace(/\/$/u,'');
 }catch{return false;}
}

export const comparisonUpdateTool={
 type:'function',name:'update_saved_comparison',
 description:'For a caller changing one campus from a residence hall to living with family in a completed UC Berkeley versus UC Davis budget comparison, use this instead of another broad lookup. Copy the retained report ID and revision. The tool checks the caller’s actual words and asks if unclear. An accepted receipt includes the unchanged figure; speak that useful figure with its caveat while the changed campus is checked in the background. Results arrive separately.',
 parameters:{type:'object',additionalProperties:false,properties:{jobId:{type:'string'},revision:{type:'integer',minimum:1}},required:['jobId','revision']},
};

export function comparisonFindings(result){
 const brief=researchBriefSelection(result);
 const budgets=brief.findings?.filter(f=>f.status==='verified'&&f.aspect==='total_budget')||[];
 if(budgets.length!==2)return null;
 const entries=budgets.map(f=>{
  const id=researchSubjectIdentity(f.subject),text=fold(f.subject+' '+f.answer+' '+f.qualification),years=byYear(text);
  if(!Object.hasOwn(campuses,id)||years.length!==1||!dorm.test(text)||family.test(text)||!resident.test(text)||
     !undergraduate.test(text)||!newStudent.test(text)||!beforeAid.test(text)||!notBill.test(text)||
     /\b(?:nonresident|non.resident|continuing|graduate only)\b/u.test(text))return null;
  const sources=brief.sources.map((source,index)=>({...source,id:source.id??index+1})).filter(source=>f.sourceIds.includes(source.id)&&samePage(source.url,campuses[id].url));
  return sources.length?{id,name:campuses[id].name,year:years[0],answer:f.answer,qualification:f.qualification,sources}:null;
 });
 if(entries.some(item=>!item)||entries[0].id===entries[1].id||entries[0].year!==entries[1].year)return null;
 return entries;
}

export function comparisonClue(current,earlier=[]){
 const text=fold(current);
 // Reject mixed or changed scope rather than narrowing a compound question.
 if(!family.test(text)||/\b(?:not|no|except|sino|nonresident|non.resident|out.of.state|graduate|posgrado|20\d{2})\b/u.test(text))return null;
 const named=Object.entries(campuses).filter(([,c])=>c.alias.test(text));
 if(named.length===1&&!near.test(text)&&!far.test(text))return {id:named[0][0],reference:'named campus'};
 if(named.length||near.test(text)===far.test(text))return null;
 const relation=near.test(text)?'closer':'farther',mapped=new Set();
 for(const prior of earlier){
  for(const part of fold(prior).match(/[^.!?;]+[.!?;]?/gu)||[]){
   const sentence=part.trim();
   if(sentence.endsWith('?')||/\b(?:not|no|except|sino|maybe|perhaps|quizas|tal vez)\b/u.test(sentence)||
      !/^(?:uc )?(?:berkeley|davis)\s+(?:is|would be|esta|queda|nos queda)\s+/u.test(sentence)||near.test(sentence)===far.test(sentence))continue;
   const matching=Object.entries(campuses).filter(([,c])=>c.alias.test(sentence));
   if(matching.length!==1)continue;
   const same=near.test(sentence)===(relation==='closer');
   mapped.add(same?matching[0][0]:Object.keys(campuses).find(id=>id!==matching[0][0]));
  }
 }
 return mapped.size===1?{id:[...mapped][0],reference:relation}:null;
}

export function comparisonLookup(entries,changed,language){
 const changedFinding=entries.find(f=>f.id===changed);
 const retained=entries.find(f=>f.id!==changed);
 if(!changedFinding||!retained)return null;
 const {year,name}=changedFinding;
 // Only the published cohorts exercised by the comparison integration.
 if(year!=='2026–27')return null;
 const question=language==='es'
  ? 'Verifica solo el costo total anual de asistencia '+year+' antes de ayuda para estudiantes nuevos de pregrado residentes de California en '+name+' que viven con su familia. Da el presupuesto de esa categoría, no una factura ni un estimado personal.'
  : 'Verify only the '+year+' annual total cost of attendance before aid for new California-resident undergraduates at '+name+' who live with family. Return the published budget for that category, not a bill or personal estimate.';
 return {retained,institution:name,question,officialUrl:campuses[changed].url};
}

export function comparisonResearchSource(input){
 const entry=Object.values(campuses).find(c=>c.name===input.institution&&c.url===input.comparisonOfficialUrl);
 return entry||null;
}

export function parseComparisonResearch(data,input,now){
 const entry=comparisonResearchSource(input),output=data?.output||[];
 if(!entry||data?.status!=='completed')return null;
 const opens=output.filter(item=>item.type==='web_search_call');
 if(opens.length!==1||opens[0].status!=='completed'||opens[0].action?.type!=='open_page'||!samePage(opens[0].action.url,entry.url))return null;
 const parts=output.flatMap(item=>item.type==='message'?item.content||[]:[]).filter(part=>part.type==='output_text');
 if(parts.length!==1)return null;
 let value;try{value=JSON.parse(parts[0].text);}catch{return null;}
 if(!value||Object.keys(value).length!==2||value.scope!=='2026-27-entering-ca-resident-living-with-family'||!Number.isSafeInteger(value.budget)||value.budget<15000||value.budget>100000)return null;
 const checkedAt=new Date(now()).toISOString(),es=input.language==='es',amount=value.budget.toLocaleString(es?'es-US':'en-US');
 const answer=es?entry.name+' viviendo con familia: presupuesto anual de USD '+amount+' [1].':entry.name+' living with family: annual cost-of-attendance budget of $'+amount+' [1].';
 const qualification=es?'Estimado 2026–27 para estudiantes nuevos de pregrado residentes de California, antes de ayuda financiera. No es una factura [1].':'2026–27 estimate for new California-resident undergraduates before financial aid. This is not a bill [1].';
 const finding={subject:entry.name,aspect:'total_budget',status:'verified',answer,qualification};
 const text=answer+'\n'+qualification;
 return {text,parts:[{text}],sources:[{title:entry.name+' cost of attendance',url:entry.url,checkedAt}],checkedAt,
  voiceBrief:{status:'verified',answer,qualification,nextStep:'',findings:[finding]}};
}

export async function selectComparisonCampus(client,entries,clue){
 const options=entries.map(f=>({id:f.id,name:f.name,...(clue.reference==='named campus'?{}:{
  relation:f.id===clue.id?clue.reference:clue.reference==='closer'?'farther':'closer',
 })}));
 const result=await client.evaluate({model:'gpt-6-luna',input:JSON.stringify({
  options,
  reference:clue.reference,
  // Only public campus identities and a normalized directional clue leave the application.
  ...(clue.reference==='named campus'?{namedCampus:entries.find(f=>f.id===clue.id)?.name}:{}),
 }),questions:[{type:'choice',name:'comparison_update',instructions:'Match the caller reference to one campus using its stated name or its relation to the family. Change only that campus to living with family. Choose unclear if the evidence does not identify one campus.',choices:[...entries.map(f=>({value:f.id,description:'Change '+f.name+' to living with family.'})),{value:'unclear',description:'No uniquely supported campus.'}]}]});
 const answer=result.response.answers?.[0];
 const confidence=answer?.probabilities?.find(p=>p.value===answer.choice)?.probability;
 return answer?.type==='choice'&&answer.name==='comparison_update'&&answer.choice===clue.id&&confidence>=0.65?answer.choice:null;
}
