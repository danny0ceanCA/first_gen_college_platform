import {createDatabase} from './database.mjs';
import {pathToFileURL} from 'node:url';
// Internal operator report only. No endpoint or institution permissions grant access.
export async function progressReport(database){
 const cutoff=new Date(Date.now()-90*86400000);
 const feedback=(await database.query("SELECT response_status,value,language,count(*) AS count FROM origen_progress_reports WHERE kind='feedback' AND recorded_at >= $1 GROUP BY response_status,value,language",[cutoff])).rows;
 const participants=(await database.query("SELECT count(DISTINCT account_id) AS count FROM origen_progress_reports WHERE kind='feedback' AND recorded_at >= $1",[cutoff])).rows[0];
 const milestones=(await database.query("SELECT value,count(*) AS count FROM origen_progress_reports WHERE kind='milestone' AND recorded_at >= $1 GROUP BY value",[cutoff])).rows;
 const total=feedback.reduce((sum,row)=>sum+Number(row.count),0);
 const answered=feedback.filter(row=>row.response_status==='answered').reduce((sum,row)=>sum+Number(row.count),0);
 return {windowDays:90,cohort:'Signed-in accounts voluntarily submitting feedback in this window; preview excluded',feedbackSubmissions:total,uniqueFeedbackAccounts:Number(participants.count),answeredSubmissions:answered,feedback:feedback.map(row=>({...row,count:Number(row.count)})),reportedMilestones:milestones.map(row=>({...row,count:Number(row.count)})),missingness:{notAsked:null,reason:'No exposure tracking or historic backfill. Absent feedback does not imply declined or zero.'},provenance:'Self-reported service feedback definition guidance-helpfulness v1, not a validated learning measure; milestones are not institution-verified. Counts are submissions, not students or causal outcomes. Repeated voluntary reports are possible. Internal use only; no research consent or partner export granted.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const database=createDatabase();if(!database)throw new Error('DATABASE_URL is required');
 try{console.log(JSON.stringify(await progressReport(database),null,2));}finally{await database.end();}
}
