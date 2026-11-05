import test from 'node:test';
import assert from 'node:assert/strict';
import {researchAnswerOverlap} from './researchDiscussion.mjs';

import {discussionExamples} from './researchDiscussion.fixture.mjs';

for(const [language,{answer,spoken}] of Object.entries(discussionExamples)){
 test(`${language}: a naturally reordered answer is recognized without six verbatim words`,()=>assert.equal(researchAnswerOverlap(answer,spoken),true));
 test(`${language}: missing or conflicting figures cannot retire a finding`,()=>{
  for(const changed of [spoken.replace(/39,428|treinta y nueve mil cuatrocientos veintiocho/u,'39,429'),spoken.replace(/49,692|cuarenta y nueve mil seiscientos noventa y dos/u,'an unknown amount'),spoken.replace('2026','2025'),spoken.replaceAll('Berkeley','Davis')])assert.equal(researchAnswerOverlap(answer,changed),false,changed);
 });
}
test('Spanish grouped digits and English spoken whole numbers match the source amounts',()=>{
 assert.equal(researchAnswerOverlap(discussionExamples.es.answer,discussionExamples.es.spoken.replace('cuarenta y nueve mil seiscientos noventa y dos','49.692').replace('treinta y nueve mil cuatrocientos veintiocho','39.428')),true);
 assert.equal(researchAnswerOverlap(discussionExamples.en.answer,discussionExamples.en.spoken.replace('49,692','forty-nine thousand six hundred and ninety-two').replace('39,428','thirty-nine thousand four hundred twenty-eight')),true);
});
test('short decimal and whole-number findings retain their exact amounts',()=>{
 const answer='The annual tuition at Example University is 12345.50 dollars.';
 assert.equal(researchAnswerOverlap(answer,'At Example, tuition is 12,345.50 dollars annually.'),true);
 assert.equal(researchAnswerOverlap(answer,'At Example, tuition is 12,345 dollars annually.'),false);
});
test('non-numeric findings require strong content overlap, not topic recognition',()=>{
 const answer='The application requires a signed counselor recommendation and an official transcript.';
 assert.equal(researchAnswerOverlap(answer,'For the application, include an official transcript and a signed recommendation from your counselor.'),true);
 assert.equal(researchAnswerOverlap(answer,'The counselor can help you think about the application.'),false);
});
test('questions and pending verification are not an explanation even when they repeat every figure',()=>{
 const answer='The published annual tuition at Example University is 12345 dollars.';
 for(const text of ['I am still checking whether the annual tuition at Example University is 12345 dollars.','Is the annual tuition at Example University 12345 dollars?','I have not confirmed that the annual tuition at Example University is 12345 dollars.'])assert.equal(researchAnswerOverlap(answer,text),false);
 const spanish='La matrícula anual de la Universidad Ejemplo es de 12345 dólares.';
 for(const text of ['Estoy verificando si la matrícula anual de la Universidad Ejemplo es de 12345 dólares.','¿La matrícula anual de la Universidad Ejemplo es de 12345 dólares?','No he confirmado que la matrícula anual de la Universidad Ejemplo es de 12345 dólares.'])assert.equal(researchAnswerOverlap(spanish,text),false);
});
