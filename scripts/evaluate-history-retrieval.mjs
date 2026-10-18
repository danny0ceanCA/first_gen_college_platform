import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {historyRetrievalCatalog} from '../evals/history-retrieval.cases.v1.mjs';
import {personalizationCatalog} from '../evals/personalization.cases.v1.mjs';
import {retrievalFixture} from '../server/history-retrieval-fixture.mjs';
import {RETRIEVAL_VERSION} from '../server/history-retrieval.mjs';
import {createProfileVoiceHandler} from '../server/profile-voice.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const output=process.argv.includes('--output')?process.argv[process.argv.indexOf('--output')+1]:'output/history-retrieval-evaluation.json';
if(!output)throw Error('--output requires a path');
const f=await retrievalFixture(),ids=new Map(),results=[];
async function comparePhaseOne(){
 const baseline=JSON.parse(await readFile(new URL('../evals/personalization.baseline.v1.json',import.meta.url),'utf8'));
 const cases=[];
 for(const c of personalizationCatalog.cases){
  const studentId=`baseline-${c.id}`,sibling=`${studentId}-sibling`,id=original=>`${studentId}-${original}`;
  for(const target of [studentId,sibling])await f.family('reader',{action:'save-student',student:{id:target,name:'Synthetic Alex',stage:'Community college',interest:'',gpa:'',color:'peach',goals:'',needs:''}});
  for(const item of c.memories)await f.save(id(item.id),item.summary,{studentId:item.studentId==='alex'?studentId:sibling,mode:item.mode,date:item.date});
  for(const deleted of c.deleteIds)await f.history({action:'delete',id:id(deleted)});
  let prompt='',status;
  const handler=createProfileVoiceHandler({ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(url,options)=>{prompt=JSON.parse(options.body.get('session')).instructions;return new Response('v=0\r\n');},()=>{},f.db);
  const req=Readable.from([JSON.stringify({sdp:'v=0\r\n',language:c.language,role:'parent',mode:c.mode,routeConversations:true,targetConfirmed:true,studentId,continuity:[{role:'user',text:c.prompt}]})]);
  Object.assign(req,{url:'/api/profile-voice',method:'POST',headers:{'content-type':'application/json',host:'localhost'},origenAuthorized:true,origenIdentity:{sub:'reader'}});
  await f.as('reader',()=>handler(req,{writeHead:s=>{status=s;},end:()=>{}},()=>{}));
  const present=original=>{const source=c.memories.find(m=>m.id===original);return source&&prompt.includes(JSON.stringify(source.summary).slice(1,-1));};
  cases.push({id:c.id,language:c.language,voiceStatus:status,answerable:c.requiredIds.length>0,missingRequiredIds:c.requiredIds.filter(original=>!present(original)),boundaryPassed:status===200&&!c.forbiddenIds.some(present)&&!prompt.includes('PRIVATE SYNTHETIC')});
 }
 return {path:'Actual profile-voice handler with real PostgreSQL; provider negotiation mocked, current query supplied as same-conversation continuity.',baselineRequiredEvidence:baseline.casesWithRequiredEvidence,baselineCatalogHash:baseline.catalogHash,answerableCases:cases.filter(c=>c.answerable).length,requiredEvidenceAvailable:cases.filter(c=>c.answerable&&c.missingRequiredIds.length===0).length,boundaryFailures:cases.filter(c=>!c.boundaryPassed).map(c=>c.id),cases};
}
try{
 for(const c of historyRetrievalCatalog.cases){
  if(!c.kind)continue;
  const id=c.kind==='summary'?c.id:randomUUID();ids.set(c.id,id);
  if(c.kind==='summary')await f.save(id,c.content);
  if(c.kind==='note')await f.note({action:'create',id,studentId:'alex',note:{topic:'transfer',kind:'question',content:c.content,language:c.language}});
  if(c.kind==='memory')await f.memory({action:'create',id,studentId:'alex',memory:{category:'preference',content:c.content,language:c.language,speaker:'parent'}});
 }
 for(let i=0;i<36;i++)await f.save(`recent-distractor-${i}`,'We discussed a general introduction to the campus. Hablamos de una introducción general al campus.',{date:new Date(Date.UTC(2026,0,i+1)).toISOString()});
 for(const c of historyRetrievalCatalog.cases.filter(c=>c.kind)){
  await f.save(`other-${c.id}`,c.content,{sub:'other'});
  await f.save(`sibling-${c.id}`,c.content,{studentId:'sam'});
  await f.save(`family-${c.id}`,c.content,{studentId:null});
 }
 for(const c of historyRetrievalCatalog.cases){
  const start=performance.now(),result=await f.retrieve(c.query),latencyMs=performance.now()-start;
  const rank=result.items.findIndex(item=>item.id===ids.get(c.id));
  results.push({id:c.id,language:c.language,answerable:!!c.kind,sourceKind:c.kind,available:result.available,
   expectedSourceRank:rank<0?null:rank+1,topFiveHit:c.kind?rank>=0:null,noRelevantPassed:c.kind?null:result.items.length===0,
   boundaryPassed:result.items.every(item=>item.studentId==='alex'&&!/^(other|sibling|family)-/.test(item.id)),
   selectedCaseIds:result.items.map(item=>[...ids].find(([,id])=>id===item.id)?.[0]||item.id),latencyMs:Number(latencyMs.toFixed(2))});
 }
 const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
 const group=language=>{const rows=results.filter(r=>r.language===language),answerable=rows.filter(r=>r.answerable),none=rows.filter(r=>!r.answerable);return {answerable:answerable.length,hits:answerable.filter(r=>r.topFiveHit).length,recallAtFive:answerable.filter(r=>r.topFiveHit).length/answerable.length,noRelevant:none.length,noRelevantPassed:none.filter(r=>r.noRelevantPassed).length};};
 const answerable=results.filter(r=>r.answerable),recall=answerable.filter(r=>r.topFiveHit).length/answerable.length;
 const phaseOneComparison=await comparePhaseOne();
 const report={schemaVersion:1,kind:'synthetic-historical-retrieval',method:RETRIEVAL_VERSION,generatedAt:new Date().toISOString(),catalogHash:hash(JSON.stringify(historyRetrievalCatalog)),
  sourceHashes:Object.fromEntries(await Promise.all(['server/history-retrieval.mjs','server/migrations/045_historical_retrieval.sql'].map(async p=>[p,hash(await readFile(new URL('../'+p,import.meta.url)))]))),
  cases:results.length,answerable:answerable.length,recallAtFive:recall,target:0.90,targetMet:recall>=0.90,
  languages:{en:group('en'),es:group('es')},boundaryFailures:results.filter(r=>!r.boundaryPassed).map(r=>r.id),
  retrievalLatencyMs:{p50:percentile(results.map(r=>r.latencyMs),0.50),p95:percentile(results.map(r=>r.latencyMs),0.95)},
  embeddingCalls:0,embeddingTokens:0,embeddingCostUSD:0,liveResponsesEvaluated:0,phaseOneComparison,results,
  limitations:'Actual isolated PostgreSQL 17, restricted runtime role, sequential synthetic queries. Latency includes pool acquisition and scoped transaction, excludes fixture setup and live audio; not production latency. Keyword fallback only, no embeddings or vector similarity. Zero embedding cost means no embedding calls, not free model inference. Recall measures source selection, not answer correctness. No live provider calls. Phase 1 baseline is preserved; the matched comparison checks source text reaching the current voice prompt.'};
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 process.stdout.write(JSON.stringify({output,cases:report.cases,recallAtFive:recall,targetMet:report.targetMet,languages:report.languages,boundaryFailures:report.boundaryFailures,latency:report.retrievalLatencyMs})+'\n');
 if(report.boundaryFailures.length||phaseOneComparison.boundaryFailures.length||!report.targetMet||results.some(r=>r.noRelevantPassed===false||!r.available))process.exitCode=1;
}finally{await f.close();}
