import {setTimeout as pause} from 'node:timers/promises';

// Only for complete, standalone DB commands. isolateDatabase.query has already
// rolled back and released the failed transaction when it propagates these
// PostgreSQL errors. Never replay an uncertain network/commit outcome, a domain
// conflict, or work inside a caller-owned transaction.
export async function retryAbortedCommand(command){
 for(let attempt=0;;attempt++){
  try{return await command();}catch(error){
   if(attempt>=3||!['40P01','40001'].includes(error?.code))throw error;
   await pause(25*2**attempt+Math.floor(Math.random()*25));
  }
 }
}
