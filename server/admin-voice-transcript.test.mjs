import test from 'node:test';import assert from 'node:assert/strict';import {createTestTranscript} from './admin-voice-transcript.mjs';
test('test transcripts are opt-in, preserve both speakers, exclude backend text and erase on clear',()=>{
 const off=createTestTranscript(false);off.event({type:'session.input_transcript.delta',delta:'private'});assert.equal(off.snapshot(),null);
 const t=createTestTranscript(true);t.event({type:'session.input_transcript.delta',delta:'I feel '});t.event({type:'session.input_transcript.delta',delta:'unsure.'});t.event({type:'session.output_transcript.delta',delta:'We can explore that together.'});t.event({type:'response.output_text.delta',delta:'backend reasoning'});
 assert.deepEqual(t.snapshot().items.map(i=>[i.role,i.text]),[['user','I feel unsure.'],['assistant','We can explore that together.']]);t.clear();t.event({type:'session.output_transcript.delta',delta:'later'});assert.equal(t.snapshot(),null);
});
test('Realtime input is deduplicated and bounded capture reports its limit',()=>{
 const t=createTestTranscript(true),input={type:'conversation.item.input_audio_transcription.completed',item_id:'one',transcript:'Question'};t.event(input);t.event(input);t.event({type:'response.output_audio_transcript.delta',delta:'Answer'});assert.equal(t.snapshot().items.length,2);t.event({type:'session.output_transcript.delta',delta:'x'.repeat(60001)});assert.equal(t.snapshot().limited,true);assert.equal(t.snapshot().items[1].text,'Answer');
});
