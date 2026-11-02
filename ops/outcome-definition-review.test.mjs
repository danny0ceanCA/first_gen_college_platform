import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOutcomeDefinitions} from './outcome-definition-review.mjs';
import {outcomeReleaseCases} from '../server/fixtures/outcome-release-cases.mjs';
test('hand-labeled outcome cases retain uncertainty, provenance and scope',()=>{
 const r=reviewOutcomeDefinitions();assert.equal(r.passed,true,JSON.stringify(r.disagreements));assert.equal(r.cases,26);assert.equal(r.matched,26);assert.equal(r.institutionalReview,'not_performed');
 assert.doesNotMatch(JSON.stringify(r),/Invented statement|Example University|synthetic-report|Coverage review/);
});
test('definition review reports disagreement instead of certifying reference labels as truth',()=>{
 const original=outcomeReleaseCases[0],changed={...original,expected:{...original.expected,state:'coordinator_reported',claims:2,reasons:['record_check_not_authenticated']}};
 const r=reviewOutcomeDefinitions([changed]);assert.equal(r.passed,false);assert.equal(r.matched,0);assert.deepEqual(r.disagreements[0],{caseId:changed.id,expectedState:'coordinator_reported',actualState:'student_reported',expectedClaims:2,actualClaims:1,missingReasons:['record_check_not_authenticated'],authorityViolation:false});
 assert.equal(reviewOutcomeDefinitions([]).passed,false);
});
