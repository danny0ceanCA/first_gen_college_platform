import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {recentlyAuthenticated} from './recent-auth.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw fail(400,'invalid_institution');return v.trim();};
const https=v=>{const value=text(v,2000,true);let url;try{url=new URL(value);}catch{throw fail(400,'invalid_institution');}if(url.protocol!=='https:'||url.username||url.password)throw fail(400,'invalid_institution');return url.href;};
const email=v=>{const value=text(v,320,true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw fail(400,'invalid_institution');return value;};
export function validateInstitution(input){
 if(!input||!['load','register','save','submit','queue','verify','publish','request-changes'].includes(input.action))throw fail(400,'invalid_institution');
 const action=input.action;if(['load','queue'].includes(action))return {action};
 const out={action};
 if(action!=='register'){out.id=text(input.id,36,true);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.id)||!Number.isSafeInteger(input.revision)||input.revision<1)throw fail(400,'invalid_institution');out.revision=input.revision;}
 if(['verify','publish','request-changes'].includes(action)){out.note=text(input.note,2000,true);return out;}
 if(action==='submit')return out;
 const p=input.page;if(!p||!Array.isArray(p.links)||p.links.length>12)throw fail(400,'invalid_institution');
 out.page={name:text(p.name,200,true),website:https(p.website),description:text(p.description,5000,true),programs:text(p.programs,5000),admissions:text(p.admissions,5000),financialAid:text(p.financialAid,5000),events:text(p.events,5000),publicEmail:p.publicEmail?email(p.publicEmail):'',links:p.links.map(l=>({title:text(l.title,200,true),url:https(l.url)}))};
 if(action==='register'){const r=input.representative;if(!r)throw fail(400,'invalid_institution');out.representative={firstName:text(r.firstName,100,true),workEmail:email(r.workEmail),jobRole:text(r.jobRole,200,true)};}
 return out;
}
const view=row=>({id:row.id,slug:row.slug,verificationStatus:row.verification_status,status:row.status,revision:row.revision,page:row.draft,publishedRevision:row.published_revision,publishedAt:row.published_at});
export function createInstitutionRepository(database,reviewers=[]){const canReview=sub=>reviewers.includes(sub);return async(subject,input)=>{
 if(!database)throw fail(503,'institutions_unavailable');const c=await database.connect();
 try{
  await c.query('BEGIN');
  if(input.action==='public'){
   const row=(await c.query('SELECT slug,published,published_at FROM origen_institutions WHERE slug=$1 AND published IS NOT NULL',[input.slug])).rows[0];
   if(!row)throw fail(404,'page_not_found');await c.query('COMMIT');return {page:row.published,slug:row.slug,publishedAt:row.published_at};
  }
  await guardAccountTransaction(c,subject);
  if(['queue','verify','publish','request-changes'].includes(input.action)&&!canReview(subject))throw fail(403,'reviewer_required');
  if(input.action==='register'){
   const r=input.representative;
   await c.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$2,$3,$4) ON CONFLICT(auth0_subject) DO UPDATE SET first_name=$2,work_email=$3,job_role=$4',[subject,r.firstName,r.workEmail,r.jobRole]);
   const slug=`${input.page.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'institution'}-${crypto.randomUUID().slice(0,8)}`;
   const row=(await c.query('INSERT INTO origen_institutions(slug,draft) VALUES($1,$2) RETURNING id',[slug,JSON.stringify(input.page)])).rows[0];
   await c.query('INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,$2,$3)',[row.id,subject,'owner']);
  }
  if(['save','submit','verify','publish','request-changes'].includes(input.action)){
   const row=(await c.query('SELECT * FROM origen_institutions WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
   const member=(await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[input.id,subject])).rows[0];
   const review=['verify','publish','request-changes'].includes(input.action);
   if(!row||(!member&&!review))throw fail(404,'institution_not_found');
   if(review&&member)throw fail(403,'independent_review_required');
   if(row.revision!==input.revision)throw fail(409,'institution_changed');
   if(input.action==='save'){
    await c.query("UPDATE origen_institutions SET draft=$2,revision=revision+1,status='draft',updated_at=now() WHERE id=$1",[input.id,JSON.stringify(input.page)]);
    if(row.draft.name!==input.page.name||row.draft.website!==input.page.website)await c.query("UPDATE origen_institutions SET verification_status='pending' WHERE id=$1",[input.id]);
   }
   if(input.action==='submit')await c.query("UPDATE origen_institutions SET status='submitted',updated_at=now() WHERE id=$1",[input.id]);
   if(review){
    if(row.status!=='submitted')throw fail(409,'submission_required');
    if(input.action==='publish'&&row.verification_status!=='verified')throw fail(409,'verification_required');
    await c.query('INSERT INTO origen_institution_reviews(institution_id,revision,reviewer_subject,action,note) VALUES($1,$2,$3,$4,$5)',[input.id,input.revision,subject,input.action,input.note]);
    if(input.action==='verify')await c.query("UPDATE origen_institutions SET verification_status='verified',updated_at=now() WHERE id=$1",[input.id]);
    if(input.action==='publish')await c.query("UPDATE origen_institutions SET published=draft,published_revision=revision,published_at=now(),status='published',updated_at=now() WHERE id=$1",[input.id]);
    if(input.action==='request-changes')await c.query("UPDATE origen_institutions SET status='changes-requested',updated_at=now() WHERE id=$1",[input.id]);
   }
  }
  if(input.action==='queue'||['verify','publish','request-changes'].includes(input.action)){
   const rows=(await c.query("SELECT * FROM origen_institutions WHERE status='submitted' ORDER BY updated_at LIMIT 100")).rows;
   const submissions=[];for(const row of rows){const representatives=(await c.query('SELECT r.first_name,r.work_email,r.job_role FROM origen_institution_representatives r JOIN origen_institution_members m ON m.auth0_subject=r.auth0_subject WHERE m.institution_id=$1',[row.id])).rows;submissions.push({...view(row),representatives});}
   await c.query('COMMIT');return {submissions,canReview:true};
  }
  const rows=(await c.query('SELECT i.* FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id WHERE m.auth0_subject=$1 ORDER BY i.created_at DESC LIMIT 100',[subject])).rows;
  const representative=(await c.query('SELECT first_name,work_email,job_role FROM origen_institution_representatives WHERE auth0_subject=$1',[subject])).rows[0];
  const institutions=[];for(const row of rows){const reviews=(await c.query('SELECT action,note,revision,created_at FROM origen_institution_reviews WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 20',[row.id])).rows;institutions.push({...view(row),reviews});}
  await c.query('COMMIT');return {institutions,representative,canReview:canReview(subject)};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
};}
export function createInstitutionHandler(database,env={}){
 const run=createInstitutionRepository(database,(env.INSTITUTION_REVIEWER_SUBJECTS||'').split(',').map(x=>x.trim()).filter(Boolean));
 return async(req,res,next)=>{
  const path=req.url?.split('?')[0],publicSlug=/^\/api\/institutions\/published\/([a-z0-9-]{1,100})$/.exec(path||'');
  if(path!=='/api/institutions'&&!publicSlug)return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(publicSlug&&req.method!=='GET')return send(405,{error:'method_not_allowed'});
  if(!publicSlug&&(!req.origenAuthorized||!req.origenIdentity?.sub))return send(401,{error:'authentication_required'});
  if(!publicSlug&&req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!publicSlug&&!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  try{
   let input={action:'public',slug:publicSlug?.[1]};
   if(!publicSlug){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>100000)return send(413,{error:'too_large'});}try{input=validateInstitution(JSON.parse(raw));}catch{return send(400,{error:'invalid_institution'});}}
   if(['verify','publish','request-changes'].includes(input.action)&&!recentlyAuthenticated(req.origenIdentity))return send(403,{error:'reauthentication_required'});
   return send(200,await run(req.origenIdentity?.sub,input));
  }catch(error){const known=[400,403,404,409].includes(error.status);if(!known)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'institutions_unavailable'});}
 };
}
