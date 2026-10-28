import {useSyncExternalStore} from 'react';
import type {AIResponse,SearchPreferences} from './ai';
import {browserPrivacy} from './browserPrivacy.mjs';

type SearchState={form:SearchPreferences;result?:{answer:AIResponse;criteria:SearchPreferences};pending:boolean;error:string;seed?:number};
const sessions=new Map<string,SearchState>(),listeners=new Set<()=>void>();
let generation=0;
const emit=()=>listeners.forEach(listener=>listener());
// Keep research on returning to a divider, in memory only. Privacy invalidation
// clears it immediately; no private search text goes into history or storage.
browserPrivacy.subscribe(()=>{generation++;sessions.clear();emit();});
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function read(scope:string,stage:string){
 let value=sessions.get(scope);
 if(!value){value={form:{interest:'',location:'',distance:'25 miles',availability:'',type:'both',paid:'any',stage},pending:false,error:''};sessions.set(scope,value);}
 return value;
}
export function useOpportunitySession(scope:string,stage:string){
 const state=useSyncExternalStore(subscribe,()=>read(scope,stage));
 const cycle=generation;
 const update=(changes:Partial<SearchState>)=>{if(cycle!==generation)return false;sessions.set(scope,{...read(scope,stage),...changes});emit();return true;};
 const begin=()=>{if(cycle!==generation||read(scope,stage).pending)return false;return update({pending:true,error:''});};
 return {state,update,begin};
}
