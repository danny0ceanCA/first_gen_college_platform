import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {createFamilyRepository,validateFamily} from './family.mjs';

export async function fixture(){
 const db=newDb();
 db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.registerFunction({name:'btrim',args:[DataType.text],returns:DataType.text,implementation:value=>value.trim()});
 db.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:value=>value.length});
 db.public.registerFunction({name:'jsonb_typeof',args:[DataType.jsonb],returns:DataType.text,implementation:value=>Array.isArray(value)?'array':typeof value});
 for(const name of ['001_family_storage.sql','002_local_imports.sql','004_account_links.sql'])db.public.none(await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8'));
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
