import test from 'node:test';
import assert from 'node:assert/strict';
import {isTopicRecapResponse} from '../src/topicRecapResponse.mjs';
import {validateRecapOutput,recapEvidence} from './topic-recap.mjs';

const valid=()=>({paragraphs:[{text:'Alex is exploring transfer options.',refs:['note:a']}],sources:[{ref:'note:a',kind:'note',id:'a',content:'Alex is exploring transfer options.',evidence:{reportedBy:'parent'}}],omitted:0});
test('accepts the real server contract, including empty and Spanish recaps',()=>{
 const evidence=recapEvidence({studentId:'alex',topic:'transfer'},{notes:[{studentId:'alex',id:'a',topic:'transfer',status:'saved',content:'Alex explora sus opciones.'}]});
 assert.equal(isTopicRecapResponse(validateRecapOutput({paragraphs:[{text:'Alex explora sus opciones.',refs:['note:a']}]},evidence)),true);
 assert.equal(isTopicRecapResponse({paragraphs:[],sources:[],omitted:0}),true);
});
test('malformed success responses fail safely before rendering, including incomplete sources and unknown citations',()=>{
 for(const mutate of [
  v=>v.paragraphs=[null],v=>v.paragraphs[0].text={unexpected:'object'},
  v=>v.sources=[null],v=>delete v.sources[0].evidence,
  v=>v.sources[0].content={unexpected:'object'},v=>v.paragraphs[0].refs=['note:other'],
  v=>v.sources[0].ref='memory:a',v=>v.sources.push(v.sources[0]),
  v=>v.paragraphs=[],v=>v.omitted=-1,
 ]){const v=valid();mutate(v);assert.equal(isTopicRecapResponse(v),false);}
 for(const v of [null,[],{},'invalid'])assert.equal(isTopicRecapResponse(v),false);
});
