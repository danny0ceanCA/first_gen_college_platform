import test from 'node:test';
import assert from 'node:assert/strict';
import {createTopicRecapQueue} from './topicRecapQueue.mjs';

const data=word=>({paragraphs:[{text:word,refs:[]}],sources:[],omitted:0});
const config=(extra={})=>({scope:'private-account/student/en',ready:true,topics:['options','transfer','costs'].map(topic=>({topic,revision:'one'})),priority:'transfer',...extra});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<100;n++){if(check())return;await wait(5);}assert.ok(check(),'Expected queue state was not reached');}
function fixture(t){
 const jobs=[],logs=[];let time=0;
 const queue=createTopicRecapQueue({delayMs:5,clock:()=>time,log:record=>logs.push(record),load:job=>new Promise((resolve,reject)=>jobs.push({...job,resolve,reject}))});
 t.after(()=>queue.reset());return {queue,jobs,logs,tick:ms=>{time+=ms;}};
}

test('waits for both authorized source loads, then preloads populated topics serially in priority order',async t=>{
 const {queue,jobs}=fixture(t);queue.configure(config({ready:false}));await wait(15);assert.equal(jobs.length,0);
 queue.configure(config());await until(()=>jobs.length===1);assert.equal(jobs[0].topic,'transfer');assert.equal(jobs[0].mode,'background');
 await wait(15);assert.equal(jobs.length,1);jobs[0].resolve(data('Transfer recap'));await until(()=>jobs.length===2);assert.equal(jobs[1].topic,'options');
 jobs[1].resolve(data('Options recap'));await until(()=>jobs.length===3);assert.equal(jobs[2].topic,'costs');
 jobs[2].resolve(data('Costs recap'));await until(()=>queue.read(config().scope,'costs','one')?.status==='ready');
 queue.configure(config({foreground:'transfer'}));await wait(15);assert.equal(jobs.length,3,'Opening a prepared topic must reuse its recap');
 assert.equal(queue.read(config().scope,'transfer','one').data.paragraphs[0].text,'Transfer recap');
});

test('an opened topic bypasses slow background work, coalesces with it, and never starts a background burst',async t=>{
 const {queue,jobs}=fixture(t);queue.configure(config());await until(()=>jobs.length===1);
 queue.configure(config({foreground:'costs'}));await until(()=>jobs.length===2);assert.equal(jobs[1].mode,'foreground');
 queue.configure(config({foreground:'transfer'}));await wait(15);assert.equal(jobs.length,2,'Do not duplicate the already-running background topic');
 jobs[1].resolve(data('Costs'));await wait(15);assert.equal(jobs.length,2,'Wait for existing background request before starting another');
 jobs[0].resolve(data('Transfer'));await until(()=>jobs.length===3);assert.equal(jobs[2].topic,'options');
});

test('source revisions invalidate only the changed topic and never display a late obsolete response',async t=>{
 const {queue,jobs}=fixture(t);queue.configure(config());await until(()=>jobs.length===1);
 const next=config({topics:[{topic:'transfer',revision:'two'},{topic:'costs',revision:'one'}]});queue.configure(next);
 assert.equal(jobs[0].signal.aborted,true);jobs[0].resolve(data('obsolete'));await until(()=>jobs.length===2);
 assert.equal(queue.read(next.scope,'transfer','one'),undefined);assert.notEqual(queue.read(next.scope,'transfer','two')?.status,'ready');
 jobs[1].resolve(data('corrected'));await until(()=>jobs.length===3);jobs[2].resolve(data('Costs'));await until(()=>queue.read(next.scope,'costs','one')?.status==='ready');
 queue.configure({...next,topics:[{topic:'transfer',revision:'three'},{topic:'costs',revision:'one'}]});
 assert.equal(queue.read(next.scope,'costs','one')?.status,'ready');assert.equal(queue.read(next.scope,'options','one'),undefined);
});

test('student, family, language, and account switches cancel in-flight work and isolate cache contents',async t=>{
 const {queue,jobs}=fixture(t);
 for(const scope of ['owner/student/en','owner/family/en','owner/other-student/en','owner/other-student/es','different-owner/student/en']){
  const count=jobs.length;queue.configure(config({scope}));await until(()=>jobs.length===count+1);
  if(count){assert.equal(jobs[count-1].signal.aborted,true);jobs[count-1].resolve(data('private prior scope'));await wait(1);assert.notEqual(queue.read(scope,'transfer','one')?.status,'ready');}
 }
 queue.reset();assert.equal(jobs.at(-1).signal.aborted,true);jobs.at(-1).resolve(data('late logout response'));await wait(15);
 assert.equal(queue.read('different-owner/student/en','transfer','one'),undefined);assert.equal(jobs.length,5);
});

test('a failed background load stays quiet without retry loops and an explicit retry can recover',async t=>{
 const {queue,jobs}=fixture(t);const cfg=config({topics:[{topic:'transfer',revision:'one'}],foreground:'transfer'});queue.configure(cfg);
 await until(()=>jobs.length===1);jobs[0].reject(new Error('private response details'));await until(()=>queue.read(cfg.scope,'transfer','one')?.status==='error');
 queue.configure(cfg);await wait(15);assert.equal(jobs.length,1);
 queue.retry('transfer');await until(()=>jobs.length===2);jobs[1].resolve(data('Recovered'));await until(()=>queue.read(cfg.scope,'transfer','one')?.status==='ready');
});

test('timings separate queue delay from load duration; cancellation logs once and never includes private sources',async t=>{
 const {queue,jobs,logs,tick}=fixture(t);queue.configure(config());tick(40);await until(()=>jobs.length===1);
 tick(75);jobs[0].resolve(data('private note'));await until(()=>queue.read(config().scope,'transfer','one')?.status==='ready');
 const completed=logs.find(item=>item.outcome==='completed');assert.deepEqual({...completed},{event:'topic_recap.finished',topic:'transfer',mode:'background',outcome:'completed',cache:'miss',queueMs:40,durationMs:75,totalMs:115});
 await until(()=>jobs.length===2);queue.reset();queue.reset();jobs[1].reject(new Error('Private account content'));await wait(10);
 assert.equal(logs.filter(item=>item.outcome==='cancelled').length,1);
 assert.ok(!JSON.stringify(logs).includes('private'));assert.ok(!JSON.stringify(logs).includes('Private'));
});
