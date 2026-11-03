import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {captureIdentity,validateCapture,createPrivateVoiceCaptureHandler} from './private-voice-capture.mjs';
import {capturePayload,createVoiceCapture} from '../src/voiceCapture.mjs';
test('capture requires the exact verified email; request attributes cannot enable another account',async()=>{
 assert.equal(captureIdentity({email:'danielgojeda.1@gmail.com',email_verified:true}),true);
 for(const value of [{email:'other@example.test',email_verified:true},{email:'danielgojeda.1@gmail.com',email_verified:false},{}])assert.equal(captureIdentity(value),false);
 let touched=false,status;
 const req=Readable.from([JSON.stringify({action:'read',email:'danielgojeda.1@gmail.com'})]);Object.assign(req,{url:'/api/private-voice-capture',method:'POST',headers:{authorization:'Bearer fictional'},origenAuthorized:true,origenIdentity:{sub:'other'}});
 await createPrivateVoiceCaptureHandler({connect(){touched=true;}},{AUTH0_DOMAIN:'fictional.auth0.com'},async()=>({ok:true,json:async()=>({sub:'other',email:'other@example.test',email_verified:true})}))(req,{writeHead(s){status=s;},end(){}},()=>{});
 assert.equal(status,403);assert.equal(touched,false);
});
test('capture excludes audio, reasoning and credentials from provider events',()=>{
 assert.equal(capturePayload({type:'response.reasoning.delta',delta:'hidden'}),null);
 assert.equal(capturePayload({type:'response.output_audio.delta',delta:'audio'}),null);
 const event=capturePayload({type:'session.updated',session:{instructions:'Relevant context',client_secret:'secret',model:'test'}});
 assert.equal(event.instructions,'Relevant context');assert.ok(!JSON.stringify(event).includes('secret'));
 const done=capturePayload({type:'response.done',response:{output:[{type:'reasoning',summary:'private'},{type:'function_call',name:'recall_student_context',arguments:'{}'}]}});
 assert.equal(done.calls.length,1);assert.ok(!JSON.stringify(done).includes('private'));
 assert.equal(capturePayload({type:'response.output_audio_transcript.done',transcript:'Spoken words'}).text,'Spoken words');
});
test('capture validation rejects malformed batches and excessive payloads',()=>{
 assert.throws(()=>validateCapture({action:'append',events:[]}));
 assert.throws(()=>validateCapture({action:'read',sessionId:'other-account'}));
 assert.throws(()=>validateCapture({action:'append',events:[{id:'invalid'}]}));
 assert.deepEqual(validateCapture({action:'read'}),{action:'read'});
});
test('queued events cannot cross an authenticated account change',async()=>{
 let touched=false,status;
 const req=Readable.from([JSON.stringify({action:'append',events:[{id:crypto.randomUUID(),sessionId:crypto.randomUUID(),subject:'previous-account',sequence:1,clientAt:new Date().toISOString(),data:{type:'diagnostic'}}]})]);
 Object.assign(req,{url:'/api/private-voice-capture',method:'POST',headers:{authorization:'Bearer fictional'},origenAuthorized:true,origenIdentity:{sub:'current-account'}});
 await createPrivateVoiceCaptureHandler({connect(){touched=true;}},{AUTH0_DOMAIN:'fictional.auth0.com'},async()=>({ok:true,json:async()=>({sub:'current-account',email:'danielgojeda.1@gmail.com',email_verified:true})}))(req,{writeHead(s){status=s;},end(){}},()=>{});
 assert.equal(status,403);assert.equal(touched,false);
});
test('large Unicode context is fragmented losslessly into keepalive-safe batches',async()=>{
 const batches=[],capture=createVoiceCapture(async events=>batches.push(events));
 capture.enable(true);const instructions='Información y contexto. '.repeat(5000);
 capture.event({type:'context.received',instructions},{sessionId:crypto.randomUUID()});
 for(let i=0;i<25;i++)await capture.flush();
 const events=batches.flat();assert.ok(events.length>1);
 for(const batch of batches){assert.ok(Buffer.byteLength(JSON.stringify(batch))<50000);validateCapture({action:'append',events:batch});}
 const reconstructed=JSON.parse(events.map(e=>e.data.text).join(''));
 assert.equal(reconstructed.instructions,instructions);
});
