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
