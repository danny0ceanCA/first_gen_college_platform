-- Cohorts select visits by first receipt rather than latest receipt activity.
CREATE INDEX origen_onboarding_attempts_started ON origen_onboarding_attempts(started_at,account_id,id);
