import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate} from 'node:timers/promises';
import {closeTestPool} from './fixtures/postgres-test-pool.mjs';

test('fixture teardown waits for every socket removal after pool.end resolves',async()=>{
 const pool=Object.assign(new EventEmitter(),{totalCount:2,end:async()=>{}});
 let finished=false;const closing=closeTestPool(pool).then(()=>{finished=true;});
 await setImmediate();assert.equal(finished,false);
 pool.emit('remove');await setImmediate();assert.equal(finished,false);
 pool.emit('remove');await closing;assert.equal(finished,true);assert.equal(pool.listenerCount('remove'),0);
});

test('empty or uncreated fixture pools require no socket wait',async()=>{
 let ended=false;await closeTestPool();await closeTestPool({totalCount:0,end:async()=>{ended=true;}});assert.equal(ended,true);
});
