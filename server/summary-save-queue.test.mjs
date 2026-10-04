import test from 'node:test';
import assert from 'node:assert/strict';
import {summarySaveQueue} from '../src/summarySaveQueue.mjs';

test('failed summary saves can retry without changing the captured student or session',async()=>{
 const queue=summarySaveQueue();let calls=0;const targets=[];
 const captured={session:'session-one',student:'student-one'};
 queue.add(captured.session,async()=>{targets.push({...captured});if(++calls===1)throw new Error('offline');});
 await assert.rejects(queue.flush());assert.equal(queue.size,1);
 queue.add('session-two',async()=>{targets.push({session:'session-two',student:'student-two'});});
 await queue.flush();assert.equal(queue.size,0);
 assert.deepEqual(targets,[captured,captured,{session:'session-two',student:'student-two'}]);
});

test('overlapping summary cleanup calls do not generate or save the same job twice',async()=>{
 const queue=summarySaveQueue();let release,calls=0;
 queue.add('one',async()=>{calls++;await new Promise(resolve=>{release=resolve;});});
 const first=queue.flush(),second=queue.flush();assert.equal(first,second);
 queue.add('one',async()=>assert.fail('duplicate'));
 release();await first;assert.equal(calls,1);assert.equal(queue.size,0);
});

test('one broken summary does not prevent other students from saving',async()=>{
 const queue=summarySaveQueue();let saved=false;
 queue.add('broken',async()=>{throw new Error('student_not_found');});
 queue.add('healthy',async()=>{saved=true;});
 await assert.rejects(queue.flush(),AggregateError);assert.equal(saved,true);assert.equal(queue.size,1);
});
