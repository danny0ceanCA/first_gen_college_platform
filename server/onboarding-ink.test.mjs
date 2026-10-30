import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingInk} from '../src/onboardingInk.mjs';
test('spoken additions preserve existing words instead of replaying the whole field',()=>{
 const change=onboardingInk('Daniel','Daniel · Parent');
 assert.equal(change.tokens.slice(change.start,change.end).join(''),' · Parent');assert.equal(change.correction,false);
 assert.equal(onboardingInk('Daniel','Daniel').start,onboardingInk('Daniel','Daniel').end);
});
test('corrections animate only the replacement and preserve an unchanged suffix',()=>{
 const change=onboardingInk('Ana Rivera','Elena Rivera');
 assert.equal(change.tokens.slice(change.start,change.end).join(''),'Elena');assert.equal(change.correction,true);
 assert.equal(change.tokens.slice(change.end).join(''),' Rivera');
 assert.equal(onboardingInk('School name','').correction,true);
});
test('Spanish accents and punctuation survive visual updates exactly',()=>{
 const text='José · Estudiante, primer año';const change=onboardingInk('José',text);
 assert.equal(change.tokens.join(''),text);assert.equal(change.correction,false);
});
