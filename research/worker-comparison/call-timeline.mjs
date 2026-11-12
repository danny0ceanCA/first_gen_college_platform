// Caller behavior is scheduled on the same continuously advancing audio clock.
// It does not wait for punctuation, a minimum word count, or an assistant turn.
// These windows group recordings only; they are not semantic turn boundaries.
export function createCallerTimeline({followupDelayMs=12000,topicDelayMs=90000,settleMs=20000,initialDelayMs=0,overlap=false}={}){
 const ended=new Map();let next=0,firstAssistantAudio;
 return {
  audio(at){if(ended.has(0)&&firstAssistantAudio===undefined)firstAssistantAudio=at;},
  claim(at){
   const initialEnd=ended.get(0),followupEnd=ended.get(1);
   const due=next===0?initialDelayMs:next===1&&initialEnd!==undefined?
    overlap?Math.min(firstAssistantAudio===undefined?Infinity:firstAssistantAudio+1000,initialEnd+20000):initialEnd+followupDelayMs:
    next===2&&followupEnd!==undefined?Math.max(initialEnd+topicDelayMs,followupEnd+1000):Infinity;
   return at>=due&&next<3?next++:null;
  },
  end(index,at){ended.set(index,at);},
  finished(at){return ended.has(2)&&at>=ended.get(2)+settleMs;},
 };
}

// Only an application-observed topic change may invalidate the experiment's
// scout. The scripted caller's next prompt is never evidence of detection.
export function observedTopicChange(event){
 return event.stage==='topic_changed'||event.type==='origen.research.delivery'&&event.deliveryReason==='different_requested_portion';
}
