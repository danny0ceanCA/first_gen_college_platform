-- Additive publication by campus. Releasing a CSU workbook must not hide the
-- existing UC workbook. A newer campus release replaces that campus as a unit;
-- absent scenarios are not silently restored from an older workbook.
CREATE OR REPLACE VIEW coa_catalog.production_published WITH(security_barrier=true) AS
 WITH active AS (
  SELECT DISTINCT ON (b.campus) b.campus,r.id
  FROM coa_catalog.production_releases r
  JOIN coa_catalog.production_release_records p ON p.release_id=r.id
  JOIN coa_catalog.budgets b ON (b.batch_id,b.budget_key,b.record_digest)=(p.batch_id,p.budget_key,p.record_digest)
  WHERE r.valid_until>now()
  ORDER BY b.campus,r.released_at DESC,r.id DESC
 )
 SELECT b.*,r.source_reviewed_at,r.valid_until,true AS caveated_publication,
 jsonb_build_object('reviewNotes',coalesce((SELECT jsonb_agg(n.value)
  FROM jsonb_array_elements(r.review_evidence->'reviewNotes') AS n(value)
  WHERE n.value->'values'->>'Budget ID'=b.budget_key),'[]'::jsonb)) AS review_evidence
 FROM coa_catalog.budgets b
 JOIN coa_catalog.production_release_records p USING(batch_id,budget_key,record_digest)
 JOIN coa_catalog.production_releases r ON r.id=p.release_id
 JOIN active a ON a.campus=b.campus AND a.id=r.id
 WHERE b.bucket<>'invalid' AND r.valid_until>now();
-- CREATE OR REPLACE retains the existing restricted reader grant.
