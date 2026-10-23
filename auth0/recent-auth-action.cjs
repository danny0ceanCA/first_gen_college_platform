// Install as an Auth0 Post Login Action and bind it to the Login flow.
// Do not substitute token issuance/current time: refresh must not count as login.
exports.onExecutePostLogin=async(event,api)=>{
 // Session authenticated_at is Enterprise-only. Other plans expose the actual
 // first-factor timestamps in authentication.methods. Preserve those times on
 // SSO/refresh; token issuance and MFA alone must never renew login freshness.
 const methods=Array.isArray(event.authentication?.methods)?event.authentication.methods:[];
 const primary=methods.filter(m=>['pwd','federated','passkey'].includes(m.name))
  .map(m=>Date.parse(m.timestamp)).filter(t=>Number.isFinite(t)&&t>0);
 const sessionTime=Date.parse(event.session?.authenticated_at);
 const timestamp=Number.isFinite(sessionTime)&&sessionTime>0?sessionTime:primary.length?Math.max(...primary):NaN;
 if(Number.isFinite(timestamp)&&timestamp>0){
  api.accessToken.setCustomClaim('https://origenedu.ai/auth_time',Math.floor(timestamp/1000));
 }
 const completed=methods.filter(m=>m.name==='mfa').map(m=>Date.parse(m.timestamp)).filter(t=>Number.isFinite(t)&&t>0);
 if(completed.length)api.accessToken.setCustomClaim('https://origenedu.ai/mfa_time',Math.floor(Math.max(...completed)/1000));
};
