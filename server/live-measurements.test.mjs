import test from 'node:test';
import assert from 'node:assert/strict';
import {liveMeasurements,responseMeasurement} from './live-measurements.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
import {liveMeasurementReport} from '../scripts/live-measurement-report.mjs';
test('native-to-dispatch correlation works without response_id and never records content',()=>{
 let time=0;const records=[];const m=liveMeasurements({now:()=>time,log:e=>records.push(diagnosticRecord(e)),config:{language:'en',instructions:'PRIVATE',tools:[]}});
 m.start();m.native({type:'response.event',delegation_id:'PRIVATE-d',event:{type:'response.created',response:{id:'PRIVATE-r'}}});
 time=10;m.native({type:'response.event',delegation_id:'PRIVATE-d',event:{type:'response.output_item.done',item:{type:'function_call',call_id:'PRIVATE-c',arguments:'PRIVATE'}}});
 time=35;m.application({type:'response.done',response:{id:'PRIVATE-r',output:[{type:'function_call',call_id:'PRIVATE-c'}]}});
 assert.equal(records.find(e=>e.measurementStage==='tool_dispatched').durationMs,25);
 assert.equal(JSON.stringify(records).includes('PRIVATE'),false);
 assert.equal(new Set(records.map(e=>e.measurementRun)).size,1);
 m.native({type:'session.usage.updated',usage:{seconds:12}});m.native({type:'session.closed',usage:{seconds:15}});m.close();m.close();
 assert.equal(records.filter(e=>e.measurementStage==='control_closed').length,1);
 assert.equal(records.find(e=>e.measurementStage==='session_closed').voiceSeconds,15);
 assert.equal(liveMeasurementReport(records).acceptedRecords,records.length);
});
test('failure categories preserve distinctions without raw errors',()=>{
 assert.equal(responseMeasurement({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}).failureKind,'output_limit');
 assert.equal(responseMeasurement({status:'completed',output:[{content:[{type:'refusal',refusal:'PRIVATE'}]}]}).failureKind,'refusal');
 assert.equal(responseMeasurement({},429).failureKind,'rate_limited');
 assert.equal(responseMeasurement(null).failureKind,'unknown');
 assert.equal(responseMeasurement({output:{content:'malformed'}}).failureKind,'unknown');
 assert.equal(responseMeasurement({error:{message:'PRIVATE'}}).failureKind,'provider_error');
 const event=diagnosticRecord({event:'voice.live.measurement',measurementStage:'research_attempt',...responseMeasurement({status:'incomplete'}),measurementRun:'PRIVATE',configurationHash:'PRIVATE',text:'PRIVATE'});
 assert.equal(JSON.stringify(event).includes('PRIVATE'),false);
});
test('logging failure cannot break the call and reports do not echo unknown data',()=>{
 const m=liveMeasurements({log:()=>{throw Error('sink unavailable');}});assert.doesNotThrow(()=>{m.start();m.close();});
 const report=liveMeasurementReport([{event:'voice.live.measurement',measurementStage:'PRIVATE',text:'PRIVATE'}]);assert.equal(report.acceptedRecords,0);assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
});
