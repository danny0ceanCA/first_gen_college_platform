import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { interpretationCases, interpretationVersion } from './calibration-interpretation-fixtures.mjs';
import { finalInterpretationCases, finalInterpretationVersion } from './interpretation-final-fixtures.mjs';
import { scoreCalibrationCase, calibrationSummary } from './calibration-scoring.mjs';
import { inspectCalibrationPipeline } from './calibration-pipeline.mjs';
import { runCalibration } from './calibration-runner.mjs';
import { pricing } from './calibration-budget.mjs';

const baseExample = () => ({ id:'unit-now', source:{id:'cal-unit-now',text:'I still need help with the letter.',reporter:'student',language:'en'},
  expected:{items:[{key:'expected-1',kind:'question',status:'open',topic:'finding_help',reportedBy:'student',language:'en',occurredAt:null,quote:'I still need help with the letter.'}]},
  rubric:{priorCaseId:null,correctionCaseId:null,expectedBarrier:'Cannot understand the letter',interpretationExpected:{
    requiredObservations:[{kind:'question',statuses:['open','partial'],requireBarrier:true}],
    forbiddenKindStatuses:[['outcome','positive']],noCorrection:true,priorLinkRequired:false,fulfillsPendingCaseId:null,
  }} });
const candidate = () => ({items:[{key:'actual-1',kind:'question',status:'partial',topic:'finding_help',reportedBy:'student',language:'en',occurredAt:null,
  quote:'I still need help with the letter.',statement:'The letter is still confusing.',barrier:'Needs help understanding the letter.',linksTo:null,corrects:null}]});

test('interpretation scoring — supported status alternatives are separate from exact annotation agreement', () => {
  const example=baseExample(),actual=candidate();
  const score=scoreCalibrationCase(example,actual,{valid:true});
  assert.equal(score.supportedAnnotations,0);
  assert.equal(score.interpretationPassed,true);
  assert.ok(score.matches.some(match=>match.checks.status===false));
  assert.ok(score.interpretationChecks.every(check=>check.pass));
  const invalid=scoreCalibrationCase(example,actual,{valid:false});
  assert.equal(invalid.interpretationPassed,false);
  const summary=calibrationSummary([{source:example.source,split:'heldout',score,diagnostic:{sent:false},accounting:{chargedUsd:0}}]);
  assert.equal(summary.overall.interpretationChecks.value,1);
  assert.equal(summary.overall.interpretationFailures,0);
});

test('interpretation scoring — barriers, unsupported certainty, and false correction are independent failures', () => {
  const example=baseExample(),actual=candidate();
  actual.items[0].barrier=null;
  actual.items[0].corrects='cal-before@1#old';
  actual.items.push({...candidate().items[0],key:'false-success',kind:'outcome',status:'positive',corrects:null});
  const score=scoreCalibrationCase(example,actual,{valid:true});
  assert.equal(score.interpretationPassed,false);
  assert.deepEqual(score.interpretationChecks.filter(check=>!check.pass).map(check=>check.type).sort(),[
    'forbidden_interpretation_classification','ordinary_progress_not_correction','required_interpretation_barrier',
  ]);
  assert.ok(score.flags.some(flag=>flag.severity==='critical' && flag.check?.type==='forbidden_interpretation_classification'));
  assert.ok(score.flags.some(flag=>flag.severity==='critical' && flag.check?.type==='ordinary_progress_not_correction'));
});

test('interpretation scoring — explicit links are required and a genuine correction counts as prior relationship', () => {
  const example=baseExample(),actual=candidate();
  example.rubric.priorCaseId='before';
  example.rubric.interpretationExpected.priorLinkRequired=true;
  const priorItems=[{id:'cal-before@1#actual-prior',sourceId:'cal-before'}];
  assert.equal(scoreCalibrationCase(example,actual,{valid:true,priorItems}).interpretationPassed,false);
  actual.items[0].linksTo=priorItems[0].id;
  assert.equal(scoreCalibrationCase(example,actual,{valid:true,priorItems}).interpretationPassed,true);
  actual.items[0].linksTo='cal-unrelated@1#item';
  assert.equal(scoreCalibrationCase(example,actual,{valid:true,priorItems}).interpretationPassed,false);

  // Old correction rubrics name the earlier action as priorCaseId and the
  // retracted outcome separately. corrects establishes the chain on its own.
  delete example.rubric.interpretationExpected;
  example.rubric.priorCaseId='earlier-action';
  example.rubric.correctionCaseId='before';
  actual.items[0].linksTo=null;
  actual.items[0].corrects=priorItems[0].id;
  const corrected=scoreCalibrationCase(example,actual,{valid:true,priorItems});
  assert.ok(!corrected.flags.some(flag=>['missing_prior_link','missing_correction_link'].includes(flag.type)));
});

function fulfillmentFixture() {
  const pending={id:'cal-pending@1#waiting',sourceId:'cal-pending',kind:'outcome',status:'pending',state:'current',linksTo:null,corrects:null};
  const action={id:'cal-unit-now@1#attended',sourceId:'cal-unit-now',kind:'action',status:'completed',state:'current',linksTo:pending.id,corrects:null};
  const result={id:'cal-unit-now@1#fulfilled',sourceId:'cal-unit-now',kind:'outcome',status:'positive',state:'current',linksTo:action.id,corrects:null};
  const example=baseExample();
  example.rubric.interpretationExpected.fulfillsPendingCaseId='pending';
  const episode={id:'episode-one',episodeKey:'requested-event',outcomeState:'positive',analysisEligible:true,reviewState:'unreviewed',items:[pending,action,result]};
  return {example,state:{episodes:[episode]},context:{valid:true,priorItems:[pending],actual:{items:[action,result]}}};
}

test('interpretation pipeline — fulfilled event retains pending history and accepts linked local result chains', () => {
  const {example,state,context}=fulfillmentFixture();
  const inspected=inspectCalibrationPipeline(example,state,context);
  assert.equal(inspected.passed,true);
  assert.equal(inspected.checks.length,4);
  assert.ok(inspected.checks.every(check=>check.pass));
  assert.equal(inspected.episodes[0].observations[2].linksTo,'cal-unit-now@1#attended');
  assert.equal(inspected.episodes[0].observations[0].state,'current');
});

test('interpretation pipeline — stale pending, erased history, unrelated success, and link cycles cannot pass fulfillment', () => {
  {
    const {example,state,context}=fulfillmentFixture();
    state.episodes[0].outcomeState='pending';
    state.episodes[0].items.pop();
    assert.ok(inspectCalibrationPipeline(example,state,context).checks.some(check=>check.type==='fulfilled_pending_has_current_positive_result' && !check.pass));
  }
  {
    const {example,state,context}=fulfillmentFixture();
    state.episodes[0].items[0].state='superseded';
    assert.ok(inspectCalibrationPipeline(example,state,context).checks.some(check=>check.type==='fulfilled_pending_history_preserved' && !check.pass));
  }
  {
    const {example,state,context}=fulfillmentFixture();
    const result=state.episodes[0].items.pop();
    state.episodes[0].outcomeState='pending';
    state.episodes.push({id:'unrelated',outcomeState:'positive',items:[result]});
    assert.ok(inspectCalibrationPipeline(example,state,context).checks.some(check=>check.type==='fulfilled_pending_has_current_positive_result' && !check.pass));
  }
  {
    const {example,state,context}=fulfillmentFixture();
    state.episodes[0].items[1].linksTo=state.episodes[0].items[2].id;
    assert.ok(inspectCalibrationPipeline(example,state,context).checks.some(check=>check.type==='fulfilled_pending_linked_to_prior_context' && !check.pass));
  }
  {
    const {example,state,context}=fulfillmentFixture();
    context.priorItems=[];
    assert.equal(inspectCalibrationPipeline(example,state,context).passed,false);
  }
});

for(const [dataset,getCases,version] of [['interpretation',interpretationCases,interpretationVersion],['interpretation-final',finalInterpretationCases,finalInterpretationVersion]]) {
test(`${dataset} runner — fictional dataset is selected, rubrics stay local, and actual sequential references reach the mock model`, async () => {
  const examples=getCases(),byText=new Map(examples.map(example=>[example.source.text,example]));
  let calls=0,withContext=0;
  const fetcher=async(_url,options)=>{
    calls++;
    const request=JSON.parse(options.body),input=JSON.parse(request.input),example=byText.get(input.source.text);
    assert.ok(example);
    assert.equal(input.source.language,example.source.language);
    assert.ok(!request.input.includes('interpretationExpected'));
    assert.ok(!request.input.includes('expected-'));
    if(input.existingItems.length){withContext++;assert.ok(input.existingItems.every(item=>item.id.includes('#actual-')));}
    const extraction=structuredClone(example.expected);
    for(const item of extraction.items){
      item.key=item.key.replace('expected-','actual-');
      if(item.linksTo)item.linksTo=item.linksTo.replace('#expected-','#actual-');
    }
    const wire={...extraction,items:extraction.items.map(({kind,status,...item})=>({...item,classification:`${kind}:${status}`}))};
    return {ok:true,json:async()=>({id:'resp_mock_interpretation',model:pricing.model,status:'completed',usage:{input_tokens:100,output_tokens:100},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(wire)}]}]})};
  };
  const identity=randomUUID();
  const {report}=await runCalibration({apiKey:'mock-only',runId:`mock-interpret-${identity}`,budgetId:`mock-interpret-${identity}`,capUsd:1,dataset,fetcher});
  assert.equal(calls,examples.length);
  assert.equal(withContext,examples.filter(example=>example.rubric.priorCaseId).length);
  assert.equal(report.status,'completed');
  assert.equal(report.configuration.dataset,version);
  assert.equal(report.configuration.datasetRole,'fresh-heldout');
  assert.equal(report.records.length,examples.length);
  assert.ok(report.records.every(record=>record.source.synthetic && record.score.valid && record.score.interpretationPassed && record.pipeline.passed));
  assert.equal(report.summary.overall.interpretationFailures,0);
});
}
