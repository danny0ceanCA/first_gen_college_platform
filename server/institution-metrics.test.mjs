import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createInstitutionRepository} from './institutions.mjs';
import {createMetricsRepository,validateMetric,purgeMetrics} from './institution-metrics.mjs';
import {createApp} from './index.mjs';
const page={name:'College',website:'https://college.edu',description:'Test',programs:'',admissions:'',financialAid:'',events:'',publicEmail:'',links:[{title:'Apply',url:'https://college.edu/apply'}]};
async function published(pool){const run=createInstitutionRepository(pool,['reviewer']);const i=(await run('owner',{action:'register',representative:{firstName:'A',workEmail:'a@college.edu',jobRole:'Staff'},page})).institutions[0];await run('owner',{action:'submit',id:i.id,revision:1});await run('reviewer',{action:'verify',id:i.id,revision:1,note:'Verified'});await run('reviewer',{action:'publish',id:i.id,revision:1,note:'Approved'});return i;}
test('metrics only count approved page actions and report completed months to current members',async()=>{
 const {pool}=await fixture();let now=new Date('2026-09-15T12:00:00Z');const run=createMetricsRepository(pool,()=>now);
 try{
  const i=await published(pool);for(let n=0;n<10;n++)await run(null,{slug:i.slug,metric:'page_view'});await run(null,{slug:i.slug,metric:'link_click',linkIndex:0});
  assert.equal((await run('owner',{action:'report',id:i.id})).pageViews,null);
  now=new Date('2026-10-03T12:00:00Z');const report=await run('owner',{action:'report',id:i.id});assert.equal(report.month,'2026-09');assert.equal(report.pageViews,10);assert.equal(report.linkClicks,null);
  await assert.rejects(run('foreign',{action:'report',id:i.id}),{status:404});await assert.rejects(run('reviewer',{action:'report',id:i.id}),{status:404});
  await assert.rejects(run(null,{slug:i.slug,metric:'link_click',linkIndex:1}),{status:400});await assert.rejects(run(null,{slug:'missing',metric:'page_view'}),{status:404});
  assert.throws(()=>validateMetric({slug:i.slug,metric:'page_view',studentId:'private'}),{status:400});
  assert.deepEqual(Object.keys((await pool.query('SELECT * FROM origen_institution_metrics')).rows[0]).sort(),['count','institution_id','metric','month']);
  await pool.query('DELETE FROM origen_institution_members WHERE institution_id=$1',[i.id]);await assert.rejects(run('owner',{action:'report',id:i.id}),{status:404});
  await purgeMetrics(pool,new Date('2027-09-01T00:00:00Z'));assert.equal((await pool.query('SELECT * FROM origen_institution_metrics')).rows.length,0);
 }finally{await pool.end();}
});
test('gateway keeps collection anonymous and report authentication, origin, schema and size boundaries intact',async()=>{
 const {pool}=await fixture();const i=await published(pool);const logs=[];const server=createServer(createApp({ALLOWED_ORIGINS:'https://origen.example'},async token=>({sub:token}),pool,r=>logs.push(r)));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{Origin:'https://origen.example','Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/api/institution-metrics/event',{slug:i.slug,metric:'page_view'})).status,200);
  assert.equal((await post('/api/institution-metrics/report',{id:i.id})).status,401);
  assert.equal((await post('/api/institution-metrics/report',{id:i.id},{Authorization:'Bearer foreign'})).status,404);
  assert.equal((await post('/api/institution-metrics/report',{id:i.id},{Authorization:'Bearer owner'})).status,200);
  assert.equal((await post('/api/institution-metrics/event',{slug:i.slug,metric:'page_view'},{Origin:'https://foreign.example'})).status,403);
  assert.equal((await post('/api/institution-metrics/event',{slug:i.slug,metric:'page_view',email:'private@x.edu'})).status,400);
  assert.equal((await post('/api/institution-metrics/event',{slug:'x'.repeat(600),metric:'page_view'})).status,413);
  assert.doesNotMatch(JSON.stringify(logs),/private@x.edu|Bearer|studentId/);
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
