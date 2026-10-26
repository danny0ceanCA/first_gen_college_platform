import {binderTopics} from './binderSignals.mjs';

// Activity is published only after the voice session acknowledges its confirmed
// scope. Screen selections and names mentioned in speech never enter this path.
export function createBinderFollower(){
 let scope='',primary=null,serial=0,command=null;
 return {observe(activity,{subject,studentIds,role,ready}){
  const valid=ready&&subject&&activity?.source&&activity.subject===subject&&
   (activity.studentId===null?role==='parent':studentIds.includes(activity.studentId));
  if(!valid){scope='';primary=null;command=null;return null;}
  const nextScope=JSON.stringify([activity.source,subject,activity.studentId]);
  const changed=nextScope!==scope;
  const topics=binderTopics.filter(topic=>activity.topics.includes(topic));
  const next=(!changed&&topics.includes(primary)?primary:topics[0])||null;
  if(changed||next!==primary){
   command=changed||next?{serial:++serial,source:activity.source,subject,studentId:activity.studentId,topic:next}:null;
  }
  scope=nextScope;primary=next;
  return command;
 }};
}

export function createBinderNavigationGuards(){
 const owners=new Set(),listeners=new Set();
 return {
  snapshot:()=>owners.size>0,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  set(owner,blocked){const before=owners.size>0;if(blocked)owners.add(owner);else owners.delete(owner);if(before!==(owners.size>0))listeners.forEach(listener=>listener());},
 };
}

export function binderFollowDeliverable(request,activity,{subject,studentIds,role,ready,blocked}){
 return !!(request&&activity&&ready&&!blocked&&request.subject===subject&&activity.subject===subject&&
  request.source===activity.source&&request.studentId===activity.studentId&&
  (request.studentId===null?role==='parent':studentIds.includes(request.studentId))&&
  (!request.topic||activity.topics.includes(request.topic)));
}
