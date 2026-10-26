import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationContract,organizationOutput,validateOrganization} from './binder-organization.mjs';
import {safeErrorCode} from './observability/error-codes.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
import {readFile} from 'node:fs/promises';
import {fixture} from './family-fixture.mjs';
import {createHistoryRepository} from './history.mjs';
import {createOrganizationService} from './binder-organization.mjs';

const entry=(quote,overrides={})=>({topic:'transfer',category:'explanation',certainty:'stated',language:'en',quote,...overrides});
const response=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}]});

test('server supplies complete source choices for narrative, paragraphs, abbreviations, lists, and Spanish',()=>{
 const summary='We discussed U.S. colleges and transfer courses. The student is considering nursing.\n\n- Transfer requirements should be checked with a counselor.\nLa estudiante decidió consultar al consejero. ¿Qué cursos pueden transferirse?';
 const contract=organizationContract(summary);
 assert.ok(contract.sentences.includes('We discussed U.S. colleges and transfer courses.'));
 assert.ok(contract.sentences.includes('- Transfer requirements should be checked with a counselor.'));
 assert.ok(contract.sentences.includes('La estudiante decidió consultar al consejero.'));
 assert.equal(contract.sentences.includes('Transfer requirements should be checked with a counselor.'),false,'list marker remains part of the exact source');
 // Every classification permitted by a generated branch must pass the original
 // provenance/uncertainty validator. Generation is constrained, not repaired.
 for(const branch of contract.schema.properties.items.items.anyOf){
  assert.equal(branch.additionalProperties,false);
  assert.deepEqual(branch.required.sort(),Object.keys(branch.properties).sort());
  const p=branch.properties;
  for(const quote of p.quote.enum)for(const category of p.category.enum)for(const certainty of p.certainty.enum){
   const item=entry(quote,{category,certainty});
   assert.deepEqual(validateOrganization({items:[item]},summary),[item]);
  }
 }
 assert.throws(()=>validateOrganization({items:[entry('Transfer requirements should be checked with a counselor.')]},summary),{code:'organization_quote'});
});

test('conditional explanations cannot be generated as stated; only explicit non-negated decisions are offered',()=>{
 const quote='We explained how transferable credits could support the student’s transfer plan.';
 const summary=[quote,'The student never decided on nursing.','The student decided to ask a counselor.'].join(' ');
 const branches=organizationContract(summary).schema.properties.items.items.anyOf;
 assert.ok(branches.some(b=>b.properties.quote.enum.includes(quote)&&b.properties.certainty.enum.includes('tentative')));
 assert.ok(!branches.some(b=>b.properties.quote.enum.includes(quote)&&b.properties.certainty.enum.includes('stated')));
 assert.deepEqual(branches.find(b=>b.properties.category.enum.includes('decision')).properties.quote.enum,['The student decided to ask a counselor.']);
 assert.throws(()=>validateOrganization({items:[entry(quote)]},summary),{code:'organization_certainty'});
});

test('sensitive sentences, fragments, long sentences and empty sources never become model choices',()=>{
 const summary='My email is private@example.test. My income is 42000 dollars. We discussed transfer pathways.';
 assert.deepEqual(organizationContract(summary).sentences,['We discussed transfer pathways.']);
 for(const source of ['', 'Hello.', 'My email is private@example.test.', 'x'.repeat(1001)])assert.equal(organizationContract(source).schema,null);
 assert.throws(()=>validateOrganization({items:[entry('My email is private@example.test.')]},summary),{code:'organization_sensitive'});
});

test('dynamic contract stays inside provider enum/string bounds for a maximum-size source',()=>{
 const summary=Array.from({length:600},(_,i)=>`I decided to ask question ${i}.`).join(' ').slice(0,12000);
 const contract=organizationContract(summary);let values=0,characters=0;
 const visit=value=>{if(Array.isArray(value)){value.forEach(visit);return;}if(value&&typeof value==='object'){if(value.enum){values+=value.enum.length;characters+=value.enum.join('').length;}Object.values(value).forEach(visit);}};
 visit(contract.schema);assert.equal(contract.schema.properties.items.items.anyOf.length,4);assert.ok(values<=1000);assert.ok(characters<120000);assert.equal(contract.sentences.length,200);
});

test('failed output reveals only a finite validation category, never source or generated content',()=>{
 const quote='The student is considering nursing.',source=quote+' Which courses transfer?';
 const cases=[
  [null,'organization_output'],[{status:'incomplete',output:[]},'organization_incomplete'],
  [{output:[{content:[{type:'output_text',text:'private invalid JSON'}]}]},'organization_json'],
  [response([entry('An invented private sentence.')]),'organization_quote'],
  [response([entry(quote)]),'organization_certainty'],
  [response([entry(quote,{certainty:'tentative'}),entry(quote,{certainty:'tentative'})]),'organization_duplicate'],
  [response([entry('Which courses transfer?',{category:'decision'})]),'organization_decision'],
  [response([entry(quote,{accountId:'forged'})]),'organization_shape'],
 ];
 for(const [data,code] of cases){
  let caught;try{organizationOutput(data,source);}catch(error){caught=error;}
  assert.equal(safeErrorCode(caught),code);
  const record=diagnosticRecord({event:'job.finished',job:'binder-processing',outcome:'failed',code:safeErrorCode(caught),summary:source,error:caught,quote});
  assert.equal(record.code,code);assert.equal(record.level,'error');
  assert.ok(!JSON.stringify(record).includes('nursing'));assert.ok(!JSON.stringify(record).includes('private'));
 }
 assert.equal(safeErrorCode({code:'organization_The private source',message:source}),'operation_failed');
 assert.deepEqual(organizationOutput(response([entry(quote,{certainty:'tentative'})]),source),[entry(quote,{certainty:'tentative'})]);
});

test('saved source and constrained provider response reach both private stores and receipts without a paid request',async t=>{
 const f=await fixture();t.after(()=>f.pool.end());
 await f.pool.query(await readFile(new URL('./migrations/031_topic_notebooks.sql',import.meta.url),'utf8'));
 await f.pool.query((await readFile(new URL('./migrations/044_student_memory.sql',import.meta.url),'utf8')).split('ALTER TABLE')[0]);
 // pg-mem does not implement PL/pgSQL/RLS; the PostgreSQL organization suite
 // covers those. This fixture exercises real persistence and service wiring.
 await f.pool.query("ALTER TABLE origen_conversation_summaries ADD COLUMN organization_reported_by text NOT NULL DEFAULT 'parent'; ALTER TABLE origen_topic_notes ADD COLUMN organization jsonb; ALTER TABLE origen_student_memories ADD COLUMN organization jsonb; ALTER TABLE origen_topic_note_batches ADD COLUMN organization_version text; ALTER TABLE origen_topic_note_batches ADD COLUMN organization_keys text[] NOT NULL DEFAULT '{}';");
 const connect=f.pool.connect.bind(f.pool),wrapped=new WeakSet();
 f.pool.connect=async()=>{const client=await connect();if(wrapped.has(client))return client;wrapped.add(client);const query=client.query.bind(client);client.query=(sql,args)=>query(sql.replace(/((?:s\.)?student_id) IS NOT DISTINCT FROM \$2/g,"coalesce($1,'')=coalesce($2,'')"),args);return client;};
 for(const subject of ['owner','other'])await f.run(subject,{action:'save-student',student:{id:'alex',name:'Alex',stage:'Community college',interest:'Science',gpa:'',color:'peach'}});
 const summary='The student is considering nursing. We discussed transfer courses and counselor questions.';
 await createHistoryRepository(f.pool)('owner',{action:'save',item:{id:'synthetic-source',studentId:'alex',mode:'planning',date:new Date().toISOString(),summary,sources:[]}});
 const items=[entry('The student is considering nursing.',{category:'goal',certainty:'tentative'}),entry('We discussed transfer courses and counselor questions.')];
 let calls=0;
 const service=createOrganizationService(f.pool,{ORIGEN_BINDER_ORGANIZATION:'true',ORIGEN_BINDER_JOBS:'true',ORIGEN_PERSONALIZATION_MODE:'on',ORIGEN_PERSONALIZATION_EXTRACTION:'true',OPENAI_API_KEY:'synthetic'},async(url,options)=>{
  calls++;const body=JSON.parse(options.body),input=JSON.parse(body.input);
  assert.equal(body.store,false);assert.deepEqual(input.sentences,organizationContract(summary).sentences);assert.equal(input.summary,undefined);
  assert.deepEqual(body.text.format.schema,organizationContract(summary).schema);
  return new Response(JSON.stringify(response(items)));
 });
 await service('owner',{studentId:'alex',summaryId:'synthetic-source'});
 const notes=(await f.pool.query('SELECT * FROM origen_topic_notes')).rows,memories=(await f.pool.query('SELECT * FROM origen_student_memories')).rows;
 assert.equal(notes.length,1);assert.equal(memories.length,1);assert.equal(notes[0].source_quote,items[1].quote);assert.equal(memories[0].source_quote,items[0].quote);
 assert.equal(notes[0].status,'suggested');assert.equal(memories[0].status,'proposed');assert.equal(memories[0].organization.certainty,'tentative');
 for(const table of ['origen_topic_note_batches','origen_memory_batches'])assert.equal((await f.pool.query(`SELECT * FROM ${table}`)).rows.length,1);
 await service('owner',{studentId:'alex',summaryId:'synthetic-source'});assert.equal(calls,1);
 for(const [subject,studentId] of [['other','alex'],['owner',null]])await assert.rejects(service(subject,{studentId,summaryId:'synthetic-source'}),{status:404});
 assert.equal(calls,1);
 await createHistoryRepository(f.pool)('owner',{action:'save',item:{id:'sensitive-source',studentId:'alex',mode:'planning',date:new Date().toISOString(),summary:'My email is private@example.test.',sources:[]}});
 await service('owner',{studentId:'alex',summaryId:'sensitive-source'});assert.equal(calls,1,'no eligible source sentence means no provider request');
 for(const table of ['origen_topic_note_batches','origen_memory_batches'])assert.equal((await f.pool.query(`SELECT * FROM ${table}`)).rows.length,2);
 assert.equal((await f.pool.query('SELECT * FROM origen_topic_notes')).rows.length,1);
});
