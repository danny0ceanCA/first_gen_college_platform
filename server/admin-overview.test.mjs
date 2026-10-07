import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {adminWindow,adminSeries,adminOverview} from './admin-overview.mjs';
import {createAdminHandler} from './admin.mjs';
test('reporting windows have equal previous durations and reject unsupported input',()=>{
 for(const days of [7,30,90]){const w=adminWindow(days,new Date('2026-10-07T19:20:00Z'));assert.equal(Date.parse(w.end)-Date.parse(w.start),days*86400000);assert.equal(Date.parse(w.start)-Date.parse(w.previousStart),days*86400000);}
 for(const days of [0,365,'30',NaN])assert.throws(()=>adminWindow(days),/invalid_period/);
});
test('daily series distinguishes untracked days from measured zeros and preserves fractional minutes',()=>{
 const w=adminWindow(7,new Date('2026-10-07T12:00:00Z'));
 const rows=[{date:'2026-10-03',new_users:'3',logins:'2',voice_minutes:1.25,calls:'1'}];
 const result=adminSeries(rows,w,'2026-10-02T12:00:00Z');
 assert.equal(result.length,8);assert.equal(result[0].logins,null);assert.equal(result[0].new_users,0);
 assert.equal(result.find(p=>p.date==='2026-10-02').voice_minutes,0);
 assert.equal(result.find(p=>p.date==='2026-10-03').voice_minutes,1.25);
 assert.equal(result.find(p=>p.date==='2026-10-03').new_users,3);
 assert.ok(adminSeries(rows,w,null).every(p=>p.voice_minutes===null));
});
test('overview uses bounded consistent current and previous windows, and suppresses incomplete comparisons',async()=>{
 const queries=[];
 const database={async query(sql,params){queries.push({sql,params});
 if(sql.includes('AS new_users')&&sql.includes('DISTINCT'))return {rows:[{new_users:'2',logins:'4',active_users:'3',voice_minutes:1.25,calls:'1'}]};
 if(sql==='SELECT count(*) AS users FROM origen_accounts')return {rows:[{users:'9'}]};
 if(sql.includes('applied_at'))return {rows:[{applied_at:'2026-10-05T00:00:00Z'}]};
 return {rows:[]};}};
 const result=await adminOverview(database,7,new Date('2026-10-07T12:00:00Z'));
 assert.equal(result.totals.users,'9');assert.equal(result.totals.voice_minutes,1.25);assert.equal(result.comparisonReady,false);
 const bounded=queries.filter(q=>q.params?.length===2);assert.equal(bounded.length,5);
 assert.ok(bounded.every(q=>q.sql.includes('>= $1')&&q.sql.includes('< $2')));
 assert.deepEqual(bounded[1].params,[result.window.previousStart,result.window.start]);
 for(const q of [bounded[0],...bounded.slice(2)])assert.deepEqual(q.params,[result.window.start,result.window.end]);
 assert.ok(queries.find(q=>q.sql.includes('date_trunc')).sql.includes("AT TIME ZONE 'UTC'"));
});
test('invalid date selection returns 400 without querying any data',async()=>{
 const handler=createAdminHandler({query(){throw Error('must not query');}},{ADMIN_SUBJECTS:'admin'});
 const req=Readable.from([JSON.stringify({action:'overview',days:365})]);Object.assign(req,{url:'/api/admin',origenAuthorized:true,origenIdentity:{sub:'admin'}});
 let status;await handler(req,{writeHead(value){status=value;},end(){}},()=>{});assert.equal(status,400);
});
