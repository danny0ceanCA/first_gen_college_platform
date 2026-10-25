// Finishing a later page does not mean earlier pages have been reviewed.
// Return to the first page once; an empty first page really is an empty queue.
export async function loadCoordinatorApplicationPage(request,after=''){
 let data=await request({action:'applications',after});
 if(after&&!data.applications?.length){
  after='';
  data=await request({action:'applications',after});
 }
 return {applications:data.applications||[],after};
}
