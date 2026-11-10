// Live transcripts are continuous fragments, not completed spoken turns. This
// ledger only suppresses optional repeat announcements; it never certifies that
// a person heard a fact or changes audio playback / the conversational floor.
const acknowledgment=/^(?:(?:yes|yeah|yep|yup|okay|ok|right|sure|uh huh|mhm|mm hmm|mm|hmm|i see|got it|thanks|thank you|si|claro|vale|entiendo|entiendo gracias|ya veo|de acuerdo|gracias|aha|aja)(?:\s+|$)){1,4}$/u;
const fold=text=>String(text||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const isResearchAcknowledgment=text=>!/[?¿？]/u.test(text)&&acknowledgment.test(fold(text));
const timed=value=>Number.isFinite(value)&&value>=0;
function interval(event){return timed(event.start_ms)&&timed(event.end_ms)&&event.end_ms>=event.start_ms?{start:event.start_ms,end:event.end_ms}:null;}
function portions(text){
 const result=[];let cursor=0;
 for(const match of text.matchAll(/[.!?。！？]+["”’')]*(?=\s|$)/gu)){
  const end=match.index+match[0].length;
  // Ellipses are not a reliable completion. A decimal within a sentence is
  // never split by the punctuation-plus-whitespace boundary above.
  if(/^\.{2,}/u.test(match[0]))continue;
  const leading=text.slice(cursor,end).match(/^\s*/u)[0].length;
  if(cursor+leading<end)result.push({start:cursor+leading,end,text:text.slice(cursor+leading,end)});
  cursor=end;
 }
 return {items:result,tail:!!text.slice(cursor).trim()};
}
export function researchSpeechObservation(){
 let text='',fragments=[],overlaps=[],active=null;
 function reset(){text='';fragments=[];overlaps=[];active=null;}
 function output(event){
  const delta=String(event.delta||'');if(!delta)return;
  fragments.push({start:text.length,end:text.length+delta.length,time:interval(event)});text+=delta;
 }
 function caller(event){
  if(!text)return;
  if(!active){active={text:'',start:text.length,resume:null,time:interval(event),finished:false};overlaps.push(active);}
  else {
   const time=interval(event);
   active.time=active.time&&time?{start:Math.min(active.time.start,time.start),end:Math.max(active.time.end,time.end)}:null;
  }
  active.text+=String(event.delta||'');
 }
 function callerStopped(){if(active){active.finished=true;active.resume=text.length;active=null;}}
 function finish({forced=false,playbackObserved=false}={}){
  const snapshot=text,groups=overlaps.map(group=>{
   const ack=group.finished&&isResearchAcknowledgment(group.text);
   // The grouping timer can still be open after native speech actually ended.
   // Fully timed, disjoint turns are sequential, not evidence of an overlap.
   const sequential=group.time&&fragments.length&&fragments.every(fragment=>fragment.time)&&
    fragments.every(fragment=>fragment.time.end<=group.time.start||fragment.time.start>=group.time.end);
   return {...group,ack,kind:sequential?'sequential':ack?'acknowledgment_overlap':group.finished?'substantive_interruption':'uncertain_overlap'};
  });
  const overlapping=groups.filter(group=>group.kind!=='sequential');
  const parsed=portions(snapshot);
  const completed=forced?[]:parsed.items.filter(portion=>groups.every(group=>{
   if(group.ack)return true;
   const covering=fragments.filter(fragment=>fragment.start<portion.end&&fragment.end>portion.start);
   // Native intervals can disambiguate a delayed transcript fragment. Without
   // them, arrival order is conservative and never joins a clause across a cut.
   if(group.time&&covering.length&&covering.every(fragment=>fragment.time)){
    const start=Math.min(...covering.map(fragment=>fragment.time.start)),end=Math.max(...covering.map(fragment=>fragment.time.end));
    return end<=group.time.start||(group.finished&&start>=group.time.end);
   }
   return portion.end<=group.start||(group.finished&&portion.start>=group.resume);
  }));
  // Even sequential turns must not stitch an unfinished earlier clause into a
  // later reply. Preserve that conservative delivery guard independently of
  // the diagnostic distinction between overlap and sequential speech.
  const interrupted=overlapping.some(group=>group.kind!=='acknowledgment_overlap')||
   groups.some(group=>group.kind==='sequential'&&!group.ack)&&(parsed.tail||completed.length<parsed.items.length);
  const result={
   completedText:completed.map(portion=>portion.text).join(' '),interrupted,
   speechOutcome:forced?'forced_flush':overlapping.some(group=>group.kind==='substantive_interruption')?'substantive_interruption':overlapping.some(group=>group.kind==='uncertain_overlap')?'uncertain_overlap':overlapping.length?'acknowledgment_overlap':'complete',
   completedPortions:completed.length,unfinishedPortion:parsed.tail||completed.length<parsed.items.length,
   playbackObserved:!!playbackObserved,overlapCount:overlapping.length,
  };
  reset();return result;
 }
 return {output,caller,callerStopped,finish};
}
