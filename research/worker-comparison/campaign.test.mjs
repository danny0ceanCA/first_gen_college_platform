import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const moduleUrl=new URL('./campaign.mjs',import.meta.url).href;
test('concurrent reservations persist all entries, enforce the total cap and exclusively own the ledger',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'origen-budget-'));
 const program=`import assert from 'node:assert/strict';const {campaignBudget}=await import(${JSON.stringify(moduleUrl)});const b=await campaignBudget();try{await assert.rejects(campaignBudget(),e=>e.code==='EEXIST');const entries=await Promise.all(Array.from({length:20},()=>b.reserve('test',1)));assert.equal(b.total(),20);await assert.rejects(b.reserve('overflow',.01),/budget_boundary/);await b.settle(entries[0],.2);assert.equal(b.total(),19.2);}finally{await b.close();}const resumed=await campaignBudget();assert.equal(resumed.total(),19.2);await resumed.close();`;
 const r=spawnSync(process.execPath,['--input-type=module','-e',program],{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const ledger=JSON.parse(await readFile(join(cwd,'output/worker-cross-scenario-20261111/budget.json'),'utf8'));assert.equal(ledger.entries.length,20);assert.equal(ledger.accountedUsd,19.2);
});
