// Post Login Action 1: bind BEFORE recent-auth-action.cjs.
// Enable Authenticator (OTP) in this Origen tenant first.
exports.onExecutePostLogin=async(event,api)=>{
 // Explicit, owner-authorized exception for the fictional coordinator login.
 // Never infer this from an email alone, user_metadata, or authorization input.
 const testSubject='auth0|6adaf0051ec26ca8f49f32fe';
 if(event.user?.user_id===testSubject&&event.user.email==='coordinator-test@example.test'
  &&event.user.email_verified===true&&event.user.app_metadata?.synthetic_test_account===true
  &&event.user.app_metadata?.purpose==='coordinator_signup_testing'){
  const claim='https://origenedu.ai/coordinator_test_mfa_exempt';
  api.accessToken.setCustomClaim(claim,testSubject);
  api.idToken.setCustomClaim(claim,testSubject);
  return;
 }
 const requested=event.transaction?.acr_values?.includes('http://schemas.openid.net/pape/policies/2007/06/multi-factor');
 if(!requested)return;
 // Requesting MFA does not grant a role. API permissions and DB memberships
 // remain authoritative. Completion is observed by the next Action.
 if(event.user.enrolledFactors?.some(f=>f.type==='otp'))api.authentication.challengeWith({type:'otp'});
 else api.authentication.enrollWith({type:'otp'});
};
