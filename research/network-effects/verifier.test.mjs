import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponsesVerifier, selectVerification } from './verifier.mjs';
import { verifyExtractionCandidate } from './verified-extraction.mjs';
import { verificationCases } from './verification-fixtures.mjs';
import { verificationContextHash, validateVerificationAudit, verificationVersion } from './verification-contracts.mjs';

const example = () => verificationCases().find(item => item.id === 'verify-dev-en-02');
const context = item => ({ existingItems: item.existingItems, episodes: [] });
const wire = value => ({...value,items:value.items.map(({kind,status,...rest})=>({...rest,classification:`${kind}:${status}`}))});
const keep = () => ({obstacles:[],decision:'keep',issues:[],edits:[],additions:[]});
const reply = result => ({ok:true,json:async()=>({id:'resp_verifier_test',model:'gpt-6-luna',status:'completed',
  usage:{input_tokens:100,output_tokens:150,output_tokens_details:{reasoning_tokens:20}},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})});
const issue = item => ({type:'classification',quote:item.source.text,detail:'The request was already made.',itemKey:item.initialCandidate.items[0].key});
const code = expected => error => error.code === expected;
const run = (item,result,options={}) => createResponsesVerifier({apiKey:'test',model:'gpt-6-luna',
  fetcher:async()=>reply(result),...options})(item.source,item.initialCandidate,context(item));
const statusRepair = item => ({...keep(),decision:'revise',issues:[issue(item)],
  edits:[{itemKey:item.initialCandidate.items[0].key,field:'classification',value:'action:completed',issueIndex:0}]});
const clean = () => {
  const item=example(),text='I prefer evening classes.';
  return {...item,source:{...item.source,text},initialCandidate:{schemaVersion:1,items:[{
    ...item.initialCandidate.items[0],kind:'preference',status:'stated',barrier:null,
    statement:text,quote:text,linksTo:null,corrects:null,
  }]},existingItems:[]};
};

test('verification routing checks high-impact claims and omissions without using gold labels or topic keywords',()=>{
  for(const item of verificationCases().filter(item=>item.split==='development'&&item.expected.decision==='revise')){
    assert.equal(selectVerification(item.source,item.initialCandidate,context(item)).required,true,item.id);
  }
  const item=clean();
  const selections=Array.from({length:100},(_,index)=>selectVerification({...item.source,id:`clean-${index}`},item.initialCandidate,context(item)));
  assert.ok(selections.some(selection=>!selection.required));
  assert.ok(selections.some(selection=>selection.reasons.includes('sample')));
  assert.deepEqual(selectVerification(item.source,item.initialCandidate,context(item)),selectVerification(item.source,item.initialCandidate,context(item)));
  const obstacle=structuredClone(item.initialCandidate);
  obstacle.items[0].barrier='An already recorded difficulty';
  assert.ok(selectVerification(item.source,obstacle,context(item)).reasons.includes('barrier_coverage'));
});

test('verifier uses original evidence and strict stateless output; keep preserves the exact candidate',async()=>{
  const item=example();let request,diagnostic;
  const verify=createResponsesVerifier({apiKey:'sk-never-log',model:'gpt-6-luna',onDiagnostic:value=>{diagnostic=value;},
    fetcher:async(_url,options)=>{request=JSON.parse(options.body);return reply(keep());}});
  const result=await verify(item.source,item.initialCandidate,{existingItems:[...item.existingItems,
    {id:'private',accountId:'other',studentId:'other',statement:'secret-other-family'}]},['unfinished_attempt']);
  assert.deepEqual(result.final,item.initialCandidate);assert.equal(result.decision,'kept');
  assert.equal(request.store,false);assert.equal(request.tools,undefined);assert.equal(request.previous_response_id,undefined);
  assert.equal(request.reasoning.effort,'medium');assert.equal(request.text.format.strict,true);
  assert.deepEqual(JSON.parse(request.input).candidate,wire(item.initialCandidate));
  assert.ok(!request.input.includes('secret-other-family'));assert.ok(!request.input.includes('expected'));
  assert.ok(!request.input.includes(item.source.accountId));assert.ok(!JSON.stringify(diagnostic).includes('sk-never-log'));
  assert.equal(diagnostic.reasoningTokens,20);
  assert.equal(request.text.format.schema.properties.replacement,undefined);
  assert.deepEqual(request.text.format.schema.properties.edits.items.properties.itemKey.enum,item.initialCandidate.items.map(value=>value.key));
});

test('a classification patch changes only its evidenced field and rejects unrelated or unsupported edits',async()=>{
  const item=example(),base=statusRepair(item),initial=structuredClone(item.initialCandidate);
  const result=await run(item,base);
  assert.equal(result.decision,'revised');assert.deepEqual(result.final,item.expected.extraction);
  assert.deepEqual(item.initialCandidate,initial,'the original candidate must not be mutated');
  for(const mutate of [
    r=>{r.issues[0].quote='Invented quote';},r=>{r.issues[0].itemKey='nonexistent';},
    r=>{r.edits[0].itemKey='nonexistent';},r=>{r.edits[0].field='episodeKey';},
    r=>{r.edits[0].field='topic';},r=>{r.edits[0].value='action:positive';},
    r=>{r.edits[0].issueIndex=2;},r=>{r.edits.push({...r.edits[0]});},
    r=>{r.edits.push({...r.edits[0],field:'statement',value:'The student received a pass.'});},
    r=>{r.edits.push({...r.edits[0],field:'reportedBy',value:'coordinator'});},
    r=>{r.decision='keep';},r=>{r.issues=[];},r=>{r.edits=[];},
    r=>{r.edits[0].value='action:attempted';},
  ]){const bad=structuredClone(base);mutate(bad);await assert.rejects(run(item,bad));}
});

test('missing obstacle inventory creates a grounded barrier while preserving wording and existing barriers',async()=>{
  const item=clean(),first='I cannot afford the train.',second='I also cannot find a later bus.';
  item.source.text=`${first} ${second}`;
  item.initialCandidate.items[0]={...item.initialCandidate.items[0],kind:'question',status:'open',
    statement:item.source.text,quote:item.source.text,barrier:first};
  const result=await run(item,{...keep(),decision:'revise',obstacles:[{quote:second,itemKey:item.initialCandidate.items[0].key,coverage:'missing'}]});
  assert.equal(result.final.items[0].barrier,`${first}; ${second}`);
  assert.deepEqual({...result.final.items[0],barrier:first},item.initialCandidate.items[0]);
  assert.deepEqual(result.issues,[{type:'barrier',quote:second,detail:'An explicit obstacle was missing from the structured barrier field.',itemKey:item.initialCandidate.items[0].key}]);
  const kept=await run(item,{...keep(),obstacles:[{quote:first,itemKey:item.initialCandidate.items[0].key,coverage:'recorded'}]});
  assert.deepEqual(kept.final,item.initialCandidate);
  for(const obstacle of [
    {quote:'Invented obstacle.',itemKey:item.initialCandidate.items[0].key,coverage:'missing'},
    {quote:second,itemKey:'unknown-key',coverage:'missing'},
    {quote:first,itemKey:item.initialCandidate.items[0].key,coverage:'missing'},
  ])await assert.rejects(run(item,{...keep(),decision:'revise',obstacles:[obstacle]}));
  const missing=structuredClone(item);missing.initialCandidate.items[0].barrier=null;
  await assert.rejects(run(missing,{...keep(),obstacles:[{quote:first,itemKey:item.initialCandidate.items[0].key,coverage:'recorded'}]}));
});

test('an omitted failed result is added as exact evidence and its obstacle is mapped to that addition',async()=>{
  const item=verificationCases().find(value=>value.id==='verify-dev-en-01');
  const quote='It rejected the message because the required subject box was blank, and nothing was sent.';
  const addition={...wire(item.expected.extraction).items[1],statement:quote,quote,barrier:null};
  const base={...keep(),decision:'revise',issues:[{type:'omission',quote,detail:'The reported unsuccessful result is absent.',itemKey:null}],
    additions:[{item:addition,issueIndex:0}],obstacles:[{quote:'the required subject box was blank',itemKey:addition.key,coverage:'missing'}]};
  const result=await run(item,base);
  assert.deepEqual(result.final.items[0],item.initialCandidate.items[0]);
  assert.equal(result.final.items[1].kind,'outcome');assert.equal(result.final.items[1].status,'unsuccessful');
  assert.equal(result.final.items[1].barrier,'the required subject box was blank');
  assert.equal(result.final.items[1].linksTo,item.initialCandidate.items[0].key);
  for(const mutate of [
    r=>{r.additions[0].item.statement='The student sent the question.';},
    r=>{r.additions[0].item.barrier='The page was blank.';},
    r=>{r.additions[0].item.linksTo='imagined-prior-item';},
    r=>{r.additions[0].item.reportedBy='parent';},
    r=>{r.issues[0].itemKey=item.initialCandidate.items[0].key;},
    r=>{r.issues[0].quote=item.initialCandidate.items[0].quote;},
  ]){const bad=structuredClone(base);mutate(bad);await assert.rejects(run(item,bad));}
});

test('required verification is durable before the call, and failures never return the primary candidate',async()=>{
  const item=example(),records=[];
  const perform=verify=>verifyExtractionCandidate({source:item.source,initial:item.initialCandidate,context:context(item),verify,
    recordAudit:async audit=>{records.push(audit);}});
  await assert.rejects(perform(async()=>{assert.equal(records.at(-1).decision,'pending');throw Object.assign(new Error('budget'),{code:'network_budget_exhausted'});}),code('network_budget_exhausted'));
  assert.deepEqual(records.map(row=>row.decision),['pending','failed']);assert.equal(records.at(-1).final,null);
  records.length=0;
  await assert.rejects(perform(async()=>({decision:'needs_review',final:null,issues:[{...issue(item),type:'uncertain'}]})),code('verification_needs_review'));
  assert.deepEqual(records.map(row=>row.decision),['pending','needs_review']);
});

test('rejected repair retains sanitized validation stage and specific contract code',async()=>{
  const item=example();let diagnostic;
  const patch={...keep(),decision:'revise',issues:[{type:'relationship',quote:item.source.text,
    detail:'Unsupported reference for rejection test.',itemKey:item.initialCandidate.items[0].key}],
    edits:[{itemKey:item.initialCandidate.items[0].key,field:'linksTo',value:'missing-prior-record',issueIndex:0}]};
  await assert.rejects(run(item,patch,{onDiagnostic:value=>{diagnostic=value;}}),code('invalid_verification'));
  assert.equal(diagnostic.validationStage,'repair');
  assert.equal(diagnostic.contractCode,'unknown_item_reference');
  assert.equal(diagnostic.outcome,'failed');
  assert.ok(!JSON.stringify(diagnostic).includes(item.source.text));
});

test('v2 durable audit blocks metadata regeneration, unsupported rewrites and barrier removal',()=>{
  const item=example(),ctx=context(item);
  item.initialCandidate.items[1].barrier='They have not replied';
  const final=structuredClone(item.initialCandidate);final.items[0].status='completed';
  const audit={schemaVersion:1,version:verificationVersion,decision:'revised',reasons:['unfinished_attempt'],
    initial:item.initialCandidate,final,issues:[issue(item)],steps:[],contextHash:verificationContextHash(item.source,ctx)};
  assert.deepEqual(validateVerificationAudit(audit,item.source,ctx).final,final);
  for(const mutate of [
    value=>{value.final.items[0].episodeKey='different-concern';},
    value=>{value.final.items[0].topic='applications';},
    value=>{value.final.items[0].key='renamed';},
    value=>{value.final.items[1].barrier=null;},
    value=>{value.final.items[1].statement='The student is waiting.';},
    value=>{value.final.items.pop();},
  ]){const bad=structuredClone(audit);mutate(bad);assert.throws(()=>validateVerificationAudit(bad,item.source,ctx));}
  const historical=structuredClone(audit);historical.version='network-effects-verification-v1';historical.final.items[1].barrier=null;
  assert.equal(validateVerificationAudit(historical,item.source,ctx).version,'network-effects-verification-v1','historical audit replay must keep its original contract');
});

test('unselected records skip the paid reviewer, while invalid primaries fail before any review',async()=>{
  const item=clean();let source=item.source;
  for(let index=0;index<100&&selectVerification(source,item.initialCandidate,context(item)).required;index++)source={...source,id:`skip-${index}`};
  assert.equal(selectVerification(source,item.initialCandidate,context(item)).required,false);
  let calls=0,stored;
  const result=await verifyExtractionCandidate({source,initial:item.initialCandidate,context:context(item),verify:async()=>{calls++;},recordAudit:async audit=>{stored=audit;}});
  assert.equal(result.decision,'skipped');assert.equal(calls,0);assert.deepEqual(stored.final,item.initialCandidate);
  const invalid=structuredClone(item.initialCandidate);invalid.items[0].quote='hallucinated';
  await assert.rejects(verifyExtractionCandidate({source,initial:invalid,verify:async()=>{calls++;},recordAudit:async()=>{calls++;}}));assert.equal(calls,0);
});

test('audit contracts bind source and context, enforce verdicts, and strip diagnostic secrets',()=>{
  const item=example(),ctx=context(item);
  const audit={schemaVersion:1,version:verificationVersion,decision:'kept',reasons:['unfinished_attempt'],initial:item.initialCandidate,
    final:item.initialCandidate,issues:[],contextHash:verificationContextHash(item.source,ctx),steps:[{stage:'verification',sent:true,outcome:'completed',headers:'secret',privateReasoning:'never'}]};
  const valid=validateVerificationAudit(audit,item.source,ctx);assert.ok(!JSON.stringify(valid).includes('secret'));assert.ok(!JSON.stringify(valid).includes('privateReasoning'));
  assert.throws(()=>validateVerificationAudit({...audit,contextHash:'0'.repeat(64)},item.source,ctx),code('verification_context_changed'));
  assert.throws(()=>validateVerificationAudit({...audit,decision:'failed'},item.source,ctx));
  assert.throws(()=>validateVerificationAudit({...audit,decision:'revised'},item.source,ctx));
});
