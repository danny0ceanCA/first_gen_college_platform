import test from 'node:test';
import assert from 'node:assert/strict';
import {liveConversationTiming} from './live-conversation-timing-report.mjs';
test('timing isolates turns, matches acknowledgments, and excludes private data',()=>{
 const event=(at,type,rest={})=>({at,type,...rest});
 const r=liveConversationTiming({requests:[{at:140,path:'/api/profile-voice',durationMs:12,status:200,body:'PRIVATE'},{at:145,path:'/api/student-memory',action:'revision',durationMs:3},{at:400,path:'/api/live-memory',durationMs:900}],runs:[{language:'en',steps:[{after:100,audioEnded:120,at:300}],sent:[event(150,'session.update',{event_id:'a'}),event(180,'session.update',{event_id:'b'})],events:[event(1,'session.output_transcript.delta',{delta:'OLD'}),event(130,'response.event',{event:{type:'response.created',response:{id:'private'}}}),event(160,'session.updated',{event_id:'unrelated'}),event(170,'session.updated',{event_id:'provider-id',client_event_id:'a'}),event(200,'response.event',{event:{type:'response.completed',response:{id:'private'}}}),event(210,'session.output_transcript.delta',{delta:'SECRET '.repeat(20)}),event(220,'response.event',{event:{type:'response.created',response:{id:'pending'}}})]}]});
 const t=r.calls[0].turns[0];assert.equal(t.candidateTranscriptMs,90);assert.equal(t.backendResponses[0].durationMs,70);assert.equal(t.unfinishedBackendResponses,1);assert.deepEqual(t.contextUpdates,[{startMs:30,durationMs:20},{startMs:60,unmatched:true}]);assert.equal(t.http.length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|private|pending|OLD/);
});
test('missing speech and failed calls are not reported as fast successful answers',()=>{
 const r=liveConversationTiming({runs:[{language:'es',failure:'private error',steps:[{after:1,audioEnded:3,at:9}],events:[]}]});
 assert.equal(r.calls[0].failed,true);assert.equal(r.calls[0].turns[0].candidateTranscriptMs,null);assert.doesNotMatch(JSON.stringify(r),/private error/);
});
test('server-control traces correlate evidence without emitting content or identifiers',()=>{
 const r=liveConversationTiming({research:[{run:'PRIVATE',kind:'research-finished',durationMs:21000,status:200,data:{text:'SECRET'}}],diagnostics:[{run:'PRIVATE',event:'voice.control.callback_timeout'}],native:[{run:'PRIVATE',at:160,type:'session.output_transcript.delta',delta:'SECRET '.repeat(20)}],runs:[{id:'PRIVATE',language:'en',brief:true,finishedAt:500,steps:[{startedAt:100,audioEnded:120}],soundStarts:[180],events:[{type:'origen.research.supplied',at:200,jobId:'PRIVATE_JOB',packetCount:3,contextBytes:1000,evidenceFormat:'brief-v1'},{type:'origen.research.context_acknowledged',at:220,jobId:'OTHER_JOB',durationMs:20},{type:'origen.research.context_acknowledged',at:240,jobId:'PRIVATE_JOB',durationMs:40}]}]});
 const call=r.calls[0];assert.equal(call.variant,'brief');assert.equal(call.callbackTimeouts,1);assert.equal(call.turns[0].candidateTranscriptMs,40);assert.equal(call.turns[0].firstAudibleMs,60);assert.equal(call.delivery[0].acknowledgmentMs,40);assert.equal(call.research[0].durationMs,21000);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|SECRET|OTHER_JOB/);
});
test('speech already underway during the question is not a fast answer candidate',()=>{
 const r=liveConversationTiming({runs:[{language:'es',steps:[{startedAt:100,audioEnded:200}],finishedAt:1000,events:[{type:'session.output_transcript.delta',at:150,delta:'PRIVATE prior speech '.repeat(10)}]}]});
 assert.equal(r.calls[0].turns[0].firstTranscriptMs,-50);assert.equal(r.calls[0].turns[0].candidateTranscriptMs,null);
});
test('delivery timing separates receipt from speech evidence and excludes mismatched revisions',()=>{
 const event=(at,deliveryStage,extra={})=>({type:'origen.research.delivery',at,deliveryStage,jobId:'PRIVATE_JOB',revision:2,...extra});
 const r=liveConversationTiming({runs:[{events:[{type:'origen.research.supplied',at:100,jobId:'PRIVATE_JOB',revision:2},
  {type:'origen.research.context_acknowledged',at:200,jobId:'PRIVATE_JOB',revision:2,durationMs:100},
  event(300,'deferred'),event(400,'reply_observed'),event(500,'commentary_requested'),event(600,'commentary_acknowledged'),
  event(700,'evidence_overlap_observed',{revision:1}),event(800,'PRIVATE_STAGE'),event(900,'delivery_unconfirmed')]}]});
 const delivery=r.calls[0].delivery[0];assert.equal(delivery.acknowledgmentMs,100);assert.equal(delivery.commentaryRequestedMs,400);
 assert.equal(delivery.commentaryAcknowledgedMs,500);assert.equal(delivery.evidenceOverlapObservedMs,null);assert.equal(delivery.lastDeliveryStage,'delivery_unconfirmed');assert.equal(delivery.deferredCount,1);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
