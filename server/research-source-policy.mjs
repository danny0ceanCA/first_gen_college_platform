// Public research authority policy, shared across educational topics. Search
// results remain untrusted evidence: a domain is an eligibility check for a
// citation, not proof that the cited page supports the requested claim.
const authorities=['studentaid.gov','universityofcalifornia.edu','calstate.edu','commonapp.org','commonapp.my.site.com','cccapply.org','opencccapply.net','assist.org','ucop.edu','cccco.edu'];
export function researchSourceAllowed(value,{federalOnly=false}={}){
 try{
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
  if(federalOnly)return host==='studentaid.gov'||host.endsWith('.studentaid.gov');
  return host.endsWith('.edu')||host.endsWith('.gov')||authorities.some(domain=>host===domain||host.endsWith('.'+domain));
 }catch{return false;}
}
export function researchSourcePolicy(input={}){
 const question=String(input.question||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const federalOnly=!input.institution&&['finance','loans'].includes(input.mode)&&
  /\b(?:fafsa|federal|pell|fsa|direct loans?|prestamos? directos?|subsidized|unsubsidized|subsidiados?)\b/u.test(question)&&
  !/\b(?:state|estatal|cal grant|dream act|scholarships?|becas? privadas?|campus|university|college|universidad)\b/u.test(question);
 const topic=/\b(?:scholarships?|becas?)\b/u.test(question)?'scholarships':
  /\b(?:housing|vivienda|alojamiento|rent|alquiler)\b/u.test(question)?'housing':
  /\b(?:career|employment|internship|trabajo|empleo|carrera profesional)\b/u.test(question)?'careers':
  /\b(?:support|counsel|advis|orientation|orientacion|apoyo|asesor)\b/u.test(question)?'student_support':
  /\b(?:program|major|degree|programa|licenciatura|maestria|doctorado)\b/u.test(question)?'programs':'general';
 return {federalOnly,topic,tool:{type:'web_search',...(federalOnly?{filters:{allowed_domains:['studentaid.gov']}}:{})}};
}
export const broadResearchSourceInstructions=`
# Responsible source and narrow research
Research the caller's actual educational question across topics, not an application checklist by default. Use the organization or office responsible for the requested fact: the named campus office for campus policy or student support; the specific department and catalog for a program; the scholarship administrator for award rules; Federal Student Aid for federal aid; the responsible state or federal agency for public programs, licensing or employment rules. A campus homepage, search snippet or a different institution's rule does not establish the requested fact. Open the actual authoritative page, current official PDF or policy document. Cite each supported fact. Approved public sources are official .edu or .gov sites and the established official application/transfer systems; do not substitute a blog, commercial aggregator or a caller-supplied URL as an authority. If the responsible source cannot be established, preserve that limitation rather than guessing. Ask only for information necessary to distinguish materially different answers.
Start with the narrow requested facts and reuse supplied current evidence. State the actual source cycle, population, program, location, units and material conditions; an unknown date or eligibility condition stays unknown. An earlier-year cost benchmark can be labeled as a benchmark; never turn an old deadline, closed opportunity or obsolete eligibility rule into a current answer. Keep verified portions useful even when another source fails. Provider completion, page access and completeness of the requested answer are separate outcomes. Report a source conflict explicitly; do not silently choose the more convenient figure. Do not add a new model pass to rewrite facts for speech.`;

const ids=text=>[...String(text||'').matchAll(/\[(\d+)\]/gu)].map(match=>Number(match[1]));
// Preserve independent, cited findings when one returned source is ineligible.
// Unstructured prose cannot be safely separated by claim, so it still fails
// closed. A mixed-source finding is withheld as a whole, never partially quoted.
export function isolateResearchSources(result,policy={}){
 if(!result)return null;
 const allowed=new Set(result.sources.flatMap((source,index)=>researchSourceAllowed(source.url,policy)?[source.id??index+1]:[]));
 if(allowed.size===result.sources.length)return result;
 let value;try{value=JSON.parse(result.text);}catch{return null;}
 if(!Array.isArray(value?.brief?.findings)||!value.brief.findings.length)return null;
 const mappings=new Map(),sources=[];
 for(const [index,source] of result.sources.entries())if(allowed.has(source.id??index+1)){
  const next=sources.length+1;mappings.set(source.id??index+1,next);sources.push({...source,...(source.id!==undefined?{id:next}:{})});
 }
 const remap=text=>String(text||'').replace(/\[(\d+)\]/gu,(_,n)=>mappings.has(Number(n))?`[${mappings.get(Number(n))}]`:'');
 const remapValue=value=>Array.isArray(value)?value.map(remapValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,remapValue(v)])):typeof value==='string'?remap(value):value;
 let retained=0,withheld=0;
 const findings=value.brief.findings.map(finding=>{
  const cited=ids(JSON.stringify(finding));
  if(cited.length&&cited.every(id=>allowed.has(id))){retained++;return remapValue(finding);}
  if(finding.status==='unverified'&&!cited.length)return finding;
  withheld++;
  return {subject:finding.subject,aspect:finding.aspect,status:'unverified',answer:policy.language==='es'?'No se pudo verificar el dato solicitado en fuentes oficiales admitidas.':'The requested fact could not be verified from eligible official sources.',qualification:policy.language==='es'?'Una fuente obtenida no era una autoridad admitida para esta consulta.':'A returned source was not an eligible authority for this check.',budget:null,evidence:null};
 });
 if(!retained)return null;
 const lead=findings.find(finding=>finding.status!=='unverified')||findings[0];
 const report=findings.map(finding=>finding.answer+' '+finding.qualification).join('\n');
 const brief={...value.brief,status:findings.every(finding=>finding.status==='verified')?'verified':'partial',answer:lead.answer,qualification:lead.qualification,nextStep:'',findings};
 const text=JSON.stringify({...value,brief,report});
 return {...result,text,parts:[{text}],sources,sourceValidation:{retainedFindings:retained,withheldFindings:withheld}};
}
