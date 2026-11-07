import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedResearchAspects} from './researchQuestion.mjs';

for(const [language,narrow,both] of [
 ['en',[
  'Compare undergraduate tuition and mandatory fees. Separate tuition from total cost of attendance.',
  'What is the total tuition, separately from the total budget?',
  'Tuition and mandatory fees, not including cost-of-attendance.',
 ],'Compare tuition and the total cost-of-attendance budget.'],
 ['es',[
  'Compara la matrícula y cuotas. Separa la matrícula del costo total.',
  'Matrícula y cuotas separadas del presupuesto total.',
  'Total de matrícula sin incluir el costo de asistencia.',
 ],'Compara la matrícula y el presupuesto total.'],
]){
 for(const question of narrow)test(`${language}: answer boundary is not another budget lookup: ${question}`,()=>assert.deepEqual(requestedResearchAspects(question),['tuition_fees']));
 test(`${language}: a genuine two-part question keeps both requested aspects`,()=>assert.deepEqual(requestedResearchAspects(both),['tuition_fees','total_budget']));
}
test('nonfinancial requests retain their own facets',()=>{
 assert.deepEqual(requestedResearchAspects('What is the application deadline?'),['deadline']);
 assert.deepEqual(requestedResearchAspects('¿Cuál es la fecha límite?'),['deadline']);
});
