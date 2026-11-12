import test from 'node:test';
import assert from 'node:assert/strict';
import {housingResearchQuestion,publishedCostQuestion,statedHousingChoice} from './voice-cost-task.mjs';
import {costHousingScenario} from './voice-housing-scope.mjs';

for(const language of ['en','es'])test(`${language}: an undated cost request uses a published benchmark and preserves explicit years`,()=>{
 const question='Published cost of attendance for the next available academic year, 2027–28.';
 const caller=language==='es'?'Quiero saber el costo de Berkeley':'I want to learn about the cost of Berkeley';
 const scoped=publishedCostQuestion(question,[caller],language);
 assert.doesNotMatch(scoped,/2027|next available/);
 assert.match(scoped,/published|publicado/);
 assert.equal(publishedCostQuestion(scoped,[caller],language),scoped,'the policy is idempotent');
 assert.equal(publishedCostQuestion(question,[caller,'2027–28'],language),question);
 assert.equal(publishedCostQuestion(question,[language==='es'?'El próximo año':'Next year'],language),question);
 assert.equal(publishedCostQuestion('FAFSA tax information',[caller],language),'FAFSA tax information');
});

for(const [language,reply] of [['en',"Yeah, he's gonna be probably renting near campus"],['es','Sí, él probablemente va a alquilar cerca del campus']])test(`${language}: natural rental plans narrow the researched scenario`,()=>{
 assert.equal(statedHousingChoice(reply),'renting');
 const next=housingResearchQuestion('California-resident undergraduate off-campus housing, arrangement unspecified.','renting',language);
 assert.equal(costHousingScenario(next),'renting');
 assert.equal(costHousingScenario(housingResearchQuestion('California-resident undergraduate off-campus housing.','with_family',language)),'with_family');
 for(const ambiguous of ['Yeah','Okay',"He is not renting",'He might rent','What if he rents?','No va a alquilar','Tal vez va a alquilar','Si va a alquilar, ¿cuánto cuesta?'])assert.equal(statedHousingChoice(ambiguous),undefined,ambiguous);
});

for(const [language,choice] of [
 ['en',"He will be off campus, not with family."],
 ['es','Él vivirá fuera del campus, no con familiares.'],
])test(`${language}: a clear personal off-campus exclusion of family selects the rental comparison category`,()=>{
 assert.equal(statedHousingChoice(choice),'renting');
 for(const family of ['With family.','Living with relatives.','Con familiares.','Vivir con padres.'])assert.equal(statedHousingChoice(family),'with_family',family);
 for(const unclear of ['campusfamily','Off campus.','He might live off campus, not with family.','What if he lives off campus, not with family?','Fuera del campus.','Tal vez vivirá fuera del campus, no con familiares.'])
  assert.equal(statedHousingChoice(unclear),undefined,unclear);
});
