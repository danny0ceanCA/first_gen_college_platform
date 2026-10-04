// A cache lives only for one live call. Never share student context across calls.
export function voiceResearchCache(now=Date.now){
 const entries=new Map();
 const normalize=value=>String(value||'').trim().replace(/\s+/g,' ');
 const key=input=>JSON.stringify([input.mode,input.language,normalize(input.institution),normalize(input.question)]);
 return {
  get(input){const id=key(input),entry=entries.get(id);if(!entry)return undefined;if(now()-entry.at>=300000){entries.delete(id);return undefined;}return entry.result;},
  put(input,result){if(result?.error||!Array.isArray(result?.sources)||!result.sources.length)return;const id=key(input);entries.delete(id);if(entries.size>=12)entries.delete(entries.keys().next().value);entries.set(id,{at:now(),result});},
 };
}
