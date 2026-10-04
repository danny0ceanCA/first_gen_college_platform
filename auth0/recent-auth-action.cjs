// Install as an Auth0 Post Login Action and bind it to the Login flow.
// Do not substitute token issuance/current time: refresh must not count as login.
exports.onExecutePostLogin=async(event,api)=>{
 const timestamp=Date.parse(event.session?.authenticated_at);
 if(Number.isFinite(timestamp)&&timestamp>0){
  api.accessToken.setCustomClaim('https://origenedu.ai/auth_time',Math.floor(timestamp/1000));
 }
};
