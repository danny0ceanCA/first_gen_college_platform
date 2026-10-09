const fields={ONBOARDING_RETENTION_DAYS:[90,7,90],ONBOARDING_ALERT_MIN_VISITS:[10,10,1000],ONBOARDING_ALERT_RATE_PERCENT:[25,5,100]};
export function onboardingConfigIssues(env={}){
 return Object.entries(fields).filter(([key,[,min,max]])=>env[key]!==undefined&&(!/^\d+$/.test(env[key])||Number(env[key])<min||Number(env[key])>max)).map(([key,[,min,max]])=>`${key}: use an integer from ${min} to ${max}`);
}
export function onboardingSettings(env={}){
 const issues=onboardingConfigIssues(env);if(issues.length)throw new Error(issues.join('; '));
 return {retentionDays:Number(env.ONBOARDING_RETENTION_DAYS??90),alertMinVisits:Number(env.ONBOARDING_ALERT_MIN_VISITS??10),alertRatePercent:Number(env.ONBOARDING_ALERT_RATE_PERCENT??25)};
}
