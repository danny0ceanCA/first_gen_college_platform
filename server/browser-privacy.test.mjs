import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserPrivacy} from '../src/browserPrivacy.mjs';
import {onboardingRecovery} from '../src/onboardingRecovery.mjs';

function storage(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),map};}
function fixture(local=storage(),session=storage()) {const events=new EventTarget();let n=0;const privacy=createBrowserPrivacy({local,session,events,nonce:()=>`${Math.random()}-${++n}`});return {local,session,events,privacy};}
const subject='auth0|one';
const rawKey=`origen.onboarding-summaries.${subject}`;
const draftKey=`origen.onboarding.${subject}.v1`;
const recover=(p,key)=>onboardingRecovery(p.storage(key),key);

test('logout and closure purge account data and reject delayed writers while preserving language and invitations',()=>{
 for(const reason of ['logout','account_closed']){
  const {local,session,privacy:p}=fixture();p.start(subject);
  for(const key of [`origen.user.${subject}.onboarding-events.v1`,`origen.account.${subject}`,`origen.institution-draft.${subject}.team`,`origen.institution-active.${subject}`,draftKey]){local.setItem(key,'private');session.setItem(key,'private');}
  local.setItem('origen.language','es');session.setItem('origen.pending-institution-invite','invitation');
  const raw=recover(p,rawKey);raw.write({call:{turns:[{text:'PRIVATE SPEECH'}]}});const lease=p.capture();let stopped=false;p.subscribe(e=>{if(e.type==='end')stopped=true;});
  p.stop(reason);assert.equal(stopped,true);assert.equal(lease.signal.aborted,true);assert.throws(()=>lease.assert(),{name:'AbortError'});
  assert.equal(raw.write({call:'late response'}),false);assert.equal(raw.read(null),null);
  assert.equal([...local.map.values(),...session.map.values()].some(v=>v==='private'||v.includes('PRIVATE SPEECH')),false);
  assert.equal(local.getItem('origen.language'),'es');assert.equal(session.getItem('origen.pending-institution-invite'),'invitation');
 }
});

test('raw text and pending summaries never enter browser storage; profile setup survives a same-tab reload',()=>{
 const {local,session,privacy:p}=fixture();p.start(subject);recover(p,rawKey).write({call:{turns:[{text:'secret speech'}]}});
 recover(p,`origen.user.${subject}.conversations.v1.pending`).write([{id:'call',summary:'private summary'}]);
 recover(p,draftKey).write({name:'Test Student',role:'student'});
 assert.equal([...local.map.values(),...session.map.values()].some(v=>v.includes('secret speech')||v.includes('private summary')),false);
 const reloaded=fixture(local,session).privacy;assert.equal(reloaded.start(subject),true);assert.deepEqual(recover(reloaded,draftKey).read(null),{name:'Test Student',role:'student'});assert.equal(recover(reloaded,rawKey).read(null),null);
});

test('legacy transcript copies are removed and the current profile draft migrates out of local storage',()=>{
 const {local,session,privacy:p}=fixture();
 for(const key of [rawKey,'origen.onboarding-summaries.auth0|other',`origen.user.${subject}.conversations.v1.pending`,'camino.conversations.v1'])local.setItem(key,'old text');
 const draft=onboardingRecovery(local,draftKey);draft.write({name:'Returning Student'});p.start(subject);
 assert.equal(local.getItem(rawKey),null);assert.equal(local.getItem('camino.conversations.v1'),null);assert.equal(local.getItem(draftKey),null);
 assert.deepEqual(recover(p,draftKey).read(null),{name:'Returning Student'});assert.ok(session.getItem(draftKey));
});

test('another tab ends active leases before a delayed storage event, and a cached page cannot revive the session',()=>{
 const a=fixture();a.privacy.start(subject);const b=fixture(a.local);b.privacy.start(subject);
 const lease=b.privacy.capture();recover(b.privacy,draftKey).write({name:'Other tab'});let stops=0;b.privacy.subscribe(e=>{if(e.type==='end')stops++;});
 a.privacy.stop();assert.equal(lease.valid(),false);assert.equal(stops,1);assert.equal(b.session.getItem(draftKey),null);
 const reloaded=fixture(a.local);assert.equal(reloaded.privacy.start(subject),false);
 assert.equal(reloaded.privacy.start(subject,{fresh:true}),true);assert.equal(lease.valid(),false);
});

test('switching accounts clears the old account and blocks a stale tab from taking ownership back',()=>{
 const a=fixture();a.privacy.start(subject);recover(a.privacy,draftKey).write({name:'Old account'});const lease=a.privacy.capture();
 const b=fixture(a.local);assert.equal(b.privacy.start('google-oauth2|two',{fresh:true}),true);assert.equal(lease.valid(),false);
 assert.equal(a.session.getItem(draftKey),null);assert.equal(fixture(a.local).privacy.start(subject),false);
 assert.equal(b.privacy.valid(),true);
});

test('deletion cancels matching requests and removes all recovery copies without touching another student',()=>{
 const {privacy:p}=fixture();p.start(subject);
 const one={id:'one',studentId:'student',mode:'planning'},two={id:'two',studentId:'other',mode:'planning'};
 const first=p.capture(one),second=p.capture(two),raw=recover(p,rawKey),pending=recover(p,`origen.user.${subject}.conversations.v1.pending`);
 raw.write({one:{...one,turns:['private']},two:{...two,turns:['keep']}});pending.write([{...one,summary:'remove'},{...two,summary:'keep'}]);
 p.forget({studentId:'student',mode:'planning'});assert.equal(first.signal.aborted,true);assert.equal(second.valid(),true);
 assert.deepEqual(Object.keys(raw.read({})),['two']);assert.deepEqual(pending.read([]).map(x=>x.id),['two']);
 // A replay loop may already hold a snapshot of the removed record.
 assert.equal(p.capture(one).valid(),false);assert.equal(p.capture({...one,id:'new-discussion'}).valid(),true);
});

test('storage notifications stop voice owners and propagate individual discussion deletion',()=>{
 const a=fixture();a.privacy.start(subject);const b=fixture(a.local);b.privacy.start(subject);const lease=b.privacy.capture({id:'delete-me'});
 const event=new Event('storage');Object.assign(event,{key:'origen.privacy.event.v1',newValue:JSON.stringify({subject,target:{id:'delete-me'}})});b.events.dispatchEvent(event);assert.equal(lease.signal.aborted,true);
 let microphoneStopped=false;b.privacy.subscribe(e=>{if(e.type==='end')microphoneStopped=true;});a.privacy.stop();const logout=new Event('storage');Object.assign(logout,{key:'origen.privacy.session.v1'});b.events.dispatchEvent(logout);assert.equal(microphoneStopped,true);
});

test('an authenticated native host may open a different account after the old view is destroyed',()=>{
 const a=fixture();a.privacy.start(subject);recover(a.privacy,draftKey).write({name:'Private draft'});a.privacy.destroy();
 const b=fixture(a.local,a.session);assert.equal(b.privacy.start('auth0|native-next',{fresh:true}),true);assert.equal(b.session.getItem(draftKey),null);assert.equal(b.privacy.valid(),true);
});

test('unavailable browser storage still allows memory-only saves and local cleanup',()=>{
 const denied={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},get length(){throw Error('blocked');}};
 const p=createBrowserPrivacy({local:denied,nonce:()=>crypto.randomUUID()});assert.equal(p.start(subject),true);const raw=recover(p,rawKey);assert.equal(raw.write({id:'hello'}),true);assert.deepEqual(raw.read(null),{id:'hello'});p.stop();assert.equal(raw.read(null),null);
});

test('temporary permission failures stop requests and voice while preserving only the same-tab profile draft',()=>{
 const a=fixture();a.privacy.start(subject);const b=fixture(a.local);b.privacy.start(subject);
 const draft=recover(a.privacy,draftKey),speech=recover(a.privacy,rawKey),lease=a.privacy.capture();
 draft.write({name:'Alex',role:'student',goals:'Nursing'});speech.write({turns:['PRIVATE SPEECH']});
 a.session.setItem(`origen.account.${subject}`,'private');
 const events=[];a.privacy.subscribe(e=>events.push(e));
 a.privacy.pause();
 assert.equal(a.privacy.valid(),false);assert.equal(lease.signal.aborted,true);
 assert.equal(events.at(-1).reason,'permission_unavailable');
 assert.ok(a.session.getItem(draftKey));assert.equal(a.session.getItem(`origen.account.${subject}`),null);
 assert.equal(b.privacy.valid(),true,'a failed lookup must not end another tab’s authenticated session');
 assert.equal(draft.write({name:'Late overwrite'}),false);
 assert.equal(a.privacy.start(subject),true);
 assert.deepEqual(recover(a.privacy,draftKey).read(null),{name:'Alex',role:'student',goals:'Nursing'});
 assert.equal(recover(a.privacy,rawKey).read(null),null);
 assert.equal(lease.valid(),false);assert.equal(draft.write({name:'Late overwrite'}),false,'pre-pause writers cannot revive after recovery');
});

test('logout, revocation and account changes still purge a paused profile draft',()=>{
 for(const reason of ['logout','eligibility_changed','account_closed']){
  const {privacy:p,session}=fixture();p.start(subject);recover(p,draftKey).write({name:'Alex'});
  p.pause();p.stop(reason);assert.equal(session.getItem(draftKey),null);assert.equal(p.start(subject),false);
 }
 const a=fixture();a.privacy.start(subject);const b=fixture(a.local);b.privacy.start(subject);
 recover(a.privacy,draftKey).write({name:'Alex'});a.privacy.pause();b.privacy.stop('logout');
 assert.equal(a.privacy.start(subject),false,'verification cannot revive a session ended in another tab');
 assert.equal(a.session.getItem(draftKey),null);
 const c=fixture();c.privacy.start(subject);recover(c.privacy,draftKey).write({name:'Alex'});c.privacy.pause();
 c.privacy.start('auth0|other',{fresh:true});assert.equal(c.session.getItem(draftKey),null);
 const d=fixture();d.privacy.start(subject);recover(d.privacy,draftKey).write({name:'Alex'});d.privacy.pause();
 assert.equal(d.privacy.start('auth0|other'),false);assert.equal(d.session.getItem(draftKey),null);
});
