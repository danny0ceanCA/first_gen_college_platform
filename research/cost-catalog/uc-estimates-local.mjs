import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {prepareUcEstimates} from '../../scripts/prepare-uc-estimates.mjs';
import {publishCatalogSnapshot,publicationDigest} from './publication.mjs';
import {createProductionCatalogProvider} from './production-provider.mjs';
import {verifyMixedCatalog} from './csu-rehearsal.mjs';
import {processResearchJob} from '../../server/voice-research-worker.mjs';
import {voiceVisualCards} from '../../server/voice-visual-cards.mjs';
import {researchCostRows} from '../../src/researchCostRows.ts';

export const ucsfCases=[
 ["Global Health Sciences master's",'maestría en salud global',29052,9],
 ["Global Health Sciences master's summer",'maestría en salud global en verano',6456,2],
 ['Global Health Sciences part-time 1','salud global tiempo parcial primer año',29052,9],
 ['Global Health Sciences part-time 2','salud global tiempo parcial segundo año',35508,11],
 ['Global Health Sciences part-time summer','salud global tiempo parcial verano',6456,2],
 ['Global Health Sciences PhD California resident','doctorado en salud global residente de California',29052,9],
 ['Global Health Sciences PhD nonresident','doctorado en salud global no residente',44154,9],
 ['Advanced Training Clinical Research certificate','certificado de investigación clínica',35508,11],
 ["Clinical Research master's first year",'maestría en investigación clínica primer año',35508,11],
 ["Clinical Research master's second year",'maestría en investigación clínica segundo año',29052,9],
 ['Biomedical Imaging','imágenes biomédicas',29052,9],
 ['Dental PostBac','posbachillerato en odontología',33080,10],
 ['Medicine PostBac','posbachillerato en medicina',33080,10],
 ['Pharmacy PostBac','posbachillerato en farmacia',33080,10],
];
export async function verifyUcEstimateDelivery(provider,{onReport=()=>{},records}={}){
 const checks=[];
 for(const language of ['en','es']){
  const es=language==='es',undergraduate=records?.filter(b=>b.payload.catalogEstimate&&b.campus!=='UC San Francisco').map(b=>{
   const raw=b.payload.raw,resident=raw.Residency==='Nonresident'?(es?'no residente':'nonresident'):(es?'residente de California':'California resident');
   const housing=raw.Housing==='On-campus apartment'?(es?'apartamento en el campus':'on-campus apartment'):
    /residence hall/i.test(raw.Housing)?(es?'residencia universitaria':'residence hall'):
    /at home|relatives/i.test(raw.Housing)?(es?'viviendo con familiares':'living with family'):
    /on campus/i.test(raw.Housing)?(es?'en el campus':'on campus'):(es?'alquilando fuera del campus':'renting off campus');
   const question=es?`Costo de asistencia ${b.academic_year} de pregrado ${resident}, ${housing}; cohorte ${raw['Normalized cohort key']}.`:
    `${b.academic_year} undergraduate ${resident} cost of attendance, ${housing}; cohort ${raw['Normalized cohort key']}.`;
   return [b.campus,question,b.payload.catalogEstimate.amount,b.payload.catalogEstimate.basis,undefined,b.payload.catalogEstimate.note?.en.includes('1,550')];
  });
  const cases=[...(undergraduate||[
   ['UC Berkeley',es?'Costo de asistencia 2026-27 de pregrado no residente alquilando fuera del campus.':'2026-27 nonresident undergraduate cost of attendance renting off campus.',88962,'calculated'],
   ['UC Irvine',es?'Costo de asistencia 2026-27 para residente de California de pregrado en el campus; cohorte 2025-26.':'2026-27 California resident undergraduate cost of attendance on campus; cohort 2025-26.',44552,'calculated',undefined,true],
  ]),
   ...ucsfCases.map(([en,spanish,amount,months])=>['UC San Francisco',es?`Costo de asistencia 2026-27 para ${spanish}.`:`2026-27 cost of attendance for ${en}.`,amount,'partial',months]),
  ];
  let reference;
  for(const [index,[institution,question,amount,basis,months,discrepancy]] of cases.entries()){
   const input={mode:'finance',language,institution,question,requestKey:'uc-estimate-'+index};let available=true;const writes=[],started=performance.now();
   const db={async query(sql,args){if(sql.includes('RETURNING id,input')){if(!available)return {rows:[]};available=false;return {rows:[{id:'isolated-uc-estimate',input}]};}writes.push({sql,args});return {rows:[{status:'running'}],rowCount:1};}};
   await processResearchJob(db,{}, {lookupCatalog:provider.lookup,log:()=>{},request:()=>assert.fail('published estimate must not perform new research or recovery')});
   const result=writes.find(w=>w.sql.includes("status='completed'"))?.args[1];assert.ok(result,language+' '+institution+' '+question);
   const finding=result.voiceBrief.findings[0],b=finding.budget;assert.equal(b.total,null);assert.equal(b.catalogEstimate.basis,basis);assert.equal(b.catalogEstimate.amount,amount);
   assert.equal(result.researchDiagnostics.attempts.length,0);assert.equal(result.researchDiagnostics.recoveryStatus,'not_needed');
   if(discrepancy)assert.match(finding.qualification,/1,550/);
   if(months){assert.match(b.catalogEstimate.note,new RegExp('\\b'+months+'\\b'));assert.ok(b.catalogEstimate.unresolved.length);}
   const events=[],visual=voiceVisualCards({emit:e=>events.push(e)});visual.trackResearch(input.requestKey,question);
   visual.receiveResearch({id:input.requestKey,status:'completed',result,query:{...input,...(reference?{visualComparisonBaseId:reference,visualComparisonCampus:institution}:{})}});
   const report=events.find(e=>e.type==='origen.visual.research')?.report;assert.ok(report);const rows=researchCostRows(report.table.rows,report.table.columns.length,report.housingScenario);
   const total=rows.find(r=>r.id==='total_budget').cells[0];assert.equal(total.estimateBasis,basis);assert.equal(Number(total.value.replace(/[^\d.]/gu,'')),amount);
   if(index===0||index===1)onReport(report,language,index);
   reference=report.id;
   checks.push({language,institution,question,basis,amount,lookupWorkerTableMs:Math.round(performance.now()-started),modelCalls:0});
  }
  for(const question of [es?'Costo de asistencia 2026-27 de UCSF.':'2026-27 UCSF cost of attendance.',es?'Costo de maestría en investigación clínica.':"Clinical Research master's cost of attendance.",
   es?'Costo de posbachillerato en odontología viviendo con familiares.':'Dental PostBac cost of attendance living with family.'])
   assert.equal(await provider.lookup({mode:'finance',language,institution:'UC San Francisco',question}),null,'unclear or incompatible scope must not be guessed');
 }
 return checks;
}

export async function rehearseUcEstimates(basePath,directory){
 const base=JSON.parse(await readFile(basePath,'utf8')),{snapshot}=await prepareUcEstimates(base,directory),name='origen_uc_estimates_20261115';
 const config={host:'127.0.0.1',port:55480,user:'postgres',connectionTimeoutMillis:3000};
 const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
 try{if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await admin.query('CREATE DATABASE '+name);}finally{await admin.end();}
 const c=new pg.Client({...config,database:name});await c.connect();let provider;
 try{
  for(const file of ['126_cost_catalog_publication.sql','128_cost_catalog_campus_releases.sql'])await c.query(await readFile(new URL('../../server/migrations/'+file,import.meta.url),'utf8'));
  const csu=JSON.parse(await readFile(new URL('./.local/csu-estimates-20261115/csu-snapshot.json',import.meta.url),'utf8'));
  await publishCatalogSnapshot(c,csu,{releasedBy:'isolated-test',note:'Preserve existing CSU release'});
  await publishCatalogSnapshot(c,base,{releasedBy:'isolated-test',note:'Existing UC baseline'});
  const before=(await c.query('SELECT budget_key,record_digest FROM coa_catalog.production_published')).rows;
  await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-test',note:'UC calculated and partial estimates'});
  assert.equal((await publishCatalogSnapshot(c,snapshot,{releasedBy:'isolated-test',note:'Idempotency'})).alreadyPublished,true);
  const rows=(await c.query('SELECT * FROM coa_catalog.production_published')).rows;assert.equal(rows.length,1267);
  const amended=new Set(snapshot.reviewEvidence.estimateReview.records.map(r=>r.budgetId));
  for(const b of before)if(!amended.has(b.budget_key))assert.equal(rows.find(r=>r.budget_key===b.budget_key).record_digest,b.record_digest);
  assert.equal(rows.filter(r=>r.payload.catalogEstimate?.basis==='calculated').length,89);assert.equal(rows.filter(r=>r.payload.catalogEstimate?.basis==='partial').length,139);
  assert.equal(rows.filter(r=>r.published_cents===null&&!r.payload.catalogEstimate).length,0);
  provider=await createProductionCatalogProvider({ORIGEN_COST_CATALOG:'true',RESEARCH_WORKER_DATABASE_URL:`postgresql://origen_research_worker@127.0.0.1:55480/${name}`});
  const reports={},checks=await verifyUcEstimateDelivery(provider,{records:snapshot.budgets,onReport:(report,language,index)=>{reports[language+'-'+index]=report;}}),mixed=await verifyMixedCatalog(provider);
  const report={database:name,records:1267,uc:491,csu:776,amended:59,unchanged:1208,checks,mixedStages:mixed.length,snapshotDigest:publicationDigest(snapshot),modelCalls:0,productionChanged:false};
  await writeFile(join(directory,'rehearsal.json'),JSON.stringify(report,null,2));await writeFile(join(directory,'table-reports.json'),JSON.stringify(reports));
  return report;
 }finally{await provider?.close();await c.end();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await rehearseUcEstimates(resolve(process.argv[2]),resolve(process.argv[3]));console.log(JSON.stringify({records:report.records,amended:report.amended,unchanged:report.unchanged,workerChecks:report.checks.length,mixedStages:report.mixedStages,modelCalls:0,productionChanged:false}));
}
