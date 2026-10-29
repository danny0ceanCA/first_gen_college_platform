import test from 'node:test';
import assert from 'node:assert/strict';
import {createLogoutTransition,readLogoutReturn,clearLogoutReturn} from '../src/logoutHandoff.mjs';

const deferred=()=>{let resolve;const promise=new Promise(next=>{resolve=next;});return {promise,resolve};};
function fixture(overrides={}){
 const records=new Map(),events=[];
 const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
 const flow=createLogoutTransition({cleanup:async()=>events.push('cleanup'),cover:async()=>events.push('cover'),stop:()=>events.push('stop'),redirect:async options=>events.push(['redirect',options]),onPhase:phase=>events.push(phase),storage,now:()=>100000,...overrides});
 return {flow,events,records,storage};
}
test('duplicate clicks share one logout; privacy purge and redirect wait for cleanup and an opaque cover',async()=>{
 const clean=deferred(),cover=deferred(),f=fixture({cleanup:()=>clean.promise,cover:()=>cover.promise});
 const options={logoutParams:{returnTo:'https://example.test'}};
 const first=f.flow.start(options),second=f.flow.start(options);
 assert.equal(first,second);await Promise.resolve();
 clean.resolve();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(f.events,['leaving']);assert.equal(f.flow.canReturn,true);
 cover.resolve();await first;
 assert.deepEqual(f.events,['leaving','stop',['redirect',options]]);assert.equal(f.flow.canReturn,false);
 assert.equal(readLogoutReturn(f.storage,100001),true);
 assert.deepEqual([...f.records.values()],['100000']);
});
test('failed cleanup never purges or redirects, and a retry can complete',async()=>{
 let fail=true;const f=fixture({cleanup:async()=>{if(fail)throw new Error('offline');}});
 await f.flow.start();assert.equal(f.flow.canReturn,true);assert.equal(f.records.size,0);
 assert.equal(f.events.at(-1),'error');assert.equal(f.events.includes('stop'),false);
 fail=false;await f.flow.start();assert.equal(f.flow.canReturn,false);assert.equal(f.events.at(-1)[0],'redirect');
});
test('a provider failure keeps private UI closed and retries without requiring another token for acknowledged cleanup',async()=>{
 let attempts=0,cleanups=0;const f=fixture({cleanup:async()=>{cleanups++;},redirect:async()=>{if(++attempts===1)throw new Error('navigation failed');}});
 await f.flow.start();assert.equal(f.flow.canReturn,false);assert.equal(f.records.size,0);assert.equal(f.events.at(-1),'error');
 await f.flow.start();assert.equal(attempts,2);assert.equal(cleanups,1);assert.equal(readLogoutReturn(f.storage,100002),true);
});
test('synchronous cleanup failures and unavailable session storage remain retryable',async()=>{
 let fail=true;const f=fixture({cleanup:()=>{if(fail)throw new Error('unavailable');return Promise.resolve();},storage:{getItem(){throw new Error();},setItem(){throw new Error();},removeItem(){throw new Error();}}});
 await f.flow.start();assert.equal(f.events.at(-1),'error');fail=false;await f.flow.start();assert.equal(f.events.at(-1)[0],'redirect');
});
test('local-only SDK sign-out reveals content and leaves no redirect marker',async()=>{
 const f=fixture();await f.flow.start({openUrl:false});assert.equal(f.events.at(-1),'revealing');assert.equal(f.records.size,0);
});
test('the visual handoff expires and rejects invalid or future timestamps',async()=>{
 const f=fixture();await f.flow.start();assert.equal(readLogoutReturn(f.storage,189999),true);
 assert.equal(readLogoutReturn(f.storage,190000),false);assert.equal(f.records.size,0);
 for(const value of ['not-a-date','0','Infinity','200000']){
  f.storage.setItem('origen.logout-transition.v1',value);assert.equal(readLogoutReturn(f.storage,100000),false);assert.equal(f.records.size,0);
 }
 f.storage.setItem('origen.logout-transition.v1','100000');clearLogoutReturn(f.storage);assert.equal(f.records.size,0);
});
