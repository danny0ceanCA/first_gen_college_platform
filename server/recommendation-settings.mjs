export const recommendationFlags=Object.freeze(['ORIGEN_RECOMMENDATIONS','ORIGEN_RECOMMENDATION_EVALUATION']);
export function recommendationConfigurationIssues(env={}){
 const issues=recommendationFlags.filter(k=>env[k]&&!['true','false'].includes(env[k])).map(k=>`${k}: use true or false`);
 if(env.ORIGEN_RECOMMENDATIONS==='true'&&env.ORIGEN_STUDENT_FOLLOW_UP!=='true')issues.push('ORIGEN_RECOMMENDATIONS: requires student follow-up');
 if(env.ORIGEN_RECOMMENDATION_EVALUATION==='true'&&env.ORIGEN_OUTCOME_EVIDENCE!=='true')issues.push('ORIGEN_RECOMMENDATION_EVALUATION: requires outcome evidence');
 return issues;
}
