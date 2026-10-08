// Own one screen lock for a physical voice call. Rejections never affect audio.
export function voiceWakeLock(onStatus=()=>{}, {document:page=globalThis.document,wakeLock=globalThis.navigator?.wakeLock}={}) {
 let stopped=false,epoch=0,pending=false,sentinel,removeRelease;
 const release=lock=>{try{Promise.resolve(lock?.release()).catch(()=>{});}catch{}};
 const clear=()=>{
  epoch++;pending=false;
  removeRelease?.();removeRelease=undefined;
  const old=sentinel;sentinel=undefined;release(old);
 };
 async function acquire(){
  if(stopped||page?.visibilityState!=='visible'||sentinel||pending)return;
  if(!wakeLock?.request){onStatus('unavailable');return;}
  const version=epoch;pending=true;
  try{
   const lock=await wakeLock.request('screen');
   if(stopped||version!==epoch||page.visibilityState!=='visible'){release(lock);return;}
   pending=false;
   if(lock.released){onStatus('unavailable');return;}
   sentinel=lock;
   const released=()=>{
    if(stopped||sentinel!==lock)return;
    sentinel=undefined;removeRelease?.();removeRelease=undefined;
    // Device policy may revoke a lock. Do not repeatedly fight that policy.
    onStatus(page.visibilityState==='visible'?'unavailable':'hidden');
   };
   lock.addEventListener('release',released);
   removeRelease=()=>lock.removeEventListener('release',released);
   onStatus('active');
  }catch{
   if(stopped||version!==epoch)return;
   pending=false;onStatus('unavailable');
  }
 }
 const visibility=()=>{
  if(stopped)return;
  if(page.visibilityState==='visible')void acquire();
  else{clear();onStatus('hidden');}
 };
 page?.addEventListener('visibilitychange',visibility);
 if(page?.visibilityState==='visible')void acquire();else onStatus('hidden');
 return {stop(){if(stopped)return;stopped=true;page?.removeEventListener('visibilitychange',visibility);clear();}};
}
