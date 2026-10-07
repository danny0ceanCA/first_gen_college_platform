import {validCampaign,recordInquiryFact,recordInquiryState} from './institution-outreach-data.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {recentlyAuthenticated} from './recent-auth.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||required&&!value.trim())throw fail(400,'invalid_inquiry');return value.trim();};
export function validateInquiry(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'invalid_inquiry');
 const actions=['submit','receipt','withdraw','unsubscribe','visitor-reply','approve-transfer','decline-transfer','inbox','update','note','reply','request-transfer','cancel-transfer','export'];
 if(!actions.includes(input.action))throw fail(400,'invalid_inquiry');
 const out={action:input.action};
 if(['submit','receipt','withdraw','unsubscribe','visitor-reply','approve-transfer','decline-transfer'].includes(input.action)){
  if(typeof input.receipt!=='string'||!/^[-_a-zA-Z0-9]{43}$/.test(input.receipt))throw fail(400,'invalid_receipt');out.receipt=input.receipt;
 }else{if(!uuid(input.institutionId))throw fail(400,'invalid_inquiry');out.institutionId=input.institutionId;}
 if(input.action==='submit'){
  if(!uuid(input.requestKey)||!['inquiry','rsvp'].includes(input.kind)||!['en','es'].includes(input.language)||!['in-app','email'].includes(input.channel)||input.replyConsent!==true||input.adultAttested!==true||typeof input.futureConsent!=='boolean'||typeof input.slug!=='string'||! /^[a-z0-9-]{1,100}$/.test(input.slug))throw fail(400,'consent_required');
  Object.assign(out,{requestKey:input.requestKey,kind:input.kind,language:input.language,channel:input.channel,slug:input.slug,replyConsent:true,adultAttested:true,futureConsent:input.futureConsent,name:text(input.name,100,true),email:text(input.email||'',254),topic:text(input.topic,120,true),message:text(input.message,3000,input.kind==='inquiry')});
  if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)||out.channel==='email'&&!out.email)throw fail(400,'invalid_email');
  // Email delivery is intentionally unavailable until verified-contact setup exists.
  if(out.channel!=='in-app')throw fail(409,'email_not_enabled');
  out.noticeVersion=input.noticeVersion==='adult-contact-v2'?'adult-contact-v2':'adult-contact-v1';
  if(uuid(input.campaignId))out.campaignId=input.campaignId;
  if(out.kind==='rsvp'){if(!uuid(input.eventId))throw fail(400,'invalid_event');out.eventId=input.eventId;}
 }
 if(['update','note','reply','request-transfer','cancel-transfer'].includes(out.action)){if(!uuid(input.id)||!Number.isInteger(input.revision)||input.revision<1)throw fail(400,'invalid_inquiry');out.id=input.id;out.revision=input.revision;}
 if(['note','reply','visitor-reply'].includes(out.action)){out.body=text(input.body,3000,true);if(!uuid(input.requestKey))throw fail(400,'invalid_inquiry');out.requestKey=input.requestKey;}
 if(out.action==='update'){if(!['new','assigned','awaiting-response','resolved'].includes(input.state))throw fail(400,'invalid_inquiry');out.state=input.state;out.assignee=text(input.assignee||'',200);if(out.state==='assigned'&&!out.assignee)throw fail(400,'assignee_required');}
 if(out.action==='approve-transfer'){if(!uuid(input.targetId)||!Number.isInteger(input.revision))throw fail(400,'invalid_transfer');out.targetId=input.targetId;out.revision=input.revision;}
 if(out.action==='request-transfer'){if(!uuid(input.targetId))throw fail(400,'invalid_inquiry');out.targetId=input.targetId;}
 if(out.action==='inbox'&&input.cursor){const [date,id]=text(input.cursor,100,true).split('|');if(!uuid(id)||!Number.isFinite(Date.parse(date)))throw fail(400,'invalid_cursor');out.cursor={date,id};}
 if(out.action==='export')out.purpose=text(input.purpose,300,true);
 return out;
}
async function audit(c,row,actor,action){await c.query('INSERT INTO origen_institution_inquiry_audit(inquiry_id,institution_id,actor,action) VALUES($1,$2,$3,$4)',[row.id,row.institution_id,actor,action]);}
async function authorized(c,id,subject){const m=(await c.query('SELECT role FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2 FOR UPDATE',[id,subject])).rows[0];if(!['owner','outreach'].includes(m?.role))throw fail(403,'outreach_access_required');return m.role;}
async function publicRecipient(c,slugOrId,byId=false){const row=(await c.query(`SELECT * FROM origen_institutions WHERE ${byId?'id':'slug'}=$1 FOR UPDATE`,[slugOrId])).rows[0];if(!row||!row.published||row.archived_at||row.parent_approval!=='approved'||row.verification_status!=='verified')throw fail(404,'recipient_unavailable');if(row.parent_institution_id){const p=(await c.query('SELECT * FROM origen_institutions WHERE id=$1',[row.parent_institution_id])).rows[0];if(!p?.published||p.archived_at||p.verification_status!=='verified')throw fail(404,'recipient_unavailable');}return row;}
async function receiptView(c,row){const institution=(await c.query('SELECT slug,published,draft,parent_institution_id FROM origen_institutions WHERE id=$1',[row.institution_id])).rows[0];const transfer=row.transfer_id?(await c.query('SELECT published FROM origen_institutions WHERE id=$1',[row.transfer_id])).rows[0]:null;const messages=(await c.query("SELECT id,body,kind,purpose,created_at FROM origen_institution_inquiry_messages WHERE inquiry_id=$1 AND kind <> 'note' ORDER BY created_at,id",[row.id])).rows;return {id:row.id,recipient:(institution.published||institution.draft).name,slug:institution.slug,kind:row.kind,eventTitle:row.event_title,language:row.language,topic:row.topic,message:row.message,state:row.state,futureConsent:row.future_consent,expiresAt:row.expires_at,revision:row.revision,transfer:transfer?{id:row.transfer_id,name:transfer.published?.name}:null,messages};}
export function createInquiryRepository(database){return async(subject,input)=>{
 if(!database)throw fail(503,'inquiries_unavailable');const c=await database.connect();try{await c.query('BEGIN');if(subject)await guardAccountTransaction(c,subject);
 if(input.action==='submit'){
  const fingerprint=hash(JSON.stringify({...input,receipt:undefined,noticeVersion:input.noticeVersion==='adult-contact-v1'?undefined:input.noticeVersion}));const existing=(await c.query('SELECT * FROM origen_institution_inquiries WHERE request_key=$1',[input.requestKey])).rows[0];
  if(existing){if(existing.receipt_hash!==hash(input.receipt)||existing.payload_hash!==fingerprint)throw fail(409,'request_changed');if(existing.withdrawn_at||new Date(existing.expires_at)<=new Date())throw fail(410,'request_expired');const receipt=await receiptView(c,existing);await c.query('COMMIT');return {receipt};}
  const institution=await publicRecipient(c,input.slug);const event=input.kind==='rsvp'?institution.published.content?.events?.find(e=>e.id===input.eventId):null;if(input.kind==='rsvp'&&(!event||Date.parse(event.endsAt)<=Date.now()))throw fail(410,'event_ended');
  const campaign=await validCampaign(c,institution,input.campaignId,{eventId:input.eventId});
  const expires=new Date(Date.now()+90*86400000);
  const row=(await c.query(`INSERT INTO origen_institution_inquiries(institution_id,request_key,receipt_hash,payload_hash,kind,event_id,event_title,name,email,language,topic,message,channel,reply_consent,future_consent,adult_attested,expires_at,campaign_id,notice_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,true,$15,$16,$17) RETURNING *`,[institution.id,input.requestKey,hash(input.receipt),fingerprint,input.kind,input.eventId||null,event?.title||null,input.name,input.email.toLowerCase(),input.language,input.topic,input.message,input.channel,input.futureConsent,expires,campaign?.id||null,input.noticeVersion])).rows[0];if(input.noticeVersion==='adult-contact-v2')await recordInquiryFact(c,row,institution);await audit(c,row,null,`${input.noticeVersion}:grant`);const receipt=await receiptView(c,row);await c.query('COMMIT');return {receipt};
 }
 if(input.receipt){
  const row=(await c.query('SELECT * FROM origen_institution_inquiries WHERE receipt_hash=$1 FOR UPDATE',[hash(input.receipt)])).rows[0];if(!row||new Date(row.expires_at)<=new Date())throw fail(404,'receipt_unavailable');
  if(row.withdrawn_at&&input.action!=='receipt')throw fail(410,'request_withdrawn');
  if(input.action==='withdraw'){await c.query("UPDATE origen_institution_inquiries SET name='',email='',topic='',message='',event_title=NULL,state='withdrawn',reply_consent=false,future_consent=false,withdrawn_at=now(),transfer_id=NULL,transfer_requested_by=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[row.id]);await c.query('DELETE FROM origen_institution_inquiry_messages WHERE inquiry_id=$1',[row.id]);await recordInquiryState(c,row.id,'withdrawn');await audit(c,row,null,'withdraw');}
  if(input.action==='unsubscribe'){await c.query('UPDATE origen_institution_inquiries SET future_consent=false,revision=revision+1,updated_at=now() WHERE id=$1',[row.id]);await audit(c,row,null,'future-consent:withdraw');}
  if(input.action==='visitor-reply'){
   const existing=(await c.query('SELECT * FROM origen_institution_inquiry_messages WHERE request_key=$1',[input.requestKey])).rows[0];if(existing&&(existing.inquiry_id!==row.id||existing.body!==input.body||existing.kind!=='visitor'))throw fail(409,'request_changed');
   if(!existing){await c.query("INSERT INTO origen_institution_inquiry_messages(inquiry_id,request_key,body,kind) VALUES($1,$2,$3,'visitor')",[row.id,input.requestKey,input.body]);await c.query("UPDATE origen_institution_inquiries SET state='new',revision=revision+1,updated_at=now() WHERE id=$1",[row.id]);await recordInquiryState(c,row.id,'new');await audit(c,row,null,'visitor-reply');}
  }
  if(input.action==='approve-transfer'){
   if(row.transfer_id!==input.targetId||row.revision!==input.revision)throw fail(409,'transfer_changed');
   if(!row.transfer_id||!row.transfer_requested_by)throw fail(409,'no_transfer');await authorized(c,row.institution_id,row.transfer_requested_by);await authorized(c,row.transfer_id,row.transfer_requested_by);await publicRecipient(c,row.transfer_id,true);await audit(c,row,null,'transfer:permission-granted');await c.query("UPDATE origen_institution_inquiries SET institution_id=$2,campaign_id=NULL,future_consent=false,transfer_id=NULL,transfer_requested_by=NULL,assignee=NULL,state='new',revision=revision+1,updated_at=now() WHERE id=$1",[row.id,row.transfer_id]);
   // Internal source notes never cross the institution boundary.
   await c.query("DELETE FROM origen_institution_inquiry_messages WHERE inquiry_id=$1 AND kind='note'",[row.id]);await recordInquiryState(c,row.id,'new');await audit(c,{...row,institution_id:row.transfer_id},null,'transfer:received');
  }
  if(input.action==='decline-transfer'){await c.query('UPDATE origen_institution_inquiries SET transfer_id=NULL,transfer_requested_by=NULL,revision=revision+1 WHERE id=$1',[row.id]);await audit(c,row,null,'transfer:declined');}
  const updated=(await c.query('SELECT * FROM origen_institution_inquiries WHERE id=$1',[row.id])).rows[0];const receipt=await receiptView(c,updated);await c.query('COMMIT');return {receipt};
 }
 const role=await authorized(c,input.institutionId,subject);
 if(['inbox','export'].includes(input.action)){
  if(input.action==='export'&&role!=='owner')throw fail(403,'owner_required');const rows=(await c.query(`SELECT * FROM origen_institution_inquiries WHERE institution_id=$1 AND expires_at>now() ${input.cursor?'AND (created_at<$2 OR (created_at=$2 AND id<$3))':''} ORDER BY created_at DESC,id DESC LIMIT ${input.action==='export'?101:26}`,input.cursor?[input.institutionId,input.cursor.date,input.cursor.id]:[input.institutionId])).rows;const limit=input.action==='export'?100:25;
  if(input.action==='export')await c.query('INSERT INTO origen_institution_inquiry_audit(institution_id,actor,action) VALUES($1,$2,$3)',[input.institutionId,subject,`export:${input.purpose}`]);
  const inquiries=[];for(const row of rows.slice(0,limit)){const messages=(await c.query('SELECT id,body,kind,purpose,created_at,delivery FROM origen_institution_inquiry_messages WHERE inquiry_id=$1 ORDER BY created_at,id',[row.id])).rows;const campaign=row.campaign_id?(await c.query('SELECT title FROM origen_institution_campaigns WHERE id=$1 AND institution_id=$2',[row.campaign_id,row.institution_id])).rows[0]:null;inquiries.push({...row,campaignTitle:campaign?.title||null,receipt_hash:undefined,payload_hash:undefined,request_key:undefined,transfer_requested_by:undefined,messages});}
  const staff=(await c.query("SELECT m.auth0_subject,r.first_name FROM origen_institution_members m JOIN origen_institution_representatives r ON r.auth0_subject=m.auth0_subject WHERE m.institution_id=$1 AND m.role IN ('owner','outreach')",[input.institutionId])).rows;await c.query('COMMIT');return {inquiries,staff,truncated:rows.length>100,emailEnabled:false,nextCursor:input.action==='inbox'&&rows.length>limit?`${new Date(rows[limit-1].created_at).toISOString()}|${rows[limit-1].id}`:null};
 }
 const row=(await c.query('SELECT * FROM origen_institution_inquiries WHERE id=$1 AND institution_id=$2 FOR UPDATE',[input.id,input.institutionId])).rows[0];if(!row)throw fail(404,'inquiry_not_found');if(row.withdrawn_at||new Date(row.expires_at)<=new Date())throw fail(410,'request_withdrawn');
 if(['note','reply'].includes(input.action)){const old=(await c.query('SELECT * FROM origen_institution_inquiry_messages WHERE request_key=$1',[input.requestKey])).rows[0];if(old){if(old.inquiry_id!==row.id||old.actor!==subject||old.body!==input.body||old.kind!==input.action)throw fail(409,'request_changed');await c.query('COMMIT');return {ok:true};}}
 if(row.revision!==input.revision)throw fail(409,'inquiry_changed');
 if(input.action==='update'){if(input.assignee)await authorized(c,row.institution_id,input.assignee);await c.query('UPDATE origen_institution_inquiries SET state=$2,assignee=$3,revision=revision+1,updated_at=now() WHERE id=$1',[row.id,input.state,input.assignee||null]);await recordInquiryState(c,row.id,input.state);}
 if(['reply','note'].includes(input.action)){if(input.action==='reply'&&!row.reply_consent)throw fail(403,'consent_required');await c.query('INSERT INTO origen_institution_inquiry_messages(inquiry_id,request_key,body,kind,actor) VALUES($1,$2,$3,$4,$5)',[row.id,input.requestKey,input.body,input.action,subject]);await c.query('UPDATE origen_institution_inquiries SET state=$2,revision=revision+1,updated_at=now() WHERE id=$1',[row.id,input.action==='reply'?'awaiting-response':row.state]);if(input.action==='reply')await recordInquiryState(c,row.id,'awaiting-response',{response:true});}
 if(input.action==='request-transfer'){
  if(input.targetId===row.institution_id)throw fail(400,'invalid_recipient');await authorized(c,input.targetId,subject);const target=await publicRecipient(c,input.targetId,true);const source=(await c.query('SELECT parent_institution_id FROM origen_institutions WHERE id=$1',[row.institution_id])).rows[0];if((source.parent_institution_id||row.institution_id)!==(target.parent_institution_id||target.id))throw fail(403,'same_parent_required');await c.query('UPDATE origen_institution_inquiries SET transfer_id=$2,transfer_requested_by=$3,revision=revision+1,updated_at=now() WHERE id=$1',[row.id,input.targetId,subject]);
 }
 if(input.action==='cancel-transfer')await c.query('UPDATE origen_institution_inquiries SET transfer_id=NULL,transfer_requested_by=NULL,revision=revision+1 WHERE id=$1',[row.id]);
 await audit(c,row,subject,input.action);await c.query('COMMIT');return {ok:true};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
};}
export async function purgeInstitutionInquiries(database){if(database)await database.query('DELETE FROM origen_institution_inquiries WHERE expires_at<=now()');}
export function createInquiryHandler(database){const run=createInquiryRepository(database),buckets=new Map();return async(req,res,next)=>{
 if(!['/api/institution-inquiries/public','/api/institution-inquiries/staff'].includes(req.url))return next();const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
 const isPublic=req.url.endsWith('/public');if(!isPublic&&!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(isPublic){const now=Date.now();for(const [k,b]of buckets)if(b.until<now)buckets.delete(k);const key=req.socket?.remoteAddress||'unknown',b=buckets.get(key)||{count:0,until:now+60000};if(buckets.size>=10000&&!buckets.has(key))return send(429,{error:'rate_limited'});buckets.set(key,b);if(++b.count>30)return send(429,{error:'rate_limited'});}
 try{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16000)return send(413,{error:'too_large'});}let input;try{input=validateInquiry(JSON.parse(raw));}catch(error){return send(error.status||400,{error:error.message});}
 if(isPublic!==!!input.receipt)return send(403,{error:'invalid_action'});
 if(input.action==='export'&&!recentlyAuthenticated(req.origenIdentity))return send(403,{error:'reauthentication_required'});
 return send(200,await run(req.origenIdentity?.sub,input));
 }catch(error){const known=[400,403,404,409,410,429].includes(error.status);if(!known)req.log?.({event:'inquiry_storage_error',level:'error'});return send(known?error.status:503,{error:known?error.message:'inquiries_unavailable'});}
};}
