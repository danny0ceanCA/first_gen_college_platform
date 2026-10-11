import {readFile} from 'node:fs/promises';
import {assessReadiness,REQUIRED_GATES} from '../ops/readiness.mjs';
const invalid=()=>{throw Object.assign(new Error('invalid_institution_filter'),{status:400});};
export function institutionFilters(input={}){
 const {page=1,search='',status='all'}=input;
 if(!Number.isInteger(page)||page<1||page>100000||typeof search!=='string'||search.length>100||!['all','draft','submitted','changes-requested','published'].includes(status))invalid();
 // This report never accepts a live/custom month, even from an administrator.
 if(input.month!==undefined||input.days!==undefined)invalid();
 return {page,search:search.trim(),status};
}
export function institutionMonth(now=new Date()){return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);}
// Return control-test results only. Never expose an expired/revoked research payload.
export function syntheticReadiness(report){
 if(report?.synthetic!==true||report.productionDataRead!==false||report.institutionApproval!==false||report.realParticipantsEnrolled!==0||report.liveReadiness!==false)return {available:false,synthetic:true,liveResearchEnabled:false};
 return {available:true,synthetic:true,liveResearchEnabled:false,source:'synthetic-generator-v1',checks:[
  {id:'withdrawal',label:'Withdrawal blocks stored dataset access',passed:report.withdrawal?.blockedStoredDatasetAccess===true},
  {id:'suppression',label:'Complementary suppression exercised',passed:report.withdrawal?.complementarySuppression===true},
  {id:'revocation',label:'Recipient revocation blocks access',passed:report.revocation?.blockedAccess===true}
 ],limitations:['Historical synthetic control exercise; no real study or participants.','Downloaded copies require recipient follow-up.','No research release or model-training authorization is granted.']};
}
export async function reportingReadiness(now=new Date()){
 const [synthetic,evidence]=await Promise.allSettled([
  readFile(new URL('../research/sandbox/latest.synthetic-report.json',import.meta.url),'utf8').then(JSON.parse),
  readFile(new URL('../ops/evidence.json',import.meta.url),'utf8').then(JSON.parse)
 ]);
 let operational={available:false,ready:false,gates:REQUIRED_GATES.map(id=>({id,valid:false}))};
 if(evidence.status==='fulfilled')try{
  const assessed=assessReadiness(evidence.value,now);
  operational={available:true,ready:assessed.ready,gates:REQUIRED_GATES.map(id=>({id,valid:evidence.value?.schemaVersion===1&&!assessed.blockingReasons.some(reason=>reason.startsWith(id+':'))}))};
 }catch{/* Invalid evidence does not establish readiness. */}
 return {research:syntheticReadiness(synthetic.status==='fulfilled'?synthetic.value:null),operational};
}
export async function adminInstitutionReport(database,input={},now=new Date(),readiness=reportingReadiness){
 institutionFilters(input);
 const c=await database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const report=await buildInstitutionReport(c,input,now,readiness);await c.query('COMMIT');return report;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
export async function buildInstitutionReport(database,input={},now=new Date(),readiness=reportingReadiness){
 const filters=institutionFilters(input),month=institutionMonth(now);
 const start=new Date(month+'-01T00:00:00Z'),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
 const search=`%${filters.search.replace(/[\\%_]/g,'\\$&')}%`;
 const where="(COALESCE(i.draft->>'name','') ILIKE $1 ESCAPE '\\' OR i.slug ILIKE $1 ESCAPE '\\') AND ($2='all' OR i.status=$2)";
 const [totals,count,rows,prepared,collection]=await Promise.all([
  database.query("SELECT count(*) AS pages,count(*) FILTER(WHERE published IS NOT NULL) AS live_pages,count(*) FILTER(WHERE status='submitted') AS awaiting_review,count(*) FILTER(WHERE verification_status='verified') AS verified_pages FROM origen_institutions"),
  database.query(`SELECT count(*) AS total FROM origen_institutions i WHERE ${where}`,[search,filters.status]),
  database.query(`WITH selected AS (SELECT i.* FROM origen_institutions i WHERE ${where} ORDER BY i.updated_at DESC,i.id ASC LIMIT 25 OFFSET $4)
   SELECT i.id,i.slug,COALESCE(i.draft->>'name','') AS name,i.status,i.verification_status,i.published IS NOT NULL AS live,i.updated_at,
   CASE WHEN COALESCE(m.page_views,0)>=10 THEN m.page_views ELSE NULL END AS page_views,
   CASE WHEN COALESCE(m.link_clicks,0)>=10 THEN m.link_clicks ELSE NULL END AS link_clicks,
   CASE WHEN o.inquiries>=10 THEN o.inquiries ELSE NULL END AS inquiries,
   CASE WHEN o.rsvps>=10 THEN o.rsvps ELSE NULL END AS rsvps,
   CASE WHEN o.responded>=10 THEN round(o.response_hours) ELSE NULL END AS first_response_hours
   FROM selected i LEFT JOIN
    (SELECT institution_id,max(CASE WHEN metric='page_view' THEN count ELSE 0 END) AS page_views,max(CASE WHEN metric='link_click' THEN count ELSE 0 END) AS link_clicks FROM origen_institution_metrics WHERE month=$3 AND institution_id IN (SELECT id FROM selected) GROUP BY institution_id) m ON m.institution_id=i.id
   LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE kind='inquiry') AS inquiries,count(*) FILTER(WHERE kind='rsvp') AS rsvps,
    count(*) FILTER(WHERE first_response_at>=submitted_at AND first_response_at<$6) AS responded,
    avg(extract(epoch FROM first_response_at-submitted_at)/3600) FILTER(WHERE first_response_at>=submitted_at AND first_response_at<$6) AS response_hours
    FROM origen_institution_outreach_facts WHERE institution_id=i.id AND submitted_at>=$5 AND submitted_at<$6) o ON true
   ORDER BY i.updated_at DESC,i.id ASC`,[search,filters.status,month,(filters.page-1)*25,start,end]),
  readiness(now),
  database.query('SELECT started_at FROM origen_institution_outreach_collection WHERE singleton=1')
 ]);
 const startedAt=collection.rows[0]?.started_at,coverage=!startedAt||new Date(startedAt)>=end?'not-collected':new Date(startedAt)>start?'partial-month':'availability-not-verified';
 if(coverage==='not-collected')for(const row of rows.rows)Object.assign(row,{inquiries:null,rsvps:null,first_response_hours:null});
 return {schemaVersion:2,classification:'internal-operational-report',generatedAt:now.toISOString(),month,timeZone:'UTC',minimumCount:10,
  filters,page:filters.page,pageSize:25,total:Number(count.rows[0].total),totals:totals.rows[0],institutions:rows.rows,
  outreach:{collectionStartedAt:startedAt?new Date(startedAt).toISOString():null,coverage},
  readiness:prepared,sources:['origen_institutions','origen_institution_metrics','origen_institution_outreach_facts','research/sandbox/latest.synthetic-report.json','ops/evidence.json'],
  definitions:{engagement:'Anonymous event counts in the last completed UTC calendar month, not unique visitors. Counts below 10, including zero or absent counters, are suppressed.',
   outreach:'Question requests and RSVP requests first submitted in this month, attributed only to the original receiving institution or department. No parent rollup, user identity or inferred affiliation. RSVPs are requests, not confirmed attendance.',
   firstResponse:'Rounded mean hours to the first request reply before month end, for requests submitted in the month. Requires at least 10 replied requests. Unanswered requests are excluded; this can make the average look better. Future outreach is not a request reply.',
   coverage:'Pre-collection inquiries are not reconstructed. Full-month availability is not verified; missing collection and small counts remain unavailable. No cumulative totals or narrow date filters allow subtraction of suppressed groups.',
   scope:'Page status totals cover all current institution pages. Directory filters and pagination apply to the displayed rows and downloadable page.',research:'Synthetic controls only. No student/institution cohort, outcome or live research release is available.',approval:'Operational evidence checks and institution page verification do not constitute institutional study approval.'}};
}
