import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {binderActivity} from './binderActivity';
import {useBinderFollowPaused} from './binderFollowControl';
import {binderFollowDeliverable,createBinderFollower,createBinderNavigationGuards,type BinderFollowRequest} from './binderFollow.mjs';

const guards=createBinderNavigationGuards();
export function useBinderNavigationGuard(blocked:boolean){
 const owner=useRef({});
 useLayoutEffect(()=>{guards.set(owner.current,blocked);return()=>guards.set(owner.current,false);},[blocked]);
}
const editing=()=>!!document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])');

export function useBinderFollow({subject,studentIds,role,ready,blocked,apply}:{subject:string|undefined;studentIds:string[];role:'parent'|'student';ready:boolean;blocked:boolean;apply:(request:BinderFollowRequest)=>void}){
 const activity=useSyncExternalStore(binderActivity.subscribe,binderActivity.snapshot,()=>null);
 const paused=useBinderFollowPaused();
 const guarded=useSyncExternalStore(guards.subscribe,guards.snapshot,()=>false);
 const [focused,setFocused]=useState(editing);
 const [follower]=useState(createBinderFollower);
 const [pending,setPending]=useState<BinderFollowRequest|null>(null);
 const [request,setRequest]=useState<BinderFollowRequest|null>(null);
 const applied=useRef(0),applyRef=useRef(apply);applyRef.current=apply;
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const update=()=>{clearTimeout(timer);timer=setTimeout(()=>setFocused(editing()),0);};
  document.addEventListener('focusin',update);document.addEventListener('focusout',update);
  return()=>{clearTimeout(timer);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);};
 },[]);
 useEffect(()=>{
  const next=follower.observe(activity,{subject,studentIds,role,ready});
  setPending(next&&next.serial!==applied.current?next:null);
  if(!next)setRequest(null);
 },[activity,subject,studentIds.join('|'),role,ready,follower]);
 useEffect(()=>{
  if(!pending||paused)return;
  // Recheck the live source at delivery, including after a draft or dialog closes.
  if(!binderFollowDeliverable(pending,binderActivity.snapshot(),{subject,studentIds,role,ready,blocked:blocked||guarded||guards.snapshot()||focused||editing()}))return;
  applied.current=pending.serial;applyRef.current(pending);setRequest(pending);setPending(null);
 },[pending,paused,blocked,guarded,focused,ready,subject,role,studentIds.join('|')]);
 return {request:paused?null:request,pending:paused?null:pending,paused};
}
