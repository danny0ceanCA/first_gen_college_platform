import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';

export const campaign='worker-cross-scenario-20261111';
export const campaignRoot=resolve('output',campaign);
export async function campaignBudget(){
 await mkdir(campaignRoot,{recursive:true});
 const path=resolve(campaignRoot,'budget.json'),lock=await open(path+'.lock','wx');
 let ledger;
 try{ledger=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;ledger={campaign,capUsd:20,approval:'User approved a new $20 total test/fix cycle, 2026-11-11.',entries:[]};}
 assert.equal(ledger.campaign,campaign);assert.equal(ledger.capUsd,20);
 let chain=Promise.resolve();
 const total=()=>ledger.entries.reduce((n,e)=>n+e.accountedUSD,0);
 const persist=()=>{const snapshot=JSON.stringify({...ledger,accountedUsd:total(),updatedAt:new Date().toISOString()},null,2);chain=chain.then(async()=>{await writeFile(path+'.tmp',snapshot);await rename(path+'.tmp',path);});return chain;};
 assert(ledger.entries.every(e=>Number.isFinite(e.accountedUSD)&&e.accountedUSD>=0)&&total()<=20);
 const budget={total,entries:ledger.entries,async reserve(kind,amount,metadata={}){
  if(!Number.isFinite(amount)||amount<=0||total()+amount>20)throw Error('budget_boundary');
  const entry={...metadata,id:randomUUID(),kind,reservedUSD:amount,accountedUSD:amount,status:'reserved'};ledger.entries.push(entry);await persist();return entry;
 },async settle(entry,actual){
  if(actual==null)return;
  assert(Number.isFinite(actual)&&actual>=0,'invalid_provider_usage');
  entry.accountedUSD=actual;entry.status=actual>entry.reservedUSD+1e-9?'reservation_exceeded':'reported_usage';await persist();
  if(entry.status==='reservation_exceeded')throw Error('reservation_exceeded');
 },async close(){await chain;await lock.close();await unlink(path+'.lock');}};
 await persist();return budget;
}
