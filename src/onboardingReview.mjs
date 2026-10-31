// Readiness belongs to an exact draft, not to a pause in the conversation.
export function onboardingReview(){
 let reviewed='',saved=false;
 const fingerprint=value=>JSON.stringify(value);
 const required=value=>Boolean(value.name?.trim()&&['parent','student'].includes(value.role)&&value.draft?.name?.trim());
 return {
  prepare(value,stageAddressed){
   if(saved)return false;
   reviewed=required(value)&&stageAddressed===true?fingerprint(value):'';
   return Boolean(reviewed);
  },
  ready(value){return !saved&&required(value)&&reviewed===fingerprint(value);},
  changed(value){if(reviewed!==fingerprint(value))reviewed='';},
  saved(){saved=true;reviewed='';},
 };
}
