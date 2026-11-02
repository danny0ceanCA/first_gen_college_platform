import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewVerificationEnvironment,reviewVerificationCounts,reviewBrowserComplete,reviewResponseBrowserComplete,followUpBrowserComplete,followUpReleaseStages} from './review-request-verification.mjs';
test('release runner excludes application/provider credentials and requires an explicit local database',()=>{
 const env=reviewVerificationEnvironment({DATABASE_TEST_URL:'postgresql://tester@127.0.0.1:5432/disposable',DATABASE_URL:'PRIVATE_PRODUCTION_SENTINEL',OPENAI_API_KEY:'PRIVATE_PROVIDER_SENTINEL',VITE_API_URL:'https://production.test',NODE_OPTIONS:'--import private-loader.mjs',PATH:'/synthetic/path'});
 assert.equal(env.PATH,'/synthetic/path');assert.equal(env.DATABASE_TEST_URL,env.ORIGEN_TEST_DATABASE_URL);assert.equal(env.NODE_ENV,'test');assert.doesNotMatch(JSON.stringify(env),/PRIVATE_|VITE_API|NODE_OPTIONS/);
 for(const url of [undefined,'postgresql://prod.example/db','https://localhost/db','postgresql://localhost','postgresql://localhost/db?host=prod.example','postgresql://localhost/db#override'])assert.throws(()=>reviewVerificationEnvironment({DATABASE_TEST_URL:url}),/disposable_loopback_database_required/);
});
test('release evidence refuses failed, skipped, cancelled, todo, zero and incomplete test runs',()=>{
 const tap='# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
 assert.equal(reviewVerificationCounts(tap,0).passed,true);
 for(const text of ['',tap.replace('# tests 2','# tests 0'),tap.replace('# fail 0','# fail 1'),tap.replace('# skipped 0','# skipped 1'),tap.replace('# cancelled 0','# cancelled 1'),tap.replace('# todo 0','# todo 1'),tap+'# pass 2\n'])assert.equal(reviewVerificationCounts(text,0).passed,false);
 assert.equal(reviewVerificationCounts(tap,1).passed,false);assert.equal(reviewVerificationCounts(tap,null).passed,false);
});
test('browser evidence requires every language, viewport and entry path exactly once',()=>{
 const record={kind:'review-request-browser-verification',schemaVersion:1,syntheticIdentity:true,syntheticSpeech:true,passed:true,journeys:[1280,390].flatMap(width=>['en','es'].flatMap(language=>['notebook','realtime','live'].map(entry=>({width,language,entry,passed:true}))))};
 assert.equal(reviewBrowserComplete(record),true);
 for(const change of [{passed:false},{syntheticSpeech:false},{journeys:record.journeys.slice(1)},{journeys:record.journeys.map(r=>({...r,entry:'notebook'}))},{journeys:record.journeys.map(r=>({...r,passed:r.entry!=='live'}))}])assert.equal(reviewBrowserComplete({...record,...change}),false);
});

test('connected response evidence requires exact provider/language/viewport coverage and declared isolation',()=>{
 for(const kind of ['connected','choices','followups','student-follow-up','private-follow-up','shared-updates']){
  const connected=kind==='connected',record={kind:kind==='shared-updates'?'student-shared-update-browser-verification':kind==='private-follow-up'?'private-follow-up-browser-verification':kind==='student-follow-up'?'student-follow-up-controls-browser-verification':`review-response-${kind}-browser-verification`,schemaVersion:1,passed:true,syntheticIdentity:true,syntheticSpeech:true,disposablePostgres:true,syntheticTransport:true,journeys:(connected?[1280,390]:[1280,390,320]).flatMap(width=>['en','es'].flatMap(language=>(connected?['live','realtime']:[undefined]).map(entry=>({width,language,entry,passed:true}))))};
  assert.equal(reviewResponseBrowserComplete(record,kind),true);
  for(const change of [{passed:false},{schemaVersion:2},{journeys:[]},{journeys:record.journeys.slice(1)},{journeys:record.journeys.map(r=>({...r,width:1280}))},{journeys:record.journeys.map(r=>({...r,passed:false}))},connected?{syntheticSpeech:false}:{syntheticTransport:false}])assert.equal(reviewResponseBrowserComplete({...record,...change},kind),false);
 }
 assert.equal(reviewResponseBrowserComplete({},'unknown'),false);
});

test('follow-up release evidence requires the complete ordered journey on both providers, languages and all viewports',()=>{
 const record={kind:'student-follow-up-connected-browser-verification',schemaVersion:1,passed:true,syntheticIdentity:true,syntheticSpeech:true,disposablePostgres:true,journeys:[1280,390,320].flatMap(width=>['en','es'].flatMap(language=>['live','realtime'].map(entry=>({width,language,entry,passed:true,stages:[...followUpReleaseStages]}))))};
 assert.equal(followUpBrowserComplete(record),true);
 for(const change of [{schemaVersion:2},{passed:false},{disposablePostgres:false},{syntheticIdentity:false},{syntheticSpeech:false},{journeys:record.journeys.slice(1)},{journeys:record.journeys.map(r=>({...r,entry:'live'}))},{journeys:record.journeys.map(r=>({...r,stages:r.stages.filter(s=>s!=='private-save')}))},{journeys:record.journeys.map(r=>({...r,stages:[...r.stages].reverse()}))},{journeys:record.journeys.map(r=>({...r,passed:r.width!==320}))}])assert.equal(followUpBrowserComplete({...record,...change}),false);
});
