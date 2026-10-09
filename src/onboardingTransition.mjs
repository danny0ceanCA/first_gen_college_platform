// Durations share one monotonic browser clock; they are not inferred from receipts.
export async function onboardingTransition({exit,open,home,enter,restore,record=()=>{},signal,now=()=>performance.now()}){
 const began=now();
 const emit=(name,metadata={})=>{try{record(name,{surface:'web',...metadata});}catch{}};
 const duration=()=>Math.round(Math.max(0,Math.min(600000,now()-began)));
 let abort;
 const cancelled=new Promise((resolve,reject)=>{abort=()=>reject(Object.assign(new Error('transition_cancelled'),{name:'AbortError'}));signal?.addEventListener('abort',abort,{once:true});});
 const run=async callback=>{if(signal?.aborted)throw Object.assign(new Error('transition_cancelled'),{name:'AbortError'});return Promise.race([Promise.resolve().then(callback),cancelled]);};
 emit('home_transition_started');
 try{
  await run(exit);
  await run(open);emit('home_transition_open_requested');
  const node=await run(home);
  if(!node)throw new Error('home_not_rendered');
  await run(()=>enter(node));
  emit('home_transition_finished',{durationMs:duration()});
 }catch(error){
  if(error.name==='AbortError'){emit('home_transition_cancelled',{reason:'screen_unmounted',durationMs:duration()});return;}
  emit('home_transition_failed',{reason:error.message==='home_not_rendered'?'home_not_rendered':'request_failed',durationMs:duration()});throw error;
 }finally{signal?.removeEventListener('abort',abort);restore();}
}
