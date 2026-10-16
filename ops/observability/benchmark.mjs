import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {readEvents} from './store.mjs';
if(!process.env.TELEMETRY_TEST_DATABASE_URL)throw new Error('disposable_telemetry_test_database_required');
const f=await fixture();try{
 const operation=randomUUID(),instance=randomUUID();
 await f.owner.query(`INSERT INTO telemetry_events(event_id,received_at,event_time,expires_at,service,environment,release,instance_id,event,level,producer,evidence,operation_id,attributes)
 SELECT gen_random_uuid(),now(),now(),now()+interval '336 hours','origen-api','test','unknown',$1,'summary.save.finished','info','server','server_observed',CASE WHEN i%1000=0 THEN $2::uuid ELSE gen_random_uuid() END,'{"outcome":"completed"}'::jsonb FROM generate_series(1,100000) i`,[instance,operation]);
 const timings=[];let count;for(let i=0;i<20;i++){const started=performance.now();const result=await readEvents(f.query,f.ledgerReader,{kind:'operation',reference:operation,environment:'test'});timings.push(performance.now()-started);count=result.events.length;}
 timings.sort((a,b)=>a-b);process.stdout.write(JSON.stringify({syntheticRows:100000,iterations:20,rowsPerQuery:count,p95Ms:timings[Math.ceil(timings.length*0.95)-1],maxMs:timings.at(-1),queryLimit:200,deadlineMs:2000})+'\n');
}finally{await f.close();}
