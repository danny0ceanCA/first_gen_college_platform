import test from 'node:test';
import assert from 'node:assert/strict';
import {validatedResearchRecord,researchRecordAudit} from '../src/researchRecord.mjs';
import {publicRecord} from './research-record.fixtures.mjs';
for(const language of ['en','es']){
 test(`${language}: category identifiers normalize without changing a step's evidence`,()=>{
  const r=publicRecord('process',language);r.facts.forEach(f=>f.key='steps');r.expectedFacts=['steps'];
  const result=validatedResearchRecord(r,new Set([1]));
  assert.deepEqual(result.facts.map(f=>f.key),['steps_1','steps_2']);assert.deepEqual(result.expectedFacts,['steps_1','steps_2']);
  for(let i=0;i<r.facts.length;i++)assert.deepEqual({...result.facts[i],key:r.facts[i].key},r.facts[i]);
  assert.equal(researchRecordAudit(result).complete,true);
  r.complete=false;assert.equal(researchRecordAudit(validatedResearchRecord(r,new Set([1]))).complete,false);
  r.complete=true;r.facts[1].order=3;assert.equal(researchRecordAudit(validatedResearchRecord(r,new Set([1]))).complete,false);
 });
 test(`${language}: ambiguous identifiers, missing expected steps, and bad citations remain rejected or incomplete`,()=>{
  const r=publicRecord('process',language);r.facts.forEach(f=>f.key='steps');r.expectedFacts=['steps','step_missing'];
  assert.equal(researchRecordAudit(validatedResearchRecord(r,new Set([1]))).complete,false);
  r.facts[1].order=1;assert.equal(validatedResearchRecord(r,new Set([1])),null);
  r.facts[1].order=2;r.facts[0].sourceCitation='[99]';assert.equal(validatedResearchRecord(r,new Set([1])),null);
  r.facts[0].sourceCitation='[1]';r.facts.push({...r.facts[0],key:'steps_1',order:3});assert.equal(validatedResearchRecord(r,new Set([1])),null);
 });
}
