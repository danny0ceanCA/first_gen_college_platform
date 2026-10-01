import test from 'node:test';
import assert from 'node:assert/strict';
import {validSearch,searchRequest,searchResponse} from './opportunities.mjs';
const preferences={interest:'Legal careers',location:'Sacramento',distance:'25 miles',availability:'Weekends',type:'volunteer',paid:'any',stage:'Community college'};
test('search requires reviewed criteria and uses a separate research configuration',()=>{
 assert.ok(validSearch(preferences));assert.ok(!validSearch({...preferences,location:''}));assert.ok(!validSearch({...preferences,type:'invalid'}));
 const request=searchRequest({OPENAI_MODEL:'chat-model',OPENAI_MODEL_OPPORTUNITIES:'research-model'},preferences,'en');
 assert.equal(request.model,'research-model');assert.equal(request.reasoning.effort,'medium');assert.equal(request.tool_choice,'required');assert.deepEqual(request.tools,[{type:'web_search'}]);assert.equal(request.store,false);assert.deepEqual(JSON.parse(request.input),preferences);
});
test('research requires actual search and renders safe source citations',()=>{
 const message={type:'message',content:[{type:'output_text',text:'Listing [source]',annotations:[{type:'url_citation',start_index:8,end_index:16,url:'https://example.org/opportunity',title:'Official listing'}]}]};
 assert.equal(searchResponse({output:[message]}),null);
 const response=searchResponse({output:[{type:'web_search_call',status:'completed'},message]});
 assert.equal(response.sources.length,1);assert.equal(response.parts[1].url,'https://example.org/opportunity');assert.equal(response.parts[1].text,'[1]');
 message.content[0].annotations[0].url='javascript:alert(1)';assert.equal(searchResponse({output:[{type:'web_search_call',status:'completed'},message]}),null);
});
