import type {ResearchRecord} from './researchRecord.mjs';
import {validatedBudget} from './publishedBudget.mjs';
import {researchFindingMatchesTaskEntity} from './researchTask.mjs';
export type ComparisonCell={scope:string;answer:string;qualification:string;status?:string;evidence?:ResearchRecord;budget?:NonNullable<ReturnType<typeof validatedBudget>>;sources:{id:number;title:string;url:string}[]};
export type VisualResearchReport={
  id:string;language:'en'|'es';pending:boolean;updatedAt:number;receivedAt?:number;
  researchTask?:{entities:string[];question?:string};
  // Server-validated lineage for a compatible addition to an existing table.
  // It is deliberately absent for unrelated requests and scenario changes.
  comparisonBaseId?:string;
  // Explicitly requested campus addition. Each column retains its own scope.
  comparisonReferenceId?:string;
  housingScenario?:'off_campus'|'renting'|'with_family';
  housingBenchmark?:boolean;
  scopeNote?:string;
  confirmedHousingChoice?:'renting'|'with_family';
  compareHousing?:boolean;
  table:{columns:string[];rows:{aspect:string;cells:(ComparisonCell|null)[]}[];unverifiedTotals?:string[];unverifiedCells?:{column:string;aspect:string}[]};
};
export type ResearchVisualState={reports:VisualResearchReport[];view:string|null;automatic:boolean;selectedHousing?:'renting'|'with_family';hiddenColumns?:string[];minimized?:boolean;updatedWhileMinimized?:boolean};
export type ResearchVisualAction=
  |{type:'reset'|'history'|'minimize'|'reopen'}
  |{type:'select';id:string}
  |{type:'hideColumn';column:string}
  |{type:'restoreColumns'}
  |{type:'receive';report:VisualResearchReport;present:boolean};

export const emptyResearchVisual:ResearchVisualState={reports:[],view:null,automatic:false};
export const historyView='history';

// Presentation-only: keep the retained report and source evidence unchanged.
export function visibleResearchReport(report:VisualResearchReport|undefined,hidden:string[]=[]){
 if(!report||!hidden.length)return report;
 const keep=report.table.columns.map((_,i)=>i).filter(i=>!hidden.includes(report.table.columns[i]));
 return {...report,table:{...report.table,columns:keep.map(i=>report.table.columns[i]),
  rows:report.table.rows.map(row=>({...row,cells:keep.map(i=>row.cells[i])})),
  unverifiedTotals:report.table.unverifiedTotals?.filter(column=>!hidden.includes(column)),
  unverifiedCells:report.table.unverifiedCells?.filter(cell=>!hidden.includes(cell.column))}};
}

// Requested options belong to the task, not just its successful lookups. A
// failed or partial result keeps an empty column; it never invents a value or
// restores a fact from another scenario merely to fill the table.
function withRequestedEntities(report:VisualResearchReport):VisualResearchReport{
  const missing=(report.researchTask?.entities||[]).filter(entity=>
    !report.table.columns.some((column,index)=>researchFindingMatchesTaskEntity(report.researchTask||{},entity,{subject:column})||
      report.table.rows.some(row=>row.cells[index]?.evidence&&researchFindingMatchesTaskEntity(report.researchTask||{},entity,
        {subject:column,evidence:row.cells[index]?.evidence}))));
  if(!missing.length)return report;
  return {...report,table:{...report.table,columns:[...report.table.columns,...missing],
    rows:report.table.rows.map(row=>({...row,cells:[...row.cells,...missing.map(()=>null)]}))}};
}

function extendComparison(base:VisualResearchReport,report:VisualResearchReport):VisualResearchReport{
  const columns=[...base.table.columns,...report.table.columns.filter(column=>!base.table.columns.includes(column))];
  const aspects=[...base.table.rows.map(row=>row.aspect),...report.table.rows.map(row=>row.aspect).filter(aspect=>!base.table.rows.some(row=>row.aspect===aspect))];
  const explicitlyUnverified=(column:string,aspect:string)=>report.table.unverifiedCells?.some(cell=>cell.column===column&&cell.aspect===aspect)||
    aspect==='total_budget'&&report.table.unverifiedTotals?.includes(column);
  const rows=aspects.map(aspect=>({aspect,cells:columns.map(column=>{
    const index=report.table.columns.indexOf(column),previousIndex=base.table.columns.indexOf(column);
    const incoming=index<0?null:report.table.rows.find(row=>row.aspect===aspect)?.cells[index];
    if(explicitlyUnverified(column,aspect))return null;
    return incoming||base.table.rows.find(row=>row.aspect===aspect)?.cells[previousIndex]||null;
  })}));
  const unverifiedCells=[...(base.table.unverifiedCells||[]),...(report.table.unverifiedCells||[])].filter((cell,index,all)=>
    !rows.find(row=>row.aspect===cell.aspect)?.cells[columns.indexOf(cell.column)]&&
    all.findIndex(other=>other.column===cell.column&&other.aspect===cell.aspect)===index);
  const unverifiedTotals=[...new Set([...(base.table.unverifiedTotals||[]),...(report.table.unverifiedTotals||[])])].filter(column=>
    !rows.find(row=>row.aspect==='total_budget')?.cells[columns.indexOf(column)]);
  return {...report,table:{...report.table,columns,rows,unverifiedCells,unverifiedTotals}};
}

export function researchVisualReducer(state:ResearchVisualState,action:ResearchVisualAction):ResearchVisualState{
  switch(action.type){
    case 'reset':return emptyResearchVisual;
    case 'minimize':return {...state,minimized:true,updatedWhileMinimized:false};
    case 'reopen':return {...state,minimized:false,updatedWhileMinimized:false};
    case 'hideColumn':return {...state,hiddenColumns:[...new Set([...(state.hiddenColumns||[]),action.column])]};
    case 'restoreColumns':return {...state,hiddenColumns:[]};
    case 'history':return {...state,view:historyView,automatic:false};
    case 'select':return {...state,view:action.id,automatic:false};
    case 'receive':{
      const {present}=action;
      let report=withRequestedEntities(action.report);
      const reference=report.comparisonReferenceId&&state.reports.find(item=>item.id===report.comparisonReferenceId);
      if(reference)report=extendComparison(reference,report);
      const base=report.comparisonBaseId&&state.reports.find(item=>item.id===report.comparisonBaseId);
      if(base&&(!base.housingScenario||!report.housingScenario||base.housingScenario===report.housingScenario)){
        report=extendComparison(base,report);
      }
      const selectedHousing=report.compareHousing?undefined:report.confirmedHousingChoice||state.selectedHousing;
      if(selectedHousing){
        const keep=report.table.columns.map((_,index)=>index).filter(index=>!report.table.rows.some(row=>{
          const housing=row.cells[index]?.budget?.housing;
          return housing&&(selectedHousing==='renting'?housing==='with_family':['renting','off_campus'].includes(housing));
        }));
        if(keep.length)report={...report,table:{...report.table,columns:keep.map(i=>report.table.columns[i]),rows:report.table.rows.map(row=>({...row,cells:keep.map(i=>row.cells[i])}))}};
      }
      const prior=state.reports.find(item=>item.id===state.view)||state.reports[0];
      if(prior){
        const incoming=report.table.columns;
        const columns=[...prior.table.columns.filter(column=>incoming.includes(column)),...incoming.filter(column=>!prior.table.columns.includes(column))];
        if(columns.some((column,index)=>column!==incoming[index])){
          report={...report,table:{...report.table,columns,rows:report.table.rows.map(row=>({...row,cells:columns.map(column=>row.cells[incoming.indexOf(column)])}))}};
        }
      }
      const alreadySaved=state.reports.some(item=>item.id===report.id);
      const archived=report.confirmedHousingChoice&&!state.selectedHousing&&state.reports.find(item=>item.id===report.id);
      const reports=[...(archived?[{...archived,id:archived.id+':housing-options'}]:[]),...(alreadySaved?state.reports.map(item=>item.id===report.id?report:item):[report,...state.reports])];
      const viewed=state.reports.find(item=>item.id===state.view);
      const extendsViewed=!!viewed&&report.table.columns.length>viewed.table.columns.length&&
        viewed.table.columns.every(column=>report.table.columns.includes(column));
      const open=present&&(!state.view||state.automatic||extendsViewed);
      const previousReport=state.reports.find(item=>item.id===report.id);
      const changed=!previousReport||JSON.stringify(previousReport.table)!==JSON.stringify(report.table);
      return {...state,reports,selectedHousing,view:open?report.id:state.view,automatic:open||state.automatic,
        updatedWhileMinimized:state.updatedWhileMinimized||!!state.minimized&&changed};
    }
  }
}
