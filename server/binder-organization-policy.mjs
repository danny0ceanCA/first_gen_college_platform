import {personalizationControls} from './personalization-controls.mjs';

export const ORGANIZATION_VERSION='binder-organization-v1';
export const organizationEnabled=(env,subject)=>env.ORIGEN_BINDER_ORGANIZATION==='true'&&env.ORIGEN_BINDER_JOBS==='true'&&personalizationControls(env,subject).extraction;
export function organizationConfigurationIssues(env){
 const issues=[];
 if(env.ORIGEN_BINDER_ORGANIZATION&&!['true','false'].includes(env.ORIGEN_BINDER_ORGANIZATION))issues.push('ORIGEN_BINDER_ORGANIZATION: use true or false');
 if(env.ORIGEN_BINDER_ORGANIZATION==='true'){
  if(env.ORIGEN_BINDER_JOBS!=='true')issues.push('ORIGEN_BINDER_JOBS: required for unified binder organization');
  if(!['on','cohort'].includes(env.ORIGEN_PERSONALIZATION_MODE)||env.ORIGEN_PERSONALIZATION_EXTRACTION!=='true')issues.push('ORIGEN_PERSONALIZATION_EXTRACTION: enabled personalization extraction required for unified binder organization');
 }
 return issues;
}
export async function assertOrganizationReady(database,env){
 if(env.ORIGEN_BINDER_ORGANIZATION!=='true')return;
 if(organizationConfigurationIssues(env).length)throw new Error('binder_organization_configuration_required');
 if(!database||!(await database.query("SELECT 1 FROM origen_schema_migrations WHERE name='062_binder_organization.sql'")).rows.length)throw new Error('binder_organization_migration_required');
}
