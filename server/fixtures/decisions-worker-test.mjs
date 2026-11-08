// Test worker entry only. A deterministic HTTP substitute exercises the actual
// production thread/projector/evaluator pipeline without paid API calls.
globalThis.fetch = async (_url, options) => {
  const request=JSON.parse(options.body);
  const answers=request.questions.map(question=>{
    if(question.type==='predicate')return {name:question.name,type:'predicate',probability:question.name==='simplify_requested'?.99:0};
    const values=question.choices.map(item=>item.value),selected=values.includes('none')?'none':values.includes('unchanged')?'unchanged':values[0];
    return {name:question.name,type:'choice',choice:selected,confidence:.99,
      probabilities:values.map(value=>({value,probability:value===selected?.99:.01/(values.length-1)}))};
  });
  return new Response(JSON.stringify({model:'gpt-6-luna',answers,
    usage:{input_tokens:1000,output_tokens:0,total_tokens:1000,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}}),
    {headers:{'x-request-id':'req_test_production'}});
};
await import('../../research/decisions/local-call/worker.mjs');
