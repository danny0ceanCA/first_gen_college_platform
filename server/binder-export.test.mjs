import test from 'node:test';
import assert from 'node:assert/strict';
import {binderExportData} from '../src/binderExport.mjs';
import {binderPdf} from '../src/binderPdf.mjs';
const note={id:'note-private-id',studentId:'student-a',topic:'costs',kind:'note',language:'en',content:'My saved note.',status:'saved',origin:'user',summaryId:null,conversationAt:null,updatedAt:'2026-10-10T10:00:00Z',translations:{es:'Mi nota guardada.'},quote:'Private backing quote.',version:9};
test('PDF export isolates binder scope and omits unsaved entries and hidden provenance',()=>{
 const data=binderExportData({studentId:'student-a',name:'Alex',language:'en',notes:[note,{...note,id:'b',studentId:'student-b',content:'Other student secret.'},{...note,id:'family',studentId:null,content:'Family secret.'},{...note,id:'draft',status:'draft',content:'Unsaved secret.'}],topic:'costs',summary:'A summary omitted from a topic-only export.'});
 assert.equal(data.topics.length,1);assert.equal(data.topics[0].sections[0].entries[0].text,'My saved note.');assert.equal(data.summary,'');
 const serialized=JSON.stringify(data);for(const hidden of ['Other student secret','Family secret','Unsaved secret','note-private-id','Private backing quote','version','student-a'])assert.ok(!serialized.includes(hidden),hidden);
 assert.equal(binderExportData({studentId:null,name:'Family',language:'en',notes:[note,{...note,studentId:null,content:'Family note.'}]}).topics[2].sections[0].entries[0].text,'Family note.');
});
test('PDF export keeps unreviewed recaps separate from personal decisions and preserves translation choices',()=>{
 const recap={...note,id:'recap',origin:'conversation',status:'suggested',summaryId:'saved-call',kind:'explanation',content:'We compared costs.'};
 const data=binderExportData({studentId:'student-a',name:'José',language:'es',notes:[note,{...recap,translations:{}},{...recap,id:'repeat'}, {...note,id:'decision',kind:'decision',content:'My actual decision.',translations:{}}]});
 const sections=data.topics[2].sections;
 assert.equal(sections[0].recap,true);assert.equal(sections[0].entries.length,1);assert.equal(sections[1].entries[0].text,'Mi nota guardada.');assert.equal(sections[1].entries[0].translated,true);assert.equal(sections[2].recap,false);
 assert.equal(binderExportData({studentId:'student-a',name:'José',language:'es',notes:[note],originalIds:[note.id]}).topics[2].sections[0].entries[0].text,'My saved note.');
});
test('PDF output paginates long notes and writes user content as text rather than executable HTML',()=>{
 const data=binderExportData({studentId:'student-a',name:'José García',language:'es',notes:[{...note,translations:{},content:'Becas y préstamos: información para mi reunión. '.repeat(240)+'<script>evil()</script>'}],topic:'costs'});
 const pdf=binderPdf(data,{now:new Date('2026-10-12T12:00:00Z')});
 assert.ok(pdf.getNumberOfPages()>2);assert.match(pdf.output(),/^%PDF-/);assert.ok(!pdf.output().includes('/JavaScript'));
});
