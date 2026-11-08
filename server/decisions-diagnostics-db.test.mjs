import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createTestLogin, useTestLogin } from './fixtures/postgres-test-login.mjs';
import { isolateDatabase, runAsAccount } from './account-isolation.mjs';
import { createDecisionsDiagnosticWriter } from './decisions-diagnostics.mjs';

test('real PostgreSQL: durable Decisions metadata survives writer recreation and isolates accounts',
  { skip: !process.env.DATABASE_TEST_URL }, async () => {
    const url=new URL(process.env.DATABASE_TEST_URL);
    if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('local_test_database_required');
    const suffix=randomUUID().replaceAll('-',''),schema='decisions_'+suffix,role='decisions_user_'+suffix;
    const owner=new pg.Pool({connectionString:url.href,max:1,options:`-c search_path=${schema}`});let runtime;
    try{
      await owner.query(`CREATE SCHEMA ${schema}`);await createTestLogin(owner,role);
      await owner.query(`CREATE TABLE origen_accounts(id uuid PRIMARY KEY,auth0_subject text UNIQUE);
        CREATE FUNCTION origen_current_account_id() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT id FROM origen_accounts WHERE auth0_subject=current_setting('origen.subject',true) $$`);
      await owner.query(await readFile(new URL('./migrations/125_decisions_events.sql',import.meta.url),'utf8'));
      await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role};
        GRANT SELECT ON origen_accounts TO ${role};GRANT SELECT,INSERT ON origen_decisions_events TO ${role}`);
      const account=randomUUID(),other=randomUUID(),call=randomUUID();
      await owner.query('INSERT INTO origen_accounts VALUES($1,$2),($3,$4)',[account,'owner-a',other,'owner-b']);
      useTestLogin(url,role);runtime=new pg.Pool({connectionString:url.href,max:1,options:`-c search_path=${schema}`});
      const database=isolateDatabase(runtime,{schema});
      for(let i=0;i<2;i++){
        const writer=createDecisionsDiagnosticWriter(database,{subject:'owner-a',sessionId:call});
        assert.equal(writer.record({type:'support_early_sent',sourceText:'PRIVATE',contextSent:true,playbackClaim:false}),true);
        await writer.close();assert.equal(writer.stats().failed,0);
      }
      const rows=await runAsAccount({sub:'owner-a'},()=>database.query('SELECT * FROM origen_decisions_events'));
      assert.equal(rows.rows.length,2);assert.notEqual(rows.rows[0].run_id,rows.rows[1].run_id);
      assert.ok(!JSON.stringify(rows.rows).includes('PRIVATE'));
      assert.equal((await runAsAccount({sub:'owner-b'},()=>database.query('SELECT * FROM origen_decisions_events'))).rowCount,0);
      await assert.rejects(runAsAccount({sub:'owner-b'},()=>database.query(
        `INSERT INTO origen_decisions_events(id,account_id,session_id,run_id,sequence,stage,observed_at,data)
         VALUES($1,$2,$3,$4,1,'forged',now(),'{}')`,[randomUUID(),account,call,randomUUID()])));
      await assert.rejects(runAsAccount({sub:'owner-a'},()=>database.query('DELETE FROM origen_decisions_events')));
      await owner.query('DELETE FROM origen_accounts WHERE id=$1',[account]);
      assert.equal((await owner.query('SELECT * FROM origen_decisions_events')).rowCount,0);
    }finally{
      await runtime?.end();
      await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await owner.query(`DROP ROLE IF EXISTS ${role}`);await owner.end();
    }
  });
