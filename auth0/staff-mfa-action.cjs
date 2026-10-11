// Post Login Action 1: bind BEFORE recent-auth-action.cjs.
// Enable Authenticator (OTP) in this Origen tenant first.
exports.onExecutePostLogin=async(event,api)=>{
 const requested=event.transaction?.acr_values?.includes('http://schemas.openid.net/pape/policies/2007/06/multi-factor');
 if(!requested)return;
 // Requesting MFA does not grant a role. API permissions and DB memberships
 // remain authoritative. Completion is observed by the next Action.
 if(event.user.enrolledFactors?.some(f=>f.type==='otp'))api.authentication.challengeWith({type:'otp'});
 else api.authentication.enrollWith({type:'otp'});
};
