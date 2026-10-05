import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingRecovery} from '../src/onboardingRecovery.mjs';
test('onboarding drafts restore across remounts, isolate accounts, expire and clear',()=>{
 const map=new Map();const storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};let time=0;
 const a=onboardingRecovery(storage,'account-a',()=>time);const draft={role:'student',name:'Alex',draft:{id:'stable-id',name:'Alex'},step:'manual'};
 assert.equal(a.write(draft),true);assert.deepEqual(onboardingRecovery(storage,'account-a',()=>time).read(null),draft);
 assert.equal(onboardingRecovery(storage,'account-b',()=>time).read(null),null);time=86400001;assert.equal(a.read(null),null);
 a.write(draft);a.clear();assert.equal(a.read(null),null);
});
test('blocked storage reports failure without crashing onboarding',()=>{
 const store=onboardingRecovery({getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}},'draft');
 assert.equal(store.read(null),null);assert.equal(store.write({}),false);assert.doesNotThrow(()=>store.clear());
});
