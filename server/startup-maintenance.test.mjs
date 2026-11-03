import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {createJobRunner} from './observability/jobs.mjs';
import {jobNames} from './observability/metrics.mjs';
import {enumFields} from './observability/event-catalog.mjs';

test('every scheduled startup cleanup job can run and be observed without rejecting startup',async()=>{
 const source=await readFile(new URL('./index.mjs',import.meta.url),'utf8');
 const cleanup=source.slice(source.indexOf('const cleanupTasks=['),source.indexOf('let cleanupBusy=false'));
 const scheduled=[...cleanup.matchAll(/\['([a-z-]+)',/g)].map(m=>m[1]);
 assert.ok(scheduled.includes('recommendation-previews'));
 assert.ok(scheduled.includes('recommendation-evaluation'));
 const client=new EventEmitter();client.query=async()=>({rows:[{locked:true}]});client.release=()=>{};
 const observed=[],runner=createJobRunner({connect:async()=>client},{log:e=>observed.push(e)});
 try{
  for(const job of scheduled){
   assert.ok(enumFields.job.includes(job),`${job} must survive structured logging`);
   let ran=false;
   assert.deepEqual(await runner.run(job,async()=>{ran=true;}),{outcome:'completed'});
   assert.ok(ran,`${job} must execute`);
   assert.ok(observed.some(e=>e.event==='job.finished'&&e.job===job&&e.outcome==='completed'));
  }
 }finally{await runner.stop();}
});

test('adding recommendation cleanup does not change deployed maintenance lock identities',()=>{
 assert.equal(jobNames.indexOf('permission-data'),0);
 assert.equal(jobNames.indexOf('binder-processing'),16);
 assert.equal(jobNames.indexOf('coordinator-lifecycle'),17);
 assert.equal(jobNames.indexOf('conversation-recovery'),18);
 assert.equal(jobNames.indexOf('conversation-checkpoints'),19);
 assert.ok(jobNames.indexOf('recommendation-previews')>19);
 assert.ok(jobNames.indexOf('recommendation-evaluation')>19);
});
