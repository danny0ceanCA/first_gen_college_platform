export const LOGOUT_REVEAL_MS=400;
const returnKey='origen.logout-transition.v1',returnLifetime=90000;

// A short-lived, tab-local visual handoff. Never stores an identity or token.
export function clearLogoutReturn(storage){try{storage?.removeItem(returnKey);}catch{}}
export function readLogoutReturn(storage,now=Date.now()){
 try{
  const started=Number(storage?.getItem(returnKey));
  if(started>0&&started<=now&&now-started<returnLifetime)return true;
 }catch{}
 clearLogoutReturn(storage);return false;
}
export function createLogoutTransition({cleanup,stop,redirect,cover,onPhase,storage,now=Date.now}){
 let pending=null,cleaned=false,stopped=false;
 return {
  get canReturn(){return !stopped;},
  start(options){
   if(pending)return pending;
   onPhase('leaving');
   pending=Promise.resolve().then(async()=>{
    try{
     // Cleanup (including the test-account reset) can stop privacy subscribers
     // and unmount the workspace. Finish covering it before any cleanup starts.
     // Failed cleanup still blocks Auth0 sign-out.
     await cover();
     if(!cleaned){await cleanup();cleaned=true;}
     stop();stopped=true;
     if(options?.openUrl!==false)try{storage?.setItem(returnKey,String(now()));}catch{}
     await redirect(options);
     if(options?.openUrl===false){clearLogoutReturn(storage);onPhase('revealing');}
    }catch{
     clearLogoutReturn(storage);onPhase('error');
    }
   }).finally(()=>{pending=null;});
   return pending;
  },
 };
}
