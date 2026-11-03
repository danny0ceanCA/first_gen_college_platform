import {randomUUID} from 'node:crypto';
import {recommendationFixture} from './recommendation-contract.mjs';
import {runAsAnalytics} from '../account-isolation.mjs';
import {validateTeachingRequest} from '../teaching-library.mjs';
import {actionTemplateDrafts,actionProcesses} from '../../src/recommendationLibrary.mjs';
import {createReviewedActionCatalog} from '../recommendation-library.mjs';
export const review={independentlyAuthored:true,bilingual:true,sourcesAndScope:true};
export const template=()=>actionTemplateDrafts()[0].content;
export function institutionalTemplate(name='Fictional North Campus',term='Fall 2026'){
 const content=template();return {...content,mode:'institution_requirement',campus:{name,officialHost:'example.edu'},term,
  prerequisites:['campus_confirmed','term_confirmed','current_official_requirement'],
  sources:[{id:randomUUID(),url:'https://example.edu/aid',claim:{en:'Synthetic source claim for testing only.',es:'Afirmación sintética de la fuente solo para pruebas.'},checkedOn:content.reviewedOn,reviewBy:content.reviewBy}]};
}
export async function actionLibraryFixture(t,{base}={}){
 const f=base||await recommendationFixture(t);
 Object.assign(f.env,{ORIGEN_RECOMMENDATIONS:'true',ORIGEN_STUDENT_FOLLOW_UP:'true'});
 const admin=(input,actor='staff')=>f.as(actor,()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_recommendation_library_command($1::jsonb) AS result',[JSON.stringify(input)])).rows[0].result));
 const teaching=(input,actor='staff')=>f.as(actor,()=>runAsAnalytics(async()=>(await f.db.query('SELECT origen_teaching_command($1::jsonb) AS result',[JSON.stringify(validateTeachingRequest(input))])).rows[0].result));
 const grant=(actor='staff',{author=true,publisher=true,processes=actionProcesses,expiry=new Date(Date.now()+14*86400000).toISOString()}={})=>f.owner.query('SELECT origen_recommendation_library_grant($1,$2,$3,$4::text[],$5::timestamptz)',[actor,author,publisher,processes,expiry]);
 const create=async(content=template(),actor='staff')=>{
  const id=randomUUID();await teaching({action:'save',id,revision:0,content:{title:'Synthetic reusable teaching',topic:'finance',language:'en',explanation:'General independently authored guidance.',reviewBy:content.reviewBy}});
  await teaching({action:'publish',id,revision:1,reviewed:true});
  const saved=await admin({action:'save',id,revision:0,content},actor);if(saved.error)throw Error(saved.error);return {id,...saved};
 };
 const publish=async(id,revision,actor='staff')=>{
  const preview=await admin({action:'preview',id,revision},actor);
  if(preview.error)return preview;
  return admin({action:'publish',id,revision,preview:preview.preview,review},actor);
 };
 const catalog=(scope={},actor='other')=>f.as(actor,()=>createReviewedActionCatalog(f.db,f.env)(actor,{studentId:'alex',process:'office_contact',campus:null,term:null,...scope}));
 return {...f,admin,teaching,grant,create,publish,catalog};
}
