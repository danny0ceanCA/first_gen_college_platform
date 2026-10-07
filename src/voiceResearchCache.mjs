// A cache lives only for one live call. Never share student context across calls.
export function wantsFreshLookup(text){return typeof text==='string'&&/\b(check again|recheck|fresh check|verify again|actualiza|verifica de nuevo|revisa de nuevo|comprueba de nuevo)\b/i.test(text);}
export function voiceResearchCache(now=Date.now){
 const entries=new Map();
 const normalize=value=>String(value||'').trim().replace(/\s+/g,' ');
 const key=input=>JSON.stringify([input.mode,input.language,normalize(input.institution),normalize(input.question)]);
 return {
  get(input){const id=key(input);if(input.forceRefresh){entries.delete(id);return undefined;}const entry=entries.get(id);if(!entry)return undefined;if(now()-entry.at>=300000){entries.delete(id);return undefined;}return entry.result;},
  put(input,result){if(result?.error||!Array.isArray(result?.sources)||!result.sources.length)return;const id=key(input);entries.delete(id);if(entries.size>=12)entries.delete(entries.keys().next().value);entries.set(id,{at:now(),result});},
 };
}
// Per physical call: cache hits are free; failed attempts count toward the budget.
export function voiceResearchBudget({maxCalls=8,maxAttemptsPerQuestion=2}={}){
 let calls=0;const attempts=new Map();
 return {take(query){const key=JSON.stringify([query.mode,query.language,query.institution,query.question.trim().replace(/\s+/g,' ')]);const n=attempts.get(key)||0;if(calls>=maxCalls||n>=maxAttemptsPerQuestion)return false;calls++;attempts.set(key,n+1);return true;},used:()=>calls};
}
