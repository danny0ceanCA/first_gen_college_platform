// Local release evidence never inherits application secrets or provider switches.
export function reviewVerificationEnvironment(source){
 let url;try{url=new URL(source.DATABASE_TEST_URL);}catch{}
 if(!url||!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname||url.pathname==='/'||url.search||url.hash)throw new Error('disposable_loopback_database_required');
 const env={};for(const key of ['PATH','HOME','TMPDIR','LANG','LC_ALL','TERM','NO_COLOR','SYSTEMROOT','WINDIR','ORIGEN_BROWSER_MODULE_ROOT','ORIGEN_BROWSER_EXECUTABLE'])if(source[key])env[key]=source[key];
 return {...env,NODE_ENV:'test',DATABASE_TEST_URL:url.href,ORIGEN_TEST_DATABASE_URL:url.href,TELEMETRY_TEST_DATABASE_URL:url.href};
}
export function reviewVerificationCounts(tap,code){
 const counts={};for(const key of ['tests','pass','fail','skipped','cancelled','todo']){const matches=[...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`,'gm'))];counts[key]=matches.length===1?Number(matches[0][1]):null;}
 return {...counts,passed:code===0&&Number.isSafeInteger(counts.tests)&&counts.tests>0&&counts.pass===counts.tests&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0&&counts.todo===0};
}
export function reviewBrowserComplete(record){
 if(record?.kind!=='review-request-browser-verification'||record.schemaVersion!==1||record.syntheticIdentity!==true||record.syntheticSpeech!==true||record.passed!==true||!Array.isArray(record.journeys)||record.journeys.length!==12)return false;
 return [1280,390].every(width=>['en','es'].every(language=>['notebook','realtime','live'].every(entry=>record.journeys.filter(r=>r?.width===width&&r.language===language&&r.entry===entry&&r.passed===true).length===1)));
}
export function reviewResponseBrowserComplete(record,kind){
 if(!['connected','choices','followups','student-follow-up','private-follow-up','shared-updates'].includes(kind)||record?.kind!==(kind==='shared-updates'?'student-shared-update-browser-verification':kind==='private-follow-up'?'private-follow-up-browser-verification':kind==='student-follow-up'?'student-follow-up-controls-browser-verification':`review-response-${kind}-browser-verification`)||record.schemaVersion!==1||record.passed!==true||!Array.isArray(record.journeys))return false;
 const connected=kind==='connected',widths=connected?[1280,390]:[1280,390,320],entries=connected?['live','realtime']:[undefined];
 if(connected?(record.syntheticIdentity!==true||record.syntheticSpeech!==true||record.disposablePostgres!==true):record.syntheticTransport!==true)return false;
 return record.journeys.length===widths.length*2*entries.length&&widths.every(width=>['en','es'].every(language=>entries.every(entry=>record.journeys.filter(r=>r?.width===width&&r.language===language&&r.entry===entry&&r.passed===true).length===1)));
}

export const followUpReleaseStages=Object.freeze(['accepted-action','check-in-choice','heard-opening','optional-answer','private-save','approved-share','coordinator-response','source-invalidation']);
export function followUpBrowserComplete(record){
 if(record?.kind!=='student-follow-up-connected-browser-verification'||record.schemaVersion!==1||record.passed!==true||record.syntheticIdentity!==true||record.syntheticSpeech!==true||record.disposablePostgres!==true||!Array.isArray(record.journeys)||record.journeys.length!==12)return false;
 return [1280,390,320].every(width=>['en','es'].every(language=>['live','realtime'].every(entry=>{
  const rows=record.journeys.filter(r=>r?.width===width&&r.language===language&&r.entry===entry);
  return rows.length===1&&rows[0].passed===true&&JSON.stringify(rows[0].stages)===JSON.stringify(followUpReleaseStages);
 })));
}
