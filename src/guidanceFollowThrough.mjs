// This is a private, self-reported workflow, not a measure of comprehension.
export function guidanceProgress(progress){
 const steps=Array.isArray(progress?.steps)?progress.steps:[],active=steps.filter(s=>s.planStatus==='active');
 let state=['explored','deferred'].includes(progress?.state)?progress.state:'suggested';
 if(steps.length){
  state=progress.stepsTruncated?'accepted':!active.length?'archived':active.every(s=>s.status==='complete')?'complete':active.some(s=>s.status==='in-progress')?'in-progress':active.some(s=>s.status==='not-started')?'accepted':'deferred';
 }
 return {state,hasLinkedSteps:steps.length>0,shouldOffer:state==='suggested'};
}
