// Accept independently stated account fields without inventing the missing one.
export function accountDraftProposal(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['firstName','role'].includes(key)))return null;
 const next={};
 if(Object.hasOwn(value,'firstName')){
  if(typeof value.firstName!=='string'||!value.firstName.trim()||value.firstName.length>100)return null;
  next.firstName=value.firstName.trim();
 }
 if(Object.hasOwn(value,'role')){
  if(!['parent','student'].includes(value.role))return null;
  next.role=value.role;
 }
 return Object.keys(next).length?next:null;
}
