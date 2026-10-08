import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {newDb,DataType} from 'pg-mem';
import {recordConversationQuality,adminConversationQuality,purgeConversationQuality} from './conversation-quality-store.mjs';
import {createHistoryRepository} from './history.mjs';
import {createSummaryHandler} from './conversation-summary.mjs';
import {createAdminHandler} from './admin.mjs';
import {reviewConversationFinding} from './conversation-reviews.mjs';

async function fixture(){
 const db=newDb();db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.none(`CREATE TABLE origen_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth0_subject text UNIQUE);
 CREATE TABLE origen_subject_locks(subject_hash text PRIMARY KEY);
 CREATE TABLE origen_closed_accounts(subject_hash text PRIMARY KEY);
 CREATE TABLE origen_students(account_id uuid REFERENCES origen_accounts(id) ON DELETE CASCADE,id text,PRIMARY KEY(account_id,id));
 CREATE TABLE origen_conversation_summaries(account_id uuid REFERENCES origen_accounts(id) ON DELETE CASCADE,id text,student_id text,mode text,summary text,sources jsonb,conversation_at timestamptz,PRIMARY KEY(account_id,id));`);
 db.public.none(await readFile(new URL('./migrations/019_voice_quality.sql',import.meta.url),'utf8'));
 db.public.none(await readFile(new URL('./migrations/025_conversation_quality.sql',import.meta.url),'utf8'));
 db.public.none(await readFile(new URL('./migrations/026_conversation_reviews.sql',import.meta.url),'utf8'));
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 const one=(await pool.query("INSERT INTO origen_accounts(auth0_subject) VALUES('auth0|one') RETURNING id")).rows[0].id;
 const two=(await pool.query("INSERT INTO origen_accounts(auth0_subject) VALUES('auth0|two') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO origen_students(account_id,id) VALUES($1,'student'),($2,'student')",[one,two]);
 return {pool,one,two,history:createHistoryRepository(pool)};
}
const item={id:'discussion',studentId:'student',mode:'finance',date:'2026-10-08T10:00:00Z',summary:'Synthetic summary.',sources:[]};
const capture={language:'en',qualityComplete:true,turns:[{role:'user',text:'How can PRIVATE_NAME pay for college?',topic:'finance',language:'en'},{role:'assistant',text:'Synthetic answer.'},{role:'user',text:'How can PRIVATE_NAME pay for college?',topic:'finance',language:'en'}]};

test('human review persists, filters the queue and rejects stale decisions without leaking identity',async()=>{
 const {pool,history}=await fixture();try{
  await history('auth0|one',{action:'save',item});await recordConversationQuality(pool,'auth0|one',item,capture);
  let report=await adminConversationQuality(pool,{},new Date('2026-10-09'));const row=report.recent[0];
  const decision={reviewId:row.reviewId,revision:row.revision,finding:0,status:'false_positive'};
  await reviewConversationFinding(pool,'auth0|reviewer',decision);
  report=await adminConversationQuality(pool,{reviewStatus:'false_positive'},new Date('2026-10-09'));
  assert.equal(report.reviewTotals.false_positive,1);assert.equal(report.recent[0].decisions[0],'false_positive');assert.ok(!JSON.stringify(report).includes('auth0|reviewer'));
  await assert.rejects(reviewConversationFinding(pool,'auth0|reviewer',{...decision,revision:'0'.repeat(64)}),{status:409});
  await assert.rejects(reviewConversationFinding(pool,'auth0|reviewer',{...decision,finding:999}),{status:400});
  await assert.rejects(reviewConversationFinding(pool,'auth0|reviewer',{...decision,status:'invented'}),{status:400});
  await recordConversationQuality(pool,'auth0|one',item,{...capture,turns:[...capture.turns,{role:'assistant',text:'A new answer.'}]});
  report=await adminConversationQuality(pool,{},new Date('2026-10-09'));assert.equal(report.reviewTotals.false_positive,0);
  await assert.rejects(reviewConversationFinding(pool,'auth0|reviewer',decision),{status:409});
  await history('auth0|one',{action:'delete',id:item.id});await assert.rejects(reviewConversationFinding(pool,'auth0|reviewer',decision),{status:404});
 }finally{await pool.end();}
});

test('summary fidelity uses saved text, persists flags once and upgrades incomplete captures',async()=>{
 const {pool,history}=await fixture();try{
  await history('auth0|one',{action:'save',item});let calls=0;
  const review=async(summary)=>{calls++;assert.equal(summary,item.summary);return {status:'checked',findings:[{category:'summary_omission',confidence:'medium',reason:'Important context may be missing.',evidence:[{kind:'turn',index:2}],needsReview:true}]};};
  await recordConversationQuality(pool,'auth0|one',{...item,summary:'Untrusted replacement'}, {...capture,qualityComplete:false},review);assert.equal(calls,0);
  const result=await recordConversationQuality(pool,'auth0|one',item,capture,review);assert.equal(result.summaryReview.status,'checked');assert.equal(result.counts.summary_omission,1);
  const retry=await recordConversationQuality(pool,'auth0|one',item,capture,review);assert.equal(calls,1);assert.equal(retry.counts.summary_omission,1);
  const admin=await adminConversationQuality(pool,{},new Date('2026-10-09'));assert.equal(admin.summariesChecked,1);
 }finally{await pool.end();}
});

test('real analysis persists only findings, deduplicates retries, protects account ownership and follows summary deletion',async()=>{
 const {pool,history}=await fixture();try{
  await history('auth0|one',{action:'save',item});
  await recordConversationQuality(pool,'auth0|one',item,capture);
  await recordConversationQuality(pool,'auth0|one',item,capture);
  const rows=(await pool.query('SELECT * FROM origen_conversation_quality')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].report.synthetic,false);assert.equal(rows[0].report.counts.repeated_question,1);assert.ok(!JSON.stringify(rows).includes('PRIVATE_NAME'));
  await assert.rejects(recordConversationQuality(pool,'auth0|two',item,capture),{status:404});
  await recordConversationQuality(pool,'auth0|one',item,{...capture,turns:[],qualityComplete:false});
  assert.equal((await pool.query('SELECT report FROM origen_conversation_quality')).rows[0].report.coverage.turns,3);
  await history('auth0|one',{action:'delete',id:item.id});assert.equal((await pool.query('SELECT * FROM origen_conversation_quality')).rows.length,0);
 }finally{await pool.end();}
});

test('deferred onboarding attaches when the summary saves, and account closure cascades findings',async()=>{
 const {pool,one,history}=await fixture();try{
  await recordConversationQuality(pool,'auth0|one',item,{...capture,defer:true});
  assert.equal((await pool.query('SELECT saved_summary_id FROM origen_conversation_quality')).rows[0].saved_summary_id,null);
  await history('auth0|one',{action:'save',item});
  assert.equal((await pool.query('SELECT saved_summary_id FROM origen_conversation_quality')).rows[0].saved_summary_id,item.id);
  await pool.query('DELETE FROM origen_accounts WHERE id=$1',[one]);assert.equal((await pool.query('SELECT * FROM origen_conversation_quality')).rows.length,0);
 }finally{await pool.end();}
});

test('technical events join only the authenticated account, and admin reporting supports filters and missing coverage',async()=>{
 const {pool,one,two,history}=await fixture();try{
  const session=crypto.randomUUID();
  for(const [owner,event] of [[one,'lookup_failure'],[two,'connection_failure']])await pool.query('INSERT INTO origen_voice_quality_events(account_id,attempt_id,session_id,sequence,event,mode,language) VALUES($1,$2,$3,1,$4,$5,$6)',[owner,crypto.randomUUID(),session,event,'finance','en']);
  await history('auth0|one',{action:'save',item});await history('auth0|one',{action:'save',item:{...item,id:'older-no-analysis'}});
  const result=await recordConversationQuality(pool,'auth0|one',item,{...capture,qualitySessionId:session});
  assert.equal(result.counts.tool_failure,1);assert.equal(result.counts.connection_failure,0);
  const report=await adminConversationQuality(pool,{days:7,topic:'finance',language:'en'},new Date('2026-10-09'));
  assert.equal(report.conversations,1);assert.equal(report.savedDiscussions,2);assert.equal(report.groups.find(g=>g.category==='tool_failure').topic,'finance');
  assert.ok(!JSON.stringify(report).includes('auth0|'));assert.ok(!JSON.stringify(report).includes('PRIVATE_NAME'));
  assert.equal((await adminConversationQuality(pool,{topic:'loans'},new Date('2026-10-09'))).conversations,0);
  await assert.rejects(adminConversationQuality(pool,{topic:'private'}),{status:400});
 }finally{await pool.end();}
});

async function call(handler,input,identity={sub:'auth0|one'}){
 const req=Readable.from([JSON.stringify(input)]);req.url='/api/conversation-summary';req.method='POST';req.headers={origin:'http://127.0.0.1:5173',host:'127.0.0.1:5173'};req.origenAuthorized=true;req.origenIdentity=identity;req.log=()=>{};
 let status,body;const res={writeHead:s=>status=s,end:text=>body=JSON.parse(text)};await handler(req,res,()=>{});return {status,body};
}

test('actual summary endpoint creates and retries analysis without another model call',async()=>{
 const {pool}=await fixture();try{
  let calls=0;const handler=createSummaryHandler({OPENAI_API_KEY:'synthetic'},async()=>{calls++;return {ok:true,status:200,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'Synthetic saved summary.'}]}]})};},pool);
  const input={...item,...capture};assert.equal((await call(handler,input)).status,200);
  assert.equal((await pool.query('SELECT report FROM origen_conversation_quality')).rows[0].report.coverage.turns,3);
  assert.equal((await call(handler,input)).status,200);assert.equal(calls,2);
 }finally{await pool.end();}
});

test('admin report requires server-granted access and retention cleanup is bounded',async()=>{
 let touched=false;const handler=createAdminHandler({query:async()=>{touched=true;throw Error();}},{});
 const req=Readable.from([JSON.stringify({action:'conversation-quality'})]);req.url='/api/admin';req.origenAuthorized=true;req.origenIdentity={sub:'auth0|ordinary',roles:['admin']};let status;
 await handler(req,{writeHead:s=>status=s,end:()=>{}},()=>{});assert.equal(status,403);assert.equal(touched,false);
 const queries=[];await purgeConversationQuality({query:async sql=>queries.push(sql)});assert.match(queries[0],/90 days/);assert.match(queries[0],/1 day/);
});
