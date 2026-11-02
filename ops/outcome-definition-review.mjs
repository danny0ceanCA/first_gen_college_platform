import {assessOutcome,OUTCOME_ASSESSMENT_RULE_VERSION} from '../server/outcome-assessment.mjs';
import {outcomeReleaseCases,outcomeReleaseCaseCutoff} from '../server/fixtures/outcome-release-cases.mjs';
export function reviewOutcomeDefinitions(cases=outcomeReleaseCases){
 const disagreements=[];
 for(const item of cases){const actual=assessOutcome(item.input,new Date(outcomeReleaseCaseCutoff)),expected=item.expected;
  const missingReasons=expected.reasons.filter(r=>!actual.reasonCodes.includes(r));
  if(actual.state!==expected.state||actual.supportedClaims.length!==expected.claims||missingReasons.length||actual.institutionVerified!==false||actual.evaluationAllowed!==false||actual.independence!=='not_established')disagreements.push({caseId:item.id,expectedState:expected.state,actualState:actual.state,expectedClaims:expected.claims,actualClaims:actual.supportedClaims.length,missingReasons,authorityViolation:actual.institutionVerified!==false||actual.evaluationAllowed!==false||actual.independence!=='not_established'});
 }
 return {kind:'outcome-definition-case-review',version:1,ruleVersion:OUTCOME_ASSESSMENT_RULE_VERSION,referenceReview:'engineering_contract_review',institutionalReview:'not_performed',cases:cases.length,matched:cases.length-disagreements.length,disagreements,passed:cases.length>0&&disagreements.length===0};
}
