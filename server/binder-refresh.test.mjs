import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshBinderNotes} from '../src/binderRefresh.mjs';
import {binderMemoryEntries,binderMemorySignalId,binderMemoryReviewEntries,binderMemorySummaryEntries} from '../src/binderMemory.mjs';

const result=(pending,failed=0,notes=[])=>({notes,generatedSummaryIds:notes.map(n=>n.summaryId),pendingCount:pending,background:{enabled:true,pending,failed,retryAfterMs:3000}});
test('older failed jobs do not prevent newly saved transfer points from arriving',async()=>{
 const note={id:'transfer-note',studentId:'student',topic:'transfer',summaryId:'new-call',content:'Confirm transferable courses with the counselor.'};
 const responses=[result(2,1),result(1,1,[note]),result(0,1,[note])],actions=[],published=[],failures=[],delays=[];
 await refreshBinderNotes({signal:new AbortController().signal,request:async action=>{actions.push(action);return responses.shift();},onData:data=>published.push(data),onFailure:error=>failures.push(error),pause:async ms=>delays.push(ms)});
 assert.deepEqual(actions,['sync','load','load']);assert.deepEqual(delays,[3000,3000]);
 assert.equal(published.length,3);assert.deepEqual(published.at(-1).notes,[note]);
 assert.ok(failures.every(error=>error==='binder_processing_failed'),'old failure stays visible while new work succeeds');
});

test('retry starts only once and completed job failures clear without rerunning sync',async()=>{
 const actions=[],failures=[];let read=0;
 await refreshBinderNotes({action:'retry',signal:new AbortController().signal,request:async action=>{actions.push(action);return result(read++?0:1);},onData:()=>{},onFailure:error=>failures.push(error),pause:async()=>{}});
 assert.deepEqual(actions,['retry','load']);assert.deepEqual(failures,[null,null]);
});

test('aborting for scope changes or privacy prevents a late response from publishing or requesting again',async()=>{
 const controller=new AbortController(),published=[];let resolve,calls=0;
 const refresh=refreshBinderNotes({signal:controller.signal,request:()=>{calls++;return new Promise(r=>resolve=r);},onData:data=>published.push(data)});
 controller.abort(new Error('scope_changed'));resolve(result(1,0,[{id:'old-student'}]));
 await assert.rejects(refresh,/scope_changed/);assert.equal(calls,1);assert.deepEqual(published,[]);
 const waiting=new AbortController();let loaded=0;
 await assert.rejects(refreshBinderNotes({signal:waiting.signal,request:async()=>result(1),onData:()=>loaded++,pause:async()=>{waiting.abort(new Error('privacy'));}}),/privacy/);
 assert.equal(loaded,1);
});

test('legacy synchronous batches and partial network failure retain successful results',async()=>{
 let calls=0;const published=[];
 await assert.rejects(refreshBinderNotes({signal:new AbortController().signal,request:async action=>{assert.equal(action,'sync');if(calls++)throw Error('offline');return {notes:[{id:'saved'}],pendingCount:2};},onData:data=>published.push(data),pause:()=>assert.fail('legacy batches do not poll')}),/offline/);
 assert.equal(published[0].notes[0].id,'saved');assert.equal(calls,2);
});

test('topic views expose existing scoped personal records without copying, confirming or mixing family data',()=>{
 const goal={id:'goal',studentId:'student-a',status:'proposed',content:'May transfer to a university.',organization:{topic:'transfer',certainty:'tentative',reportedBy:'parent'}};
 const items=[goal,{...goal,id:'confirmed',status:'confirmed'},{...goal,id:'family',studentId:null},{...goal,id:'sibling',studentId:'student-b'},{...goal,id:'costs',organization:{topic:'costs'}},{...goal,id:'untagged',organization:undefined},{...goal,id:'removed',status:'deleted'}];
 const displayed=binderMemoryEntries(items,'student-a','transfer');
 assert.deepEqual(displayed.map(item=>item.id),['goal','confirmed']);assert.equal(displayed[0],goal);
 assert.equal(displayed[0].status,'proposed');assert.equal(displayed[0].organization.reportedBy,'parent');
 assert.deepEqual(binderMemoryEntries(items,null,'transfer').map(item=>item.id),['family']);
 assert.deepEqual(binderMemoryEntries(items,'student-b','transfer').map(item=>item.id),['sibling']);
 assert.equal(binderMemorySignalId('goal'),'memory:goal');assert.notEqual(binderMemorySignalId('goal'),'goal');
});


test('confirming a detail removes its review card while keeping the same scoped notebook record',()=>{
 const proposed={id:'detail',studentId:'alex',status:'proposed',organization:{topic:'transfer'},content:'Transfer next year.'};
 const confirmed={...proposed,status:'confirmed'};
 const other={...proposed,id:'other',studentId:'sibling'};
 assert.deepEqual(binderMemoryReviewEntries([proposed,other],'alex'),[proposed]);
 assert.deepEqual(binderMemoryReviewEntries([confirmed,other],'alex'),[]);
 assert.deepEqual(binderMemoryEntries([confirmed,other],'alex','transfer'),[confirmed]);
 assert.deepEqual(binderMemorySummaryEntries([confirmed,other],'alex'),[]);
 const untagged={...confirmed,id:'legacy',organization:undefined};
 const family={...untagged,id:'family',studentId:null};
 assert.deepEqual(binderMemorySummaryEntries([untagged,family,proposed],'alex'),[untagged]);
 assert.deepEqual(binderMemorySummaryEntries([untagged,family,proposed],null),[family]);
});


test('unreviewed details already appear on the notebook without changing their trust or family scope',()=>{
 const draft={id:'draft',studentId:'alex',status:'proposed',content:'May study biology.',reportedBy:'parent'};
 const family={...draft,id:'family',studentId:null},other={...draft,id:'other',studentId:'sam'};
 const entries=binderMemorySummaryEntries([draft,family,other,{...draft,id:'deleted',status:'deleted'}],'alex');
 assert.deepEqual(entries,[draft]);assert.equal(entries[0],draft);assert.equal(entries[0].status,'proposed');assert.equal(entries[0].reportedBy,'parent');
 assert.deepEqual(binderMemorySummaryEntries([draft,family],null),[family]);
});
