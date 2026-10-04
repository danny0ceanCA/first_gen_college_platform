import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {createFamilyRepository,validateFamily} from './family.mjs';

export async function fixture(){
 const db=newDb();
 db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.registerFunction({name:'btrim',args:[DataType.text],returns:DataType.text,implementation:value=>value.trim()});
 db.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:value=>value.length});
 db.public.registerFunction({name:'jsonb_typeof',args:[DataType.jsonb],returns:DataType.text,implementation:value=>Array.isArray(value)?'array':typeof value});
 for(const name of ['001_family_storage.sql','002_local_imports.sql','003_history_imports.sql','004_account_links.sql','005_family_conversations.sql','006_planning_conversations.sql','007_planning_records.sql','008_institutions.sql','009_institution_metrics.sql','010_account_lifecycle.sql','011_subject_locks.sql','013_voice_experience.sql']){let sql=await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8');if(name==='001_family_storage.sql')sql=sql.replace('mode text NOT NULL CHECK','mode text NOT NULL CONSTRAINT origen_conversation_summaries_mode_check CHECK');db.public.none(sql);}
 db.public.registerFunction({name:'to_char',args:[DataType.date,DataType.text],returns:DataType.text,implementation:value=>new Date(value).toISOString().slice(0,10)});
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
