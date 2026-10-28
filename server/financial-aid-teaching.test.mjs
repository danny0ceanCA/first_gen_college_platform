import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSession} from './profile-voice.mjs';
import {financeResearchRequest,financeTool} from './finance-research.mjs';
import {conceptFirstTeachingStyle} from '../src/voiceStyle.mjs';
import {individualAidCalculationBoundary} from '../src/financialAidTeaching.mjs';

test('financial-aid teaching survives roles, languages and continuing guide updates without prescribing a lesson or changing tools',()=>{
 for(const mode of ['finance','loans'])for(const role of ['student','parent'])for(const language of ['en','es'])for(const continuing of [false,true]){
  const session=voiceSession({mode,role,language,continuing,profile:{name:'Synthetic student'},targetConfirmed:true,studentId:'synthetic',routeConversations:true,allowGuideHandoff:true},{});
  assert.equal(session.instructions.split(individualAidCalculationBoundary).length-1,1);
  assert.ok(session.instructions.includes(conceptFirstTeachingStyle));
  assert.match(session.instructions,/how colleges understand the student/);
  assert.match(session.instructions,/not a sequence of lessons/);
  assert.match(session.instructions,/specific question, known context or interruption takes priority/);
  assert.match(session.instructions,/before naming Student Aid Index/);
  assert.match(session.instructions,/not enough|not the bill/);
  assert.doesNotMatch(session.instructions,/show simple arithmetic|can determine your exact aid/i);
  const example=session.instructions.split('STYLE EXAMPLE — inspiration, not a mandatory opening or text to repeat: ')[1]?.split('\n')[0];
  assert.ok(example);
  assert.ok(example.startsWith(language==='es'?'Para entender la universidad':'To understand college'));
  assert.ok(!example.includes(language==='es'?'To understand college':'Para entender la universidad'));
  assert.equal(session.tools[0].name,'lookup_financial_aid');
  assert.equal(session.audio.output.voice,'marin');assert.equal(session.audio.output.speed,1);
  if(continuing)assert.match(session.instructions,/CONTINUING LIVE CONVERSATION/);
 }
});

test('individual aid calculations cannot be invited again by another guide or an unconfirmed student scope',()=>{
 for(const mode of ['profile','finance','loans','planning','admissions'])for(const confirmed of [false,true]){
  const session=voiceSession({mode,language:'en',role:'parent',profile:{notes:'PRIVATE_CONTEXT'},routeConversations:mode!=='profile',targetConfirmed:confirmed,students:[]},{});
  assert.ok(session.instructions.includes(individualAidCalculationBoundary));
  assert.match(session.instructions,/even if they supply figures or ask you to calculate it/);
  assert.match(session.instructions,/housing change may|how a concept works/);
  if(!confirmed&&mode!=='profile'){
   assert.ok(!session.instructions.includes('PRIVATE_CONTEXT'));
   assert.ok(!session.tools.some(tool=>tool.name.startsWith('lookup_')));
  }
 }
});

test('research supplies official conditions and office questions instead of personal aid calculations, retaining live search and source restrictions',()=>{
 for(const language of ['en','es'])for(const institution of ['','UC Davis']){
  const request=financeResearchRequest({}, {question:'Can you calculate my grant and R2T4 amount?',institution,language});
  assert.ok(request.instructions.includes(individualAidCalculationBoundary));
  assert.match(request.instructions,/prepare specific questions/);
  assert.match(request.instructions,/Cite every substantive claim/);
  assert.match(request.instructions,/Do not search for personal names, income/);
  assert.equal(request.tool_choice,'required');assert.equal(request.tools[0].type,'web_search');
  if(!institution)assert.deepEqual(request.tools[0].filters.allowed_domains,['studentaid.gov']);
  assert.match(request.instructions,new RegExp(`Answer in ${language==='es'?'Spanish':'English'}`));
 }
 assert.match(financeTool.description,/do not calculate personal eligibility, awards or balances/);
});
