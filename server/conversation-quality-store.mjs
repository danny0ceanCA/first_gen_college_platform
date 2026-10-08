import {reportRevision,findingDecisions} from './conversation-reviews.mjs';
import {createHash} from 'node:crypto';
import {guardAccountTransaction} from './account-guard.mjs';
import {adminWindow} from './admin-overview.mjs';
import {analyzeConversationQuality,qualityTrends} from './conversation-quality.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail=(status,message)=>Object.assign(new Error(message),{status});

// Uses the transcript already submitted for summarization; only derived findings persist.
export async function recordConversationQuality(database,subject,item,input,reviewSummary){
 if(!database||!subject||!item)return;
 const c=await database.connect();
 try{
  await c.query('BEGIN');await guardAccountTransaction(c,subject);
  const owner=(await c.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1 FOR UPDATE',[subject])).rows[0]?.id;
  if(!owner)throw fail(404,'account_not_found');
  const saved=(await c.query('SELECT student_id,mode,summary FROM origen_conversation_summaries WHERE account_id=$1 AND id=$2',[owner,item.id])).rows[0];
  if(saved&&(saved.student_id!==item.studentId||saved.mode!==item.mode))throw fail(409,'summary_conflict');
  if(!saved&&input.defer!==true)throw fail(404,'summary_not_found');
  const sessionId=uuid(input.qualitySessionId)?input.qualitySessionId:uuid(input.guidance?.sessionId)?input.guidance.sessionId:uuid(item.id)?item.id:null;
  const events=sessionId?(await c.query('SELECT event,mode,language FROM origen_voice_quality_events WHERE account_id=$1 AND session_id=$2 ORDER BY received_at,sequence LIMIT 1000',[owner,sessionId])).rows:[];
  const turns=input.turns.map(turn=>({role:turn.role,text:turn.text,topic:['profile','planning','finance','loans','admissions'].includes(turn.topic)?turn.topic:item.mode,...(['en','es'].includes(turn.language)?{language:turn.language}:{}),...(['en','es'].includes(turn.expectedLanguage)?{expectedLanguage:turn.expectedLanguage}:{})}));
  const report=analyzeConversationQuality({synthetic:false,turns,events,language:input.language,complete:input.qualityComplete===true,summaries:[{}]});
  const previous=(await c.query('SELECT mode,report FROM origen_conversation_quality WHERE account_id=$1 AND summary_id=$2',[owner,item.id])).rows[0];
  if(previous&&previous.mode!==item.mode)throw fail(409,'summary_conflict');
  if(previous&&(previous.report.coverage.turns>report.coverage.turns||previous.report.coverage.complete&&!report.coverage.complete)){
   if(saved)await c.query('UPDATE origen_conversation_quality SET saved_summary_id=$2 WHERE account_id=$1 AND summary_id=$2',[owner,item.id]);
   await c.query('COMMIT');return previous.report;
  }
  // A completed review is reused on retries. Older phase 2 reports can be upgraded.
  const fingerprint=createHash('sha256').update(JSON.stringify([saved?.summary??item.summary,turns.map(t=>[t.role,t.text])])).digest('hex');
  if(previous?.report.summaryReview?.fingerprint===fingerprint&&(previous.report.coverage.complete||previous.report.summaryReview.status==='checked'))report.summaryReview={...previous.report.summaryReview,findings:previous.report.findings.filter(f=>f.category.startsWith('summary_'))};
  else if(reviewSummary&&input.qualityComplete===true)report.summaryReview=await reviewSummary(saved?.summary??item.summary,turns);
  else report.summaryReview={status:'unavailable'};
  if(report.summaryReview.status==='checked'){
   for(const finding of report.summaryReview.findings??[])report.findings.push({...finding,topic:item.mode,language:input.language});
   for(const finding of report.summaryReview.findings??[])report.counts[finding.category]=(report.counts[finding.category]??0)+1;
  }
  // Findings are already in the report; avoid storing a second copy.
  report.summaryReview={version:'summary-fidelity-v1',fingerprint,status:report.summaryReview.status};
  await c.query(`INSERT INTO origen_conversation_quality(account_id,summary_id,saved_summary_id,mode,language,conversation_at,report) VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(account_id,summary_id) DO UPDATE SET saved_summary_id=EXCLUDED.saved_summary_id,report=EXCLUDED.report,analyzed_at=now()`,[owner,item.id,saved?item.id:null,item.mode,input.language,item.date,JSON.stringify(report)]);
  await c.query('COMMIT');return report;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}

export async function linkConversationQuality(c,owner,item){
 // Allows old test fixtures and additive schema rollout; production installs migration 025.
 if(!(await c.query("SELECT table_name FROM information_schema.tables WHERE table_name='origen_conversation_quality'")).rows.length)return;
 await c.query('UPDATE origen_conversation_quality SET saved_summary_id=$2 WHERE account_id=$1 AND summary_id=$2 AND mode=$3',[owner,item.id,item.mode]);
}

export async function purgeConversationQuality(database){
 if(database)await database.query("DELETE FROM origen_conversation_quality WHERE analyzed_at < now()-interval '90 days' OR (saved_summary_id IS NULL AND analyzed_at < now()-interval '1 day')");
}

export async function adminConversationQuality(database,input={},now=new Date()){
 const days=input.days??30,topic=input.topic??'all',language=input.language??'all';
 if(![7,30,90].includes(days)||!['all','profile','planning','finance','loans','admissions'].includes(topic)||!['all','en','es'].includes(language))throw fail(400,'invalid_quality_filter');
 const page=input.page??0,status=input.reviewStatus??'all';
 if(!Number.isInteger(page)||page<0||page>166||!['all','pending','confirmed','false_positive','insufficient_evidence'].includes(status))throw fail(400,'invalid_review_filter');
 const window=adminWindow(days,now);
 const rows=(await database.query(`SELECT review_id,reviews,mode,language,conversation_at,analyzed_at,report FROM origen_conversation_quality WHERE saved_summary_id IS NOT NULL AND conversation_at >= $1 AND conversation_at < $2 AND ($3='all' OR mode=$3) AND ($4='all' OR language=$4) ORDER BY conversation_at DESC LIMIT 5001`,[window.start,window.end,topic,language])).rows;
 const selected=rows.slice(0,5000),reports=selected.map(row=>row.report);
 const trends=qualityTrends(reports);
 const coverage=(await database.query(`SELECT count(*) AS saved FROM origen_conversation_summaries WHERE conversation_at >= $1 AND conversation_at < $2 AND ($3='all' OR mode=$3)`,[window.start,window.end,topic])).rows[0];
 const totals={pending:0,confirmed:0,false_positive:0,insufficient_evidence:0};
 for(const row of selected)for(const decision of findingDecisions(row))totals[decision]++;
 const queue=selected.filter(row=>status==='all'||findingDecisions(row).includes(status));
 return {...trends,reviewTotals:totals,page,queueSize:queue.length,window,generatedAt:now.toISOString(),savedDiscussions:Number(coverage?.saved??0),coverageLanguageScope:'Saved discussion count includes both languages; older summaries do not record response language.',truncated:rows.length>5000,
  reviewed:totals.confirmed+totals.false_positive+totals.insufficient_evidence,reviewStatus:'Human review decisions; automated signals remain separate',recent:queue.slice(page*30,page*30+30).map(row=>({reviewId:row.review_id,revision:reportRevision(row.report),decisions:findingDecisions(row),topic:row.mode,language:row.language,date:row.conversation_at,analyzedAt:row.analyzed_at,summaryReview:row.report.summaryReview,coverage:row.report.coverage,findings:row.report.findings})),retentionDays:90};
}
