import {useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {useFamily} from './FamilyStore';
import {useConversationHistory} from './ConversationHistory';
import {apiFetch} from './api';
import {browserPrivacy} from './browserPrivacy.mjs';
import {subscribeMemoryContext} from './memoryContext.mjs';
import {createVoicePreparation} from './voicePreparation.mjs';
import {voicePreparationCandidates} from './voicePreparationCandidates.mjs';
import type {VoiceProps} from './ProfileVoice';

export function useVoicePreparation(entry:VoiceProps|null,active:boolean){
 const {user,isAuthenticated,getAccessTokenSilently}=useAuth0();
 const family=useFamily(),history=useConversationHistory();
 const [preparation]=useState(()=>createVoicePreparation());
 const [revision,refresh]=useState(0);
 const latest=useRef(getAccessTokenSilently);latest.current=getAccessTokenSilently;
 const studentId=entry?.profile.id,subject=user?.sub;
 const enabled=isAuthenticated&&!!subject&&!!entry&&!entry.onboarding&&entry.mode!=='profile'&&family.cloud&&!family.loading&&!family.error&&!history.loading&&!history.error&&!!studentId&&family.students.some(student=>student.id===studentId);
 const mode=entry?.mode||'planning',language=entry?.language,role=entry?.role;
 // Saved profile/history changes invalidate an old handle before idle refresh.
 // Organization jobs and edits also notify through memoryContext; other-device
 // changes are covered by expiry and the server revision check at consumption.
 useEffect(()=>{preparation.clear();},[subject,studentId,mode,language,role,enabled,family.students,family.account,history.items,preparation]);
 useEffect(()=>{
  const changed=()=>{preparation.clear();refresh(value=>value+1);};
  const unsubscribe=subscribeMemoryContext(subject,changed);
  const privacy=browserPrivacy.subscribe(changed);
  return()=>{unsubscribe();privacy();preparation.clear();};
 },[subject,preparation]);
 useEffect(()=>{
  if(!enabled||active)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const input={mode,language,role,studentId,routeConversations:role==='parent',targetConfirmed:true};
  const prepare=()=>{
   if(stopped||document.visibilityState==='hidden'||!browserPrivacy.valid()||browserPrivacy.subject!==subject)return;
   const load=(scope:Omit<typeof input,'studentId'>&{studentId?:string})=>async(signal:AbortSignal)=>{
    const token=await latest.current();signal.throwIfAborted();
    if(!browserPrivacy.valid()||browserPrivacy.subject!==subject)return undefined;
    const response=await apiFetch('/api/profile-voice',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...scope,action:'prepare'}),signal});
    return response.ok?response.json():undefined;
   };
   // Give the neutral opening and screen selection priority. A second child
   // often gets chosen by voice; prepare that scope after the first pair, not
   // as a third concurrent request competing with call startup. Starting a call
   // stops queued work, but does not abort an already loading opaque handle.
   const scopes=voicePreparationCandidates(input,family.students);
   void Promise.all(scopes.slice(0,2).map(scope=>preparation.warm(subject!,scope,load(scope)))).then(async ids=>{
    for(const scope of scopes.slice(2)){
     if(stopped||document.visibilityState==='hidden'||!browserPrivacy.valid()||browserPrivacy.subject!==subject)break;
     ids.push(await preparation.warm(subject!,scope,load(scope)));
    }
    if(!stopped)timer=setTimeout(prepare,ids.some(Boolean)?25000:5000);
   });
  };
  const schedule=()=>{clearTimeout(timer);if(document.visibilityState!=='hidden')timer=setTimeout(prepare,600);};
  schedule();document.addEventListener('visibilitychange',schedule);
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);};
 },[enabled,active,subject,studentId,mode,language,role,revision,family.students,family.account,history.items,preparation]);
 return preparation;
}
