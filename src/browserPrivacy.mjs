// One lifecycle for private browser data. The shared stamp contains no content or token.
const stampKey='origen.privacy.session.v1',eventKey='origen.privacy.event.v1';
const privateKey=key=>/^origen\.(user\.|account\.|onboarding\.|onboarding-summaries\.|institution-draft\.|institution-active\.)/.test(key)||key.startsWith('camino.')||key==='origen.account-preview.v1';
const belongs=(key,subject)=>key.startsWith(`origen.user.${subject}.`)||key===`origen.account.${subject}`||key===`origen.onboarding.${subject}.v1`||key.startsWith(`origen.onboarding.voice.${subject}.`)||key===`origen.onboarding-summaries.${subject}`||key.startsWith(`origen.institution-draft.${subject}.`)||key===`origen.institution-active.${subject}`;
const transcriptKey=key=>key.startsWith('origen.onboarding-summaries.')||/\.conversations\.v1(?:\.pending)?$/.test(key);
const matches=(target,item)=>target.id?target.id===item.id:item.studentId===target.studentId&&(!target.mode||item.mode===target.mode);
export function createBrowserPrivacy({local,session,events,nonce=()=>crypto.randomUUID()}={}){
 const memory=new Map(),listeners=new Set(),leases=new Set(),forgottenIds=new Set();let current=null,blocked=false,paused=false,generation=0;
 const read=()=>{try{return JSON.parse(local?.getItem(stampKey)||'null');}catch{return null;}};
 const write=value=>{try{local?.setItem(stampKey,JSON.stringify(value));}catch{}};
 function purge(subject,others=false,keepDraft=false){for(const storage of [local,session])if(storage)try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(keepDraft&&storage===session&&key===`origen.onboarding.${subject}.v1`)continue;if(key&&privateKey(key)&&(subject===undefined||(others?!belongs(key,subject):belongs(key,subject))))storage.removeItem(key);}}catch{}}
 function emit(event){for(const listener of [...listeners])try{listener(event);}catch{/* Every owner must get the stop signal. */}}
 function invalidate(reason,keepDraft=false){if(blocked&&!paused)return;blocked=true;paused=keepDraft;generation++;for(const lease of leases)lease.abort();leases.clear();memory.clear();forgottenIds.clear();if(current)purge(current.subject,false,keepDraft);emit({type:'end',reason,subject:current?.subject});}
 function valid(){if(!current)return false;const stamp=read();if(local&&stamp&&(stamp.version!==current.version||stamp.ended)){invalidate('session_changed');return false;}return !blocked;}
 function start(subject,{fresh=false}={}){
  if(current?.subject===subject&&valid())return true;
  if(current&&(!blocked||(paused&&current.subject!==subject)))invalidate('account_changed');
  const stamp=read();
  // A cached page must not revive a session another tab explicitly ended.
  if(stamp&&(stamp.ended||stamp.subject!==subject)&&!fresh){current={subject,version:nonce(),ended:true};blocked=true;purge(subject);return false;}
  current=stamp?.subject===subject&&!stamp.ended?stamp:{subject,version:nonce(),ended:false};blocked=false;paused=false;generation++;write(current);
  purge(subject,true);
  // Retire all persistent transcript/summary recovery, including old versions.
  for(const storage of [local,session])if(storage)try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key&&transcriptKey(key))storage.removeItem(key);}}catch{}
  // Move an existing profile draft into this tab, then remove the persistent copy.
  if(local)try{for(let i=local.length-1;i>=0;i--){const key=local.key(i);if(key&&(key.startsWith('origen.onboarding.')||key.startsWith('origen.institution-draft.'))&&belongs(key,subject)){const draft=local.getItem(key);if(draft&&!session?.getItem(key))session?.setItem(key,draft);local.removeItem(key);}}}catch{}
  return true;
 }
 // A failed permission lookup suspends this tab, not the authenticated session
 // in other tabs. Preserve only its profile draft; voice and requests stop.
 function pause(){if(current&&valid())invalidate('permission_unavailable',true);}
 function stop(reason='logout'){if(current&&(valid()||paused))write({...current,version:nonce(),ended:true});invalidate(reason);}
 function capture(conversation){const version=current?.version,controller=new AbortController();const lease={abort:()=>controller.abort(),conversation};leases.add(lease);if(!valid()||conversation?.id&&forgottenIds.has(conversation.id))controller.abort();return {signal:controller.signal,valid:()=>!controller.signal.aborted&&valid()&&current?.version===version,assert(){if(!this.valid())throw Object.assign(new Error('privacy_session_ended'),{name:'AbortError'});},release:()=>leases.delete(lease)};}
 function forget(target,publish=true){
  if(!valid())return;
  if(target.id)forgottenIds.add(target.id);
  const remember=item=>{const matched=matches(target,item);if(matched&&item.id)forgottenIds.add(item.id);return matched;};
  for(const lease of leases)if(lease.conversation&&remember(lease.conversation)){lease.abort();leases.delete(lease);}
  // Recovery dictionaries contain either raw turns or pending narrative summaries.
  for(const [key,raw] of memory){try{const record=JSON.parse(raw);if(Array.isArray(record.value))record.value=record.value.filter(item=>!remember(item));else if(record.value&&typeof record.value==='object')for(const [id,item] of Object.entries(record.value)){const byKey=remember({...item,id}),byValue=remember(item);if(byKey||byValue)delete record.value[id];}memory.set(key,JSON.stringify(record));}catch{memory.delete(key);}}
  emit({type:'forget',subject:current.subject,target});
  if(publish)try{local?.setItem(eventKey,JSON.stringify({subject:current.subject,target,nonce:nonce()}));local?.removeItem(eventKey);}catch{}
 }
 const onStorage=event=>{if(event.key===stampKey)valid();if(event.key===eventKey&&event.newValue)try{const message=JSON.parse(event.newValue);if(message.subject===current?.subject&&message.target)forget(message.target,false);}catch{}};
 const onReturn=()=>valid();events?.addEventListener('storage',onStorage);events?.addEventListener('pageshow',onReturn);events?.addEventListener('focus',onReturn);
 function storage(key){
  const version=current?.version,cycle=generation;const allowed=()=>valid()&&current?.version===version&&generation===cycle;
  const durable=!transcriptKey(key)&&!key.endsWith('.pending')?session:null;
  // Profile drafts may survive a reload in this tab; raw conversations never do.
  return {getItem:name=>allowed()?(durable?durable.getItem(name):memory.get(name)||null):null,setItem(name,value){if(!allowed())throw Object.assign(new Error('privacy_session_ended'),{name:'AbortError'});if(durable)durable.setItem(name,value);else memory.set(name,value);},removeItem(name){if(!allowed())return;if(durable)durable.removeItem(name);else memory.delete(name);}};
 }
 return {start,stop,pause,valid,capture,forget,storage,matches,purge,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},get subject(){return current?.subject;},destroy(){events?.removeEventListener('storage',onStorage);events?.removeEventListener('pageshow',onReturn);events?.removeEventListener('focus',onReturn);invalidate('destroyed');listeners.clear();}};
}
const safeStorage=name=>{try{return typeof window==='undefined'?undefined:window[name];}catch{return undefined;}};
export const browserPrivacy=createBrowserPrivacy({local:safeStorage('localStorage'),session:safeStorage('sessionStorage'),events:typeof window==='undefined'?undefined:window});
