import test from 'node:test';
import assert from 'node:assert/strict';
import {liveMeasurements,responseMeasurement} from './live-measurements.mjs';
import {diagnosticRecord} from './observability/event-schema.mjs';
import {liveMeasurementReport} from '../scripts/live-measurement-report.mjs';
import {enumFields} from './observability/event-catalog.mjs';
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

test('speech observations keep playback evidence separate from completed text',()=>{
 const records=[];
 const measurements=liveMeasurements({log:event=>records.push(diagnosticRecord(event))});
 measurements.application({type:'origen.research.speech_observed',speechOutcome:'substantive_interruption',
  completedPortions:1,unfinishedPortion:true,playbackObserved:false,overlapCount:2,text:'PRIVATE'});
 const observation=records[0];
 assert.equal(observation.measurementStage,'speech_observation');
 assert.equal(observation.speechOutcome,'substantive_interruption');
 assert.equal(observation.completedPortions,1);
 assert.equal(observation.playbackObserved,false);
 assert.equal(observation.unfinishedPortion,true);
 assert.equal(observation.overlapCount,2);
 assert.ok(!JSON.stringify(records).includes('PRIVATE'));
 measurements.application({type:'origen.research.delivery',jobId:'PRIVATE',deliveryStage:'repeat_suppressed',deliveryReason:'unchanged_context'});
 assert.equal(records[1].deliveryReason,'unchanged_context');
 const report=liveMeasurementReport(records);
 assert.equal(report.acceptedRecords,2);
 const speech=report.groups.find(group=>group.stage==='speech_observation');
 assert.equal(speech.speechOutcomes.substantive_interruption,1);
 assert.equal(speech.playbackObservations.activity_not_observed,1);
 assert.equal(report.groups.find(group=>group.stage==='research_delivery').deliveryOutcomes.repeat_suppressed,1);
 measurements.close();
});

test('selection recovery measurements preserve fixed lifecycle categories and timing without private identifiers',()=>{
 const raw=[],records=[];let time=0;
 const measurements=liveMeasurements({now:()=>time,log:event=>{raw.push(event);records.push(diagnosticRecord(event));}});
 measurements.application({type:'input_audio_buffer.speech_started'});
 for(const stage of enumFields.recoveryStage){time+=100;measurements.application({type:'origen.selection.recovery',stage,reason:'native_delegation',durationMs:time,
  recoveryId:'PRIVATE-ID',item_id:'PRIVATE-ITEM',response_id:'PRIVATE-RESPONSE',eventId:'PRIVATE-EVENT',transcript:'PRIVATE-TEXT',name:'PRIVATE-NAME'});}
 assert.equal(records.length,enumFields.recoveryStage.length);
 assert.ok(records.every(event=>event.measurementStage==='selection_recovery'&&event.turnIndex===1));
 assert.equal(new Set(records.map(event=>event.measurementRun)).size,1);
 assert.equal(JSON.stringify(raw).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(records).includes('PRIVATE'),false);
 measurements.application({type:'origen.selection.recovery',stage:'PRIVATE-STAGE',reason:'PRIVATE-REASON',durationMs:'PRIVATE-DURATION'});
 assert.equal(records.length,enumFields.recoveryStage.length,'unknown stages must not create operational records');
 measurements.application({type:'origen.selection.recovery',stage:'unconfirmed',reason:'PRIVATE-REASON',durationMs:NaN});
 assert.equal(records.at(-1).recoveryReason,undefined);assert.equal(records.at(-1).durationMs,undefined);
 const sanitized=diagnosticRecord({event:'voice.live.measurement',measurementStage:'selection_recovery',recoveryStage:'PRIVATE-STAGE',recoveryReason:'PRIVATE-REASON',text:'PRIVATE-TEXT',recoveryId:'PRIVATE-ID'});
 assert.equal(JSON.stringify(sanitized).includes('PRIVATE'),false);
 const report=liveMeasurementReport([...records,{event:'voice.live.measurement',measurementStage:'selection_recovery',recoveryStage:'PRIVATE-STAGE',recoveryReason:'PRIVATE-REASON'}]);
 const group=report.groups.find(row=>row.stage==='selection_recovery');
 assert.equal(group.recoveryStages.requested,1);assert.equal(group.recoveryStages.unconfirmed,2);
 assert.equal(group.recoveryReasons.native_delegation,enumFields.recoveryStage.length);
 assert.equal(group.metrics.durationMs.samples,enumFields.recoveryStage.length);
 assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
 measurements.close();
});

test('research deferrals distinguish a pending requested fact from evidence not supplied to Live',()=>{
 const records=[],measurements=liveMeasurements({log:event=>records.push(diagnosticRecord(event))});
 for(const reason of ['awaiting_requested_evidence','requested_evidence_not_supplied']){
  measurements.application({type:'origen.research.delivery',jobId:'PRIVATE-ID',deliveryStage:'deferred',deliveryReason:reason,question:'PRIVATE-TEXT'});
  assert.equal(records.at(-1).deliveryReason,reason);
  assert.equal(records.at(-1).deliveryStage,'deferred');
 }
 assert.ok(!JSON.stringify(records).includes('PRIVATE'));
 assert.equal(liveMeasurementReport(records).acceptedRecords,2);measurements.close();
});
