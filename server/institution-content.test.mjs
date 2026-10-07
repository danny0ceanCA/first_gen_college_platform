import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './family-fixture.mjs';
import {createInstitutionRepository,validateInstitution,validateInstitutionPage} from './institutions.mjs';
import {createApp} from './index.mjs';
import {localizedInstitution,upcomingInstitutionEvents} from '../src/institutionContent.mjs';
import {rebaseInstitutionDraft} from '../src/institutionDraft.mjs';
import {renderInstitutionPage} from './institution-public-html.mjs';
const offering={id:'11111111-1111-4111-8111-111111111111',kind:'pathway',audiences:['transfer','adult'],title:'Transfer support',description:'Plan your transfer.',eligibility:'Community college students',url:'https://college.example/transfer',translations:{es:{title:'Apoyo de transferencia',description:'Planifica tu transferencia.',eligibility:'Estudiantes de colegios comunitarios'}}};
const event={id:'22222222-2222-4222-8222-222222222222',title:'Information session',description:'Learn about transfer options.',startsAt:'2030-11-15T17:00:00-08:00',endsAt:'2030-11-15T18:00:00-08:00',timeZone:'America/Los_Angeles',location:'Online',registrationUrl:'https://college.example/register',translations:{es:{title:'Sesión informativa',description:'Conoce opciones de transferencia.',location:'En línea'}}};
const page={name:'Example College',intro:'A place for your next step.',website:'https://college.example/',description:'College support.',programs:'',admissions:'',financialAid:'',events:'',publicEmail:'info@college.example',links:[],logoUrl:'https://college.example/logo.png',translations:{es:{name:'Colegio Ejemplo',intro:'Un lugar para tu siguiente paso.',description:'Apoyo universitario.'}},content:{version:1,offerings:[offering],events:[event]}};
const representative={firstName:'Alex',workEmail:'alex@college.example',jobRole:'Outreach'};
async function setup(){const {pool}=await fixture();const run=createInstitutionRepository(pool,['reviewer']);const call=(sub,input)=>run(sub,validateInstitution(input));const create=async content=>(await call('owner',{action:'register',registrationKey:crypto.randomUUID(),representative,page:content})).institutions[0];const publish=async i=>{await call('owner',{action:'submit',id:i.id,revision:i.revision});await call('reviewer',{action:'verify',id:i.id,revision:i.revision,note:'Independent verification'});await call('reviewer',{action:'publish',id:i.id,revision:i.revision,note:'Both language versions reviewed'});};return{pool,run,call,create,publish};}

test('structured records validate audiences, stable IDs, explicit event offsets, chronology and safe official URLs',()=>{
 assert.deepEqual(validateInstitutionPage(page,true),page);
 for(const change of [{endsAt:event.startsAt},{startsAt:'2030-11-15T17:00'},{startsAt:'2030-02-30T17:00:00Z'},{timeZone:'Bad/Zone'},{registrationUrl:'javascript:alert(1)'},{registrationUrl:''}])assert.throws(()=>validateInstitutionPage({...page,content:{...page.content,events:[{...event,...change}]}},true),{status:400});
 assert.throws(()=>validateInstitutionPage({...page,content:{...page.content,offerings:[{...offering,audiences:['invented']}]}}),{status:400});
 assert.throws(()=>validateInstitutionPage({...page,content:{...page.content,events:[{...event,id:offering.id}]}}),{status:400});
 assert.throws(()=>validateInstitutionPage({...page,logoUrl:'http://unsafe.example/logo.png'},true),{status:400});
 assert.equal(validateInstitutionPage({...page,content:{...page.content,events:[{...event,startsAt:'unfinished'}]}}).content.events[0].startsAt,'unfinished');
});

test('Spanish falls back explicitly by field, event expiry is consistent, and new fields survive concurrent draft refresh',()=>{
 const es=localizedInstitution(page,'es');assert.equal(es.page.content.offerings[0].title,'Apoyo de transferencia');assert.deepEqual(es.missing,[]);
 const partial=localizedInstitution({...page,translations:{es:{name:'Colegio'}}},'es');assert.equal(partial.page.description,page.description);assert.ok(partial.missing.includes('description'));
 assert.equal(upcomingInstitutionEvents([event],Date.parse(event.endsAt)).length,0);assert.equal(upcomingInstitutionEvents([event],Date.parse(event.startsAt)).length,1);
 const base={name:'College'};assert.deepEqual(rebaseInstitutionDraft(base,{...base,content:page.content},{name:'New name'}).merged,{name:'New name',content:page.content});
});

test('directory and public snapshots exclude drafts, archived pages and unpublished parents, with literal bilingual searches',async()=>{
 const {pool,run,call,create,publish}=await setup();try{
  const i=await create(page);const draft=await create({...page,name:'Private draft'});await publish(i);
  assert.equal((await run(null,{action:'directory',search:'Colegio'})).entries[0].name,page.name);
  assert.equal((await run(null,{action:'directory',search:'%'})).entries.length,0);
  assert.equal((await run(null,{action:'directory',search:'Private'})).entries.length,0);
  await call('owner',{action:'save',id:i.id,revision:1,page:{...page,intro:'PRIVATE DRAFT CHANGE'}});assert.equal((await run(null,{action:'public',slug:i.slug})).page.intro,page.intro);
  await call('owner',{action:'archive',id:i.id,revision:2});assert.equal((await run(null,{action:'directory'})).entries.length,0);
  assert.equal((await call('owner',{action:'load'})).institutions.some(x=>x.id===draft.id),true);
 }finally{await pool.end();}
});

test('directory pagination is bounded and does not expose a published unit behind an unavailable parent',async()=>{
 const {pool,run}=await setup();try{
  for(let n=0;n<27;n++)await pool.query("INSERT INTO origen_institutions(slug,draft,published,status,verification_status) VALUES($1,$2,$2,'published','verified')",[`college-${String(n).padStart(2,'0')}`,JSON.stringify(page)]);
  const first=await run(null,{action:'directory'});assert.equal(first.entries.length,24);assert.ok(first.nextCursor);const second=await run(null,{action:'directory',cursor:first.nextCursor});assert.equal(second.entries.length,3);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.slug)).size,27);
  const parent=(await pool.query("INSERT INTO origen_institutions(slug,draft) VALUES('private-parent',$1) RETURNING id",[JSON.stringify(page)])).rows[0];
  await pool.query("INSERT INTO origen_institutions(slug,draft,published,parent_institution_id,unit_type,parent_approval) VALUES('orphan-unit',$1,$1,$2,'department','approved')",[JSON.stringify({...page,name:'Hidden unit'}),parent.id]);
  assert.equal((await run(null,{action:'directory',search:'Hidden'})).entries.length,0);await assert.rejects(run(null,{action:'public',slug:'orphan-unit'}),{status:404});
 }finally{await pool.end();}
});

test('sharing HTML contains server-readable approved content, bilingual metadata, safe escaped text and ended-event notices',()=>{
 const env={INSTITUTION_PUBLIC_ORIGIN:'https://api.example',PUBLIC_APP_URL:'https://origen.example'};
 const result={page,slug:'example-college',publishedAt:'2026-10-07T00:00:00Z',units:[]};const html=renderInstitutionPage(result,{env,language:'es',now:Date.parse('2030-11-01')});assert.match(html,/<html lang="es"/);assert.match(html,/og:title.*Colegio Ejemplo/);assert.match(html,/Apoyo de transferencia/);assert.match(html,/Sesión informativa/);assert.match(html,/rel="canonical".*api.example/);assert.doesNotMatch(html,/auth0_subject|Independent verification|alex@college/);
 const ended=renderInstitutionPage(result,{env,language:'es',eventId:event.id,now:Date.parse('2030-12-01')});assert.match(ended,/Este evento terminó/);assert.doesNotMatch(ended,/href="https:\/\/college.example\/register"/);
 const malicious=renderInstitutionPage({...result,page:{...page,name:'<script>alert(1)</script>'}},{env});assert.doesNotMatch(malicious,/<script>alert/);assert.match(malicious,/&lt;script&gt;/);
});

test('anonymous page, directory, event and downloadable QR routes require approved publication',async()=>{
 const {pool,create,publish}=await setup();const i=await create(page);const app=createApp({ALLOWED_ORIGINS:'https://origen.example',INSTITUTION_PUBLIC_ORIGIN:'https://api.example'},async token=>({sub:token}),pool,()=>{});const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;try{
  assert.equal((await fetch(`${base}/api/institutions/pages/${i.slug}`)).status,404);await publish(i);
  const response=await fetch(`${base}/api/institutions/pages/${i.slug}?lang=es&event=${event.id}`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/Sesión informativa/);assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
  const qr=await fetch(`${base}/api/institutions/qr/${i.slug}?lang=es`);assert.equal(qr.status,200);assert.equal(qr.headers.get('content-type'),'image/png');assert.deepEqual([...new Uint8Array(await qr.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal((await fetch(`${base}/api/institutions/directory`)).status,200);assert.equal((await fetch(`${base}/api/institutions/pages/${i.slug}?lang=fr`)).status,400);
 }finally{await new Promise(r=>server.close(r));await pool.end();}
});
