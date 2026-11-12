import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyResearchVisual,researchVisualReducer,visibleResearchReport} from './researchVisualState.ts';
import {publicRecord} from '../server/research-record.fixtures.mjs';

for(const language of ['en','es'])test(`${language}: minimized research updates quietly and reopens with all comparisons and controls retained`,()=>{
 const report={id:'first',language,pending:false,updatedAt:1,table:{columns:['Campus A'],rows:[{aspect:'total_budget',cells:[{scope:'Campus A',answer:'$40,000',qualification:'Estimate',sources:[]}]}]}};
 let state=researchVisualReducer(emptyResearchVisual,{type:'receive',report,present:true});
 state=researchVisualReducer(state,{type:'hideColumn',column:'Campus A'});
 state=researchVisualReducer(state,{type:'minimize'});
 assert.equal(state.minimized,true);assert.equal(state.updatedWhileMinimized,false);
 state=researchVisualReducer(state,{type:'receive',report:{...report,updatedAt:2},present:true});
 assert.equal(state.updatedWhileMinimized,false,'unchanged evidence does not claim an update');
 const added={...report,id:'second',comparisonBaseId:'first',table:{columns:['Campus B'],rows:[{aspect:'total_budget',cells:[{scope:'Campus B',answer:'$42,000',qualification:'Estimate',sources:[]}]}]}};
 state=researchVisualReducer(state,{type:'receive',report:added,present:true});
 assert.equal(state.minimized,true,'new research cannot force the panel open');
 assert.equal(state.updatedWhileMinimized,true);
 state=researchVisualReducer(state,{type:'reopen'});
 assert.equal(state.minimized,false);assert.equal(state.updatedWhileMinimized,false);
 assert.deepEqual(state.reports.find(r=>r.id===state.view).table.columns,['Campus A','Campus B']);
 assert.deepEqual(state.hiddenColumns,['Campus A']);
 assert.equal(state.reports.length,2);
 assert.deepEqual(researchVisualReducer(state,{type:'reset'}),emptyResearchVisual);
});

for(const language of ['en','es'])test(`${language}: removing a column only hides it, persists through new results, and can be undone`,()=>{
 const columns=['UC Berkeley — Renting off campus','UC Davis — Renting off campus','UC Davis — Living with family'];
 const report={id:'cost',language,pending:false,updatedAt:1,table:{columns,rows:[{aspect:'total_budget',cells:columns.map((scope,i)=>({scope,answer:'$'+(40000+i),qualification:'Estimate, not a bill.',sources:[]}))}]}};
 let state=researchVisualReducer(emptyResearchVisual,{type:'receive',report,present:true});
 const original=JSON.stringify(state.reports);
 state=researchVisualReducer(state,{type:'hideColumn',column:columns[2]});
 let shown=visibleResearchReport(state.reports[0],state.hiddenColumns);
 assert.deepEqual(shown.table.columns,columns.slice(0,2));
 assert.equal(shown.table.rows[0].cells.length,2);assert.equal(JSON.stringify(state.reports),original);
 state=researchVisualReducer(state,{type:'receive',report:{...report,updatedAt:2},present:true});
 assert.equal(visibleResearchReport(state.reports[0],state.hiddenColumns).table.columns.length,2);
 for(const column of columns.slice(0,2))state=researchVisualReducer(state,{type:'hideColumn',column});
 assert.equal(visibleResearchReport(state.reports[0],state.hiddenColumns).table.columns.length,0);
 state=researchVisualReducer(state,{type:'restoreColumns'});
 assert.equal(visibleResearchReport(state.reports[0],state.hiddenColumns).table.columns.length,3);
 assert.deepEqual(researchVisualReducer(state,{type:'reset'}),emptyResearchVisual);
});

for(const language of ['en','es'])test(`${language}: a requested program column does not create an extra empty campus column`,()=>{
 const es=language==='es',program=es?'Iniciativa de Primera Generación':'First-Generation Initiative';
 const question=es?`¿Cuál es el correo de contacto de la ${program} de Eastview College?`:`What is the contact email for the ${program} at Eastview College?`;
 for(const variant of ['matching','different_campus','different_program','unrequested_program','missing_program_scope']){
  const evidence=publicRecord('student_support',language);evidence.scope.program=variant==='missing_program_scope'?null:program;
  const subject=(variant==='different_campus'?'Pine Valley College':'Eastview College')+' '+(variant==='different_program'?'Other Program':program);
  const request=variant==='unrequested_program'?(es?'¿Cuál es el contacto de Eastview College?':'What is the contact for Eastview College?'):question;
  const item={id:variant,language,pending:false,updatedAt:1,researchTask:{question:request,entities:['Eastview College']},
   table:{columns:[subject],rows:[{aspect:'other',cells:[{scope:subject,answer:'Contact email is unverified.',qualification:'Could not verify the exact address.',status:'partial',evidence,sources:[]}]}]}};
  const state=researchVisualReducer(emptyResearchVisual,{type:'receive',report:item,present:true});
  const table=state.reports[0].table;
  assert.deepEqual(table.columns,variant==='matching'?[subject]:[subject,'Eastview College'],variant);
  if(variant!=='matching')assert.equal(table.rows[0].cells.at(-1),null,variant);
 }
});

for(const language of ['en','es'])test(`${language}: adding a college keeps the displayed columns stable and aligns each amount and caveat`,()=>{
 const berkeley={scope:'UC Berkeley',answer:'$49,692',qualification:'Published estimate; another source differs.',status:'partial',sources:[]};
 const davis={scope:'UC Davis',answer:'$44,760',qualification:'Planning estimate, not a bill.',status:'verified',sources:[]};
 const initial={id:'one',language,pending:false,updatedAt:1,table:{columns:['UC Berkeley'],rows:[{aspect:'total_budget',cells:[berkeley]}]}};
 const comparison={id:'two',language,pending:false,updatedAt:2,table:{columns:['UC Davis','UC Berkeley'],rows:[{aspect:'total_budget',cells:[davis,berkeley]}]}};
 const state=researchVisualReducer(researchVisualReducer(emptyResearchVisual,{type:'receive',report:initial,present:true}),{type:'receive',report:comparison,present:true});
 assert.equal(state.view,'two');
 assert.deepEqual(state.reports[0].table.columns,['UC Berkeley','UC Davis']);
 assert.deepEqual(state.reports[0].table.rows[0].cells,[berkeley,davis]);
 assert.deepEqual(comparison.table.columns,['UC Davis','UC Berkeley'],'input evidence ordering is unchanged');
 const revised={...comparison,updatedAt:3,table:{...comparison.table,rows:[{aspect:'total_budget',cells:[{...davis,answer:'$45,000'},berkeley]}]}};
 const updated=researchVisualReducer(state,{type:'receive',report:revised,present:true});
 assert.deepEqual(updated.reports[0].table.columns,['UC Berkeley','UC Davis']);
 assert.equal(updated.reports[0].table.rows[0].cells[0],berkeley);
 assert.equal(updated.reports[0].table.rows[0].cells[1].answer,'$45,000');
});

const cell=(school,answer,status='verified')=>({scope:`${school} — 2026–27 renting off campus`,answer,qualification:`${school}: published estimate, not a bill.`,status,sources:[{id:1,title:school,url:`https://${school}.example/costs`}]});
const report=(id,language,columns,totals,extra={})=>({id,language,pending:false,updatedAt:1,housingScenario:'renting',table:{columns,rows:[{aspect:'total_budget',cells:totals}]},...extra});
const receive=(state,value)=>researchVisualReducer(state,{type:'receive',report:value,present:true});

for(const language of ['en','es'])test(`${language}: an explicit campus addition retains a tuition-only reference even if the next lookup fails`,()=>{
 const berkeley=report('berkeley',language,['Berkeley'],[null],{housingScenario:'off_campus'});
 berkeley.table.rows.push({aspect:'tuition_fees',cells:[cell('Berkeley','$18,214','partial')]});
 const davis=report('davis',language,['Davis'],[null],{comparisonReferenceId:'berkeley'});
 davis.table.unverifiedTotals=['Davis'];
 const state=receive(receive(emptyResearchVisual,berkeley),davis),latest=state.reports[0];
 assert.deepEqual(latest.table.columns,['Berkeley','Davis']);
 assert.equal(latest.table.rows.find(row=>row.aspect==='tuition_fees').cells[0].answer,'$18,214');
 assert.deepEqual(latest.table.rows.find(row=>row.aspect==='total_budget').cells,[null,null]);
 assert.deepEqual(latest.table.unverifiedTotals,['Davis']);
});

for(const language of ['en','es'])test(`${language}: explicit comparison lineage retains a growing table, original sources, and unavailable new campuses`,()=>{
 const first=report('one',language,['Berkeley'],[cell('Berkeley','$49,692')]);
 first.table.rows.push({aspect:'tuition_fees',cells:[cell('Berkeley','$18,214')]});
 let state=receive(emptyResearchVisual,first);
 state=receive(state,report('two',language,['Davis'],[cell('Davis','$44,760')],{comparisonBaseId:'one'}));
 state=receive(state,report('three',language,['Irvine','Davis'],[null,cell('Davis','$44,760')],{comparisonBaseId:'two'}));
 const merced=report('four',language,['Merced'],[null],{comparisonBaseId:'three'});
 merced.table.unverifiedTotals=['Merced'];merced.table.unverifiedCells=[{column:'Merced',aspect:'total_budget'}];
 state=receive(state,merced);
 state=receive(state,report('five',language,['Riverside'],[cell('Riverside','$42,000')],{comparisonBaseId:'four'}));
 const latest=state.reports[0];
 assert.deepEqual(latest.table.columns,['Berkeley','Davis','Irvine','Merced','Riverside']);
 assert.deepEqual(latest.table.rows[0].cells.map(value=>value?.answer||null),['$49,692','$44,760',null,null,'$42,000']);
 assert.equal(latest.table.rows[0].cells[0],first.table.rows[0].cells[0],'source, scope and qualification are retained with each finding');
 assert.equal(latest.table.rows.find(row=>row.aspect==='tuition_fees').cells[0],first.table.rows[1].cells[0]);
 assert.deepEqual(latest.table.unverifiedTotals,['Merced']);
 assert.equal(state.view,'five');
 assert.deepEqual(first.table.columns,['Berkeley'],'prior history remains unchanged');
});

for(const language of ['en','es'])test(`${language}: fresh facts or explicit failures replace prior facts without reviving stale values`,()=>{
 const first=report('one',language,['Berkeley','Davis'],[cell('Berkeley','$49,692'),cell('Davis','$44,760')]);
 first.table.rows.push({aspect:'tuition_fees',cells:[cell('Berkeley','$18,214'),cell('Davis','$18,078')]});
 const update=report('two',language,['Berkeley','Davis'],[null,cell('Davis','$45,000','partial')],{comparisonBaseId:'one'});
 update.table.unverifiedTotals=['Berkeley'];
 update.table.unverifiedCells=[{column:'Berkeley',aspect:'total_budget'},{column:'Berkeley',aspect:'tuition_fees'}];
 const state=receive(receive(emptyResearchVisual,first),update),latest=state.reports[0];
 assert.equal(latest.table.rows[0].cells[0],null);
 assert.equal(latest.table.rows[0].cells[1].answer,'$45,000');
 assert.equal(latest.table.rows[0].cells[1].status,'partial');
 assert.equal(latest.table.rows.find(row=>row.aspect==='tuition_fees').cells[0],null);
 assert.equal(latest.table.rows.find(row=>row.aspect==='tuition_fees').cells[1].answer,'$18,078');
 const recovered=report('three',language,['Berkeley'],[cell('Berkeley','$50,000')],{comparisonBaseId:'two'});
 const final=receive(state,recovered).reports[0];
 assert.deepEqual(final.table.unverifiedTotals,[]);
 assert.equal(final.table.rows[0].cells[0].answer,'$50,000');
});

test('unrelated reports, scenario changes, and cleared student state do not inherit comparison history',()=>{
 const initial=receive(emptyResearchVisual,report('one','en',['Berkeley'],[cell('Berkeley','$49,692')]));
 for(const next of [
  report('two','en',['Davis'],[cell('Davis','$44,760')]),
  report('two','en',['Davis'],[cell('Davis','$44,760')],{comparisonBaseId:'missing'}),
  report('two','en',['Davis'],[cell('Davis','$44,760')],{comparisonBaseId:'one',housingScenario:'with_family'}),
 ])assert.deepEqual(receive(initial,next).reports[0].table.columns,['Davis']);
 const cleared=researchVisualReducer(initial,{type:'reset'});
 assert.deepEqual(receive(cleared,report('two','en',['Davis'],[cell('Davis','$44,760')],{comparisonBaseId:'one'})).reports[0].table.columns,['Davis']);
});

for(const language of ['en','es'])test(`${language}: a task keeps requested programs visible independently of lookup success`,()=>{
 const initial={id:'programs',language,pending:true,updatedAt:1,researchTask:{entities:['Nursing program','Design program']},
  table:{columns:['Nursing program'],rows:[{aspect:'other',cells:[{scope:'Nursing program — fall 2027',answer:'Two years',qualification:'Full time only.',status:'verified',sources:[]}]}]}};
 const state=receive(emptyResearchVisual,initial);
 assert.deepEqual(state.reports[0].table.columns,['Nursing program','Design program']);
 assert.equal(state.reports[0].table.rows[0].cells[1],null);
 assert.equal(state.reports[0].table.rows[0].cells[0].answer,'Two years');
 assert.deepEqual(initial.table.columns,['Nursing program']);
});
