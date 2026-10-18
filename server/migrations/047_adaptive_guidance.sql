-- A student may set an action aside without marking it complete or deleting it.
ALTER TABLE origen_plan_steps DROP CONSTRAINT origen_plan_steps_status_check;
ALTER TABLE origen_plan_steps ADD CONSTRAINT origen_plan_steps_status_check
 CHECK(status IN ('not-started','in-progress','complete','deferred'));

-- Application actions belong to their own binder topic.
ALTER TABLE origen_plans DROP CONSTRAINT origen_plans_category_check;
ALTER TABLE origen_plans ADD CONSTRAINT origen_plans_category_check
 CHECK(category IN ('education','courses','transfer','degree','career','financial','applications','other'));
