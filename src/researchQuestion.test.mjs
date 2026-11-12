import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedResearchAspects} from './researchQuestion.mjs';

for(const [language,narrow,both] of [
 ['en',[
  'Compare undergraduate tuition and mandatory fees. Separate tuition from total cost of attendance.',
  'What is the total tuition, separately from the total budget?',
  'Tuition and mandatory fees, not including cost-of-attendance.',
  'Tuition and mandatory fees charged by the university, excluding estimated housing, food and other living expenses. Provide the published amount.',
  'Tuition and fees, excluding housing and food, with source and year.',
 ],'Compare tuition and the total cost-of-attendance budget.'],
 ['es',[
  'Compara la matrícula y cuotas. Separa la matrícula del costo total.',
  'Matrícula y cuotas separadas del presupuesto total.',
  'Total de matrícula sin incluir el costo de asistencia.',
  'Matrícula y cuotas obligatorias, excluyendo vivienda, alimentación y otros gastos de vida. Indica el año.',
  'Matrícula y cuotas, sin incluir la vivienda ni la alimentación.',
 ],'Compara la matrícula y el presupuesto total.'],
]){
 for(const question of narrow)test(`${language}: answer boundary is not another budget lookup: ${question}`,()=>assert.deepEqual(requestedResearchAspects(question),['tuition_fees']));
 test(`${language}: a genuine two-part question keeps both requested aspects`,()=>assert.deepEqual(requestedResearchAspects(both),['tuition_fees','total_budget']));
}
test('nonfinancial requests retain their own facets',()=>{
 assert.deepEqual(requestedResearchAspects('What is the application deadline?'),['deadline']);
 assert.deepEqual(requestedResearchAspects('¿Cuál es la fecha límite?'),['deadline']);
});

test('a new positive housing request is preserved after an exclusion clause',()=>{
 assert.deepEqual(requestedResearchAspects('Tuition excluding housing, but include housing separately.'),['tuition_fees','housing']);
 assert.deepEqual(requestedResearchAspects('Matrícula excluyendo vivienda, pero incluye vivienda por separado.'),['tuition_fees','housing']);
});
