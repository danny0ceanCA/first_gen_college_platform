import test from 'node:test';
import assert from 'node:assert/strict';
import {researchAnswerOverlap,researchPortionObserved} from './researchDiscussion.mjs';

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

for(const [language,reply] of Object.entries({en:'UC Santa Cruz tuition is about seventeen thousand four hundred dollars for the year, but I could not verify every fee.',es:'La matrícula de UC Santa Cruz es de unos diecisiete mil cuatrocientos dólares al año, pero no pude verificar cada cuota.'})){
 test(`${language}: a rounded relevant portion suppresses optional repetition without asserting the entire report was delivered`,()=>{
  const f={subject:'UC Santa Cruz — new undergraduate transfers, 2026–27',aspect:'tuition_fees',status:'partial',answer:'Annual tuition is $17,490 and supplemental tuition is $39,270. [1]'};
  assert.equal(researchPortionObserved(f,reply),true);
  assert.equal(researchPortionObserved(f,reply.replace('Santa Cruz','Berkeley')),false);
  assert.equal(researchPortionObserved({...f,answer:'Annual tuition is $28,000. [1]'},reply),false);
  assert.equal(researchPortionObserved({...f,aspect:'housing'},reply),false);
 });
}

test('optional announcement suppression binds the amount to the same campus and an affirmative claim',()=>{
 const f={subject:'UC Berkeley — entering undergraduates',aspect:'tuition_fees',status:'verified',answer:'Annual tuition is $18,214. [1]'};
 for(const text of ['Berkeley tuition is still pending. UCSC tuition is about eighteen thousand dollars.',
  'UC Berkeley tuition might be about eighteen thousand dollars, but I have not verified that.',
  'La matrícula de Berkeley está pendiente. La matrícula de UCSC es de unos dieciocho mil dólares.',
  'La matrícula de UC Berkeley podría ser de unos dieciocho mil dólares, pero no he confirmado eso.'])assert.equal(researchPortionObserved(f,text),false,text);
});

const topicalPortions={
 en:[
  {aspect:'eligibility',answer:'The minimum GPA for North Campus scholarship eligibility is 3.25. Awards range from $100 to $17,000. [1]',spoken:'For North Campus scholarship eligibility, the minimum GPA is three point two five.',wrong:'For North Campus scholarship eligibility, the minimum GPA is three point five.'},
  {aspect:'eligibility',answer:'North Campus scholarship consideration requires financial need and academic merit. Award amounts vary by fund. [1]',spoken:'North Campus scholarship consideration requires academic merit and financial need.',wrong:'North Campus scholarship consideration does not require academic merit and financial need.'},
  {aspect:'other',answer:'The statistics course at North Campus requires a signed counselor recommendation and an official transcript. Assessment is completed after admission. [1]',spoken:'For the statistics course at North Campus, include an official transcript and a signed recommendation from your counselor.',wrong:'For the statistics course at South Campus, include an official transcript and a signed recommendation from your counselor.'},
  {aspect:'deadline',answer:'The North Campus application deadline is November 30. Supplemental records have a different deadline. [1]',spoken:'The application deadline for North Campus is November thirty.',wrong:'The application deadline for North Campus is November twenty-nine.'},
 ],
 es:[
  {aspect:'eligibility',answer:'El promedio mínimo para la elegibilidad de becas de Campus Norte es 3.25. Los premios varían entre $100 y $17,000. [1]',spoken:'Para la elegibilidad de becas de Campus Norte, el promedio mínimo es tres punto veinticinco.',wrong:'Para la elegibilidad de becas de Campus Norte, el promedio mínimo es tres punto cinco.'},
  {aspect:'eligibility',answer:'Los requisitos de becas de Campus Norte incluyen necesidad económica y mérito académico. Los montos varían por fondo. [1]',spoken:'Los requisitos de becas de Campus Norte incluyen mérito académico y necesidad económica.',wrong:'Los requisitos de becas de Campus Norte no incluyen mérito académico y necesidad económica.'},
  {aspect:'other',answer:'El curso de estadística de Campus Norte requiere una recomendación firmada del consejero y un expediente oficial. La evaluación ocurre después de la admisión. [1]',spoken:'El curso de estadística de Campus Norte requiere un expediente oficial y una recomendación firmada del consejero.',wrong:'El curso de estadística de Campus Sur requiere un expediente oficial y una recomendación firmada del consejero.'},
  {aspect:'deadline',answer:'El plazo de solicitud de Campus Norte es el 30 de noviembre. Los documentos adicionales tienen otro plazo. [1]',spoken:'El plazo de solicitud de Campus Norte es el treinta de noviembre.',wrong:'El plazo de solicitud de Campus Norte es el veintinueve de noviembre.'},
 ],
};
for(const [language,cases]of Object.entries(topicalPortions))for(const [index,example]of cases.entries())test(`${language}: portion ${index} recognizes an explained fact without requiring optional findings`,()=>{
 const finding={subject:language==='en'?'North Campus':'Campus Norte',aspect:example.aspect,status:'verified',answer:example.answer};
 assert.equal(researchPortionObserved(finding,example.spoken),true);
 assert.equal(researchPortionObserved(finding,example.wrong),false);
 assert.equal(researchPortionObserved(finding,example.spoken.replace(/\.$/u,'?')),false);
 const pending=(language==='en'?'I am still checking whether ':'Estoy verificando si ')+example.spoken;
 assert.equal(researchPortionObserved(finding,pending),false);
});

test('spoken decimal digits retain zeros and never collapse to an integer',()=>{
 const answer='North Campus scholarship eligibility requires a minimum GPA of 3.05.';
 assert.equal(researchAnswerOverlap(answer,'North Campus scholarship eligibility requires a minimum GPA of three point zero five.'),true);
 assert.equal(researchAnswerOverlap(answer,'North Campus scholarship eligibility requires a minimum GPA of three point five.'),false);
});

test('a GPA answer from a compound finding does not require the unused year and award range',()=>{
 const finding={subject:'North Campus — undergraduate scholarships',aspect:'eligibility',status:'verified',answer:'For 2026–27 entering transfers, the admission application serves as the campus-scholarship application; the published minimum GPA is 3.25. No additional information is normally required unless requested. Current published awards range from USD 100–17,000 per academic year. [1]'};
 const spoken='North Campus scholarships use the admission application, and they say the published minimum GPA is three point two five.';
 assert.equal(researchPortionObserved(finding,spoken),true);
 assert.equal(researchPortionObserved(finding,spoken.replace('two five','five')),false);
 assert.equal(researchPortionObserved(finding,spoken.replace('North','South')),false);
 assert.equal(researchPortionObserved(finding,'North Campus scholarships use the admission application; I am checking the published minimum GPA.'),false);
});

for(const [language,examples]of Object.entries({
 en:[
  ['eligibility','The minimum GPA for North Campus scholarship eligibility is 3.25. Awards vary by fund. [1]','North Campus awards vary by fund.'],
  ['eligibility','North Campus scholarship eligibility has several requirements. The minimum GPA is 3.25. [1]','North Campus scholarship eligibility has several requirements.'],
  ['eligibility','North Campus scholarship eligibility has three requirements. The minimum GPA is 3.25. [1]','North Campus scholarship eligibility has three requirements.'],
  ['eligibility','North Campus scholarship eligibility requires meeting several requirements. The minimum GPA is 3.25. [1]','North Campus scholarship eligibility requires meeting several requirements.'],
  ['eligibility','North Campus GPA information is listed on page 2. The minimum GPA is 3.25. [1]','North Campus GPA information is listed on page 2.'],
  ['deadline','North Campus application deadline information is available on the official website. The deadline is November 30. [1]','North Campus application deadline information is available on the official website.'],
  ['deadline','North Campus application deadline information is listed on page 2. The deadline is November 30. [1]','North Campus application deadline information is listed on page 2.'],
 ],
 es:[
  ['eligibility','El promedio mínimo para la elegibilidad de becas de Campus Norte es 3.25. Los premios varían por fondo. [1]','Los premios de Campus Norte varían por fondo.'],
  ['eligibility','La elegibilidad de becas de Campus Norte tiene varios requisitos. El promedio mínimo es 3.25. [1]','La elegibilidad de becas de Campus Norte tiene varios requisitos.'],
  ['eligibility','La elegibilidad de becas de Campus Norte tiene tres requisitos. El promedio mínimo es 3.25. [1]','La elegibilidad de becas de Campus Norte tiene tres requisitos.'],
  ['eligibility','La elegibilidad de becas de Campus Norte requiere cumplir varios requisitos. El promedio mínimo es 3.25. [1]','La elegibilidad de becas de Campus Norte requiere cumplir varios requisitos.'],
  ['eligibility','La información del promedio de Campus Norte aparece en la página 2. El promedio mínimo es 3.25. [1]','La información del promedio de Campus Norte aparece en la página 2.'],
  ['deadline','La información del plazo de solicitud de Campus Norte está disponible en el sitio oficial. El plazo es el 30 de noviembre. [1]','La información del plazo de solicitud de Campus Norte está disponible en el sitio oficial.'],
  ['deadline','La información del plazo de solicitud de Campus Norte aparece en la página 2. El plazo es el 30 de noviembre. [1]','La información del plazo de solicitud de Campus Norte aparece en la página 2.'],
 ],
}))test(`${language}: generic research qualifications and notices do not satisfy a requested fact`,()=>{
 for(const [aspect,answer,spoken]of examples){
  const finding={subject:language==='en'?'North Campus':'Campus Norte',aspect,status:'verified',answer};
  assert.equal(researchPortionObserved(finding,spoken),false,spoken);
  const unfinished=spoken.replace(/\.$/u,language==='en'?', so we still need the eligibility answer.':', así que todavía necesitamos la respuesta sobre elegibilidad.');
  assert.equal(researchPortionObserved(finding,unfinished),false,unfinished);
 }
});
