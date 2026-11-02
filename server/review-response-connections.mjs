import {validateReviewResponseReference} from '../src/reviewResponseConnection.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export function validateReviewResponseInspection(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||input.action!=='inspect'
  ||Object.keys(input).some(key=>!['action','studentId','source'].includes(key))
  ||typeof input.studentId!=='string'||!input.studentId.trim()||input.studentId.length>128
  ||/[\x00-\x1f\x7f]/.test(input.studentId))throw fail(400,'invalid_review_response_reference');
 return {action:'inspect',studentId:input.studentId,source:validateReviewResponseReference(input.source)};
}

// Internal, student-owned metadata inspection. No HTTP route, voice tool,
// response-body retrieval, activity writer, plan writer or sharing capability.
export function createReviewResponseConnectionRepository(database){return async input=>{
 const command=validateReviewResponseInspection(input);
 if(!database)throw fail(503,'review_response_connections_unavailable');
 const result=(await database.query('SELECT origen_review_response_connection_command($1::jsonb) AS result',[JSON.stringify(command)])).rows[0].result;
 if(result.error)throw fail(result.error==='review_response_unavailable'?404:result.error==='invalid_review_response_reference'?400:403,result.error);
 return result;
};}
