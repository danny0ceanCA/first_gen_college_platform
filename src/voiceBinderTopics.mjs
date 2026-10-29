import {binderTopics} from './binderSignals.mjs';

export function binderTopicGuide(topic,current){
 if(topic==='costs')return current==='loans'?'loans':'finance';
 if(topic==='applications')return 'admissions';
 if(topic==='options'||topic==='transfer')return 'planning';
 return null;
}

// Topic signals belong to the reply's captured user turn, not to whichever
// question happens to be current after an interruption or an async handoff.
export function voiceBinderTopics({getTurn,canApply,getGuide,getFocusTopic=()=>undefined,highlight,switchGuide,onGuideUnavailable=()=>{}}){
 let stopped=false,revision=0,tail=Promise.resolve();
 return {
  update(topics,turn){
   if(stopped||turn===undefined||turn!==getTurn()||!canApply()||!Array.isArray(topics)||topics.length>4||topics.some(topic=>!binderTopics.includes(topic))||new Set(topics).size!==topics.length)return Promise.resolve(false);
   const selected=[...topics],version=++revision;
   const current=()=>!stopped&&version===revision&&turn===getTurn()&&canApply();
   if(!highlight(selected))return Promise.resolve(false);
   const task=tail.then(async()=>{
    if(!current())return false;
    const primary=selected[0],next=binderTopicGuide(primary,getGuide()),focus=getFocusTopic();
    if(next&&(next!==getGuide()||(focus&&focus!==primary))){
     try{const applied=await switchGuide(next,primary,current);if(applied===false&&current())onGuideUnavailable();}catch{if(current())onGuideUnavailable();}
    }
    if(!current())return false;
    // A guide acknowledgement can install default topics. Restore the exact
    // current selection only if it has not been superseded in the meantime.
    return highlight(selected);
   });
   tail=task.catch(()=>{});return task;
  },
  stop(){stopped=true;revision++;},
 };
}
