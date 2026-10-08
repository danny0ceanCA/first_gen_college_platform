import test from 'node:test';
import assert from 'node:assert/strict';
import {appendConversationTurn,mergeConversationSources,recentConversationMemory,selectConversationMemory} from '../src/voiceMemory.mjs';
import {flushPendingHistory} from '../src/pendingHistory.mjs';
import {validateMemory} from './history.mjs';
import {voiceSession} from './profile-voice.mjs';
import {voiceStartingPoints} from '../src/voiceStartingPoints.mjs';

test('live summary retains early facts across sixty exchanges',()=>{
 let turns=[];for(let i=0;i<120;i++)turns=appendConversationTurn(turns,{role:i%2?'assistant':'user',text:`Fact ${i}`});
 assert.equal(turns.length,120);assert.equal(turns[0].text,'Fact 0');assert.equal(turns.at(-1).text,'Fact 119');
});
test('many live lookups stay savable and refreshed citations replace earlier checks',()=>{
 const date='2026-10-03T00:00:00Z';let sources=[];
 for(let i=0;i<45;i++)sources=mergeConversationSources(sources,[{title:`Source ${i}`,url:`https://example.org/${i}`,checkedAt:date}]);
 sources=mergeConversationSources(sources,[{title:'Updated source',url:'https://example.org/44',checkedAt:'2026-10-04T00:00:00Z'}]);
 assert.equal(sources.length,30);assert.equal(sources.at(-1).title,'Updated source');
 assert.doesNotThrow(()=>validateMemory({id:'session',studentId:null,date,mode:'finance',summary:'Discussed costs.',sources}));
});
test('voice receives the latest six memories regardless of server or browser ordering',()=>{
 const items=Array.from({length:12},(_,i)=>({id:i,studentId:'one',date:`2026-09-${String(i+1).padStart(2,'0')}T00:00:00Z`}));
 const expected=[6,7,8,9,10,11];
 assert.deepEqual(recentConversationMemory(items,'one').map(x=>x.id),expected);
 assert.deepEqual(recentConversationMemory([...items].reverse(),'one').map(x=>x.id),expected);
 assert.deepEqual(recentConversationMemory(items,'other'),[]);
});

test('topic-aware context retains older relevant discussions, latest corrections and another topic without crossing students',()=>{
 const items=Array.from({length:12},(_,i)=>({id:`m-${i}`,studentId:'one',date:`2026-09-${String(i+1).padStart(2,'0')}T00:00:00Z`,mode:i<4?'planning':'finance',summary:`Discussion ${i}`}));
 const mixed=[...items,{...items[0],id:'private',studentId:'other',date:'2026-10-01T00:00:00Z',summary:'Other student secret'}];
 const selected=recentConversationMemory(mixed,'one','planning');
 assert.equal(selected.length,6);assert.ok(selected.some(x=>x.id==='m-11'));assert.ok(selected.some(x=>x.id==='m-10'));
 assert.equal(selected.filter(x=>x.mode==='planning').length,3);assert.ok(!selected.some(x=>x.id==='private'));
 assert.deepEqual(recentConversationMemory([...mixed].reverse(),'one','planning'),selected);
 assert.equal(selectConversationMemory([...items,...items,{date:'bad',summary:'invalid'}],'planning').length,6);
});

test('long memory retains final corrections and unconfirmed scope cannot embed private history',()=>{
 const items=Array.from({length:6},(_,i)=>({id:`long-${i}`,date:`2026-09-${String(i+1).padStart(2,'0')}T00:00:00Z`,mode:'planning',summary:`Earlier goal. ${'x'.repeat(5000)} Corrected goal: nursing.`}));
 const input={language:'es',role:'parent',mode:'planning',memory:items,profile:{},students:[],routeConversations:true};
 const confirmed=voiceSession({...input,targetConfirmed:true,studentId:'one'},{});
 assert.match(confirmed.instructions,/Corrected goal: nursing/);assert.match(confirmed.instructions,/middle omitted/);
 // Keep the existing memory/base budget separate from the bounded phase 3 policy.
 assert.ok(confirmed.instructions.length-voiceStartingPoints(input).length<30000);
 const unresolved=voiceSession({...input,targetConfirmed:false},{});
 assert.doesNotMatch(unresolved.instructions,/Corrected goal: nursing|Earlier goal/);
});
test('deferred onboarding summaries save after student creation and survive a failed save',async()=>{
 const item={id:'summary',studentId:'new-student'};const pending=new Map([[item.id,item]]);let calls=0;
 await flushPendingHistory(pending,new Set(),async()=>{calls++;});assert.equal(calls,0);
 await assert.rejects(flushPendingHistory(pending,new Set(['new-student']),async()=>{throw new Error('offline');}));
 assert.equal(pending.size,1);
 await flushPendingHistory(pending,new Set(['new-student']),async saved=>{calls++;assert.equal(saved,item);});
 assert.equal(calls,1);assert.equal(pending.size,0);
});

test('a failed deferred summary does not block other student summaries',async()=>{
 const first={id:'first',studentId:'one'},second={id:'second',studentId:'two'};
 const pending=new Map([[first.id,first],[second.id,second]]);const saved=[];
 await assert.rejects(flushPendingHistory(pending,new Set(['one','two']),async item=>{if(item.id==='first')throw new Error('offline');saved.push(item.id);}));
 assert.deepEqual(saved,['second']);assert.deepEqual([...pending.keys()],['first']);
});
