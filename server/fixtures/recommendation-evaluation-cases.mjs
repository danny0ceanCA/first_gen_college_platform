// Invented aggregate inputs, never an account export or teaching-access replay.
const key=n=>n.toString(16).padStart(64,'0');
export function syntheticRecommendationEvaluationRows(){return Array.from({length:40},(_,i)=>{
 const group=Math.floor(i/10);return {key:key(i+1),participant:key(i+101),sourceKey:key(500),status:group===3?'clarification_required':'recommended',considered:1,eligible:group===3?0:1,channel:i%2?'binder':'voice',language:i%2?'es':'en',latencyMs:200,
  displayed:i%2===1,played:i%2===0,accepted:group<3,outcome:group===3?'not_recorded':group===2?'insufficient':'student_reported',episodeKey:group<3?key(i+1000):null,reportedAttempt:group<2,pending:group===1,adverse:false,unknown:group===2,declinedOutcome:false,supportedOutcome:group===0};
});}
