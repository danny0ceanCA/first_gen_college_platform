import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeachingEvidence} from './admin-voice-evidence.mjs';
const entry={id:'essay',revision:8,content:{title:'Student experiences',explanation:"Your experiences matter, even when they don't appear on a transcript. You decide what to share."}};
test('loaded references and backend work cannot masquerade as spoken teaching evidence',()=>{
 const evidence=createTeachingEvidence();evidence.supplied([entry]);evidence.ready();assert.equal(evidence.snapshot().matches.length,0);assert.equal(evidence.snapshot().outputTranscriptCharacters,0);assert.equal(evidence.snapshot().providerAudioChunks,0);
 evidence.transcript('Try thinking about something important to you.');assert.equal(evidence.snapshot().matches.length,0);
});
test('teaching wording is verified across transcript fragments with its exact revision',()=>{
 const evidence=createTeachingEvidence();evidence.supplied([entry]);evidence.transcript('Your experiences matter, even when ');assert.equal(evidence.snapshot().matches.length,0);evidence.transcript("they don’t appear on a transcript.");
 const snapshot=evidence.snapshot();assert.equal(snapshot.matches.length,1);assert.equal(snapshot.matches[0].revision,8);assert.equal(snapshot.matches[0].evidence,'spoken_transcript_wording');assert.match(snapshot.matches[0].quote,/Your experiences matter/);assert.equal(snapshot.browserPlaybackReported,false);evidence.audio();evidence.playback();assert.equal(evidence.snapshot().providerAudioChunks,1);assert.equal(evidence.snapshot().browserPlaybackReported,true);
});
