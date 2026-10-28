-- Give students a stable placement for comments on their own binder entries.
-- Staff responses retain publication IDs only; this adds no source content.
-- Replacing the existing projection preserves every authorization check and ACL.
DO $$
DECLARE
 definition text := pg_get_functiondef('origen_coordinator_feedback_v6(jsonb)'::regprocedure);
 needle text := $old$'publicationItemId',x.publication_item_id,$old$;
 replacement text := $new$'publicationItemId',x.publication_item_id,'anchor',CASE WHEN staff THEN NULL ELSE (
  SELECT jsonb_build_object('id',anchor_lineage.source_id,'kind',anchor_lineage.source_kind,'version',anchor_item.source_version)
  FROM origen_binder_publication_items anchor_item JOIN origen_binder_source_lineage anchor_lineage
   ON anchor_lineage.id=anchor_item.lineage_id AND anchor_lineage.account_id=anchor_item.account_id AND anchor_lineage.student_id=anchor_item.student_id
  WHERE anchor_item.id=x.publication_item_id AND anchor_item.account_id=owner AND anchor_item.student_id=x.student_id
   AND anchor_lineage.source_kind IN ('note','memory')
 ) END,$new$;
BEGIN
 IF definition IS NULL OR length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'unexpected_coordinator_feedback_projection';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
