import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceResearchProgress,researchEvidence} from '../src/voiceResearchProgress.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';
import {voiceSession} from './profile-voice.mjs';

function harness(){
 let time=0,id=0,language='en',available=true,current=true;
 const timers=new Map(),said=[];
 const progress=voiceResearchProgress({now:()=>time,language:()=>language,isCurrent:()=>current,speak:sentence=>{if(!available)return false;said.push(sentence);return true;},schedule:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
 const advance=ms=>{const end=time+ms;while(timers.size){const [key,next]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(next.at>end)break;time=next.at;timers.delete(key);next.fn();}time=end;};
 return {progress,said,timers,advance,language:value=>language=value,available:value=>available=value,current:value=>current=value};
}

test('fast research stays quiet; delayed updates vary and are capped per lookup and call',()=>{
 const h=harness();h.progress.start();h.advance(9000);h.progress.stop();h.advance(60000);assert.deepEqual(h.said,[]);
 h.progress.start();h.advance(70000);assert.equal(h.said.length,2);assert.equal(h.timers.size,0);
 assert.notEqual(h.said[0],h.said[1]);
 h.progress.start();h.advance(70000);assert.equal(h.said.length,3);assert.equal(new Set(h.said).size,3);
 h.progress.start();h.advance(70000);assert.equal(h.said.length,3);assert.equal(h.timers.size,0);
});

test('busy speech defers updates without consuming allowance, and language is read when speaking',()=>{
 const h=harness();h.available(false);h.progress.start();h.advance(12000);assert.equal(h.said.length,0);
 h.language('es');h.available(true);h.advance(1000);assert.match(h.said[0],/Estoy consultando/);
 h.advance(23000);assert.match(h.said[1],/Puedes seguir hablando/);
 h.progress.stop();assert.equal(h.timers.size,0);
});

test('completion, cancellation and obsolete callbacks cannot announce a finished or replacement lookup',()=>{
 const h=harness();h.progress.start();const stale=[...h.timers.values()][0].fn;
 h.progress.stop();stale();assert.equal(h.timers.size,0);assert.equal(h.said.length,0);
 h.progress.start();stale();h.advance(10000);assert.equal(h.said.length,1);
 h.current(false);h.advance(40000);assert.equal(h.said.length,1);assert.equal(h.timers.size,0);
});

test('tool evidence identifies reuse without claiming fresh verification and retains dated sources',()=>{
 const result={text:'Synthetic evidence.',sources:[{url:'https://example.org',title:'Synthetic source'}],checkedAt:'2026-10-08T00:00:00Z'};
 const reused=researchEvidence(result,true),fresh=researchEvidence(result,false);
 assert.equal(reused.status,'reused_verified_result');assert.match(reused.instruction,/Do not claim a new search/);
 assert.equal(fresh.status,'source_check_completed');assert.match(fresh.instruction,/only what the evidence supports/);
 assert.deepEqual(reused.sources,result.sources);assert.equal(reused.checkedAt,result.checkedAt);
 for(const mode of ['planning','finance','loans','admissions']){
  const session=voiceSession({mode,role:'student',language:'en',profile:{}},{});
  assert.match(session.instructions,/no claimed findings before results/);
  assert.match(session.instructions,/never call it a fresh search/);
 }
});

test('transport failure while requesting progress does not block the actual research answer',()=>{
 const events=[];const turns=voiceTurns(event=>{if(event.response?.metadata?.topic==='origen_lookup_progress')throw Error('transport failed');events.push(event);});
 turns.request();turns.beginDone('lookup',true);
 assert.equal(turns.progress('Checking sources.'),false);
 turns.toolsCompleted();assert.equal(events.length,2);assert.deepEqual(events[1],{type:'response.create'});turns.stop();
});

test('a closed transport cannot leave a nonexistent status response blocking a reply',()=>{
 const events=[];const turns=voiceTurns(event=>{if(event.response?.metadata?.topic==='origen_lookup_progress')return;events.push(event);return `event-${events.length}`;});
 turns.request();turns.beginDone('lookup',true);assert.equal(turns.progress('Checking sources.'),false);
 turns.toolsCompleted();assert.equal(events.length,2);turns.stop();
});
