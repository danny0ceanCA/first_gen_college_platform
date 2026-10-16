import {mkdir,open,unlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {deny} from './contracts.mjs';
async function receipt(path){const f=await open(path,'wx',0o600);try{await f.sync();}finally{await f.close();}}
async function syncDirectory(path){if(process.platform==='win32')return;const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
export async function reserve(root,{id,investigationId}){
 for(const value of [id,investigationId])if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value??''))deny();
 const dir=join(root,investigationId);await mkdir(dir,{recursive:true,mode:0o700});if((await lstat(dir)).isSymbolicLink())deny();
 const lock=await open(join(dir,'active'),'wx',0o600);let released=false;
 const release=async()=>{if(released)return;released=true;await lock.close();await unlink(join(dir,'active'));await syncDirectory(dir);};
 try{
  await receipt(join(root,`grant-${id}`));await syncDirectory(root);
  for(let slot=1;slot<=2;slot++){
   try{await receipt(join(dir,`attempt-${slot}`));await syncDirectory(dir);return {slot,release};}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  deny();
 }catch(error){await release();throw error;}
}
