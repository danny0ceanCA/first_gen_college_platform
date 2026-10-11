import test from 'node:test';
import assert from 'node:assert/strict';
import {withRequestDeadline} from '../src/requestDeadline.mjs';
import {adminAccessDecision} from '../src/accountAccess.mjs';
import {voiceLanguageControl} from '../src/voiceLanguage.mjs';
import {voiceWorkspaceQueue} from '../src/voiceWorkspace.mjs';

test('access denial is distinct from outages, expired authentication and invalid responses',async()=>{
 const response=(status,data)=>new Response(JSON.stringify(data),{status});
 assert.equal(await adminAccessDecision(response(200,{admin:true})),'allowed');
 assert.equal(await adminAccessDecision(response(403,{error:'admin_required'})),'denied');
 for(const [status,data] of [[503,{error:'database_unavailable'}],[401,{error:'authentication_required'}],[403,{error:'origin_not_allowed'}],[200,{}]])await assert.rejects(adminAccessDecision(response(status,data)));
});

test('a stalled token or fetch is bounded and aborted even if its dependency ignores cancellation',async()=>{
 let signal;
 await assert.rejects(withRequestDeadline(async current=>{signal=current;return new Promise(()=>{});},{timeoutMs:10}),{name:'TimeoutError'});
 assert.equal(signal.aborted,true);
 const cancelled=new AbortController();cancelled.abort();let began=false;
 await assert.rejects(withRequestDeadline(async()=>{began=true;},{signal:cancelled.signal}),{name:'AbortError'});
 assert.equal(began,false);
 assert.equal(await withRequestDeadline(async()=>42),42);
});

test('a failed guide build releases language queue and cannot apply its late response',async()=>{
 const sent=[];let resolveBuild;let applied=0;
 const control=voiceLanguageControl(event=>{sent.push(event);queueMicrotask(()=>control.event({type:'session.updated',session:event.session}));});
 control.event({type:'session.created',session:{instructions:'Initial planning'}});
 const failed=control.configure(()=>withRequestDeadline(async signal=>{const session=await new Promise(resolve=>{resolveBuild=resolve;});signal.throwIfAborted();return session;},{timeoutMs:10}),()=>applied++);
 await assert.rejects(failed,{name:'TimeoutError'});
 assert.equal(sent.length,0);
 await control.change('es');
 resolveBuild({instructions:'Obsolete finance',tools:[]});await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(applied,0);assert.equal(control.language(),'es');assert.equal(sent.length,1);
 control.stop();
});

test('student clarification waits for playback and rapid selections use the latest target',async()=>{
 let busy=true,tick;const requested=[];
 const queue=voiceWorkspaceQueue({busy:()=>busy,apply:async id=>{requested.push(id);},schedule:fn=>{tick=fn;return 1;},cancel:()=>{}});
 queue.select('mateo');queue.select('sofia');assert.deepEqual(requested,[]);
 busy=false;await tick();assert.deepEqual(requested,['sofia']);
 busy=true;queue.select('mateo');queue.stop();busy=false;await tick();assert.deepEqual(requested,['sofia']);
});
