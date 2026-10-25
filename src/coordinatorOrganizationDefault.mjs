const normalizedName=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();

// Only default to an eligible result, and never guess between duplicate names.
export function defaultCoordinatorOrganization(name,organizations,registeredInstitutionId){
 if(registeredInstitutionId)return organizations.some(org=>org.id===registeredInstitutionId)?registeredInstitutionId:'';
 if(!normalizedName(name)||organizations.length>50)return '';
 const matches=organizations.filter(org=>normalizedName(org.name)===normalizedName(name));
 return matches.length===1?matches[0].id:'';
}
