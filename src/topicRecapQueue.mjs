// One background request at a time. A topic opened by the user may start
// immediately alongside it, so a slow background topic never blocks reading.
// Everything here lives only in this mounted, authorized binder session.
export function createTopicRecapQueue({load,log=()=>{},clock=()=>performance.now(),delayMs=650}={}){
 const entries=new Map(),listeners=new Set();let scope,ready=false,priority,foreground,timer,version=0;
 const emit=()=>{version++;for(const listener of listeners)listener();};
 const report=record=>{try{log(Object.freeze(record));}catch{/* Diagnostics must not interrupt reading. */}};
 const elapsed=at=>Math.max(0,Math.round(clock()-at));
 const finish=(entry,outcome)=>{
  if(entry.logged)return;entry.logged=true;
  report({event:'topic_recap.finished',topic:entry.topic,mode:entry.mode,outcome,cache:'miss',queueMs:entry.queueMs,durationMs:elapsed(entry.started),totalMs:elapsed(entry.queued)});
 };
 const cancel=entry=>{
  if(entry.controller){entry.controller.abort();finish(entry,'cancelled');}
 };
 const active=()=>[...entries.values()].filter(entry=>entry.state.status==='loading');
 function schedule(){
  clearTimeout(timer);if(!ready)return;
  const urgent=entries.get(foreground);
  if(urgent?.state.status==='queued'&&active().length<2)start(urgent,'foreground');
  timer=setTimeout(()=>{
   if(!ready||active().length)return;
   const next=entries.get(priority)?.state.status==='queued'?entries.get(priority):[...entries.values()].find(entry=>entry.state.status==='queued');
   if(next)start(next,'background');
  },delayMs);
 }
 function start(entry,mode){
  entry.controller=new AbortController();entry.mode=mode;entry.started=clock();entry.queueMs=elapsed(entry.queued);entry.logged=false;
  entry.state=Object.freeze({status:'loading'});const owner=scope;
  report({event:'topic_recap.started',topic:entry.topic,mode,queueMs:entry.queueMs});emit();
  Promise.resolve().then(()=>{
   entry.controller.signal.throwIfAborted();
   return load({scope:owner,topic:entry.topic,revision:entry.revision,mode,signal:entry.controller.signal});
  }).then(data=>{
   if(!ready||owner!==scope||entries.get(entry.topic)!==entry||entry.controller.signal.aborted)return;
   entry.state=Object.freeze({status:'ready',data});finish(entry,'completed');emit();
  },error=>{
   if(!ready||owner!==scope||entries.get(entry.topic)!==entry||entry.controller.signal.aborted)return;
   entry.state=Object.freeze({status:'error'});finish(entry,error?.name==='AbortError'?'cancelled':'failed');emit();
  }).finally(()=>{if(owner===scope&&entries.get(entry.topic)===entry)schedule();});
 }
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},snapshot:()=>version,
  configure(next){
   const previousForeground=foreground;
   if(scope!==next.scope){for(const entry of entries.values())cancel(entry);entries.clear();}
   scope=next.scope;ready=next.ready;priority=next.priority;foreground=next.foreground;
   const revisions=new Map(next.topics.map(item=>[item.topic,item.revision]));
   for(const [topic,entry] of entries){
    if(!ready&&entry.state.status!=='ready'||ready&&revisions.get(topic)!==entry.revision){cancel(entry);entries.delete(topic);}
   }
   if(ready)for(const [topic,revision] of revisions)if(!entries.has(topic))entries.set(topic,{topic,revision,queued:clock(),state:Object.freeze({status:'queued'})});
   if(ready&&foreground!==previousForeground&&entries.get(foreground)?.state.status==='ready')report({event:'topic_recap.reused',topic:foreground,mode:'foreground',cache:'hit',durationMs:0});
   emit();schedule();
  },
  read(owner,topic,revision){return ready&&scope===owner&&entries.get(topic)?.revision===revision?entries.get(topic).state:undefined;},
  retry(topic){
   const entry=entries.get(topic);if(!ready||entry?.state.status!=='error')return;
   entries.set(topic,{topic,revision:entry.revision,queued:clock(),state:Object.freeze({status:'queued'})});emit();schedule();
  },
  reset(){ready=false;clearTimeout(timer);for(const entry of entries.values())cancel(entry);entries.clear();scope=undefined;foreground=undefined;emit();},
 };
}

// Explicitly selected metadata only: no subject, student ID, revision, text,
// token, URL, or raw error is written to the browser console.
export function logTopicRecapTiming(record){console.info('[Origen recap]',record);}
