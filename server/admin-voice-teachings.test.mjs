import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readAdminVoiceTeachings,liveTeachingDeliveryUpdates,teachingDeliveryReferences} from './admin-voice-teachings.mjs';
import {retrievalFixture} from './history-retrieval-fixture.mjs';
import {runAsAnalytics} from './account-isolation.mjs';
import {validateTeachingRequest} from './teaching-library.mjs';

test('across-topics voice tests preload topic teachings and dynamic lookups avoid literal keyword gates',async()=>{
 const calls=[],essay={id:'essay',revision:8,content:{topic:'admissions',title:'Essay encouragement',explanation:'Everyday experiences matter.',deliveryStyle:'Warm and patient.'}},transfer={id:'transfer',revision:8,content:{topic:'planning',title:'ASSIST',explanation:'Review transfer agreements.'}};
 const database={query:async(_sql,params)=>{const scope=JSON.parse(params[0]);calls.push(scope);return {rows:[{data:scope.topic==='admissions'?[essay]:scope.topic==='planning'?[transfer]:[]}]};}};
 const across=await readAdminVoiceTeachings(database,{topic:'general',language:'en',campus:'',academicYear:'',query:'Hello'});
 assert.deepEqual(new Set(across.map(e=>e.id)),new Set(['essay','transfer']));assert.equal(calls.length,6);assert.ok(calls.every(c=>c.retrieval==='guide'&&c.language==='en'));
 calls.length=0;assert.deepEqual(await readAdminVoiceTeachings(database,{topic:'admissions',language:'en',query:'I have nothing worth writing about'}),[essay]);assert.equal(calls.length,1);assert.equal(calls[0].retrieval,'guide');
 assert.deepEqual(await readAdminVoiceTeachings(database,{topic:'finance',language:'en'}),[]);
});

test('discovery stays bounded and delivery updates fit Live append limits for multibyte text',async()=>{
 const entry={id:'repeated',content:{explanation:'x'.repeat(5000),deliveryStyle:'温かくゆっくり。'.repeat(300),topic:'admissions'}};
 const database={query:async()=>({rows:[{data:[entry,...Array.from({length:5},(_,i)=>({...entry,id:'other'+i}))]}]})};
 const entries=await readAdminVoiceTeachings(database,{topic:'general',language:'en'});
 assert.ok(entries.length<=6);assert.equal(entries.length,new Set(entries.map(e=>e.id)).size);assert.ok(entries.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e)),0)<=12000);
 const messages=liveTeachingDeliveryUpdates([entry]);assert.ok(messages.every(message=>Buffer.byteLength(message)<=480));assert.match(messages[0],/While discussing admissions/);assert.match(messages[0],/Apply all parts silently/);assert.equal(messages.map(message=>JSON.parse(message.slice(message.indexOf('{'))).text).join(''),entry.content.deliveryStyle);assert.equal(liveTeachingDeliveryUpdates([{content:{}}]).length,0);
});

test('Live keeps the end of long tone, approach and example fields, including Unicode and escaped JSON',()=>{
 const content={topic:'admissions',title:'Essay support',deliveryStyle:'Warm. '.repeat(160)+'VALIDATE THE STUDENT BEFORE ASKING QUESTIONS.',conversationApproach:'Escucha con paciencia. '.repeat(30)+'Acknowledge the expressed concern first.',example:'“No estás solo.”\n'.repeat(45)+'This final example sentence must arrive.'};
 const entry={id:'essay',revision:10,content};const refs=teachingDeliveryReferences([entry]);for(const key of ['deliveryStyle','conversationApproach','example'])assert.equal(refs[0][key],content[key]);
 const messages=liveTeachingDeliveryUpdates([entry]);assert.ok(messages.length>3);assert.ok(messages.every(m=>Buffer.byteLength(m)<=480));
 for(const [key,label] of [['deliveryStyle','Tone'],['conversationApproach','Conversational approach'],['example','Example in the educator voice']])assert.equal(messages.filter(m=>m.includes(': '+label+',')).map(m=>JSON.parse(m.slice(m.indexOf('{'))).text).join(''),content[key]);
 assert.equal(teachingDeliveryReferences([{content:{conversationApproach:'Acknowledge before asking.'}}]).length,1);
});

test('real publication, language, campus and draft boundaries apply to cross-topic voice discovery',{skip:!process.env.DATABASE_TEST_URL},async t=>{
 const f=await retrievalFixture();t.after(f.close);
 const command=input=>f.as('reader',()=>runAsAnalytics(()=>f.db.query('SELECT origen_teaching_command($1::jsonb)',[JSON.stringify(validateTeachingRequest(input))])));
 const make=async(overrides,publish=true)=>{const id=randomUUID(),content={title:'Synthetic teaching',topic:'admissions',language:'en',explanation:'Everyday experiences matter.',keywords:'PIQ',reviewBy:'2099-12-31',...overrides};await command({action:'save',id,revision:0,content});if(publish)await command({action:'publish',id,revision:1,reviewed:true});return id;};
 const essay=await make({}),transfer=await make({topic:'planning',keywords:''}),spanish=await make({language:'es'}),draft=await make({title:'Never published'},false);
 const campus=await make({campus:'A specific campus',academicYear:'2026-27',sourceUrl:'https://www.ucdavis.edu/'});
 const read=scope=>f.as('reader',()=>runAsAnalytics(()=>readAdminVoiceTeachings(f.db,{topic:'general',language:'en',campus:'',academicYear:'',...scope})));
 assert.deepEqual(new Set((await read({})).map(e=>e.id)),new Set([essay,transfer]));assert.equal((await read({topic:'admissions',query:'Tell me about myself'}))[0].id,essay);
 assert.deepEqual((await read({language:'es'})).map(e=>e.id),[spanish]);assert.ok((await read({campus:'A specific campus',academicYear:'2026-27'})).some(e=>e.id===campus));assert.ok(!(await read({})).some(e=>e.id===draft));
});
