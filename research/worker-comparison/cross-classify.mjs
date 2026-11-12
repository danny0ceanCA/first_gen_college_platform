// Calibrate the same supplemental-task selector against positives AND hard
// negatives. This script performs classifications only, never research/actions.
import {loadEnv} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createDecisionsClient} from '../decisions/client.mjs';
import {decisionRequest,decisionAssessment,scopedScoutCatalog,supplementalPredicateRequest,supplementalPredicateAssessment} from './scout.mjs';
import {scenarios,supplementalCatalog} from './scenarios.mjs';
import {campaignBudget,campaignRoot} from './campaign.mjs';
export const calibrationCases=scenarios.flatMap(s=>['en','es'].flatMap(language=>{
 const text=s[language].initial,snapshot={language,turns:[{role:'user',text}],primaryResearch:[{question:s.primary[language],status:'running'}]};
 return [
  {id:`${s.id}-${language}-need`,expected:s.supplement.id,snapshot},
  {id:`${s.id}-${language}-known`,expected:'none',snapshot:{...snapshot,knownTaskIds:[s.supplement.id]}},
  {id:`${s.id}-${language}-declined`,expected:'none',snapshot:{...snapshot,turns:[{role:'user',text:text+(language==='es'?' No busques nada más; solo quiero conversar.':' Do not look anything else up; I only want to talk.')}]}},
 ];
})).concat(['en','es'].flatMap(language=>[
 {id:`${language}-demographic-only`,expected:'none',snapshot:{language,turns:[{role:'user',text:language==='es'?'Somos de primera generación y hablamos español.':'We are first generation and speak Spanish.'}]}},
 {id:`${language}-hypothetical`,expected:'none',snapshot:{language,turns:[{role:'user',text:language==='es'?'Solo un ejemplo imaginario: alguien de UC Davis no puede comprar alimentos. No es nuestra situación.':'Only an imagined example: someone at UC Davis cannot afford groceries. This is not our situation.'}]}},
 {id:`${language}-ambiguous`,expected:'none',snapshot:{language,turns:[{role:'user',text:language==='es'?'Necesitamos el autobús para esa universidad.':'We need the bus for that university.'}]}},
 {id:`${language}-new-topic`,expected:'none',snapshot:{language,turns:[{role:'user',text:scenarios[0][language].initial},{role:'user',text:scenarios[0][language].next}]}},
]));
if(process.argv[1]?.endsWith('cross-classify.mjs')){
 if(!process.argv.includes('--execute')){console.log(JSON.stringify({classifications:calibrationCases.length,research:false,actions:false,maxReservedUsd:calibrationCases.length*.005}));}
 else{
  const revision=process.argv.find(x=>x.startsWith('--revision='))?.slice(11)||'r2';
  const budget=await campaignBudget(),root=resolve(campaignRoot,'classification-'+revision);await mkdir(root,{recursive:true});
  const env={...loadEnv('development',process.cwd(),''),...process.env},client=createDecisionsClient({apiKey:env.OPENAI_API_KEY});let index=0;
  async function consume(){while(index<calibrationCases.length){const c=calibrationCases[index++],path=resolve(root,c.id+'.json');
   try{await readFile(path);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
   const catalog=scopedScoutCatalog(c.snapshot,supplementalCatalog),perTask=process.argv.includes('--per-task');
   await budget.reserve('classification_calibration',.005,{case:c.id,revision});const request=perTask?supplementalPredicateRequest(c.snapshot,catalog):decisionRequest(c.snapshot,catalog);let result;
   try{const response=await client.evaluate(request);result={...c,request,response,assessment:perTask?supplementalPredicateAssessment(response.response,catalog):decisionAssessment(response.response,undefined,catalog)};result.pass=result.assessment.selected===c.expected;}
   catch(e){result={...c,error:String(e.code||e.message).slice(0,100),pass:false};}
   await writeFile(path,JSON.stringify(result,null,2));console.log(JSON.stringify({id:c.id,pass:result.pass,expected:c.expected,...result.assessment}));
  }}
  try{const results=await Promise.allSettled([consume(),consume()]);for(const r of results)if(r.status==='rejected')throw r.reason;}finally{await budget.close();}
 }
}
