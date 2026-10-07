import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createResearchSandbox} from './governance.mjs';
export async function syntheticResearchExercise(){
 const protocol=JSON.parse(await readFile(new URL('./protocol.v1.json',import.meta.url),'utf8'));
 const lab=await createResearchSandbox();
 try{
  const registered=await lab.register(protocol);const scope={studyId:protocol.studyId,version:protocol.version};
  for(let i=0;i<20;i++){
   const subject=`synthetic-person-${i}`;
   await lab.permission({...scope,subject,eventId:randomUUID(),action:'consent',language:i%2?'es':'en',noticeHash:registered.noticeHash,adultSelfConfirmed:true});
   await lab.measure({...scope,subject,month:'2026-10',response:i<10?'helpful':'partly'});
  }
  const released=await lab.release({...scope,actor:protocol.recipients[0]});
  const withdrawal=await lab.permission({...scope,subject:'synthetic-person-0',eventId:randomUUID(),action:'withdraw',language:'en',noticeHash:registered.noticeHash});
  let staleAccessDenied=false;try{await lab.read({...scope,actor:protocol.recipients[0],manifestId:released.manifestId});}catch(error){staleAccessDenied=error.code==='dataset_unavailable';}
  const afterWithdrawal=await lab.release({...scope,actor:protocol.recipients[0]});
  await lab.revoke({...scope,recipientId:protocol.recipients[0]});
  let revokedRecipientDenied=false;try{await lab.read({...scope,actor:protocol.recipients[0],manifestId:afterWithdrawal.manifestId});}catch(error){revokedRecipientDenied=error.code==='recipient_not_authorized';}
  const audit=await lab.audit();
  return {synthetic:true,productionDataRead:false,institutionApproval:false,realParticipantsEnrolled:0,source:'synthetic-generator-v1',released,withdrawal:{blockedStoredDatasetAccess:staleAccessDenied,futureCohortSize:afterWithdrawal.payload.participantCount,complementarySuppression:afterWithdrawal.payload.counts===null,previousDownloadedCopies:'recipient follow-up required; not erased by software'},revocation:{blockedAccess:revokedRecipientDenied},audit:{allowed:audit.events.filter(e=>e.outcome==='allowed').length,denied:audit.events.filter(e=>e.outcome==='denied').length},liveReadiness:false};
 }finally{await lab.close();}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/research/sandbox/demo.mjs'))console.log(JSON.stringify(await syntheticResearchExercise(),null,2));
