// Inspect the saved projection, not merely the candidate JSON. Never sent to AI.
export function inspectCalibrationPipeline(example, state, {valid, priorItems, actual}) {
  const episodes = state.episodes;
  const checks = [];
  const safetyChecks = [];
  for (const episode of episodes) {
    if (episode.processingHolds?.length) checks.push({type:'unprocessed_source_blocks_certainty',episodeId:episode.id,
      pass:episode.analysisEligible===false && episode.reviewState==='needs-review'
        && episode.outcomeState==='unknown' && episode.actionState==='unknown'});
  }
  const priorSource = example.rubric.correctionCaseId ? `cal-${example.rubric.correctionCaseId}` : null;
  if (priorSource) {
    const targets = priorItems.filter(item=>item.sourceId===priorSource && item.kind==='outcome');
    checks.push({type:'correction_target_available',pass:targets.length>0});
    for (const target of targets) {
      const episode=episodes.find(episode=>episode.items.some(item=>item.id===target.id));
      const old=episode?.items.find(item=>item.id===target.id);
      const correction=actual?.items?.find(item=>item.corrects===target.id);
      checks.push({type:valid?'correction_replaces_prior_result':'failed_correction_blocks_prior_result',targetId:target.id,
        pass:valid ? !!correction && old?.state==='superseded' && episode?.outcomeState!=='positive'
          : episode?.outcomeState==='unknown' && episode?.analysisEligible===false});
      safetyChecks.push({type:'correction_leaves_no_trusted_old_success',targetId:target.id,
        pass:old?.state==='superseded' || episode?.outcomeState!=='positive' && episode?.analysisEligible===false});
    }
  }
  const wanted=example.rubric.pipelineExpected;
  if (wanted && valid) {
    const relevant=episodes.filter(episode=>episode.items.some(item=>item.sourceId===example.source.id && item.state==='current'));
    const statuses=new Set(relevant.map(episode=>episode.outcomeState).filter(Boolean));
    if(wanted.outcomeState)checks.push({type:'saved_outcome_matches_scenario',expected:wanted.outcomeState,
      pass:statuses.has(wanted.outcomeState) || wanted.outcomeState==='mixed' && statuses.has('positive') && ['pending','unsuccessful','unknown'].some(status=>statuses.has(status))});
    for(const sourceId of wanted.supersededSourceIds||[])checks.push({type:'retracted_source_stays_superseded',sourceId,
      // A correction retracts the specific result, not unrelated actions in its source.
      pass:episodes.flatMap(episode=>episode.items).some(item=>item.sourceId===sourceId && item.kind==='outcome')
        && !episodes.flatMap(episode=>episode.items).some(item=>item.sourceId===sourceId && item.kind==='outcome' && item.state==='current')});
    if(wanted.forbidsUnqualifiedPositive)checks.push({type:'partial_progress_not_unqualified_success',
      pass:statuses.size>0 && !(statuses.size===1 && statuses.has('positive'))});
  }
  const fulfilledCase = example.rubric.interpretationExpected?.fulfillsPendingCaseId;
  if (fulfilledCase) {
    const fulfilledSource = `cal-${fulfilledCase}`;
    const targets = priorItems.filter(item => item.sourceId === fulfilledSource && item.kind === 'outcome' && item.status === 'pending');
    checks.push({type:'pending_fulfillment_target_available',pass:targets.length>0});
    const allItems = new Map(episodes.flatMap(episode => episode.items).map(item => [item.id, item]));
    // Follow only explicit supported links, including a local positive result
    // linked to a new completed action which itself links to prior context.
    const linksToPriorSource = start => {
      const seen = new Set();
      let item = start;
      while (item?.linksTo && !seen.has(item.id)) {
        seen.add(item.id);
        item = allItems.get(item.linksTo);
        if (item?.sourceId === fulfilledSource) return true;
      }
      return false;
    };
    for (const target of targets) {
      const episode = episodes.find(episode => episode.items.some(item => item.id === target.id));
      const historical = episode?.items.find(item => item.id === target.id);
      const newItems = episode?.items.filter(item => item.sourceId === example.source.id && item.state === 'current') || [];
      checks.push({type:'fulfilled_pending_history_preserved',targetId:target.id,
        pass:historical?.state==='current' && historical.status==='pending'});
      checks.push({type:'fulfilled_pending_has_current_positive_result',targetId:target.id,
        pass:valid && episode?.outcomeState==='positive' && episode.analysisEligible!==false
          && newItems.some(item=>item.kind==='outcome' && item.status==='positive' && item.corrects===null)});
      checks.push({type:'fulfilled_pending_linked_to_prior_context',targetId:target.id,
        pass:valid && newItems.some(linksToPriorSource)});
    }
  }
  return {passed:checks.every(check=>check.pass),checks,safetyPassed:safetyChecks.every(check=>check.pass),safetyChecks,
    episodes:episodes.map(({id,episodeKey,questionState,actionState,outcomeState,reviewState,analysisEligible,processingHolds,correctionCoverageHolds,evidenceWarnings,items})=>({
      id,episodeKey,questionState,actionState,outcomeState,reviewState,analysisEligible,processingHolds,correctionCoverageHolds,evidenceWarnings,
      observations:items.map(({id,kind,status,state,linksTo,corrects})=>({id,kind,status,state,linksTo,corrects})),
    }))};
}
