import {loadEnv} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {campaignBudget,campaignRoot} from './campaign.mjs';
import {scenarios} from './scenarios.mjs';
import {researchGap} from './gap-research.mjs';
import {createResearchTask,auditResearchTask} from '../../src/researchTask.mjs';
import {validatedResearchFindings} from '../../src/researchFindings.mjs';
const retryIds=new Set(['costs-primary-en','applications-primary-en','applications-primary-es','grants-primary-es','esl-primary-en','esl-primary-es','support-primary-en','support-primary-es','support-supplement-es']);
const cases=scenarios.flatMap(s=>['en','es'].flatMap(language=>['primary','supplement'].map(role=>({id:`${s.id}-${role}-${language}`,scenario:s.id,role,language,candidate:s[role]})))).filter(c=>!process.argv.includes('--retest')||retryIds.has(c.id));
if(!process.argv.includes('--execute')){console.log(JSON.stringify({calls:cases.length,scenarios:scenarios.map(s=>s.topic),budget:20,isolated:true}));process.exit(0);}
const budget=await campaignBudget(),root=resolve(campaignRoot,process.argv.includes('--retest')?'research-retest':'research');await mkdir(root,{recursive:true});
const allEnv={...loadEnv('development',process.cwd(),''),...process.env};const env={OPENAI_API_KEY:allEnv.OPENAI_API_KEY};if(!env.OPENAI_API_KEY)throw Error('OpenAI key required');
let index=0;
async function consume(){while(index<cases.length){const c=cases[index++],path=resolve(root,c.id+'.json');
 try{JSON.parse(await readFile(path,'utf8'));console.log(JSON.stringify({id:c.id,resumed:true}));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const row={id:c.id,scenario:c.scenario,role:c.role,language:c.language,traces:[]};
 try{row.result=await researchGap(c.candidate,c.language,{env,budget,report:row.traces});row.audit=auditResearchTask(createResearchTask({question:c.candidate[c.language],institution:c.candidate.institution,language:c.language}),row.result);row.findingCount=validatedResearchFindings(row.result).length;}
 catch(e){row.failure=String(e.code||e.message||e).slice(0,150);}
 await writeFile(path,JSON.stringify(row,null,2));console.log(JSON.stringify({id:c.id,failure:row.failure,audit:row.audit,findings:row.findingCount,accountedUsd:budget.total()}));
 if(row.failure?.includes('budget')||row.failure?.includes('reservation'))throw Error(row.failure);
}}
try{const completed=await Promise.allSettled([consume(),consume()]);for(const r of completed)if(r.status==='rejected')throw r.reason;}finally{await budget.close();}
