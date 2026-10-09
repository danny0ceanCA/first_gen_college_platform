import {onboardingDelivery} from './onboardingDelivery.mjs';
// A new attempt represents a visit to setup. Only allowlisted diagnostics persist.
export function onboardingEvents(send,{enabled=true,id=crypto.randomUUID(),schedule,cancel=clearTimeout,now=()=>new Date().toISOString(),storage,scope,random}={}){
 const handoffEvents=new Set(['home_transition_started','home_transition_open_requested','home_transition_finished','home_transition_failed','home_transition_cancelled','home_guide_update_started','home_guide_update_finished','home_guide_update_failed','home_introduction_requested','home_introduction_started','home_introduction_finished','home_introduction_failed','native_handoff_requested','native_handoff_acknowledged','native_handoff_failed']);
 handoffEvents.add('tracking_delivery_recovered');handoffEvents.add('tracking_delivery_gap');
 let opened=false,home=false,sequence=0,leavingReason;
 let lastFields='';
 const delivery=onboardingDelivery(send,{storage:enabled?storage:undefined,scope:enabled?scope:undefined,schedule,cancel,now:()=>Date.parse(now()),random,onDelivered:({retryCount,gaps})=>{
  if(retryCount)event('tracking_delivery_recovered',{retryCount});
  for(const [gapReason,droppedCount] of Object.entries(gaps))event('tracking_delivery_gap',{gapReason,droppedCount});
 }});
 const flush=()=>enabled?delivery.flush():Promise.resolve();
 const event=(name,metadata={})=>{
  if(!enabled||!opened||(home&&!handoffEvents.has(name))||sequence>=2000)return;
  if(name==='voice_ended'&&leavingReason)metadata={...metadata,reason:leavingReason};
  delivery.enqueue(id,{sequence:++sequence,name,occurredAt:now(),metadata});
 };
 return {
  id,event,flush,resume:()=>{if(enabled)delivery.resume();},pause:delivery.pause,clear:delivery.clear,
  open(metadata){if(opened||!enabled)return;opened=true;event('onboarding_opened',{...metadata,deliveryVersion:1});},
  fields(fields){const next=JSON.stringify(fields);if(next===lastFields)return;lastFields=next;event('fields_updated',{fields});},
  logout(){leavingReason='logout';event('logout_selected');return flush();},
  homeReached(){if(!opened||home)return;event('home_reached');home=true;void flush();},
  get started(){return opened;},
 };
}
export function onboardingFieldPresence(name,role,draft){
 const fields={account_name:!!name?.trim(),account_role:['student','parent'].includes(role)};
 for(const key of ['name','stage','school','interest','gpa','activities','goals','institutions','entryTerm','needs','notes'])fields[key==='name'?'student_name':key]=typeof draft?.[key]==='string'&&!!draft[key].trim();
 return fields;
}
