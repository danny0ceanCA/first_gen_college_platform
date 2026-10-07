import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {voiceSession} from './profile-voice.mjs';
import {financeResearchRequest} from './finance-research.mjs';
import {admissionsResearchRequest} from './admissions-research.mjs';
import {onboardingWelcome} from '../src/voiceWelcome.mjs';
import {spokenLanguageFromText} from '../src/voiceLanguage.mjs';
import {voiceResearchCache,wantsFreshLookup,voiceResearchBudget} from '../src/voiceResearchCache.mjs';
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function evaluationDefinitions(){return {catalog:JSON.parse(await readFile(new URL('../evals/cases.v1.json',import.meta.url),'utf8')),rubric:JSON.parse(await readFile(new URL('../evals/rubric.v1.json',import.meta.url),'utf8'))};}
export function contractCase(c){
 const checks=[];const check=(name,passed)=>checks.push({name,passed:!!passed});
 const input={mode:c.mode,language:c.language,role:'parent',profile:{name:'Synthetic Sofia',stage:'11th grade'},targetConfirmed:true,studentId:'synthetic-sofia',routeConversations:true,students:[{id:'synthetic-sofia',name:'Synthetic Sofia'},{id:'synthetic-mateo',name:'Synthetic Mateo'}],allowGuideHandoff:true};
 if(c.category==='ambiguous-target')input.targetConfirmed=false;
 if(c.category==='topic-transition')input.continuing=true;
 if(c.category==='student-switch')input.scopeRestart=true;
 if(c.category==='memory-correction')input.memory=[{date:'2026-10-01',mode:'planning',summary:'Synthetic old interest: engineering; user now corrects it.'}];
 const config=voiceSession(input,{}),text=config.instructions;
 check('language tool available',config.tools.some(t=>t.name==='set_conversation_language'));
 check('save claims require acknowledgement',text.includes('Never claim a summary was saved'));
 switch(c.category){
  case 'introduction':{const opening=onboardingWelcome(c.language);check('warm opening and orientation before details',opening.includes('Start with Hola')&&opening.includes('BEFORE asking for student details')&&opening.includes(c.language==='es'?'resúmenes':'summaries'));break;}
  case 'simple-explanation':check('budget is not a bill',/not necessarily a bill/.test(text));break;
  case 'language-switch':check('spoken preference changes before lookup',spokenLanguageFromText(c.prompt,'en')==='es'&&text.includes('before any scope, guide or lookup'));break;
  case 'key-term':check('English term does not change Spanish language',text.includes('continue the explanation in Spanish')&&spokenLanguageFromText('Work-study','es')==='es');break;
  case 'topic-transition':check('in-place continuity overrides greeting',text.includes('CONTINUING LIVE CONVERSATION')&&text.includes('overrides ALL')&&config.tools.some(t=>t.name==='switch_college_guide'));break;
  case 'ambiguous-target':check('unknown target has no private profile',!text.includes('11th grade')&&text.includes('never guess')&&config.tools.some(t=>t.name==='request_conversation_target'));break;
  case 'student-switch':check('confirmed target reconnection avoids greeting',text.includes('do not restart your introduction')&&text.includes('Do not combine students'));break;
  case 'memory-correction':check('memory is not current verified policy',text.includes('Saved summaries are not verified current policy')&&text.includes('Synthetic old interest'));break;
  case 'tool-failure':check('failed lookup cannot be repeated indefinitely',text.includes('Do not repeatedly retry an identical failed lookup'));break;
  case 'changing-policy':{
   const query={mode:'admissions',language:c.language,institution:'Synthetic college',question:c.prompt};const cache=voiceResearchCache(()=>0);
   cache.put(query,{sources:[{url:'https://admission.universityofcalifornia.edu/'}]});
   check('fresh check bypasses cache',wantsFreshLookup(c.prompt)&&cache.get({...query,forceRefresh:true})===undefined);
   const request=admissionsResearchRequest({}, {...query,institution:'UC'});check('exact cycle and evidence required',request.instructions.includes('never silently use a previous year')&&request.instructions.includes('actual agreement'));
   break;
  }
  default:throw new Error('Unknown evaluation category');
 }
 const budget=voiceResearchBudget();for(let i=0;i<8;i++)budget.take({mode:'planning',language:c.language,institution:'',question:`Synthetic ${i}`});
 check('bounded paid lookup attempts',!budget.take({mode:'planning',language:c.language,institution:'',question:'Synthetic ninth'}));
 return {id:c.id,language:c.language,category:c.category,critical:c.critical,configurationHash:hash(config),checks,passed:checks.every(x=>x.passed)};
}
export async function contractReport(){
 const {catalog,rubric}=await evaluationDefinitions();const cases=catalog.cases.map(contractCase);
 const sourceFiles=['profile-voice.mjs','research-quality.mjs','finance-research.mjs','admissions-research.mjs','education-planning.mjs','../src/voiceResearchCache.mjs','../src/ProfileVoice.tsx'];
 const sourceHash=hash(await Promise.all(sourceFiles.map(async file=>[file,await readFile(new URL(file,import.meta.url),'utf8')])));
 const requests=['en','es'].flatMap(language=>[financeResearchRequest({}, {language,question:'Synthetic cost query',institution:''}),admissionsResearchRequest({}, {language,question:'Synthetic application query',institution:''})]);
 return {formatVersion:1,kind:'offline-software-contracts',catalogVersion:catalog.version,catalogHash:hash(catalog),rubricVersion:rubric.version,rubricHash:hash(rubric),configurationHash:hash([cases.map(c=>c.configurationHash),requests]),sourceHash,generatedAt:new Date().toISOString(),evaluatedCaseIds:cases.map(c=>c.id).sort(),evaluator:{id:'origen-contract-runner-v1',type:'automatic-software-check'},sampleSize:cases.length,passed:cases.filter(c=>c.passed).length,failed:cases.filter(c=>!c.passed).map(c=>c.id),cases,modelResponsesEvaluated:0,latencyMs:null,costUSD:null,releaseReady:false,limitations:'Checks actual configuration and client helpers, not model behavior, speech quality, live sources, WebRTC latency or academic outcomes. Human-reviewed synthetic responses and measured costs are still required.'};
}
// Capture/review files must contain synthetic examples only. No production log import.
export function reviewResponses(catalog,rubric,capture){
 if(capture?.synthetic!==true||capture.catalogHash!==hash(catalog)||capture.rubricHash!==hash(rubric)||!Array.isArray(capture.responses))throw new Error('Synthetic capture with matching catalog and rubric hashes required');
 const known=new Map(catalog.cases.map(c=>[c.id,c]));const seen=new Set();const failures=[],missing=[],disagreements=[];let scores=[];const timings=[],costs=[];
 for(const response of capture.responses){
  const c=known.get(response.id);if(!c||seen.has(c.id))throw new Error('Unknown or duplicate capture case');seen.add(c.id);
  if(typeof response.text!=='string'||!response.text.trim()||response.text.length>20000||!response.configurationHash||!response.providerModel)throw new Error('Response text and model/configuration provenance required');
  const reviews=response.reviews?.filter(r=>r.type==='human'&&typeof r.evaluatorId==='string'&&r.evaluatorId.trim());
  if(!reviews?.length){missing.push(`${c.id}:human-review`);continue;}
  const identities=new Set();
  for(const r of reviews){if(identities.has(r.evaluatorId))throw new Error('Duplicate human evaluator');identities.add(r.evaluatorId);for(const dimension of rubric.dimensions){const score=r.scores?.[dimension];if(![0,1,2].includes(score))throw new Error('Every rubric dimension needs a valid score');if(score===0||(['privacy','attribution'].includes(dimension)&&score<2)||(c.critical&&score<rubric.thresholds.minimumCriticalScore))failures.push(`${c.id}:${dimension}`);}}
  for(const dimension of rubric.dimensions){scores.push(Math.min(...reviews.map(r=>r.scores[dimension])));if(new Set(reviews.map(r=>r.scores[dimension])).size>1)disagreements.push(`${c.id}:${dimension}`);}
  if(!Number.isInteger(response.researchCalls)||response.researchCalls<0)missing.push(`${c.id}:research-call-count`);else if(response.researchCalls>rubric.thresholds.maxResearchCallsPerConnection)failures.push(`${c.id}:research-budget`);
  if(!Array.isArray(response.sources)||!Array.isArray(response.toolTrace))missing.push(`${c.id}:source-tool-evidence`);
  if(Number.isFinite(response.firstAudioMs)&&response.firstAudioMs>=0)timings.push(response.firstAudioMs);else missing.push(`${c.id}:first-audio-timing`);
  if(Number.isFinite(response.costUSD)&&response.costUSD>=0&&response.usage&&typeof response.usage==='object'&&Object.values(response.usage).length>0&&Object.values(response.usage).every(v=>Number.isFinite(v)&&v>=0)&&typeof response.pricingAsOf==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(response.pricingAsOf))costs.push(response.costUSD);else missing.push(`${c.id}:cost-usage-pricing`);
 }
 for(const id of known.keys())if(!seen.has(id))missing.push(`${id}:response`);
 const mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
 timings.sort((a,b)=>a-b);const p95=timings.length?timings[Math.ceil(timings.length*.95)-1]:null;
 const budget=capture.costBudgetUSD;const totalCost=costs.length?costs.reduce((a,b)=>a+b,0):null;
 if(!Number.isFinite(budget)||budget<0)missing.push('adopted-cost-budget');
 if(mean!==null&&mean<rubric.thresholds.minimumMean)failures.push('mean-score');
 if(p95!==null&&p95>rubric.thresholds.maxP95FirstAudioMs)failures.push('p95-first-audio');
 if(totalCost!==null&&Number.isFinite(budget)&&totalCost>budget)failures.push('cost-budget');
 return {kind:'human-reviewed-synthetic-responses',catalogHash:hash(catalog),rubricHash:hash(rubric),sampleSize:seen.size,evaluatedCaseIds:[...seen].sort(),configurationHash:hash(capture.responses.map(r=>[r.id,r.configurationHash,r.providerModel]).sort((a,b)=>a[0].localeCompare(b[0]))),evaluators:[...new Set(capture.responses.flatMap(r=>(r.reviews||[]).map(review=>review.evaluatorId).filter(Boolean)))],meanScore:mean,p95FirstAudioMs:p95,totalCostUSD:totalCost,failures,missingEvidence:missing,disagreements,technicalGatePassed:!failures.length&&!missing.length&&!disagreements.length,releaseReady:false,limitations:'Release approval remains a separate named human decision. Self-supplied ratings/pricing require review; this runner does not verify provider receipts or infer student learning.'};
}
export function compareReports(baseline,candidate){
 if(baseline.kind!==candidate.kind||baseline.catalogHash!==candidate.catalogHash||baseline.rubricHash!==candidate.rubricHash||baseline.sampleSize!==candidate.sampleSize||hash(baseline.evaluatedCaseIds)!==hash(candidate.evaluatedCaseIds))throw new Error('Compare the same evaluation kind, cases, rubric and sample size');
 return {kind:baseline.kind,sampleSize:baseline.sampleSize,configurationChanged:baseline.configurationHash!==candidate.configurationHash,sourceChanged:baseline.sourceHash!==candidate.sourceHash,baselineFailures:baseline.failed??baseline.failures,candidateFailures:candidate.failed??candidate.failures,releaseReady:false,limitations:'A contract comparison is not evidence of model-response improvement. Human response comparisons must retain identical case coverage.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command='contracts',...paths]=process.argv.slice(2);let result;
 if(command==='contracts')result=await contractReport();
 else if(command==='review'){const {catalog,rubric}=await evaluationDefinitions();result=reviewResponses(catalog,rubric,JSON.parse(await readFile(paths[0],'utf8')));}
 else if(command==='compare')result=compareReports(...await Promise.all(paths.map(async path=>JSON.parse(await readFile(path,'utf8')))));
 else throw new Error('Use contracts, review <capture.json>, or compare <baseline.json> <candidate.json>');
 console.log(JSON.stringify(result,null,2));if(result.failed?.length||result.technicalGatePassed===false)process.exitCode=1;
}
