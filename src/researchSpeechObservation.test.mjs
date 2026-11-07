import test from 'node:test';
import assert from 'node:assert/strict';
import {researchSpeechObservation} from './researchSpeechObservation.mjs';

const cases=[
 {language:'en',first:'The 2026 annual tuition is 12345 dollars.',tail:' Housing is estimated at',ack:'Yes, okay.',cut:'Wait, what about housing?',next:' Housing is separate from tuition.'},
 {language:'es',first:'La matrícula anual de 2026 es de 12345 dólares.',tail:' La vivienda se estima en',ack:'Sí, entiendo.',cut:'Espera, ¿y la vivienda?',next:' La vivienda es aparte de la matrícula.'},
];
for(const item of cases){
 test(`${item.language}: brief acknowledgment retains a completed answer without a restart`,()=>{
  const observation=researchSpeechObservation();
  observation.output({delta:item.first+item.tail});observation.caller({delta:item.ack});observation.callerStopped();
  observation.output({delta:' 9000.'});
  const result=observation.finish({playbackObserved:true});
  assert.equal(result.speechOutcome,'acknowledgment_overlap');assert.equal(result.interrupted,false);
  assert.equal(result.completedPortions,2);assert.equal(result.unfinishedPortion,false);
  assert.equal(result.completedText,item.first+item.tail+' 9000.');
 });
 test(`${item.language}: genuine interruption preserves the finished fact and keeps the unfinished clause pending`,()=>{
  const observation=researchSpeechObservation();
  observation.output({delta:item.first+item.tail});observation.caller({delta:item.cut});observation.callerStopped();
  const result=observation.finish({playbackObserved:true});
  assert.equal(result.speechOutcome,'substantive_interruption');assert.equal(result.interrupted,true);
  assert.equal(result.completedText,item.first);assert.equal(result.completedPortions,1);assert.equal(result.unfinishedPortion,true);
 });
 test(`${item.language}: a clause spanning a real interruption cannot be stitched into delivery evidence`,()=>{
  const observation=researchSpeechObservation();
  observation.output({delta:item.first+item.tail});observation.caller({delta:item.cut});observation.callerStopped();
  observation.output({delta:' 9000.'+item.next});
  const result=observation.finish({playbackObserved:true});
  assert.equal(result.completedText,item.first+item.next);assert.equal(result.completedPortions,2);
  assert.equal(result.unfinishedPortion,true);assert.equal(result.overlapCount,1);
 });
 test(`${item.language}: a later correction overrides an initially affirmative fragment`,()=>{
  const observation=researchSpeechObservation();
  observation.output({delta:item.first+item.tail});observation.caller({delta:item.ack});
  observation.caller({delta:' '+item.cut});observation.callerStopped();
  const result=observation.finish({playbackObserved:true});
  assert.equal(result.speechOutcome,'substantive_interruption');assert.equal(result.completedText,item.first);
 });
 test(`${item.language}: unclosed caller fragment remains uncertain`,()=>{
  const observation=researchSpeechObservation();observation.output({delta:item.first+item.tail});observation.caller({delta:item.ack});
  const result=observation.finish({playbackObserved:true});
  assert.equal(result.speechOutcome,'uncertain_overlap');assert.equal(result.completedText,item.first);
 });
 test(`${item.language}: transcript completion and playback evidence stay separate`,()=>{
  const observation=researchSpeechObservation();observation.output({delta:item.first});
  const result=observation.finish({playbackObserved:false});
  assert.equal(result.speechOutcome,'complete');assert.equal(result.playbackObserved,false);assert.equal(result.completedPortions,1);
  assert.equal('heard' in result,false);
 });
 test(`${item.language}: forced flushing cannot certify any completed portion`,()=>{
  const observation=researchSpeechObservation();observation.output({delta:item.first});
  const result=observation.finish({forced:true,playbackObserved:true});
  assert.equal(result.speechOutcome,'forced_flush');assert.equal(result.completedPortions,0);assert.equal(result.completedText,'');
 });
}
test('native intervals separate late transcript arrival from actual overlapping speech',()=>{
 const observation=researchSpeechObservation();
 observation.output({delta:'Tuition is 12000 dollars.',start_ms:100,end_ms:1000});
 observation.caller({delta:'Wait, housing?',start_ms:2000,end_ms:3000});
 observation.output({delta:' Fees are 500 dollars.',start_ms:1100,end_ms:1900});
 observation.callerStopped();observation.output({delta:' Housing is separate.',start_ms:3100,end_ms:4000});
 const result=observation.finish({playbackObserved:true});
 assert.equal(result.completedPortions,3);assert.equal(result.unfinishedPortion,false);
});
test('a generated sentence overlapping native caller time stays pending despite early transcript arrival',()=>{
 const observation=researchSpeechObservation();
 observation.output({delta:'Tuition is 12000 dollars.',start_ms:100,end_ms:1000});
 observation.output({delta:' Housing is 9000 dollars.',start_ms:1100,end_ms:3500});
 observation.caller({delta:'Wait, stop.',start_ms:2000,end_ms:3000});observation.callerStopped();
 const result=observation.finish({playbackObserved:true});
 assert.equal(result.completedText,'Tuition is 12000 dollars.');assert.equal(result.unfinishedPortion,true);
});
test('fully timed sequential turns are not diagnosed as a genuine interruption',()=>{
 const observation=researchSpeechObservation();
 observation.output({delta:'Tuition is 12000 dollars.',start_ms:100,end_ms:1000});
 observation.caller({delta:'What about housing?',start_ms:1200,end_ms:2000});observation.callerStopped();
 observation.output({delta:' Housing is separate.',start_ms:2100,end_ms:3000});
 const result=observation.finish({playbackObserved:true});
 assert.equal(result.speechOutcome,'complete');assert.equal(result.interrupted,false);assert.equal(result.overlapCount,0);
 assert.equal(result.completedPortions,2);
});
test('disjoint native turns do not turn a stitched unfinished clause into completion evidence',()=>{
 const observation=researchSpeechObservation();
 observation.output({delta:'Tuition is',start_ms:100,end_ms:1000});
 observation.caller({delta:'What about housing?',start_ms:1200,end_ms:2000});observation.callerStopped();
 observation.output({delta:' 12000 dollars. Housing is separate.',start_ms:2100,end_ms:3000});
 const result=observation.finish({playbackObserved:true});
 assert.equal(result.speechOutcome,'complete');assert.equal(result.overlapCount,0);
 assert.equal(result.completedText,'Housing is separate.');assert.equal(result.unfinishedPortion,true);
});
for(const text of ['Right?','¿Sí?'])test(`a short question is not classified as an acknowledgment: ${text}`,()=>{
 const observation=researchSpeechObservation();observation.output({delta:'Tuition is'});observation.caller({delta:text});observation.callerStopped();
 assert.equal(observation.finish().speechOutcome,'substantive_interruption');
});
test('a spoken decimal is kept together and trailing ellipsis stays unfinished',()=>{
 const observation=researchSpeechObservation();observation.output({delta:'The fee is 49.50 dollars. Housing is...'});
 const result=observation.finish({playbackObserved:true});
 assert.equal(result.completedText,'The fee is 49.50 dollars.');assert.equal(result.unfinishedPortion,true);
});
test('finishing a speech observation isolates the next answer',()=>{
 const observation=researchSpeechObservation();observation.output({delta:'Earlier.'});observation.caller({delta:'Stop.'});observation.callerStopped();observation.finish();
 observation.output({delta:'A fresh reply.'});const result=observation.finish();
 assert.equal(result.speechOutcome,'complete');assert.equal(result.overlapCount,0);assert.equal(result.completedText,'A fresh reply.');
});
