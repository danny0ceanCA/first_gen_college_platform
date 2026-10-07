import {validateInstitutionExtras} from './institution-content.mjs';
import {renderInstitutionPage,renderUnavailableInstitutionPage,publicInstitutionURL} from './institution-public-html.mjs';
import QRCode from 'qrcode';
import {notifyInstitution,institutionNotifications} from './institution-notifications.mjs';
import {createHash} from 'node:crypto';
import {accessActions,validateAccess,runAccess,accessEvent,invitationIdentity} from './institution-access.mjs';
import {safeErrorCode} from './api-logging.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {recentlyAuthenticated} from './recent-auth.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw fail(400,'invalid_institution');return v.trim();};
const https=v=>{const value=text(v,2000,true);let url;try{url=new URL(value);}catch{throw fail(400,'invalid_institution');}if(url.protocol!=='https:'||url.username||url.password)throw fail(400,'invalid_institution');return url.href;};
const email=v=>{const value=text(v,320,true);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw fail(400,'invalid_institution');return value;};
export function validateInstitutionPage(p,complete=false){
 if(!p||!Array.isArray(p.links)||p.links.length>12)throw fail(400,'invalid_institution');
 const field=(value,max)=>{if(typeof value!=='string'||value.length>max)throw fail(400,'invalid_institution');return value;};
 const page={name:field(p.name,200),website:field(p.website,2000),description:field(p.description,5000),programs:field(p.programs,5000),admissions:field(p.admissions,5000),financialAid:field(p.financialAid,5000),events:field(p.events,5000),publicEmail:field(p.publicEmail||'',320),links:p.links.map(l=>({title:field(l.title,200),url:field(l.url,2000)}))};
 if(complete){text(page.name,200,true);text(page.description,5000,true);https(page.website);if(page.publicEmail)email(page.publicEmail);for(const link of page.links){text(link.title,200,true);https(link.url);}}
 return {...page,...validateInstitutionExtras(p,complete)};
}
export function validateInstitution(input){
 if(!input||![...accessActions,'load','register','save','submit','queue','verify','publish','request-changes','archive','unpublish','restore','mark-notification'].includes(input.action))throw fail(400,'invalid_institution');
 if(accessActions.includes(input.action))return validateAccess(input);
 const action=input.action;if(['load','queue'].includes(action))return {action};
 const out={action};
 if(action!=='register'){out.id=text(input.id,36,true);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.id)||action!=='mark-notification'&&(!Number.isSafeInteger(input.revision)||input.revision<1))throw fail(400,'invalid_institution');out.revision=input.revision;}
 if(action==='mark-notification')return {action,id:out.id};
 if(['archive','unpublish','restore'].includes(action))return out;
 if(['verify','publish','request-changes'].includes(action)){out.note=text(input.note,2000,true);return out;}
 if(action==='submit')return out;
 out.page=validateInstitutionPage(input.page);
 if(action==='register'){
  if(typeof input.registrationKey!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.registrationKey))throw fail(400,'invalid_institution');
  out.registrationKey=input.registrationKey;out.unitType=input.unitType||'institution';out.parentId=input.parentId||null;
  if(!['institution','department','program'].includes(out.unitType)||out.unitType==='institution'&&out.parentId||out.unitType!=='institution'&&(!out.parentId||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.parentId)))throw fail(400,'invalid_institution');
  text(out.page.name,200,true);
  const r=input.representative;if(!r)throw fail(400,'invalid_institution');out.representative={firstName:text(r.firstName,100,true),workEmail:email(r.workEmail),jobRole:text(r.jobRole,200,true)};}
 return out;
}
const view=row=>({contentSchemaVersion:row.content_schema_version,id:row.id,slug:row.slug,verificationStatus:row.verification_status,status:row.status,revision:row.revision,page:row.draft,publishedRevision:row.published_revision,publishedAt:row.published_at,publishedPage:row.published,updatedAt:row.updated_at,draftSavedAt:row.draft_saved_at,archivedAt:row.archived_at,parentInstitutionId:row.parent_institution_id,unitType:row.unit_type,parentApproval:row.parent_approval,membershipRole:row.membership_role});
export function createInstitutionRepository(database,reviewers=[]){const canReview=sub=>reviewers.includes(sub);return async(subject,input,identity={})=>{
 if(!database)throw fail(503,'institutions_unavailable');const c=await database.connect();let registeredInstitutionId;
 try{
  await c.query('BEGIN');
  if(input.action==='directory'){
   const pattern='%'+(input.search||'').replace(/[\\%_]/g,'\\$&')+'%';
   const rows=(await c.query("SELECT i.slug,i.published,i.unit_type,i.published_at,p.published AS parent_page,p.slug AS parent_slug FROM origen_institutions i LEFT JOIN origen_institutions p ON p.id=i.parent_institution_id WHERE i.published IS NOT NULL AND i.archived_at IS NULL AND (i.parent_institution_id IS NULL OR (i.parent_approval='approved' AND p.published IS NOT NULL AND p.archived_at IS NULL)) AND i.slug > $1 AND (i.published->>'name' ILIKE $2 OR i.published->'translations'->'es'->>'name' ILIKE $2) ORDER BY i.slug LIMIT 25",[input.cursor||'',pattern])).rows;
   const more=rows.length===25,entries=rows.slice(0,24).map(row=>({slug:row.slug,name:row.published.name,intro:row.published.intro||row.published.description.slice(0,240),logoUrl:row.published.logoUrl||'',spanishName:row.published.translations?.es?.name||'',spanishIntro:row.published.translations?.es?.intro||row.published.translations?.es?.description?.slice(0,240)||'',unitType:row.unit_type,parent:row.parent_page?{name:row.parent_page.name,slug:row.parent_slug}:null,publishedAt:row.published_at}));
   await c.query('COMMIT');return {entries,nextCursor:more?entries.at(-1).slug:null};
  }
  if(input.action==='public'){
   const row=(await c.query('SELECT id,slug,published,published_at,parent_institution_id FROM origen_institutions WHERE slug=$1 AND published IS NOT NULL AND archived_at IS NULL',[input.slug])).rows[0];
   if(!row)throw fail(404,'page_not_found');
   const parent=row.parent_institution_id?(await c.query('SELECT slug,published FROM origen_institutions WHERE id=$1 AND published IS NOT NULL AND archived_at IS NULL',[row.parent_institution_id])).rows[0]:null;
   if(row.parent_institution_id&&!parent)throw fail(404,'page_not_found');
   const units=(await c.query("SELECT slug,published,unit_type FROM origen_institutions WHERE parent_institution_id=$1 AND parent_approval='approved' AND published IS NOT NULL AND archived_at IS NULL ORDER BY created_at",[row.id])).rows;
   await c.query('COMMIT');return {page:row.published,slug:row.slug,publishedAt:row.published_at,parent:parent?{name:parent.published.name,slug:parent.slug}:null,units:units.map(u=>({name:u.published.name,slug:u.slug,unitType:u.unit_type}))};
  }
  await guardAccountTransaction(c,subject);
  if(input.action==='mark-notification'){await c.query('UPDATE origen_institution_notifications SET read_at=now() WHERE id=$1 AND auth0_subject=$2 AND institution_id IN (SELECT institution_id FROM origen_institution_members WHERE auth0_subject=$2)',[input.id,subject]);await c.query('COMMIT');return {ok:true};}
  if(accessActions.includes(input.action)){const result=await runAccess(c,subject,input,identity,canReview(subject));await c.query('COMMIT');return result;}
  if(['queue','verify','publish','request-changes'].includes(input.action)&&!canReview(subject))throw fail(403,'reviewer_required');
  if(input.action==='register'){
   const key=input.registrationKey||crypto.randomUUID();
   const fingerprint=createHash('sha256').update(JSON.stringify({page:input.page,representative:input.representative,unitType:input.unitType||'institution',parentId:input.parentId||null})).digest('hex');
   const existing=(await c.query('SELECT * FROM origen_institution_registration_requests WHERE auth0_subject=$1 AND request_id=$2',[subject,key])).rows[0];
   registeredInstitutionId=existing?.institution_id;
   if(existing&&existing.payload_hash!==fingerprint)throw fail(409,'registration_changed');
   if(!existing){
    let approval='approved';
    if(input.parentId){
     const parent=(await c.query('SELECT * FROM origen_institutions WHERE id=$1 FOR UPDATE',[input.parentId])).rows[0];
     const membership=(await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[input.parentId,subject])).rows[0];
     if(!parent||parent.archived_at||parent.parent_institution_id||(!parent.published&&!membership))throw fail(404,'parent_not_found');
     approval=membership?.role==='owner'?'approved':'pending';
    }
    const r=input.representative;
    await c.query('INSERT INTO origen_institution_representatives(auth0_subject,first_name,work_email,job_role) VALUES($1,$2,$3,$4) ON CONFLICT(auth0_subject) DO UPDATE SET first_name=$2,work_email=$3,job_role=$4',[subject,r.firstName,r.workEmail,r.jobRole]);
    const slug=`${input.page.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'institution'}-${crypto.randomUUID().slice(0,8)}`;
    const row=(await c.query('INSERT INTO origen_institutions(slug,draft,parent_institution_id,unit_type,parent_approval,content_schema_version) VALUES($1,$2,$3,$4,$5,2) RETURNING id',[slug,JSON.stringify(input.page),input.parentId||null,input.unitType||'institution',approval])).rows[0];
    await c.query('INSERT INTO origen_institution_members(institution_id,auth0_subject,role) VALUES($1,$2,$3)',[row.id,subject,'owner']);
    await c.query('INSERT INTO origen_institution_registration_requests(auth0_subject,request_id,payload_hash,institution_id) VALUES($1,$2,$3,$4)',[subject,key,fingerprint,row.id]);
    registeredInstitutionId=row.id;await accessEvent(c,row.id,subject,'register',subject);
   }
  }
  if(['save','submit','verify','publish','request-changes','archive','unpublish','restore'].includes(input.action)){
   const relation=(await c.query('SELECT parent_institution_id FROM origen_institutions WHERE id=$1',[input.id])).rows[0];
   if(relation?.parent_institution_id)await c.query('SELECT id FROM origen_institutions WHERE id=$1 FOR UPDATE',[relation.parent_institution_id]);
   const row=(await c.query('SELECT * FROM origen_institutions WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
   const member=(await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[input.id,subject])).rows[0];
   const review=['verify','publish','request-changes'].includes(input.action);
   if(!row||(!member&&!review))throw fail(404,'institution_not_found');
   const parentMember=row.parent_institution_id?(await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[row.parent_institution_id,subject])).rows[0]:null;
   if(review&&(member||parentMember))throw fail(403,'independent_review_required');
   if(!review&&!['owner','editor'].includes(member.role))throw fail(403,'editor_required');
   const lifecycle=['archive','unpublish','restore'].includes(input.action);
   if(lifecycle&&member?.role!=='owner')throw fail(403,'owner_required');
   if(row.archived_at&&input.action!=='restore')throw fail(409,'institution_archived');
   if(!['save','archive','unpublish','restore'].includes(input.action)&&row.parent_approval!=='approved')throw fail(409,'parent_approval_required');
   if(input.action==='publish'&&row.parent_institution_id){const parent=(await c.query('SELECT published,verification_status,archived_at FROM origen_institutions WHERE id=$1',[row.parent_institution_id])).rows[0];if(!parent?.published||parent.archived_at||parent.verification_status!=='verified')throw fail(409,'parent_publication_required');}
   if(row.revision!==input.revision)throw fail(409,'institution_changed');
   if(['submit','publish'].includes(input.action)){try{validateInstitutionPage(row.draft,true);}catch{throw fail(400,'draft_incomplete');}}
   if(lifecycle){
    if(['archive','unpublish'].includes(input.action)&&(await c.query('SELECT id FROM origen_institutions WHERE parent_institution_id=$1 AND published IS NOT NULL',[row.id])).rows.length)throw fail(409,'published_departments_exist');
    if(input.action==='restore'){if(!row.archived_at)throw fail(409,'institution_not_archived');await c.query("UPDATE origen_institutions SET archived_at=NULL,revision=revision+1,status='draft',updated_at=now() WHERE id=$1",[row.id]);}
    else {if(input.action==='unpublish'&&!row.published)throw fail(409,'page_not_published');await c.query("UPDATE origen_institutions SET archived_at=$2,published=NULL,published_revision=NULL,published_at=NULL,revision=revision+1,status='draft',updated_at=now() WHERE id=$1",[row.id,input.action==='archive'?new Date():null]);}
    await accessEvent(c,row.id,subject,input.action);await notifyInstitution(c,row.id,input.action,row.revision+1);
   }
   if(input.action==='save'&&JSON.stringify(row.draft)!==JSON.stringify(input.page)){
    await c.query("UPDATE origen_institutions SET draft=$2,revision=revision+1,status='draft',updated_at=now(),draft_saved_at=now(),content_schema_version=2 WHERE id=$1",[input.id,JSON.stringify(input.page)]);
    if(row.draft.name!==input.page.name||row.draft.website!==input.page.website)await c.query("UPDATE origen_institutions SET verification_status='pending' WHERE id=$1",[input.id]);
   }
   if(input.action==='submit'&&row.status!=='submitted')await c.query("UPDATE origen_institutions SET status='submitted',updated_at=now() WHERE id=$1",[input.id]);
   if(review){
    if(row.status!=='submitted')throw fail(409,'submission_required');
    if(input.action==='publish'&&row.verification_status!=='verified')throw fail(409,'verification_required');
    await c.query('INSERT INTO origen_institution_reviews(institution_id,revision,reviewer_subject,action,note) VALUES($1,$2,$3,$4,$5)',[input.id,input.revision,subject,input.action,input.note]);
    if(input.action==='verify')await c.query("UPDATE origen_institutions SET verification_status='verified',updated_at=now() WHERE id=$1",[input.id]);
    if(input.action==='publish')await c.query("UPDATE origen_institutions SET published=draft,published_revision=revision,published_at=now(),status='published',updated_at=now() WHERE id=$1",[input.id]);
    await notifyInstitution(c,row.id,input.action,row.revision);
    if(input.action==='request-changes')await c.query("UPDATE origen_institutions SET status='changes-requested',updated_at=now() WHERE id=$1",[input.id]);
   }
  }
  if(input.action==='queue'||['verify','publish','request-changes'].includes(input.action)){
   const rows=(await c.query("SELECT * FROM origen_institutions WHERE status='submitted' AND archived_at IS NULL ORDER BY updated_at LIMIT 100")).rows;
   const submissions=[];for(const row of rows){const representatives=(await c.query('SELECT r.first_name,r.work_email,r.job_role FROM origen_institution_representatives r JOIN origen_institution_members m ON m.auth0_subject=r.auth0_subject WHERE m.institution_id=$1',[row.id])).rows;const parent=row.parent_institution_id?(await c.query('SELECT published,draft FROM origen_institutions WHERE id=$1',[row.parent_institution_id])).rows[0]:null;submissions.push({...view(row),parentName:parent?(parent.published||parent.draft).name:null,representatives});}
   await c.query('COMMIT');return {submissions,canReview:true};
  }
  const rows=(await c.query('SELECT i.*,m.role AS membership_role FROM origen_institutions i JOIN origen_institution_members m ON m.institution_id=i.id WHERE m.auth0_subject=$1 ORDER BY i.created_at DESC LIMIT 100',[subject])).rows;
  const representative=(await c.query('SELECT first_name,work_email,job_role FROM origen_institution_representatives WHERE auth0_subject=$1',[subject])).rows[0];
  const institutions=[];for(const row of rows){const reviews=(await c.query('SELECT action,note,revision,created_at FROM origen_institution_reviews WHERE institution_id=$1 ORDER BY created_at DESC LIMIT 20',[row.id])).rows;const parent=row.parent_institution_id?(await c.query('SELECT draft,published FROM origen_institutions WHERE id=$1',[row.parent_institution_id])).rows[0]:null;const publicationHistory=(await c.query("SELECT action,created_at FROM origen_institution_access_events WHERE institution_id=$1 AND action IN ('archive','unpublish','restore') ORDER BY created_at DESC LIMIT 20",[row.id])).rows;institutions.push({...view(row),publicationHistory,parentName:parent?(parent.published||parent.draft).name:null,reviews});}
  const unitRequests=(await c.query("SELECT u.id,u.draft,u.unit_type,u.parent_institution_id,p.draft AS parent_draft FROM origen_institutions u JOIN origen_institutions p ON p.id=u.parent_institution_id JOIN origen_institution_members m ON m.institution_id=p.id WHERE m.auth0_subject=$1 AND m.role='owner' AND u.parent_approval='pending' AND u.archived_at IS NULL AND p.archived_at IS NULL ORDER BY u.created_at LIMIT 100",[subject])).rows.map(u=>({id:u.id,name:u.draft.name,unitType:u.unit_type,parentId:u.parent_institution_id,parentName:u.parent_draft.name}));
  const authorizedUnits=(await c.query("SELECT u.id,u.draft,u.unit_type,u.status,u.parent_approval,u.archived_at,u.parent_institution_id,p.draft AS parent_draft FROM origen_institutions u JOIN origen_institutions p ON p.id=u.parent_institution_id JOIN origen_institution_members m ON m.institution_id=p.id WHERE m.auth0_subject=$1 AND m.role='owner' ORDER BY u.created_at LIMIT 100",[subject])).rows.map(u=>({id:u.id,name:u.draft.name,unitType:u.unit_type,parentId:u.parent_institution_id,parentName:u.parent_draft.name,status:u.status,parentApproval:u.parent_approval,archivedAt:u.archived_at}));
  const affiliationRequests=(await c.query(canReview(subject)?'SELECT a.*,r.first_name,r.work_email,r.job_role FROM origen_institution_affiliation_requests a JOIN origen_institution_representatives r ON r.auth0_subject=a.auth0_subject ORDER BY a.created_at DESC LIMIT 100':'SELECT * FROM origen_institution_affiliation_requests WHERE auth0_subject=$1 ORDER BY created_at DESC LIMIT 100',canReview(subject)?[]:[subject])).rows;const notifications=await institutionNotifications(c,subject);await c.query('COMMIT');return {registeredInstitutionId,institutions,representative,unitRequests,authorizedUnits,affiliationRequests,notifications,canReview:canReview(subject)};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
};}
export function createInstitutionHandler(database,env={}){
 const run=createInstitutionRepository(database,(env.INSTITUTION_REVIEWER_SUBJECTS||'').split(',').map(x=>x.trim()).filter(Boolean));
 return async(req,res,next)=>{
  const requestURL=new URL(req.url,'http://localhost');const path=requestURL.pathname,sharing=/^\/api\/institutions\/(pages|qr)\/([a-z0-9-]{1,100})$/.exec(path),directory=path==='/api/institutions/directory';const publicSlug=/^\/api\/institutions\/published\/([a-z0-9-]{1,100})$/.exec(path||'');
  if(path!=='/api/institutions'&&!publicSlug&&!sharing&&!directory)return next();const publicRequest=!!publicSlug||!!sharing||directory;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(publicRequest&&req.method!=='GET')return send(405,{error:'method_not_allowed'});
  if(!publicRequest&&(!req.origenAuthorized||!req.origenIdentity?.sub))return send(401,{error:'authentication_required'});
  if(!publicRequest&&req.method!=='POST')return send(405,{error:'method_not_allowed'});
  if(!publicRequest&&!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  try{
   let input={action:'public',slug:publicSlug?.[1]||sharing?.[2]};
   if(directory){const search=requestURL.searchParams.get('q')||'',cursor=requestURL.searchParams.get('cursor')||'';if(search.length>120||cursor&&!/^[a-z0-9-]{1,100}$/.test(cursor))return send(400,{error:'invalid_directory'});input={action:'directory',search,cursor};}
   if(!publicRequest){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1000000)return send(413,{error:'too_large'});}try{input=validateInstitution(JSON.parse(raw));}catch{return send(400,{error:'invalid_institution'});}}
   if(['verify','publish','request-changes','transfer-owner','review-affiliation'].includes(input.action)&&!recentlyAuthenticated(req.origenIdentity))return send(403,{error:'reauthentication_required'});
   const identity=input.action==='accept-invite'?await invitationIdentity(req,env):req.origenIdentity;
   const result=await run(req.origenIdentity?.sub,input,identity);
   if(sharing){const language=requestURL.searchParams.get('lang')||'en',eventId=requestURL.searchParams.get('event')||'';if(!['en','es'].includes(language)||eventId&&!/^[0-9a-f-]{36}$/i.test(eventId))return send(400,{error:'invalid_public_page'});if(eventId&&!result.page.content?.events?.some(e=>e.id===eventId))return send(404,{error:'event_not_found'});
    if(sharing[1]==='qr'){const url=publicInstitutionURL(env,input.slug,language,eventId);if(!url)return send(503,{error:'sharing_not_configured'});const png=await QRCode.toBuffer(url,{type:'png',width:640,margin:4,errorCorrectionLevel:'M'});res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':`attachment; filename="${input.slug}-qr.png"`});return res.end(png);}
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(renderInstitutionPage(result,{env,language,eventId}));
   }
   return send(200,result);
  }catch(error){if(sharing?.[1]==='pages'&&error.status===404){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});return res.end(renderUnavailableInstitutionPage(requestURL.searchParams.get('lang'),env));}const known=[400,403,404,409,410].includes(error.status);if(!known)req.log?.({event:'database_error',level:'error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'institutions_unavailable'});}
 };
}
