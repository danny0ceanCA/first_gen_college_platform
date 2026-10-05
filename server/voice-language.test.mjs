import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceLanguageControl,voiceLanguageInstructions,voiceLanguageTools} from '../src/voiceLanguage.mjs';
import {voiceSession} from './profile-voice.mjs';
import {voiceTurns} from '../src/voiceTurns.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
 const events=[],languages=[];
 const control=voiceLanguageControl(event=>events.push(event),{language:'en',onLanguage:language=>languages.push(language),...options});
 control.event({type:'session.created',session:{instructions:'Profile context and college guidance. Speak English.'}});
 const ack=index=>control.event({type:'session.updated',session:events[index].session});
 return {events,languages,control,ack};
}

test('English to Spanish and back updates the existing session before reporting success, without touching audio or tools',async()=>{
 const {control,events,ack,languages}=harness();
 const spanish=control.change('es');await tick();
 assert.equal(control.language(),'en');
 assert.deepEqual(Object.keys(events[0].session).sort(),['instructions','type']);
 assert.match(events[0].session.instructions,/Current conversation language: Spanish/);
 assert.match(events[0].session.instructions,/Profile context/);
 ack(0);assert.equal(await spanish,true);assert.equal(control.language(),'es');
 const english=control.change('en');await tick();ack(1);await english;
 assert.deepEqual(languages,['es','en']);
 assert.equal(events[1].session.instructions.match(/<origen-language>/g).length,1);
 assert.match(events[1].session.instructions,/Current conversation language: English/);
 assert.ok(events.every(event=>event.type==='session.update'));
 control.stop();
});

test('concurrent language and specialist updates are serialized and the specialist uses the acknowledged language',async()=>{
 const {control,events,ack}=harness();let builtLanguage;
 const spanish=control.change('es');
 const guide=control.configure(async language=>{builtLanguage=language;return {type:'realtime',instructions:'Loans guidance. Speak English.',tools:[{name:'lookup_financial_aid'}]};});
 await tick();assert.equal(events.length,1);assert.equal(builtLanguage,undefined);
 ack(0);await spanish;await tick();assert.equal(builtLanguage,'es');
 assert.match(events[1].session.instructions,/Current conversation language: Spanish/);
 ack(1);await guide;
 const english=control.change('en');await tick();
 assert.match(events[2].session.instructions,/Loans guidance/);ack(2);await english;
 control.stop();
});

test('a language request queued behind a slow specialist preserves its instructions and ends in the requested language',async()=>{
 const {control,events,ack}=harness();let release;
 const guide=control.configure(()=>new Promise(resolve=>{release=resolve;}));
 const spanish=control.change('es');await tick();assert.equal(events.length,0);
 release({type:'realtime',instructions:'Applications guidance',tools:[]});await tick();ack(0);await guide;
 await tick();assert.match(events[1].session.instructions,/Applications guidance/);ack(1);await spanish;
 assert.equal(control.language(),'es');control.stop();
});

test('a late Spanish acknowledgement cannot undo a newer explicit English request after a timeout',async()=>{
 let timeout;const {control,events,ack}=harness({schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 const spanish=control.change('es');await tick();timeout();await assert.rejects(spanish,/timeout/);
 const english=control.change('en');await tick();assert.equal(events.length,2);
 ack(1);await english;ack(0);assert.equal(control.language(),'en');
 assert.equal(control.event({type:'error',error:{event_id:events[0].event_id}}),true);
 control.stop();
});

test('a rejected language update preserves the call and a subsequent language change can succeed',async()=>{
 const {control,events,ack}=harness();const first=control.change('es');await tick();
 assert.equal(control.event({type:'error',error:{event_id:events[0].event_id}}),true);
 await assert.rejects(first,/rejected/);assert.equal(control.language(),'en');
 const retry=control.change('es');await tick();ack(1);await retry;
 assert.equal(control.language(),'es');control.stop();
});

test('retrying the same timed-out language change resolves on the effective session instead of hanging again',async()=>{
 let timeout;const {control,events,ack}=harness({schedule:fn=>{timeout=fn;return 1;},cancel:()=>{}});
 const first=control.change('es');await tick();timeout();await assert.rejects(first,/timeout/);
 const retry=control.change('es');await tick();
 assert.equal(events[0].session.instructions,events[1].session.instructions);
 ack(1);await retry;assert.equal(control.language(),'es');
 control.stop();
});

test('language tools are applied before scope, topic and research tools, and the reply waits for the acknowledgement',async()=>{
 const {control,events,ack}=harness();const sent=[],turns=voiceTurns(event=>sent.push(event));
 turns.created();turns.beginDone('response',true);
 const output=[{type:'function_call',name:'request_conversation_target',arguments:'{"scope":"general"}'},{type:'function_call',name:'lookup_financial_aid',arguments:'{"language":"en"}'},{type:'function_call',name:'set_conversation_language',call_id:'switch',arguments:'{"language":"es"}'}];
 const languageTools=voiceLanguageTools(output,control,event=>sent.push(event));
 await tick();assert.equal(sent.length,0);assert.equal(turns.busy(),true);
 ack(0);assert.equal(await languageTools,1);
 assert.equal(control.language(),'es');assert.equal(JSON.parse(sent[0].item.output).status,'language_updated');
 // The remaining scope/lookup handler now reads Spanish even if its generated arguments say English.
 assert.equal(JSON.parse(sent[0].item.output).language,'es');
 turns.toolsCompleted();assert.equal(sent.filter(event=>event.type==='response.create').length,1);
 turns.stop();control.stop();
});

test('all guides permit clear spoken language changes while keeping bilingual transcription and protecting quoted terms and names',()=>{
 for(const mode of ['profile','finance','loans','planning','admissions'])for(const language of ['en','es']){
  const session=voiceSession({mode,language,role:'parent',profile:{}},{});
  assert.equal(session.audio.input.transcription.language,undefined);
  assert.match(session.audio.input.transcription.prompt,/without translating/);
  assert.match(session.instructions,/understandable question or sentence in the other language/);
  assert.match(session.instructions,/isolated name, college acronym, quoted form label/);
  assert.match(session.instructions,new RegExp(`Current conversation language: ${language==='es'?'Spanish':'English'}`));
  const tools=session.tools.filter(tool=>tool.name.startsWith('lookup_'));
  assert.ok(tools.every(tool=>tool.parameters.required.includes('language')));
 }
 assert.throws(()=>voiceLanguageInstructions('context','fr'),/invalid/);
});

test('closing the call stops pending and queued configuration changes without sending more events',async()=>{
 const {control,events}=harness();const first=control.change('es'),second=control.change('en');
 await tick();control.stop();await assert.rejects(first,/stopped/);await assert.rejects(second,/stopped/);
 assert.equal(events.length,1);
});
