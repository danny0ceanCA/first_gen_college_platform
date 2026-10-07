import test from 'node:test';
import assert from 'node:assert/strict';
import {institutionFilters,institutionMonth,syntheticReadiness,adminInstitutionReport,reportingReadiness} from './admin-institutions.mjs';
test('institution reporting uses only the last completed UTC month and validates filters',()=>{
 assert.equal(institutionMonth(new Date('2026-01-01T00:00:00Z')),'2025-12');
 assert.equal(institutionMonth(new Date('2026-10-31T23:59:59Z')),'2026-09');
 for(const input of [{month:'2026-10'},{days:30},{page:0},{page:1.5},{status:'approved'},{search:'x'.repeat(101)}])assert.throws(()=>institutionFilters(input),{status:400});
 assert.deepEqual(institutionFilters({search:' College ',status:'submitted'}),{page:1,search:'College',status:'submitted'});
});
test('synthetic research projection never exposes released or revoked datasets',()=>{
 const report={synthetic:true,productionDataRead:false,institutionApproval:false,realParticipantsEnrolled:0,liveReadiness:false,withdrawal:{blockedStoredDatasetAccess:true,complementarySuppression:true},revocation:{blockedAccess:true},released:{payload:{participantCount:20,private:'secret'},manifestId:'private-manifest'}};
 const result=syntheticReadiness(report);assert.equal(result.available,true);assert.equal(result.liveResearchEnabled,false);assert.equal(result.checks.length,3);
 assert.doesNotMatch(JSON.stringify(result),/secret|manifest|participantCount/);
 for(const change of [{synthetic:false},{productionDataRead:true},{institutionApproval:true},{realParticipantsEnrolled:1},{liveReadiness:true}])assert.equal(syntheticReadiness({...report,...change}).available,false);
});
test('institution reports bind literal search, suppress small metrics in SQL, and avoid user affiliation joins',async()=>{
 const calls=[],database={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('AS pages')?[{pages:'2',live_pages:'1',awaiting_review:'1',verified_pages:'1'}]:sql.includes('AS total')?[{total:'2'}]:[{id:'institution',page_views:null,link_clicks:'10'}]};}};
 const report=await adminInstitutionReport(database,{search:'50%_',page:2,status:'submitted'},new Date('2026-10-07T19:00:00Z'),async()=>({research:{available:false},operational:{ready:false}}));
 assert.equal(report.month,'2026-09');assert.equal(report.page,2);assert.equal(report.minimumCount,10);
 const query=calls.find(c=>c.sql.includes('OFFSET'));
 assert.deepEqual(query.args,['%50\\%\\_%','submitted','2026-09',25]);
 assert.match(query.sql,/page_views,0\)>=10 THEN m.page_views ELSE NULL/);assert.match(query.sql,/link_clicks,0\)>=10 THEN m.link_clicks ELSE NULL/);
 for(const call of calls)assert.doesNotMatch(call.sql,/origen_accounts|origen_students|origen_institution_members|work_email|auth0_subject|summary|transcript/);
 assert.equal(report.institutions[0].page_views,null);
});
test('readiness returns safe evidence results without raw owners or documents',async()=>{
 const result=await reportingReadiness(new Date('2026-10-07T19:00:00Z'));
 assert.equal(result.research.liveResearchEnabled,false);assert.equal(result.operational.gates.length,9);
 assert.doesNotMatch(JSON.stringify(result),/manifestId|auth0_subject|checkedAt|approvedBy|work_email/);
});
