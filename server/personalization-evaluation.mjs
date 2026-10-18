import {readFile} from 'node:fs/promises';
import {createHistoryRepository} from './history.mjs';
import {voiceSession} from './profile-voice.mjs';
import {fixture} from './family-fixture.mjs';
import {hash} from './model-evaluation.mjs';
import {personalizationCatalog} from '../evals/personalization.cases.v1.mjs';

export function assessSelection(c,items){
 const selectedIds=items.map(item=>item.id);
 return {
  selectedIds,
  missingRequiredIds:c.requiredIds.filter(id=>!selectedIds.includes(id)),
  forbiddenSelectedIds:c.forbiddenIds.filter(id=>selectedIds.includes(id)),
  unexpectedScopeIds:items.filter(item=>item.studentId!==c.studentId).map(item=>item.id),
 };
}

export async function personalizationBaseline(catalog=personalizationCatalog){
 if(catalog.synthetic!==true||!catalog.cases?.length||new Set(catalog.cases.map(c=>c.id)).size!==catalog.cases.length)throw new Error('Unique synthetic cases required');
 const results=[];
 for(const c of catalog.cases){
  const {pool,run}=await fixture();
  const history=createHistoryRepository(pool),subject='synthetic-personalization';
  try{
   for(const id of ['alex','sam'])await run(subject,{action:'save-student',student:{id,name:id==='alex'?'Alex':'Sam',stage:'Community college',interest:'',gpa:'',color:'peach'}});
   await run('synthetic-other-account',{action:'save-student',student:{id:'alex',name:'Other Alex',stage:'Community college',interest:'',gpa:'',color:'peach'}});
   const base={studentId:'alex',mode:'planning',date:'2026-11-01T00:00:00Z',sources:[]};
   await history('synthetic-other-account',{action:'save',item:{...base,id:'foreign-memory',summary:'PRIVATE SYNTHETIC OTHER ACCOUNT: a different goal.'}});
   await history(subject,{action:'save',item:{...base,id:'family-memory',studentId:null,summary:'PRIVATE SYNTHETIC FAMILY: a family-only question.'}});
   for(const item of c.memories)await history(subject,{action:'save',item});
   for(const id of c.deleteIds)await history(subject,{action:'delete',id});
   const {items}=await history(subject,{action:'context',studentId:c.studentId,mode:c.mode});
   const config=voiceSession({role:'student',language:c.language,mode:c.mode,profile:{name:'Alex'},memory:items},{});
   const selection=assessSelection(c,items);
   results.push({id:c.id,category:c.category,language:c.language,critical:c.critical,...selection,
    requiredEvidenceAvailable:selection.missingRequiredIds.length===0,
    boundaryPassed:selection.forbiddenSelectedIds.length===0&&selection.unexpectedScopeIds.length===0&&!config.instructions.includes('PRIVATE SYNTHETIC'),
    promptCharacters:config.instructions.length,
    expectedBehavior:c.expectedBehavior,
    liveResponseReview:'not-run',repeatQuestions:null,firstAudioMs:null,retrievalLatencyMs:null,providerCostUSD:null,
   });
  }finally{await pool.end();}
 }
 const sourcePaths=['server/history.mjs','src/voiceMemory.mjs','server/profile-voice.mjs'];
 const sources=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,hash(await readFile(new URL('../'+p,import.meta.url),'utf8'))])));
 const answerable=results.filter(r=>catalog.cases.find(c=>c.id===r.id).requiredIds.length>0);
 return {
  schemaVersion:1,kind:'synthetic-memory-selection-baseline',synthetic:true,catalogHash:hash(catalog),sourceHashes:sources,
  sampleSize:results.length,answerableCases:answerable.length,
  casesWithRequiredEvidence:answerable.filter(r=>r.requiredEvidenceAvailable).length,
  boundaryFailures:results.filter(r=>!r.boundaryPassed).map(r=>r.id),
  liveResponsesEvaluated:0,results,
  limitations:'Actual history repository and prompt construction with isolated pg-mem fixtures. Covers summary selection only, not all workspace/profile context. No provider calls, speech, current-source verification, or semantic answer scoring. Null timings/costs are unmeasured. Required-source coverage does not establish that the model used it correctly. Later phases must rerun the same cases against their integrated context path.',
 };
}
