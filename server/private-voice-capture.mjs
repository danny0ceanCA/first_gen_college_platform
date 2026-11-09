import {invitationIdentity} from './institution-access.mjs';
import {guardAccountTransaction} from './account-guard.mjs';
import {CAPTURE_EMAIL} from '../src/voiceCapture.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
export async function purgePrivateVoiceCapture(database){
 if((await database.query("SELECT to_regclass('origen_private_voice_capture') AS table_name")).rows[0]?.table_name)await database.query('DELETE FROM origen_private_voice_capture WHERE expires_at<=now()');
}
export function captureIdentity(identity){return identity?.email_verified===true&&identity.email?.trim().toLowerCase()===CAPTURE_EMAIL;}
export function validateCapture(input){
 if(!input||!['append','read'].includes(input.action))throw Error('invalid_capture');
 if(input.action==='read'){if(input.sessionId!==undefined&&!uuid(input.sessionId)||input.before&&(!uuid(input.before.id)||!Number.isFinite(Date.parse(input.before.at))))throw Error('invalid_capture');return input;}
 if(!Array.isArray(input.events)||!input.events.length||input.events.length>8)throw Error('invalid_capture');
 for(const e of input.events)if(!uuid(e.id)||!uuid(e.sessionId)||!Number.isSafeInteger(e.sequence)||e.sequence<1||!Number.isFinite(Date.parse(e.clientAt))||e.studentId!=null&&(typeof e.studentId!=='string'||e.studentId.length>128)||!e.data||typeof e.data.type!=='string'||JSON.stringify(e.data).length>50000)throw Error('invalid_capture');
 return input;
}
export function createPrivateVoiceCaptureHandler(database,env={},fetcher=fetch){return async(req,res,next)=>{
 if(req.url!=='/api/private-voice-capture')return next();
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(!req.origenAuthorized||!req.origenIdentity?.sub)return send(401,{error:'authentication_required'});
 if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
 let client;
 try{
  // An operator may bind this opt-in to one existing authenticated subject.
  // Browser-supplied email or subject can never grant this capability.
  if(env.ORIGEN_PRIVATE_VOICE_CAPTURE_SUBJECT){
   if(req.origenIdentity.sub!==env.ORIGEN_PRIVATE_VOICE_CAPTURE_SUBJECT)return send(403,{error:'capture_not_enabled'});
  }else{
   const identity=await invitationIdentity(req,env,fetcher);if(!captureIdentity(identity))return send(403,{error:'capture_not_enabled'});
  }
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>400000)return send(413,{error:'capture_too_large'});}
  let input;try{input=validateCapture(JSON.parse(raw));}catch{return send(400,{error:'invalid_capture'});}
  if(input.action==='append'&&input.events.some(e=>e.subject!==req.origenIdentity.sub))return send(403,{error:'capture_identity_changed'});
  if(!database)return send(503,{error:'capture_unavailable'});
  client=await database.connect();await client.query('BEGIN');await guardAccountTransaction(client,req.origenIdentity.sub);
  const owner=(await client.query('SELECT id FROM origen_accounts WHERE auth0_subject=$1',[req.origenIdentity.sub])).rows[0]?.id;
  if(!owner)throw Error('capture_unavailable');
  await client.query('DELETE FROM origen_private_voice_capture WHERE account_id=$1 AND expires_at<=now()',[owner]);
  let result={saved:true};
  if(input.action==='append'){
   const n=Number((await client.query("SELECT count(*) AS n FROM origen_private_voice_capture WHERE account_id=$1 AND received_at>now()-interval '1 day'",[owner])).rows[0].n);
   if(n+input.events.length>20000)throw Error('capture_limit');
   for(const e of input.events){
    const student=e.studentId&&(await client.query('SELECT id FROM origen_students WHERE account_id=$1 AND id=$2',[owner,e.studentId])).rows[0]?.id||null;
    await client.query('INSERT INTO origen_private_voice_capture(id,account_id,session_id,student_id,sequence,client_at,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',[e.id,owner,e.sessionId,student,e.sequence,e.clientAt,JSON.stringify({...e.data,attemptId:e.attemptId,reportedStudentId:e.studentId})]);
   }
  }else {
   const events=(await client.query('SELECT id,session_id,student_id,sequence,client_at,received_at,data FROM origen_private_voice_capture WHERE account_id=$1 AND expires_at>now() AND ($2::uuid IS NULL OR session_id=$2) AND ($3::timestamptz IS NULL OR (received_at,id)<($3::timestamptz,$4::uuid)) ORDER BY received_at DESC,id DESC LIMIT 1000',[owner,input.sessionId??null,input.before?.at??null,input.before?.id??null])).rows;
   const last=events.at(-1);result={events,next:events.length===1000?{at:last.received_at,id:last.id}:null};
  }
  await client.query('COMMIT');return send(200,result);
 }catch{if(client)await client.query('ROLLBACK').catch(()=>{});return send(503,{error:'capture_unavailable'});}finally{client?.release();}
};}
