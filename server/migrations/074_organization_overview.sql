-- Internal operational aggregates only. No names, transcripts, notes or audio.
-- Existing account-level calls cannot be reliably attributed; never backfill them.
ALTER TABLE origen_voice_activity ADD COLUMN guidance_segment_id uuid;
ALTER TABLE origen_voice_activity ADD CONSTRAINT voice_activity_guidance_segment
 FOREIGN KEY(account_id,guidance_segment_id) REFERENCES origen_guidance_segments(account_id,id) ON DELETE SET NULL (guidance_segment_id);
CREATE INDEX origen_voice_activity_guidance ON origen_voice_activity(account_id,guidance_segment_id) WHERE guidance_segment_id IS NOT NULL;

CREATE TABLE origen_organization_voice_attributions (
 voice_id uuid NOT NULL REFERENCES origen_voice_activity(id) ON DELETE CASCADE,
 institution_id uuid NOT NULL REFERENCES origen_institutions(id) ON DELETE CASCADE,
 account_id uuid NOT NULL,
 segment_id uuid NOT NULL,
 FOREIGN KEY(account_id,segment_id) REFERENCES origen_guidance_segments(account_id,id) ON DELETE CASCADE,
 PRIMARY KEY(voice_id,institution_id)
);
CREATE INDEX organization_voice_attributions_org ON origen_organization_voice_attributions(institution_id,voice_id);
CREATE INDEX organization_voice_attributions_segment ON origen_organization_voice_attributions(account_id,segment_id);
ALTER TABLE origen_organization_voice_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON origen_organization_voice_attributions FROM PUBLIC;

CREATE FUNCTION origen_organization_active_coordinators(organization uuid) RETURNS SETOF origen_coordinator_profiles
LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT p.* FROM origen_coordinator_profiles p
 JOIN origen_institution_members m ON m.institution_id=p.institution_id AND m.auth0_subject=p.auth0_subject
 JOIN origen_institutions i ON i.id=p.institution_id
 JOIN origen_coordinator_organizations o ON o.institution_id=i.id
 WHERE i.id=organization AND i.archived_at IS NULL AND i.verification_status='verified'
 AND i.parent_approval='approved' AND o.status='active' AND p.status='active'
 AND NOT EXISTS(SELECT 1 FROM origen_staff_access_controls s WHERE s.subject_hash=encode(sha256(convert_to(p.auth0_subject,'UTF8')),'hex') AND s.blocked)
$$;

CREATE FUNCTION origen_attribute_organization_voice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE segment origen_guidance_segments%ROWTYPE;
BEGIN
 IF NEW.guidance_segment_id IS NULL THEN RETURN NEW; END IF;
 SELECT g.* INTO segment FROM origen_guidance_segments g
 JOIN origen_guidance_sessions s ON s.account_id=g.account_id AND s.id=g.session_id
 WHERE g.account_id=NEW.account_id AND g.id=NEW.guidance_segment_id AND g.target_kind='student' AND s.actor_role='student';
 IF NOT FOUND OR NOT origen_coordinator_student_ready(NEW.account_id,segment.student_id) THEN RETURN NEW; END IF;
 -- Snapshot the accepted affiliations at call start, once per organization even
 -- if several of its coordinators are connected. Later links do not rewrite history.
 INSERT INTO origen_organization_voice_attributions(voice_id,institution_id,account_id,segment_id)
 SELECT DISTINCT NEW.id,p.institution_id,NEW.account_id,NEW.guidance_segment_id FROM origen_binder_connections c
 JOIN origen_coordinator_profiles p ON p.id=c.coordinator_id
 WHERE c.account_id=NEW.account_id AND c.student_id=segment.student_id
 AND c.status='accepted' AND c.accepted_at<=NEW.started_at AND c.expires_at>NEW.started_at
 AND EXISTS(SELECT 1 FROM origen_organization_active_coordinators(p.institution_id) active WHERE active.id=p.id)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_voice_attribution AFTER INSERT ON origen_voice_activity
 FOR EACH ROW EXECUTE FUNCTION origen_attribute_organization_voice();

CREATE FUNCTION origen_admin_organization_overview(organization uuid, days integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE actor text:=nullif(current_setting('origen.subject',true),''); result jsonb;
BEGIN
 IF actor IS NULL OR current_setting('origen.purpose',true) IS DISTINCT FROM 'analytics'
 OR EXISTS(SELECT 1 FROM origen_staff_access_controls WHERE subject_hash=encode(sha256(convert_to(actor,'UTF8')),'hex') AND blocked)
 THEN RAISE EXCEPTION 'organization_overview_denied' USING ERRCODE='42501'; END IF;
 IF days IS NULL OR days NOT IN (7,30,90) THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM origen_institutions WHERE id=organization AND archived_at IS NULL) THEN RETURN NULL; END IF;
 WITH active AS MATERIALIZED (SELECT * FROM origen_organization_active_coordinators(organization)),
 connections AS MATERIALIZED (
  SELECT c.* FROM origen_binder_connections c JOIN active p ON p.id=c.coordinator_id
  WHERE c.status IN ('requested','accepted') AND c.expires_at>now() AND origen_coordinator_student_ready(c.account_id,c.student_id)
 ), shared AS (
  SELECT DISTINCT g.account_id,g.student_id FROM active p
  CROSS JOIN LATERAL origen_coordinator_visible_binders(p.id) v
  JOIN origen_binder_share_grants g ON g.id=v.id
 ), voice AS (
  SELECT v.id,v.seconds FROM origen_organization_voice_attributions a
  JOIN origen_voice_activity v ON v.id=a.voice_id
  JOIN origen_guidance_segments g ON g.account_id=v.account_id AND g.id=v.guidance_segment_id
  JOIN origen_guidance_sessions s ON s.account_id=g.account_id AND s.id=g.session_id
  WHERE a.institution_id=organization AND v.started_at>=now()-make_interval(days=>days) AND v.started_at<now()
  AND s.actor_role='student' AND g.target_kind='student' AND g.configuration_state='applied'
  -- A later family/unresolved/different-student segment makes the entire call
  -- unsuitable for student-only attribution, even after the call was recorded.
  AND NOT EXISTS(SELECT 1 FROM origen_guidance_segments other WHERE other.account_id=s.account_id AND other.session_id=s.id
    AND (other.target_kind<>'student' OR other.student_id IS DISTINCT FROM g.student_id))
 )
 SELECT jsonb_build_object(
  'organizationId',organization,'generatedAt',now(),'days',days,'periodStart',now()-make_interval(days=>days),'periodEnd',now(),
  'activeCoordinators',(SELECT count(*) FROM active),
  'totalCoordinators',(SELECT count(*) FROM origen_coordinator_profiles WHERE institution_id=organization),
  'linkedStudents',(SELECT count(DISTINCT (account_id,student_id)) FROM connections WHERE status='accepted'),
  'sharedBinders',(SELECT count(*) FROM shared),
  'pendingConnections',(SELECT count(*) FROM connections WHERE status='requested'),
  'voiceMinutes',(SELECT round((coalesce(sum(seconds),0)/60)::numeric,1) FROM voice),
  'voiceCalls',(SELECT count(*) FROM voice),
  'voiceTrackingSince',(SELECT applied_at FROM origen_schema_migrations WHERE name='074_organization_overview.sql')
 ) INTO result;
 RETURN result;
END $$;

DO $$ DECLARE fn text; BEGIN
 FOREACH fn IN ARRAY ARRAY['origen_organization_active_coordinators(uuid)','origen_attribute_organization_voice()','origen_admin_organization_overview(uuid,integer)'] LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog,%I,pg_temp',fn,current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
END $$;
