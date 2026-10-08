import {createHash} from 'node:crypto';
export const reportRevision=report=>createHash('sha256').update(JSON.stringify(report)).digest('hex');
export const currentReviews=row=>(row.reviews??[]).filter(r=>r.revision===reportRevision(row.report));
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function reviewConversationFinding(database,subject,input){
 if(typeof subject!=='string'||!subject||!/^[0-9a-f-]{36}$/i.test(input.reviewId??'')||!/^[0-9a-f]{64}$/.test(input.revision??'')||!Number.isInteger(input.finding)||input.finding<0||!['confirmed','false_positive','insufficient_evidence','pending'].includes(input.status))throw fail(400,'invalid_review');
 const c=await database.connect();try{
  await c.query('BEGIN');
  const row=(await c.query('SELECT report,reviews FROM origen_conversation_quality WHERE review_id=$1 AND saved_summary_id IS NOT NULL FOR UPDATE',[input.reviewId])).rows[0];
  if(!row)throw fail(404,'analysis_not_found');
  if(reportRevision(row.report)!==input.revision)throw fail(409,'analysis_changed');
  if(input.finding>=row.report.findings.length)throw fail(400,'invalid_finding');
  const history=[...currentReviews(row),{revision:input.revision,finding:input.finding,status:input.status,reviewedAt:new Date().toISOString(),reviewer:createHash('sha256').update(subject).digest('hex')}];
  // Preserve the latest decision for every finding, plus bounded recent audit history.
  const latest=new Map();for(const decision of history)latest.set(decision.finding,decision);
  const audit=[...latest.values(),...history.slice(-200)];
  await c.query('UPDATE origen_conversation_quality SET reviews=$2 WHERE review_id=$1',[input.reviewId,JSON.stringify(audit)]);
  await c.query('COMMIT');return {saved:true};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
export function findingDecisions(row){
 const decisions=new Map();for(const review of currentReviews(row))decisions.set(review.finding,review);
 return row.report.findings.map((_,index)=>decisions.get(index)?.status??'pending');
}
