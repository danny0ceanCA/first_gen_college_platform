// Phase 5 extension of the existing real-database binder/voice journey.
// All people, wording, provider transport and audio are synthetic.
const assert=require('node:assert/strict');
async function prepareLibrary(f,studentId,language){
 const {actionLibraryFixture}=await import('../server/fixtures/recommendation-library.mjs');
 const {createRecommendationDeliveryRepository}=await import('../server/recommendation-delivery.mjs');
 const library=await actionLibraryFixture(null,{base:f});await library.grant();
 const row=await library.create();assert.equal((await library.publish(row.id,1)).error,undefined);
 Object.assign(f.env,{ORIGEN_RECOMMENDATION_EVALUATION:'true'});
 const deliver=input=>f.as('other',()=>createRecommendationDeliveryRepository(f.db,f.env)('other',{studentId,...input}));
 const suggestion=await deliver({action:'select',request:{language,intent:'next_action',goal:'understand_requirement',process:'office_contact',focus:null,episodes:[],timeZone:'UTC'},answers:{document_requested:'unknown',document_prepared:'unknown',submission_reported:'unknown',decision_pending:'unknown'}});
 assert.equal(suggestion.status,'recommended');assert.equal(suggestion.source.teachingId,row.id);
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_receipts')).rows[0].n,0,'Evaluation is never inferred from ordinary selection.');
 await deliver({action:'cancel',id:suggestion.id});return {library,row};
}
async function acceptRecommendation({page,f,studentId,language,guidance,action,plans}){
 const t=(en,es)=>language==='es'?es:en;
 await page.locator('.personal-binder [data-topic=summary]').first().click();
 const evaluation=page.locator('.recommendation-evaluation');
 await evaluation.getByRole('button',{name:t('Optional recommendation evaluation','Evaluación opcional de recomendaciones'),exact:true}).click();
 await evaluation.getByRole('button',{name:t('Review recommendation permission','Revisar permiso de recomendaciones'),exact:true}).click();
 const allow=evaluation.getByRole('button',{name:t('Allow recommendation evaluation','Permitir evaluación de recomendaciones'),exact:true});assert.equal(await allow.isDisabled(),true);
 await evaluation.getByRole('checkbox').check();await allow.click();
 await evaluation.getByText(t('Future recommendations included while permission is current','Recomendaciones futuras incluidas mientras el permiso esté vigente'),{exact:true}).waitFor();
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_receipts')).rows[0].n,0,'Earlier library selection is not backfilled.');
 await page.getByRole('button',{name:new RegExp(t('^My requests','^Mis solicitudes'))}).click();
 const sheet=page.locator('.review-request-sheet');await sheet.getByText(guidance,{exact:true}).waitFor();
 const widget=sheet.locator('.recommendation-suggestion');
 await widget.getByRole('button',{name:t('Review a next step from this','Revisar un próximo paso a partir de esto'),exact:true}).click();
 const selection=page.waitForResponse(r=>r.url().endsWith('/api/recommendations')&&r.request().postDataJSON()?.action==='select');
 const displayed=page.waitForResponse(r=>r.url().endsWith('/api/recommendations')&&r.request().postDataJSON()?.action==='display');
 await widget.getByRole('button',{name:t('Review a suggestion','Revisar una sugerencia'),exact:true}).click();
 const accept=widget.getByRole('button',{name:t('Accept and save this step','Aceptar y guardar este paso'),exact:true});await accept.waitFor();assert.equal(await accept.isDisabled(),true);
 await widget.getByText(action,{exact:false}).waitFor();await widget.scrollIntoViewIfNeeded();
 // Display is recorded only when the actual suggestion is in the viewport.
 assert.equal((await displayed).status(),200);
 await widget.getByRole('checkbox').check();await accept.click();await widget.getByRole('status').filter({hasText:t('Saved privately','Guardado de forma privada')}).waitFor();
 const selected=await (await selection).json();assert.equal(selected.status,'recommended');
 const rows=(await plans()).plans;assert.equal(rows.length,1);const step=rows[0].steps[0];assert.equal(step.action,selected.action);assert.ok(step.recommendationSource);assert.ok(step.responseSource.source);
 const receipt=(await f.owner.query('SELECT * FROM origen_recommendation_evaluation_receipts')).rows;assert.equal(receipt.length,1);assert.ok(receipt[0].displayed_at);assert.ok(receipt[0].accepted_at);assert.equal(receipt[0].played_at,null);
 await page.getByRole('button',{name:t('Close requests','Cerrar solicitudes'),exact:true}).click();
 const topics=page.locator('.notebook-page-navigation').getByRole('button',{name:t('Topics','Temas'),exact:true});if(await topics.isVisible())await topics.click();
 return {target:{planId:rows[0].id,stepId:step.id},action:step.action};
}
async function evaluationSnapshot(f){
 const {runAsCoordinatorActor}=await import('../server/account-isolation.mjs');
 return f.as('staff',()=>runAsCoordinatorActor('staff',{issuedAt:Math.floor(Date.now()/1000)},async()=>(await f.db.query('SELECT origen_recommendation_evaluation_report($1::jsonb) AS result',[JSON.stringify({action:'load',purpose:'recommendation_evaluation',contractVersion:1,organizationId:f.org,enabled:true})])).rows[0].result));
}
async function verifyLinkedOutcome(f,record){
 const coordinator=(await f.owner.query("SELECT id FROM origen_coordinator_profiles WHERE institution_id=$1 AND auth0_subject='staff'",[f.org])).rows[0].id;
 await f.owner.query("SELECT origen_recommendation_evaluation_grant($1,$2,clock_timestamp()+interval '30 days')",[f.org,coordinator]);
 // Put this synthetic selection in the fixed previous-month cohort. The real
 // report contract deliberately has no arbitrary date-range parameters.
 await f.owner.query("UPDATE origen_recommendation_evaluation_permissions SET started_at=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '10 days'");
 await f.owner.query("UPDATE origen_recommendation_evaluation_receipts SET created_at=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')-interval '2 days'");
 const links=(await f.owner.query('SELECT * FROM origen_outcome_recommendation_links')).rows;assert.equal(links.length,1);assert.equal(links[0].episode_id,record.episode.id);
 const bundle=await evaluationSnapshot(f);assert.equal(bundle.items.length,1);assert.equal(bundle.items[0].outcomes.length,1);assert.doesNotMatch(JSON.stringify(bundle.items),/PRIVATE_|employer|empleador|insurance|seguro/);assert.equal(JSON.stringify(bundle).includes(record.report.detail),false);
}
async function verifyCorrectionAndWithdrawal({page,f,language,plans}){
 const t=(en,es)=>language==='es'?es:en;
 const bundle=await evaluationSnapshot(f);assert.equal(bundle.items.length,1);assert.equal(bundle.items[0].outcomes.length,0,'A corrected private report cannot contribute its stale outcome.');
 const report=await f.call('staff','/api/recommendation-evaluation-report',{action:'report',purpose:'recommendation_evaluation',contractVersion:1,organizationId:f.org});
 assert.equal(report.status,'suppressed');assert.equal(report.participants,null);assert.equal(report.selections,null);
 const before=await plans();f.env.ORIGEN_RECOMMENDATION_EVALUATION='false';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 const topics=page.locator('.notebook-page-navigation').getByRole('button',{name:t('Topics','Temas'),exact:true});if(await topics.isVisible())await topics.click();
 await page.locator('.personal-binder [data-topic=summary]').first().click();
 const evaluation=page.locator('.recommendation-evaluation'),toggle=evaluation.getByRole('button',{name:t('Optional recommendation evaluation','Evaluación opcional de recomendaciones'),exact:true});
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await evaluation.getByRole('button',{name:t('Withdraw recommendation permission','Retirar permiso de recomendaciones'),exact:true}).click();
 await evaluation.getByText(t('Not included — withdrawn','No incluido — retirado'),{exact:true}).waitFor();
 assert.equal((await f.owner.query('SELECT count(*)::int n FROM origen_recommendation_evaluation_receipts')).rows[0].n,0);assert.deepEqual(await plans(),before);
 assert.equal(await page.evaluate(()=>window.connections.at(-1).connectionState),'connected','Withdrawing evaluation does not interrupt ordinary guidance.');
}
module.exports={prepareLibrary,acceptRecommendation,verifyLinkedOutcome,verifyCorrectionAndWithdrawal};
