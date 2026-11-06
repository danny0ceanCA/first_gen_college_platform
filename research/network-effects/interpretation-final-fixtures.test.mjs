import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationCases } from './calibration-fixtures.mjs';
import { freshCalibrationCases } from './calibration-fresh-fixtures.mjs';
import { fresh2CalibrationCases } from './calibration-fresh2-fixtures.mjs';
import { interpretationCases } from './calibration-interpretation-fixtures.mjs';
import { finalInterpretationCases, finalInterpretationVersion } from './interpretation-final-fixtures.mjs';
import { validateSource, validateExtraction } from './contracts.mjs';

test('final interpretation holdout — 12 untouched sources span all three languages without duplicating prior text',()=>{
  const cases=finalInterpretationCases(),prior=[...calibrationCases(),...freshCalibrationCases(),...fresh2CalibrationCases(),...interpretationCases()];
  assert.equal(finalInterpretationVersion,'first-generation-interpretation-final-12-v1');
  assert.equal(cases.length,12);
  assert.deepEqual(Object.fromEntries(['en','es','mixed'].map(language=>[language,cases.filter(example=>example.source.language===language).length])),{en:4,es:4,mixed:4});
  assert.equal(new Set(cases.map(example=>example.source.id)).size,12);
  assert.ok(cases.every(example=>example.source.synthetic && example.split==='heldout' && example.rubric.humanReview==='pending'));
  assert.ok(cases.every(example=>!prior.some(old=>old.source.text===example.source.text||old.source.id===example.source.id)));
  assert.equal(cases.filter(example=>example.rubric.interpretationExpected.fulfillsPendingCaseId).length,3);
});

test('final interpretation holdout — evidence and pending-to-fulfilled links validate without corrections',()=>{
  const existingItems=[],previous=new Map();
  for(const example of finalInterpretationCases()){
    validateSource(example.source);
    validateExtraction(example.expected,example.source,{existingItems});
    const rule=example.rubric.interpretationExpected;
    for(const wanted of rule.requiredObservations)assert.ok(example.expected.items.some(item=>item.kind===wanted.kind&&wanted.statuses.includes(item.status)&&(!wanted.requireBarrier||item.barrier)));
    if(rule.fulfillsPendingCaseId){
      const prior=previous.get(rule.fulfillsPendingCaseId);
      assert.equal(prior.source.accountId,example.source.accountId);
      assert.equal(prior.source.reporter,example.source.reporter);
      assert.ok(prior.expected.items.some(item=>item.kind==='outcome'&&item.status==='pending'));
      assert.ok(example.expected.items.some(item=>item.kind==='outcome'&&item.status==='positive'));
    }
    for(const item of example.expected.items){
      assert.equal(item.corrects,null);assert.equal(item.occurredAt,null);
      existingItems.push({...item,id:`${example.source.id}@1#${item.key}`,sourceId:example.source.id,accountId:example.source.accountId,studentId:example.source.studentId,state:'current'});
    }
    previous.set(example.id,example);
  }
});
