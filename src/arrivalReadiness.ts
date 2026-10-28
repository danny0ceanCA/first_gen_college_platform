import {createContext,useContext,useLayoutEffect,useRef} from 'react';

export const ArrivalReadiness=createContext<(id:symbol,pending:boolean)=>void>(()=>{});

// Loading gates can finish their requests behind the welcome screen. They do
// not restart an arrival that has already completed (for example on refresh).
export function useArrivalPending(pending:boolean){
 const update=useContext(ArrivalReadiness),id=useRef(Symbol('arrival'));
 useLayoutEffect(()=>{
  const key=id.current;
  update(key,pending);
  return()=>update(key,false);
 },[pending,update]);
}
