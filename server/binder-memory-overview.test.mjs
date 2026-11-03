import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryOverview,memoryExcerpt} from '../src/binderMemoryOverview.mjs';

const memory=(id,content,extra={})=>({id,content,studentId:'aiden',category:'goal',language:'en',status:'proposed',speaker:'parent',reportedBy:'parent',updatedAt:'2026-11-02T00:00:00Z',organization:{topic:'transfer',certainty:'tentative'},...extra});
const options={studentId:'aiden',topic:'transfer'};
test('overview stays inside the student and divider; family and untagged memories stay separate',()=>{
 const input=[memory('mine','May explore a transfer.'),memory('other','Other student',{studentId:'other'}),memory('family','Family concern',{studentId:null}),memory('untagged','Student background',{organization:undefined}),memory('cost','Budget',{organization:{topic:'costs'}}),memory('deleted','Old plan',{status:'deleted'})];
 assert.deepEqual(memoryOverview(input,options).flatMap(g=>g.highlights.map(m=>m.id)),['mine']);
 assert.deepEqual(memoryOverview(input,{studentId:'aiden'}).flatMap(g=>g.highlights.map(m=>m.id)),['untagged']);
 assert.deepEqual(memoryOverview(input,{...options,studentId:null}).flatMap(g=>g.highlights.map(m=>m.id)),['family']);
});
test('bounded overview represents each category and leaves every original intact',()=>{
 const input=['goal','constraint','preference','question'].flatMap(category=>Array.from({length:8},(_,i)=>memory(category+i,`Detail ${i} for ${category}; may change after speaking with a counselor.`,{category})));
 const before=structuredClone(input),groups=memoryOverview(input,options);
 assert.equal(groups.length,4);assert.equal(groups.reduce((n,g)=>n+g.highlights.length,0),4);
 for(const group of groups){assert.equal(group.count,8);assert.ok(group.highlights.length>=1);for(const m of group.highlights)assert.ok(input.includes(m));}
 assert.deepEqual(input,before);
});
test('selects concise wording before administrative recap text, without combining claims',()=>{
 const input=[memory('recap','The discussion focused on helping Aiden explore transferring.'),memory('goal','Aiden is interested in political science; he has not chosen a campus.'),memory('need','Evening classes may work with bookstore shifts.')];
 const selected=memoryOverview(input,options)[0].highlights;
 assert.deepEqual(selected.map(m=>m.id),['goal','need']);assert.equal(selected[0].content,input[1].content);
});
test('only exact repeats with matching attribution and uncertainty collapse in highlights',()=>{
 const content='Aiden may transfer in fall 2027, if the required courses are available.';
 for(const difference of [{reportedBy:'student',speaker:'student'},{status:'confirmed'},{organization:{topic:'transfer',certainty:'stated'}},{language:'es'}]){
  const input=[memory('a',content),memory('duplicate',content),memory('different',content,difference)];
  const group=memoryOverview(input,options)[0];assert.equal(group.count,3);assert.equal(group.highlights.length,2);assert.ok(group.highlights.some(m=>m.id==='different'));
 }
});
test('excerpts never rewrite or splice content; shortened previews visibly show an ellipsis',()=>{
 const content='Aiden has not decided whether to transfer. His parent hopes he can attend a nearby campus, but he wants to compare other options before making a decision. '.repeat(3);
 const result=memoryExcerpt(content);assert.equal(result.truncated,true);assert.ok(result.text.length<=181);assert.ok(result.text.endsWith('…'));assert.ok(content.startsWith(result.text.slice(0,-1)));
 const spanish='Quizá estudie cerca de casa; todavía no ha elegido una universidad.';assert.deepEqual(memoryExcerpt(spanish),{text:spanish,truncated:false});
});
