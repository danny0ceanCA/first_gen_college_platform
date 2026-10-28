import {useSyncExternalStore} from 'react';
import {binderActivity} from './binderActivity';
import {browserPrivacy} from './browserPrivacy.mjs';

// Pause is scoped to this call, not to a student or a persisted account setting.
// Topic glows continue while automatic navigation is paused.
let paused=false,source:string|undefined;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(listener=>listener());
function reset(){if(paused){paused=false;emit();}}
binderActivity.subscribe(()=>{
 const next=binderActivity.snapshot()?.source;
 if(source!==next){source=next;reset();}
});
browserPrivacy.subscribe(()=>{source=undefined;reset();});
export const binderFollowControl={
 subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
 snapshot:()=>paused,
 setPaused:(next:boolean)=>{if(paused!==next){paused=next;emit();}},
};
export function useBinderFollowPaused(){return useSyncExternalStore(binderFollowControl.subscribe,binderFollowControl.snapshot,()=>false);}
