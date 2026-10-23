import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestLogin,useTestLogin} from './fixtures/postgres-test-login.mjs';

test('disposable logins use distinct passwords without changing role restrictions or reusing the owner credential',async()=>{
 const queries=[],database={query:async sql=>queries.push(sql)},prefix='fixture_'+randomUUID().replaceAll('-','');
 await createTestLogin(database,prefix+'_a');await createTestLogin(database,prefix+'_b');
 const first=useTestLogin(new URL('postgresql://owner:owner-canary@127.0.0.1:55487/synthetic'),prefix+'_a');
 const second=useTestLogin(new URL(first),prefix+'_b');
 assert.ok(first.password!==second.password&&first.password!=='owner-canary');
 assert.ok(/^[a-f0-9]{64}$/.test(first.password)&&/^[a-f0-9]{64}$/.test(second.password));
 assert.ok(queries.every(sql=>sql.endsWith('NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT')));
 assert.ok(queries[0].includes(`PASSWORD '${first.password}'`)&&queries[1].includes(`PASSWORD '${second.password}'`));
 assert.equal(first.hostname,'127.0.0.1');assert.equal(first.pathname,'/synthetic');
 assert.equal(useTestLogin(new URL(first),prefix+'_a').password===first.password,true);
});

test('invalid or uncreated test roles fail without executing SQL or falling back to owner authentication',async()=>{
 let calls=0;await assert.rejects(createTestLogin({query:async()=>calls++},'invalid;role'),/invalid_test_role/);
 assert.equal(calls,0);assert.throws(()=>useTestLogin(new URL('postgresql://owner@127.0.0.1/test'),'uncreated'),/unknown_test_role/);
});
