import {researchDetailRows} from './researchDetailRows';
import {researchScopeLabel} from './researchRecord.mjs';
import {createPortal} from 'react-dom';
import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {animate,stagger} from 'animejs';
import {ArrowLeft,ChevronRight,GripHorizontal,History,Info,Minus,Table2,X} from 'lucide-react';
import {publishedCostHousing,researchCostRows} from './researchCostRows';
import './VoiceVisualCard.css';

import {historyView,visibleResearchReport,type ComparisonCell,type VisualResearchReport,type ResearchVisualState,type ResearchVisualAction} from './researchVisualState';
export {researchVisualReducer,emptyResearchVisual} from './researchVisualState';
export type {VisualResearchReport} from './researchVisualState';

const rowLabels:Record<string,[string,string]>={
  tuition_fees:['Tuition and fees','Matrícula y cuotas'],
  total_budget:['Estimated total cost','Costo total estimado'],
  housing:['Housing','Alojamiento'],
  housing_and_food:['Housing and food','Alojamiento y alimentación'],
  deadline:['Deadlines','Fechas límite'],
  eligibility:['Eligibility','Requisitos de elegibilidad'],
  other:['Published details','Detalles publicados'],
  direct_costs:['Direct university charges','Cargos directos de la universidad'],
  meals:['Meal plan','Plan de comidas'],
  food:['Food allowance','Presupuesto de alimentación'],
  books:['Books and supplies','Libros y materiales'],
  transportation:['Transportation','Transporte'],
  personal:['Personal expenses','Gastos personales'],
  health_insurance:['Health insurance','Seguro médico'],
  document_fee:['Document fee','Cuota de documentación'],
  residence_hall_total:['Residence hall total','Total en residencia universitaria'],
  campus_apartment_total:['Campus apartment total','Total en apartamento universitario'],
  off_campus_apartment_total:['Off-campus apartment total','Total en apartamento fuera del campus'],
  off_campus_without_family_total:['Off campus, without parents','Fuera del campus, sin los padres'],
  with_family_total:['Living with family total','Total viviendo con familiares'],
  other_expenses:['Other estimated expenses','Otros gastos estimados'],
};
const easing='cubic-bezier(.22,.74,.25,1)';

function reportScopes(report:VisualResearchReport){
  return [...new Set(report.table.rows.flatMap(row=>row.cells.flatMap((cell,index)=>{
    const prefix=report.table.columns[index]+' — ';
    return cell?.scope.startsWith(prefix)?[cell.scope.slice(prefix.length)]:[];
  })))].join(' · ');
}

const withoutCitations=(text:string)=>text.replace(/\s*\[\d+\]/gu,'').trim();
const sharedText=(values:string[])=>values.length&&values.every(value=>value===values[0])?values[0]:'';
const displayAmount=(value:string)=>value.replace(/^US\$/u,'$');
const money=/^(?:USD\s*)?\$\s*\d(?:[\d,.]*\d)?(?:\s*(?:USD|CAD))?$/u;

function cellScope(cell:ComparisonCell,column:string,spanish=false){
  if(cell.budget){const period={academic_year:['Academic year','Año académico'],calendar_year:['Calendar year','Año calendario'],semester:['Semester','Semestre'],quarter:['Quarter','Trimestre'],month:['Month','Mes']}[cell.budget.period][spanish?1:0];return [cell.budget.year,cell.budget.population,period,cell.budget.currency].join(' · ');}
  if(cell.evidence)return researchScopeLabel(cell.evidence,spanish?'es':'en');
  if(cell.scope===column)return '';
  const prefix=[column+' — ',column+': '].find(prefix=>cell.scope.startsWith(prefix));
  return prefix?cell.scope.slice(prefix.length):cell.scope;
}

function cellValue(cell:ComparisonCell,column:string){
  let value=withoutCitations(cell.answer);
  for(const label of [cell.scope,column]){
    if(value.startsWith(label)){
      const rest=value.slice(label.length);
      if(/^\s*[:—–]/u.test(rest)){value=rest.replace(/^\s*[:—–]\s*/u,'');break;}
    }
  }
  if(money.test(value.replace(/\.$/u,'')))return {value:value.replace(/\.$/u,''),context:'',numeric:true};
  const separator=value.lastIndexOf(':');
  const tail=value.slice(separator+1).trim().replace(/\.$/u,'');
  if(separator>0&&money.test(tail))return {value:tail,context:value.slice(0,separator).trim(),numeric:true};
  return {value,context:'',numeric:false};
}

export function VoiceVisualCard({state,dispatch,language,onPresented}:{state:ResearchVisualState;dispatch:(action:ResearchVisualAction)=>void;language:'en'|'es';onPresented?:(details:Record<string,unknown>)=>void}){
  const {view,reports}=state;
  const [offset,setOffset]=useState({x:0,y:0});
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number;width:number;height:number;bottom:number;offsetX:number;offsetY:number}|null>(null);
  const panel=useRef<HTMLElement>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const reopenButton=useRef<HTMLButtonElement>(null);
  const moveFocus=useRef(false);
  const previous=useRef<{view:string;offsetX:number;offsetY:number;cells:Map<string,{left:number;top:number;content:string}>}|null>(null);
  const sourceReport=reports.find(item=>item.id===view);
  const report=useMemo(()=>visibleResearchReport(sourceReport,state.hiddenColumns),[sourceReport,state.hiddenColumns]);
  const presentedSource=useRef<VisualResearchReport|undefined>(undefined);
  const spanish=language==='es';
  const t=(en:string,es:string)=>spanish?es:en;
  const history=view===historyView;
  const tableLanguage=report?.language==='es'?1:0;
  const columns=report?.table.columns||[];
  const wideComparison=columns.length>2;
  const labelWidth=wideComparison?15/(15+13*columns.length)*100:columns.length===1?62:34;
  const originalRows=report?.table.rows||[];
  const parsedCostRows=researchCostRows(originalRows,columns.length,report?.housingScenario);
  const totals=originalRows.find(row=>row.aspect==='total_budget')?.cells||[];
  const costRows=parsedCostRows&&originalRows.some(row=>row.aspect==='total_budget')&&!parsedCostRows.some(row=>row.id==='total_budget')
    ? [...parsedCostRows,{id:'total_budget',aspect:'total_budget',cells:columns.map(()=>null)}]
    : parsedCostRows;
  const rows=researchDetailRows(costRows?.length?originalRows.filter(row=>!['total_budget','housing','tuition_fees'].includes(row.aspect)||row.cells.some(cell=>cell?.evidence)):originalRows,report?.language||'en');
  const title=history?t('Table history','Historial de tablas'):costRows?t('Cost estimate','Costo estimado'):t('Research table','Tabla de investigación');
  const displayedTotals=costRows?.find(row=>row.id==='total_budget')?.cells.flatMap(cell=>cell?.evidence?[cell.evidence]:[])||[];
  const beforeAid=displayedTotals.length>0&&displayedTotals.every(cell=>/\b(?:before (?:financial )?aid|antes de (?:la )?ayuda)\b/iu.test(cell.answer));
  const includedLabel=tableLanguage?'incluido en los cargos directos':'included in direct charges';
  const baseScopes=columns.map((column,index)=>{
    const total=totals[index];
    if(costRows&&total)return cellScope(total,column,!!tableLanguage);
    return sharedText(rows.flatMap(row=>{
      const cell=row.cells[index];
      return cell?[cellScope(cell,column,!!tableLanguage)]:[];
    }));
  });
  const scopes=baseScopes.map((scope,index)=>{
    const answer=totals[index]?.answer||'';
    const publishedHousing=publishedCostHousing(answer,scope);
    const housingLabel=publishedHousing&&{
      renting:tableLanguage?'Alquiler fuera del campus':'Renting off campus',
      with_family:tableLanguage?'Viviendo con familiares':'Living with family',
      off_campus:tableLanguage?'Fuera del campus':'Off campus',
    }[publishedHousing];
    if(housingLabel)return [scope,housingLabel].filter(Boolean).join(' · ');
    if(costRows?.some(row=>row.aspect==='total_budget'&&row.id.endsWith('_total')&&row.cells[index])||
      !/\b(?:residence[- ]halls?|residencias universitarias)\b/iu.test(answer+' '+scope)||
      /\b(?:residence[- ]halls?|residencias universitarias)\b/iu.test(scope))return scope;
    return [scope,tableLanguage?'Residencias universitarias':'Residence halls'].filter(Boolean).join(' · ');
  });
  const tableScope=sharedText(scopes);
  const hasGaps=rows.some(row=>row.cells.some(cell=>!cell));

  useLayoutEffect(()=>{
    if(!report||!panel.current)return;
    const rect=panel.current.getBoundingClientRect();
    const displayed=costRows||rows;
    const visibilityOnly=presentedSource.current===sourceReport;
    presentedSource.current=sourceReport;
    onPresented?.({jobId:report.id,updatedAt:report.updatedAt,receivedAt:report.receivedAt,columnCount:columns.length,rowCount:displayed.length,
      populatedCells:displayed.reduce((sum,row)=>sum+row.cells.filter(Boolean).length,0),
      ...(visibilityOnly?{presentationReason:'column_visibility'}:report.receivedAt?{durationMs:Math.max(0,Date.now()-report.receivedAt)}:{}),evidenceKind:'dom_committed',visible:rect.width>0&&rect.height>0});
  },[report,state.minimized]);

  useLayoutEffect(()=>{
    if(state.minimized)reopenButton.current?.focus({preventScroll:true});
  },[state.minimized]);

  useLayoutEffect(()=>{
    const node=panel.current;
    if(!node||!view)return;
    let frame=0;
    const fit=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const bounds=node.getBoundingClientRect();
        const viewport=window.visualViewport;
        const left=(viewport?.offsetLeft||0)+8,top=(viewport?.offsetTop||0)+8;
        const right=left+(viewport?.width||window.innerWidth)-16;
        const bottom=top+(viewport?.height||window.innerHeight)-16;
        const dx=bounds.left<left?left-bounds.left:bounds.right>right?right-bounds.right:0;
        const dy=bounds.top<top?top-bounds.top:bounds.bottom>bottom?bottom-bounds.bottom:0;
        if(Math.abs(dx)>.5||Math.abs(dy)>.5)setOffset(current=>({x:current.x+dx,y:current.y+dy}));
      });
    };
    const observer=new ResizeObserver(fit);
    observer.observe(node);window.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('scroll',fit);
    fit();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',fit);
      window.visualViewport?.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('scroll',fit);};
  },[view,state.minimized]);

  useLayoutEffect(()=>{
    const node=panel.current;
    if(!node||!view){previous.current=null;return;}
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    if(moveFocus.current){moveFocus.current=false;heading.current?.focus({preventScroll:true});}
    const prior=previous.current;
    const parts=Array.from(node.querySelectorAll<HTMLElement>('[data-motion-key]'));
    const cells=new Map(parts.map(part=>{
      const bounds=part.getBoundingClientRect();
      return [part.dataset.motionKey!,{left:bounds.left,top:bounds.top,content:part.textContent||''}];
    }));
    previous.current={view,cells,offsetX:offset.x,offsetY:offset.y};
    if(media.matches||history||prior?.view===historyView)return;
    const animations:Animation[]=[];
    if(!prior&&typeof node.animate==='function'){
      animations.push(node.animate([
        {opacity:.62,transform:'translateY(10px) scale(.94)'},
        {opacity:1,transform:'translateY(-1px) scale(1.008)',offset:.74},
        {opacity:1,transform:'none'},
      ],{duration:440,easing}));
    }
    const arrivals:HTMLElement[]=[],highlights:HTMLElement[]=[];
    parts.forEach(part=>{
      const key=part.dataset.motionKey!,before=prior?.cells.get(key),after=cells.get(key)!;
      if(!before){
        arrivals.push(part.querySelector<HTMLElement>('.origen-research-value')||part);
        if(prior&&part.matches('td'))highlights.push(part);
        return;
      }
      const x=before.left+offset.x-prior!.offsetX-after.left,y=before.top+offset.y-prior!.offsetY-after.top;
      if((x||y)&&typeof part.animate==='function')animations.push(part.animate([{transform:`translate(${x}px,${y}px)`},{transform:'none'}],{duration:330,easing}));
      if(before.content!==after.content){
        arrivals.push(part.querySelector<HTMLElement>('.origen-research-value')||part);
        if(part.matches('td'))highlights.push(part);
      }
    });
    const writing=arrivals.length?animate(arrivals,{
      opacity:[.55,1],translateY:['.22em','0em'],duration:560,
      delay:stagger(Math.min(30,150/arrivals.length)),ease:'outCubic',
    }):null;
    const glow=[true,false].flatMap(tuition=>{const targets=highlights.filter(element=>!!element.closest('.origen-research-cost-tuition')===tuition);return targets.length?[animate(targets,{backgroundColor:['#e9f1e7',tuition?'#f5f0e5':'#fff'],duration:1150,ease:'outCubic'})]:[];});
    const stop=()=>{if(media.matches){writing?.complete();glow.forEach(animation=>animation.complete());animations.forEach(animation=>animation.finish());}};
    media.addEventListener('change',stop);
    return ()=>{writing?.revert();glow.forEach(animation=>animation.revert());animations.forEach(animation=>animation.cancel());media.removeEventListener('change',stop);};
  },[view,report,history,state.minimized]);

  function navigate(action:ResearchVisualAction){moveFocus.current=true;dispatch(action);}
  function panelBounds(){
    const node=panel.current;
    if(!node)return null;
    const {left,top,width,height}=node.getBoundingClientRect();
    return {left,top,width,height,bottom:parseFloat(getComputedStyle(node).bottom)||16,offsetX:offset.x,offsetY:offset.y};
  }
  function movePanel(bounds:NonNullable<ReturnType<typeof panelBounds>>,dx:number,dy:number){
    const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(min,max),Math.max(min,value));
    setOffset({
      x:bounds.offsetX+clamp(dx,8-bounds.left,window.innerWidth-8-bounds.left-bounds.width),
      y:bounds.offsetY+clamp(dy,8-bounds.top,window.innerHeight-bounds.bottom-bounds.top-bounds.height),
    });
  }
  if(!view||!history&&!report)return null;
  if(state.minimized)return createPortal(<button ref={reopenButton} type="button" className="origen-research-pill"
    aria-label={t('Open research table','Abrir tabla de investigación')} onClick={()=>navigate({type:'reopen'})}>
    <Table2 size={17} aria-hidden="true"/>
    <span>{costRows?t('Cost comparison','Comparación de costos'):t('Research table','Tabla de investigación')}</span>
    {state.updatedWhileMinimized&&<small>{t('Updated','Actualizada')}</small>}
    <ChevronRight size={15} aria-hidden="true"/>
  </button>,document.body);
  return createPortal(<aside ref={panel}
      className={['origen-research-panel',costRows&&columns.length===1?'origen-research-panel--single-cost':'',columns.length>=4?'origen-research-panel--wide-comparison':''].filter(Boolean).join(' ')} aria-label={title} lang={language}
      style={{translate:`${offset.x}px ${offset.y}px`}}>
      <header className="origen-research-heading" onPointerDown={event=>{
        if(event.button!==0||(event.target as Element).closest('button:not(.origen-research-grip)'))return;
        const bounds=panelBounds();
        if(!bounds)return;
        drag.current={...bounds,id:event.pointerId,x:event.clientX,y:event.clientY};
        const grip=(event.target as Element).closest('.origen-research-grip');
        (grip||event.currentTarget).setPointerCapture(event.pointerId);
      }} onPointerMove={event=>{
        const active=drag.current;
        if(active?.id===event.pointerId)movePanel(active,event.clientX-active.x,event.clientY-active.y);
      }} onLostPointerCapture={()=>{drag.current=null;}}>
        <Table2 size={17} aria-hidden="true"/>
        <h3 ref={heading} tabIndex={-1}>{title}</h3>
        {!history&&tableScope&&<span className="origen-research-scope" lang={report?.language}>{tableScope}</span>}
        <div className="origen-research-tools">
          <button type="button" aria-label={t('Minimize table','Minimizar tabla')} title={t('Minimize table','Minimizar tabla')}
            onClick={()=>dispatch({type:'minimize'})}><Minus size={17} aria-hidden="true"/></button>
          {!!state.hiddenColumns?.length&&<button type="button" onClick={()=>navigate({type:'restoreColumns'})}>
            {t('Restore columns','Restaurar columnas')} <span>{state.hiddenColumns.length}</span>
          </button>}
          <button type="button" className="origen-research-grip" aria-label={t('Move table with arrow keys','Mueve la tabla con las flechas')}
            title={t('Drag to move. Double-click to center.','Arrastra para mover. Haz doble clic para centrar.')}
            onDoubleClick={()=>setOffset({x:0,y:0})} onKeyDown={event=>{
              const arrows:Record<string,[number,number]>={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]};
              const delta=arrows[event.key],bounds=panelBounds();
              if(delta&&bounds){event.preventDefault();movePanel(bounds,...delta);}
            }}>
            <GripHorizontal size={18} aria-hidden="true"/>
          </button>
          {history?<button type="button" onClick={()=>navigate({type:'select',id:reports[0].id})}>
            <ArrowLeft size={15} aria-hidden="true"/>{t('Latest','Más reciente')}
          </button>:reports.length>1&&<button type="button" onClick={()=>navigate({type:'history'})}>
            <History size={15} aria-hidden="true"/>{t('History','Historial')} <span>{reports.length}</span>
          </button>}
        </div>
      </header>
      {history?<ol className="origen-research-history">
        {reports.map(item=><li key={item.id}>
          <button type="button" data-motion-key={item.id} onClick={()=>navigate({type:'select',id:item.id})}>
            <span><strong>{item.table.columns.join(' · ')}</strong>
              <small>{[...item.table.rows.map(row=>(rowLabels[row.aspect]||rowLabels.other)[spanish?1:0]),reportScopes(item)].filter(Boolean).join(' · ')}</small>
            </span>
            <time dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat(language,{timeStyle:'short'}).format(item.updatedAt)}</time>
            <ChevronRight size={15} aria-hidden="true"/>
          </button>
        </li>)}
      </ol>:report&&<>
        <div className="origen-research-table-scroll" role="region" tabIndex={0} aria-label={title} lang={report.language}>
          {!columns.length&&<p className="origen-research-columns-hidden">{t('All columns are hidden. Restore columns to see the comparison.','Todas las columnas están ocultas. Restaura las columnas para ver la comparación.')}</p>}
          <table className={costRows?'origen-research-table origen-research-cost-table':'origen-research-table'}
            style={wideComparison?{minWidth:`${15+13*columns.length}rem`}:undefined}>
            {costRows&&<colgroup><col style={{width:`${labelWidth}%`}}/>{columns.map(column=><col key={column} style={{width:`${(100-labelWidth)/columns.length}%`}}/>)}</colgroup>}
            <thead><tr><th scope="col">{tableLanguage?'Dato':'Measure'}</th>
              {columns.map((column,index)=><th scope="col" key={column} className="origen-research-column-heading" data-motion-key={`column:${column}`}>
                <button type="button" className="origen-research-column-remove" aria-label={t(`Remove ${column} from table`,`Quitar ${column} de la tabla`)}
                  title={t('Remove from table','Quitar de la tabla')} onClick={()=>{moveFocus.current=true;dispatch({type:'hideColumn',column});}}>
                  <X size={13} aria-hidden="true"/>
                </button>{column}
                {!tableScope&&scopes[index]&&<small>{scopes[index]}</small>}
              </th>)}</tr></thead>
            <tbody>{costRows?.map(row=>{
              const included=row.cells.some(Boolean)&&row.cells.every(cell=>!cell||cell.included);
              const label=row.id==='total_budget'&&beforeAid
                ? (row.cells.some(cell=>cell?.evidence?.status==='partial')
                  ? (tableLanguage?'Total publicado antes de la ayuda':'Published total before aid')
                  : (tableLanguage?'Total estimado antes de la ayuda':'Estimated total before aid'))
                : rowLabels[row.id][tableLanguage];
              return <tr key={row.id} className={row.id==='total_budget'?'origen-research-cost-total':row.id==='tuition_fees'?'origen-research-cost-tuition':included?'origen-research-cost-included':undefined}>
                <th scope="row" data-motion-key={`row:${row.id}`}>{label}{included&&<small>{includedLabel}</small>}</th>
                {row.cells.map((cell,index)=>{
                  const column=columns[index];
                  const evidence=cell?.evidence;
                  const scope=evidence&&cellScope(evidence,column,!!tableLanguage);
                  const year=scope?.match(/\b20\d{2}\s*[–—-]\s*(?:20)?\d{2}\b/u)?.[0];
                  return <td key={column} className="is-numeric" data-motion-key={JSON.stringify([row.id,column])}>
                    {cell?<><span className="origen-research-value">{displayAmount(cell.value)}</span>
                      {'derived' in cell&&cell.derived&&<small>{tableLanguage?'Suma de vivienda y alimentación':'Housing + food sum'}</small>}
                      {year&&!scopes[index].includes(year)&&<small>{year}</small>}
                      {'feeDetail' in cell&&cell.feeDetail&&<small>{cell.feeDetail.rounded
                        ?(tableLanguage?'presupuesto, redondeado':'budget, rounded')
                        :(tableLanguage?'importe del presupuesto':'budget amount')}</small>}
                      {cell.feeScheduleOnly&&<small>{tableLanguage?'Subtotal del tarifario':'Fee schedule subtotal'}</small>}
                      {!included&&cell.included&&<small>{includedLabel}</small>}
                      {evidence?.status==='partial'&&(row.id==='total_budget'||evidence!==totals[index])&&<small>{tableLanguage?'Consulta el alcance':'See scope'}</small>}
                      {!cell.included&&scope&&scope!==baseScopes[index]&&row.aspect==='housing'&&<small>{scope}</small>}
                    </>:<span className="origen-research-gap" aria-label={tableLanguage?'Sin importe en la tabla':'No amount shown'}>{row.id==='health_insurance'?(tableLanguage?'No se indica por separado':'Not reported separately'):'—'}</span>}
                  </td>;
                })}
              </tr>;
            })}{rows.map(row=>{
              const label=row.label||(rowLabels[row.aspect]||rowLabels.other)[tableLanguage];
              const notes=row.cells.flatMap(cell=>cell?[withoutCitations(cell.qualification)]:[]);
              const commonNote=notes.length>1?sharedText(notes):'';
              return <tr key={row.aspect}>
                <th scope="row" data-motion-key={`row:${row.aspect}`}>{label}{commonNote&&<small>{commonNote}</small>}</th>
                {row.cells.map((cell,index)=>{
                  const column=columns[index];
                  const answer=cell&&!(costRows&&!costRows.length&&['total_budget','housing','tuition_fees'].includes(row.aspect))?(cell.fact?{value:cell.answer,context:'',numeric:false}:cellValue(cell,column)):null;
                  const scope=cell&&cellScope(cell,column,!!tableLanguage);
                  const localScope=scope!==scopes[index]?scope:'';
                  return <td key={column} className={answer?.numeric?'is-numeric':undefined} data-motion-key={JSON.stringify([row.aspect,column])}>
                    {cell&&answer?<>
                      <div className="origen-research-value-line">
                        <span className="origen-research-value">{answer.value}</span>
                        {cell.fact?cell.sources.map(source=><a key={source.id} href={source.url} target="_blank" rel="noreferrer" title={source.title} aria-label={tableLanguage?`Fuente: ${source.title}`:`Source: ${source.title}`}>[{source.id}]</a>):<details className="origen-research-cell-details">
                          <summary title={tableLanguage?'Fuentes':'Sources'} aria-label={tableLanguage?`Fuentes: ${column}, ${label}`:`Sources: ${column}, ${label}`}>
                            <Info size={14} aria-hidden="true"/>
                          </summary>
                          <div className="origen-research-cell-details-body">
                            <ul>{cell.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title||(tableLanguage?'Fuente oficial':'Official source')}</a></li>)}</ul>
                          </div>
                        </details>}
                      </div>
                      {(localScope||answer.context)&&<small>{[localScope,answer.context].filter(Boolean).join(' · ')}</small>}
                      {!commonNote&&<small>{withoutCitations(cell.qualification)}</small>}
                    </>:<span className="origen-research-gap" aria-label={tableLanguage?'Sin verificar':'Unverified'}>—</span>}
                  </td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
        {costRows&&<footer className="origen-research-cost-notes" lang={report.language}>
          {report.scopeNote&&<p>{report.scopeNote}</p>}
          {!report.scopeNote&&report.housingBenchmark&&<p>{tableLanguage?'Referencia de alquiler. Falta confirmar dónde vivirá el estudiante.':'Rental benchmark. The student’s living arrangement is unconfirmed.'}</p>}
          {totals.some(Boolean)&&<p>{tableLanguage?'Estimado para planificar. Tu factura y tu ayuda pueden variar.':'Planning estimate. Your actual bill and aid can vary.'}</p>}
          {totals.some(cell=>cell?.status==='partial'&&/\b(?:conflict|discrepanc|do not reconcile|differ(?:s|ent published)|difieren|no coinciden|no concuerdan)\b/iu.test(cell.qualification))&&<p>{tableLanguage?'Las fuentes publicadas difieren. Revisa «¿Qué incluye?» para conocer los detalles.':'Published sources differ. See “What’s included?” for details.'}</p>}
          {!!report.table.unverifiedTotals?.length&&<p>
            {columns.length>1&&<>{report.table.unverifiedTotals.join(', ')} · </>}
            {report.pending?(tableLanguage?'El costo total de asistencia sigue sin verificarse.':'The total cost of attendance is unverified so far.'):
              (tableLanguage?'No pudimos verificar el costo total de asistencia.':'The total cost of attendance could not be verified.')}
          </p>}
          {report.housingScenario==='off_campus'&&totals.some(Boolean)&&!costRows.some(row=>row.aspect==='total_budget')&&
            <p>{tableLanguage?'El costo total depende de si alquilas o vives con familiares.':'The total depends on whether the student rents or lives with family.'}</p>}
          {!costRows.length&&<p>{tableLanguage?'Consulta los detalles de la investigación.':'See the research details below.'}</p>}
          {costRows.some(row=>row.cells.some(cell=>!cell))&&<p>{tableLanguage?'— Importe no mostrado':'— Amount not shown'}</p>}
          <details key={report.id}>
            <summary>{tableLanguage?'¿Qué incluye?':'What’s included?'}</summary>
            {columns.map((column,index)=><section key={column}>
              {columns.length>1&&<h4>{column}</h4>}
              {costRows.filter(row=>row.id==='tuition_fees').map(row=>{
                const cell=row.cells[index],detail=cell&&'feeDetail' in cell?cell.feeDetail:undefined;
                return detail&&<p key="fee-basis">{tableLanguage
                  ?`El presupuesto usa ${displayAmount(detail.budget)} para matrícula y cuotas; el tarifario indica ${displayAmount(detail.schedule)}. La diferencia es de ${detail.difference}${detail.rounded?' por el redondeo publicado de las cuotas':''}.`
                  :`The budget uses ${displayAmount(detail.budget)} for tuition and fees; the fee schedule lists ${displayAmount(detail.schedule)}. The difference is ${detail.difference}${detail.rounded?' from the published rounding of fees':''}.`}</p>;
              })}
              {originalRows.filter(row=>['total_budget','housing','tuition_fees'].includes(row.aspect)).map(row=>{
                const cell=row.cells[index];
                if(!cell)return null;
                const scope=cellScope(cell,column,!!tableLanguage);
                return <div key={row.aspect}>
                  <h5>{rowLabels[row.aspect][tableLanguage]}</h5>
                  {scope&&<p>{scope}</p>}
                  {!(row.aspect==='total_budget'&&report.housingScenario&&/\b(?:residence[- ]halls?|on[- ]campus apartment|residencias universitarias|apartamento en el campus)\b/iu.test(cell.answer)&&
                    /\b(?:off[- ]campus|fuera del campus)\b/iu.test(cell.answer))&&<p>{withoutCitations(cell.answer)}</p>}
                  <p>{withoutCitations(cell.qualification)}</p>
                  {cell.budget&&<ul>{cell.budget.components.filter(item=>item.role!=='component'||item.qualification).map(item=><li key={item.key}>{item.sourceLabel}: {item.amount===null?'—':new Intl.NumberFormat(language,{style:'currency',currency:cell.budget!.currency}).format(item.amount)} · {({subtotal:t('Subtotal','Subtotal'),excluded:t('Not included in total','No incluido en el total'),additional:t('Additional charge','Cargo adicional'),missing:t('Unverified','Sin verificar'),component:''})[item.role]} {item.qualification}</li>)}</ul>}
                  <ul>{cell.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title||(tableLanguage?'Fuente oficial':'Official source')}</a></li>)}</ul>
                </div>;
              })}
            </section>)}
          </details>
        </footer>}
        {(report.pending||hasGaps)&&<footer className="origen-research-footer">
          {report.pending&&<span className="origen-research-pending">{t('Checking more','Seguimos revisando')}</span>}
          {hasGaps&&<span>{t('— Unverified','— Sin verificar')}</span>}
        </footer>}
      </>}
    </aside>,document.body);
}
