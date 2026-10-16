import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {migrateTelemetry,grantTelemetryRole} from './manage.mjs';
import {migrateDatabase} from '../../server/database.mjs';
import {grantRuntimeAccess} from '../../server/runtime-grants.mjs';
import {grantErasureWorker} from '../../server/telemetry-erasure-grants.mjs';
import {replayLedger} from './erasure-worker.mjs';
import {grantSupportResolver} from '../../server/support-diagnostics-grants.mjs';
export async function fixture({application=false}={}){
 const suffix=randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:process.env.TELEMETRY_TEST_DATABASE_URL,max:1}),pools=[],databases=[],roles=[];
 const createDatabase=async label=>{const name=`tel_${label}_${suffix}`;await admin.query(`CREATE DATABASE ${name}`);databases.push(name);const url=new URL(process.env.TELEMETRY_TEST_DATABASE_URL);url.pathname=`/${name}`;const pool=new pg.Pool({connectionString:url.href,max:2});pools.push(pool);return {pool,url};};
 const createRole=async(db,purpose,ledger=false)=>{const name=`tel_${purpose.toLowerCase()}_${suffix}`;await admin.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);roles.push(name);await grantTelemetryRole(db.pool,name,purpose,'test');const url=new URL(db.url);url.username=name;url.password='';const pool=new pg.Pool({connectionString:url.href,max:2});pools.push(pool);return pool;};
 const close=async()=>{await Promise.all(pools.map(pool=>pool.end()));for(const db of databases)await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);for(const role of roles)await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();};
 try{
  const data=await createDatabase('events'),ledger=await createDatabase('ledger');await migrateTelemetry(data.pool);await migrateTelemetry(ledger.pool,{ledger:true});
  const ingest=await createRole(data,'ingest'),query=await createRole(data,'query'),health=await createRole(data,'health'),retention=await createRole(data,'retention'),erasure=await createRole(data,'erasure'),ledgerWriter=await createRole(ledger,'ledgerWriter',true),ledgerReader=await createRole(ledger,'ledgerReader',true),ledgerRetention=await createRole(ledger,'ledgerRetention',true);
  await replayLedger(erasure,ledgerWriter);
  const supportControl=await createRole(ledger,'support'),monitor=await createRole(data,'monitor');
  let appOwner,appRuntime,appErasure,appHealth,appSupport;
  if(application){const app=await createDatabase('app');appOwner=app.pool;await migrateDatabase(appOwner);
   for(const purpose of ['runtime','worker','health','support']){const name=`tel_app_${purpose}_${suffix}`;await admin.query(`CREATE ROLE ${name} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);roles.push(name);if(purpose==='runtime')await grantRuntimeAccess(appOwner,name);else if(purpose==='support')await grantSupportResolver(appOwner,name);else await grantErasureWorker(appOwner,name,{healthOnly:purpose==='health'});const url=new URL(app.url);url.username=name;url.password='';const pool=new pg.Pool({connectionString:url.href,max:2});pools.push(pool);if(purpose==='runtime')appRuntime=pool;else if(purpose==='worker')appErasure=pool;else if(purpose==='support')appSupport=pool;else appHealth=pool;}
  }
  return {owner:data.pool,ledgerOwner:ledger.pool,ingest,query,health,retention,erasure,ledgerWriter,ledgerReader,ledgerRetention,supportControl,monitor,appOwner,appRuntime,appErasure,appHealth,appSupport,close};
 }catch(error){await close();throw error;}
}
