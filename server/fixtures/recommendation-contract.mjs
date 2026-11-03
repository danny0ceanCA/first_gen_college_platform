import {randomUUID} from 'node:crypto';
import {studentFollowUpFixture} from './student-follow-up.mjs';
import {createRecommendationSourceRepository} from '../recommendation-contract.mjs';
export function syntheticRecommendationCandidate(){return {
 contractVersion:1,source:{kind:'reviewed-template',teachingId:randomUUID(),revision:1},
 action:{en:'Ask the office which document format is required.',es:'Pregunta a la oficina qué formato del documento se requiere.'},
 goal:'understand_requirement',process:'insurance_waiver',prerequisites:['campus_confirmed','term_confirmed'],exclusions:['already_completed','declined'],
 scope:{campus:{state:'unknown',id:null},term:{state:'unknown',value:null},organizationId:null},support:[],
 reviewedAt:'2026-11-01T00:00:00.000Z',expiresAt:'2026-12-01T00:00:00.000Z',
 explanation:{en:'Confirm the requirement before preparing the document.',es:'Confirma el requisito antes de preparar el documento.'}
};}
export async function recommendationFixture(t){
 const f=await studentFollowUpFixture(t);Object.assign(f.env,{ORIGEN_STUDENT_FOLLOW_UP:'true',ORIGEN_RECOMMENDATIONS:'true'});
 const actionSource={kind:'accepted-action',...f.target,planVersion:f.plan.version};
 const responseSource={...f.source,organizationId:f.org};
 const command=(source=actionSource,extra={})=>({action:'resolve-source',contractVersion:1,purpose:'personal_guidance',studentId:'alex',source,...extra});
 const resolve=(source=actionSource,extra={},actor='other')=>f.as(actor,()=>createRecommendationSourceRepository(f.db,f.env)(actor,command(source,extra)));
 const sql=(input,actor='other')=>f.as(actor,async()=>{const c=await f.db.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('origen.recommendations','true',true)");const r=await c.query('SELECT origen_recommendation_source_command($1::jsonb) AS result',[JSON.stringify(input)]);await c.query('COMMIT');return r.rows[0].result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}});
 return {...f,actionSource,responseSource,command,resolve,sql};
}
