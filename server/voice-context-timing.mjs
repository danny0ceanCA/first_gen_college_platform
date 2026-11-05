// Fixed stage names only; no prompts, identities, queries or result bodies.
export const contextStages=Object.freeze(['version','memory','profile','history','workspace','retrieval','continuity','coordinator','session_guards','opening','brief','teachings','negotiate']);
export function voiceContextTiming({emit=()=>{},clock=()=>performance.now()}={}){
 const start=clock(),durations=new Map();
 let preparation;
 return {
  preparation(status){if(['preparing','hit','miss','cold'].includes(status))preparation=status;},
  async measure(stage,operation){
   if(!contextStages.includes(stage))throw Error('invalid_timing_stage');
   const at=clock();let outcome='failed';
   try{const result=await operation();outcome='completed';return result;}
   finally{const durationMs=Math.max(0,clock()-at);durations.set(stage,(durations.get(stage)||0)+durationMs);try{const pending=emit({event:'voice.context_timing',contextStage:stage,durationMs,outcome});pending?.catch?.(()=>{});}catch{}}
  },
  header(){return [...durations].map(([stage,ms])=>`${stage};dur=${ms.toFixed(1)}`).concat(preparation?[`preparation;desc="${preparation}"`]:[],`total;dur=${Math.max(0,clock()-start).toFixed(1)}`).join(', ');},
 };
}
