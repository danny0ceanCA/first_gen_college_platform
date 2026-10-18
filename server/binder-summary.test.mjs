import test from 'node:test';
import assert from 'node:assert/strict';
import {binderSummaryPages} from '../src/binderSummary.mjs';

const words=text=>text.replace(/\s+/g,' ').trim();
test('binder pages preserve corrections, uncertainty, and original order across long bilingual summaries',()=>{
 const summary=Array.from({length:18},(_,index)=>`Conversation ${index+1}: Alex is considering nursing, not committed to it. No se confirmó una decisión. La fecha del 15 de abril todavía se debe verificar.`).join(' ');
 for(const language of ['en','es']){
  const pages=binderSummaryPages(summary,language);
  assert.ok(pages.length>1);
  assert.equal(words(pages.flat().map(block=>block.text).join(' ')),words(summary));
  assert.ok(pages.every(page=>page.length<=4));
 }
});
test('binder preserves explicit topics while presenting bullet notes as separate written paragraphs',()=>{
 const pages=binderSummaryPages('# College options\n- Nursing is one option.\n- No decision yet.\n\n**Questions to ask**\n1. Is the course transferable?\n2. When does registration close?');
 assert.deepEqual(pages.flat(),[
  {type:'heading',text:'College options'},
  {type:'note',text:'Nursing is one option.'},
  {type:'note',text:'No decision yet.'},
  {type:'heading',text:'Questions to ask'},
  {type:'paragraph',text:'1. Is the course transferable? 2. When does registration close?'}
 ]);
 assert.ok(pages.every(page=>page.at(-1).type!=='heading'));
});
test('long unpunctuated text and markup remain intact as text with no content omitted',()=>{
 const summary='<script>alert("example")</script> '+Array.from({length:450},(_,index)=>`word${index}`).join(' ');
 const pages=binderSummaryPages(summary);
 assert.equal(words(pages.flat().map(block=>block.text).join(' ')),summary);
 assert.equal(pages.flat()[0].type,'paragraph');
 assert.deepEqual(binderSummaryPages('   '),[]);
});
