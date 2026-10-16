import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {fixture} from '../observability/fixture.mjs';
import {isolateDatabase,runAsAccount} from '../../server/account-isolation.mjs';
import {createPermissionRepository} from '../../server/guardian-permission.mjs';
import {createFamilyRepository,validateFamily} from '../../server/family.mjs';
import {createDiagnosticOperations} from '../../server/observability/operations.mjs';
import {createSupportRepository} from '../../server/support-diagnostics.mjs';
import {createAuthority,createEvidenceReader} from './store.mjs';
import {createInvestigator} from './gateway.mjs';
export const keys=()=>{const pair=generateKeyPairSync('ed25519');return {signingKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:pair.publicKey.export({type:'spki',format:'pem'})};};
export const actor=()=>({sub:'synthetic-staff',iat:Math.floor(Date.now()/1000)-1,permissions:['observability:investigate']});
export async function supportFixture(){
 const f=await fixture({application:true}),db=isolateDatabase(f.appRuntime),as=(sub,work)=>runAsAccount({sub},work),permission=createPermissionRepository(db),family=createFamilyRepository(db),operations=createDiagnosticOperations(db),support=createSupportRepository(db,{environment:'test'});
 try{
  const refs={};for(const sub of ['synthetic-alice','synthetic-bob']){
   await as(sub,()=>permission.account(sub,{action:'screen',ageBand:'18plus',audience:'grade9plus'}));
   await as(sub,()=>family(sub,validateFamily({action:'save-account',account:{firstName:'Synthetic',role:'student',email:''}})));
   refs[sub]=[];for(const studentId of ['student-a','student-b']){
    await as(sub,()=>family(sub,validateFamily({action:'save-student',student:{id:studentId,name:'Synthetic',stage:'College'}})));
    const requestId=randomUUID(),op=await as(sub,()=>operations(sub,{studentId,kind:'voice',hint:randomUUID(),requestId}));refs[sub].push({...op,requestId});
   }
  }
  const authority=createAuthority({application:f.appSupport,control:f.supportControl,telemetry:f.query,ledger:f.ledgerReader}),options={authority,readEvidence:createEvidenceReader(f.query),...keys(),audience:'https://support.synthetic',environment:'test',sourceRoot:'https://github.com/example/origen',gatewayRevision:'c'.repeat(40)};
  const investigator=createInvestigator(options);
  return {...f,db,as,refs,permission,authority,options,investigator,report:(sub,reference,purpose='voice')=>as(sub,()=>support(sub,{action:'report',reference,purpose})),closeCase:(sub,reference,purpose='voice')=>as(sub,()=>support(sub,{action:'close',reference,purpose})),close:async()=>{investigator.close();await f.close();}};
 }catch(error){await f.close();throw error;}
}
