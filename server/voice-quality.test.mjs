import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityEvent,storeQualityEvent,adminVoiceQuality} from './voice-quality.mjs';
const input=()=>({attemptId:crypto.randomUUID(),sessionId:crypto.randomUUID(),sequence:1,event:'session_start',mode:'planning',language:'es'});
test('quality records contain only allowed technical fields and categories',()=>{
 const record=qualityEvent({...input(),code:'private-name',mode:'private-school',language:'private',durationMs:Infinity,transcript:'secret',profile:{name:'secret'},connectionState:'private',eventId:'secret'});
 assert.equal(record.code,'other');assert.equal(record.mode,null);assert.equal(record.language,null);assert.equal(record.durationMs,null);assert.equal(record.connectionState,null);
 assert.ok(!JSON.stringify(record).includes('private'));assert.ok(!JSON.stringify(record).includes('secret'));
 for(const change of [{sequence:0},{sequence:1.5},{sequence:100001},{attemptId:'bad'},{sessionId:'bad'},{event:'unrecognized'}])assert.equal(qualityEvent({...input(),...change}),null);
 assert.equal(qualityEvent({...input(),durationMs:999999}).durationMs,600000);
});
test('storage binds the authenticated account, deduplicates and caps events',async()=>{
 const calls=[];let released=false;
 const database={connect:async()=>({query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.startsWith('SELECT id FROM origen_accounts')?[{id:'owned-account'}]:[]};},release:()=>{released=true;}})};
 const event=input();await storeQualityEvent(database,'auth0|owner',{...event,accountId:'forged'});
 const insert=calls.find(c=>c.sql.startsWith('INSERT INTO origen_voice_quality_events'));
 assert.equal(insert.args[0],'owned-account');assert.equal(insert.args[1],event.attemptId);assert.match(insert.sql,/ON CONFLICT DO NOTHING/);assert.match(insert.sql,/<1000/);assert.equal(released,true);
});
test('quality queries consistently select an attempt cohort and bound filters',async()=>{
 const calls=[],database={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('SELECT count(*) AS attempts')?[{attempts:'0'}]:[]};}};
 const result=await adminVoiceQuality(database,7,new Date('2026-10-07T19:00:00Z'),{topic:'finance',language:'es'});
 assert.equal(result.totals.attempts,'0');assert.equal(result.measuredSince,null);
 for(const c of calls.slice(0,4)){assert.deepEqual(c.args,['2026-09-30T19:00:00.000Z','2026-10-07T19:00:00.000Z','finance','es']);assert.match(c.sql,/started_at>=\$1/);assert.match(c.sql,/\$3='all' OR topic=\$3/);assert.doesNotMatch(c.sql,/first_name|email|payload|\btranscript\b|summary/);}
 await assert.rejects(adminVoiceQuality(database,365),{status:400});await assert.rejects(adminVoiceQuality(database,7,new Date(),{topic:'anything'}),{status:400});
});
