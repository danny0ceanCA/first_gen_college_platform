import {readFile} from 'node:fs/promises';
import {newDb,DataType} from 'pg-mem';
import {createFamilyRepository,validateFamily} from './family.mjs';

export async function fixture(){
 const db=newDb();
 db.public.registerOperator({operator:'~',left:DataType.text,right:DataType.text,returns:DataType.bool,implementation:(value,pattern)=>new RegExp(pattern).test(value)});
 db.public.registerFunction({name:'gen_random_uuid',returns:DataType.uuid,impure:true,implementation:()=>crypto.randomUUID()});
 db.public.registerFunction({name:'btrim',args:[DataType.text],returns:DataType.text,implementation:value=>value.trim()});
 db.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:value=>value.length});
 db.public.registerFunction({name:'jsonb_typeof',args:[DataType.jsonb],returns:DataType.text,implementation:value=>Array.isArray(value)?'array':typeof value});
 for(const name of ['001_family_storage.sql','002_local_imports.sql','003_history_imports.sql','004_account_links.sql','005_family_conversations.sql','006_planning_conversations.sql','007_planning_records.sql','008_institutions.sql','009_institution_metrics.sql','010_account_lifecycle.sql','011_subject_locks.sql','013_voice_experience.sql','014_account_role.sql','017_admin_activity.sql','018_onboarding_milestones.sql','019_voice_quality.sql','020_institution_access.sql','021_institution_workspace.sql','022_institution_content.sql','023_institution_inquiries.sql','024_institution_campaigns.sql','027_onboarding_events.sql']){let sql=await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8');if(name==='001_family_storage.sql')sql=sql.replace('mode text NOT NULL CHECK','mode text NOT NULL CONSTRAINT origen_conversation_summaries_mode_check CHECK');if(name==='008_institutions.sql')sql=sql.replace("role text NOT NULL DEFAULT 'owner' CHECK","role text NOT NULL DEFAULT 'owner' CONSTRAINT origen_institution_members_role_check CHECK");db.public.none(sql);}
 db.public.registerFunction({name:'to_char',args:[DataType.date,DataType.text],returns:DataType.text,implementation:value=>new Date(value).toISOString().slice(0,10)});
 const {Pool}=db.adapters.createPg();const pool=new Pool();
 // pg-mem does not parse savepoints. Production rollback behavior is checked
 // separately with a failing client; successful fixture operations need no rollback.
 const wrapped=new WeakSet();const connect=pool.connect.bind(pool);pool.connect=async()=>{const client=await connect();if(wrapped.has(client))return client;wrapped.add(client);const query=client.query.bind(client);client.query=(sql,args)=>/^((SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) origen_onboarding_tracking)$/.test(sql)?Promise.resolve({rows:[]}):query(sql,args);return client;};
 return {pool,run:(subject,input)=>createFamilyRepository(pool)(subject,validateFamily(input))};
}
