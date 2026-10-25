const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function adminOrganizationOverview(database,{organizationId,days=30}={}){
 if(typeof organizationId!=='string'||!uuid.test(organizationId)||![7,30,90].includes(days))throw Object.assign(new Error('invalid_organization_filter'),{status:400});
 const result=(await database.query('SELECT origen_admin_organization_overview($1::uuid,$2::integer) AS result',[organizationId,days])).rows[0]?.result;
 if(!result)throw Object.assign(new Error('organization_not_found'),{status:404});
 return result;
}
