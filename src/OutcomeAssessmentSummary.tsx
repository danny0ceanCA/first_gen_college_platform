export type OutcomeAssessment={subject:{kind:string;id:string;version:number};state:string;reasonCodes:string[];validUntil?:string|null};
export default function OutcomeAssessmentSummary({value,language}:{value?:OutcomeAssessment;language:'en'|'es'}){
 if(!value)return null;
 const t=(en:string,es:string)=>language==='es'?es:en,codes=new Set(value.reasonCodes),expired=value.validUntil&&Date.parse(value.validUntil)<=Date.now();
 const state=expired?'stale':value.state;
 const summary=state==='student_reported'?t('This records the student’s account; it has not been independently confirmed.','Esto registra lo reportado por el estudiante; no se ha confirmado de forma independiente.'):
 state==='coordinator_reported'?t('This records the coordinator’s observation; Origen has not authenticated the institutional record.','Esto registra la observación del coordinador; Origen no ha autenticado el registro institucional.'):
 state==='disputed'?t('There is an unresolved disagreement. This evidence does not establish a settled result.','Hay un desacuerdo sin resolver. Esta evidencia no establece un resultado definitivo.'):
 state==='multiple_events'?t('These accounts describe different event dates. Each remains attributed to its source.','Estos reportes describen fechas de eventos distintas. Cada uno conserva su fuente.'):
 state==='ambiguous'?t('The timing is unclear. These accounts cannot yet be treated as the same event.','Las fechas no están claras. Aún no se pueden tratar estos reportes como el mismo evento.'):
 state==='stale'||state==='unavailable'?t('This evidence is not available for a current conclusion.','Esta evidencia no está disponible para una conclusión actual.'):
 t('There is not enough applicable evidence to establish this claim.','No hay suficiente evidencia aplicable para establecer esta afirmación.');
 const reasons=[
  codes.has('student_declined')?t('The student chose not to report a result.','El estudiante eligió no reportar un resultado.'):null,
  codes.has('result_pending')?t('The reported result is still pending.','El resultado reportado sigue pendiente.'):null,
  codes.has('goal_changed')?t('The student’s goal changed. This is not a failure.','La meta del estudiante cambió. Esto no es un fracaso.'):null,
  codes.has('decision_is_denial')?t('A denial is a received decision, not an approval.','Una denegación es una decisión recibida, no una aprobación.'):null,
  codes.has('event_date_unknown')?t('The event date is unknown; the save date does not replace it.','No se conoce la fecha del evento; la fecha de guardado no la sustituye.'):null,
  codes.has('undated_event_outside_window')?t('An undated event cannot establish what happened within the stated observation period.','Un evento sin fecha no establece qué ocurrió dentro del período de observación indicado.'):null,
  codes.has('record_type_does_not_establish_claim')?t('The declared record type does not establish this particular claim.','El tipo de registro declarado no establece esta afirmación específica.'):null,
  codes.has('same_scope_date_conflict')?t('Reports about the same scope and date conflict; neither is selected as the truth.','Los reportes sobre el mismo contexto y fecha se contradicen; no se elige uno como la verdad.'):null,
  codes.has('prior_revision_disagreement')?t('A disagreement concerns an earlier revision; the correction does not imply student agreement.','Un desacuerdo corresponde a una revisión anterior; la corrección no implica acuerdo del estudiante.'):null,
  codes.has('dependent_student_account')?t('Repeating the student’s statement does not provide independent evidence.','Repetir la declaración del estudiante no aporta evidencia independiente.'):null,
  codes.has('advice_author_is_reviewer')?t('The reviewer also authored the advice. This observation does not show that the advice caused an outcome.','Quien revisó también escribió el consejo. Esta observación no demuestra que el consejo causó un resultado.'):null,
  codes.has('evidence_limit')?t('This view is incomplete, so no overall conclusion is drawn.','Esta vista está incompleta, por lo que no se obtiene una conclusión general.'):null,
  codes.has('definition_contract_changed')?t('The outcome definition needs review before this evidence can be assessed.','La definición del resultado necesita revisión antes de evaluar esta evidencia.'):null,
 ].filter(Boolean);
 return <div className="outcome-assessment" aria-label={t('What this evidence supports','Qué respalda esta evidencia')}><p>{summary}</p>{!!reasons.length&&<details><summary>{t('Why this assessment','Por qué se evalúa así')}</summary><p>{reasons.join(' ')}</p></details>}</div>;
}
