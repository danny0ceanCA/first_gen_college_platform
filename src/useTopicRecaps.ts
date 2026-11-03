import {useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {withRequestDeadline} from './requestDeadline.mjs';
import {isTopicRecapResponse} from './topicRecapResponse.mjs';
import {createTopicRecapQueue,logTopicRecapTiming,type RecapTopic,type TopicRecapData} from './topicRecapQueue.mjs';

type Props={studentId:string|null;language:'en'|'es';ready:boolean;topics:{topic:RecapTopic;revision:string}[];priority:RecapTopic;foreground?:RecapTopic};
export default function useTopicRecaps({studentId,language,ready,topics,priority,foreground}:Props){
 const {user,getAccessTokenSilently}=useAuth0();
 const auth=useRef(getAccessTokenSilently);auth.current=getAccessTokenSilently;
 const scope=JSON.stringify([user?.sub,studentId,language]);
 const [queue]=useState(()=>createTopicRecapQueue({log:logTopicRecapTiming,load:async job=>{
  const [subject,target,locale]=JSON.parse(job.scope) as [string,string|null,'en'|'es'];
  const lease=browserPrivacy.capture({studentId:target});
  try{return await withRequestDeadline(async signal=>{
   lease.assert();if(browserPrivacy.subject!==subject)throw new Error('account_changed');
   const token=await auth.current();signal.throwIfAborted();lease.assert();
   if(!token)throw new Error('account_changed');
   let tokenSubject;try{tokenSubject=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;}catch{}
   if(!subject||tokenSubject!==subject)throw new Error('account_changed');
   const response=await apiFetch('/api/topic-recap',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({studentId:target,topic:job.topic,language:locale,loadMode:job.mode}),signal});
   const data=await response.json();signal.throwIfAborted();lease.assert();
   if(!response.ok||!isTopicRecapResponse(data))throw new Error('recap_unavailable');
   return data as TopicRecapData;
  },{signal:AbortSignal.any([job.signal,lease.signal]),timeoutMs:55000});}
  finally{lease.release();}
 }}));
 useSyncExternalStore(queue.subscribe,queue.snapshot,queue.snapshot);
 const revisions=JSON.stringify(topics);
 useLayoutEffect(()=>{queue.configure({scope,ready:ready&&!!user?.sub,topics,priority,foreground});},[queue,scope,ready,revisions,priority,foreground]);
 useLayoutEffect(()=>{
  const unsubscribe=browserPrivacy.subscribe(()=>queue.reset());
  return()=>{unsubscribe();queue.reset();};
 },[queue]);
 return {read:(topic:string)=>ready?queue.read(scope,topic,topics.find(item=>item.topic===topic)?.revision):undefined,retry:queue.retry};
}
