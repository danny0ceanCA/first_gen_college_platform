import test from 'node:test';
import assert from 'node:assert/strict';
import {assessSelection,personalizationBaseline} from './personalization-evaluation.mjs';
import {personalizationCatalog} from '../evals/personalization.cases.v1.mjs';

test('personalization evidence checks detect missing sources and forbidden or wrong-student records',()=>{
 const c={requiredIds:['current'],forbiddenIds:['deleted'],studentId:'alex'};
 assert.deepEqual(assessSelection(c,[{id:'deleted',studentId:'alex'},{id:'other',studentId:'sam'}]),{
  selectedIds:['deleted','other'],missingRequiredIds:['current'],forbiddenSelectedIds:['deleted'],unexpectedScopeIds:['other'],
 });
});
test('baseline rejects non-synthetic and duplicate cases',async()=>{
 await assert.rejects(personalizationBaseline({...personalizationCatalog,synthetic:false}),/synthetic/);
 await assert.rejects(personalizationBaseline({...personalizationCatalog,cases:[personalizationCatalog.cases[0],personalizationCatalog.cases[0]]}),/Unique/);
});
test('real history selection obeys scope and deletion without claiming unmeasured model quality',async()=>{
 const cases=personalizationCatalog.cases.filter(c=>['student-isolation','deleted-memory'].includes(c.category));
 const result=await personalizationBaseline({...personalizationCatalog,cases});
 assert.equal(result.sampleSize,4);assert.deepEqual(result.boundaryFailures,[]);
 assert.equal(result.liveResponsesEvaluated,0);
 for(const c of result.results){assert.equal(c.providerCostUSD,null);assert.equal(c.firstAudioMs,null);assert.equal(c.liveResponseReview,'not-run');}
});
