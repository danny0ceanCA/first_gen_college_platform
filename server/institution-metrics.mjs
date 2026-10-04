import {safeErrorCode} from './api-logging.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function purgeMetrics(database,now=new Date()){
 if(!database)return;
 const cutoff=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1)).toISOString().slice(0,7);
 await database.query('DELETE FROM origen_institution_metrics WHERE month < $1',[cutoff]);
}
export function validateMetric(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['slug','metric','linkIndex'].includes(k))||typeof input.slug!=='string'||! /^[a-z0-9-]{1,100}$/.test(input.slug)||!['page_view','link_click'].includes(input.metric))throw fail(400,'invalid_metric');
 if(input.metric==='page_view'&&input.linkIndex!==undefined||input.metric==='link_click'&&(!Number.isInteger(input.linkIndex)||input.linkIndex< -1||input.linkIndex>11))throw fail(400,'invalid_metric');
 return input;
}
export function createMetricsRepository(database,clock=()=>new Date()){
 return async(subject,input)=>{
  if(!database)throw fail(503,'metrics_unavailable');
  const now=clock(),month=now.toISOString().slice(0,7);
  if(input.action==='report'){
   if(!subject)throw fail(401,'authentication_required');
   if(typeof input.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.id))throw fail(400,'invalid_metric');
   const membership=await database.query('SELECT institution_id FROM origen_institution_members WHERE institution_id=$1 AND auth0_subject=$2',[input.id,subject]);
   if(!membership.rows.length)throw fail(404,'institution_not_found');
   // Only one completed calendar month: no custom ranges, live deltas or breakdowns.
   const period=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
   const rows=(await database.query('SELECT metric,count FROM origen_institution_metrics WHERE institution_id=$1 AND month=$2',[input.id,period])).rows;
   const counts=Object.fromEntries(rows.map(r=>[r.metric,Number(r.count)]));
   return {month:period,timeZone:'UTC',minimumCount:10,pageViews:(counts.page_view||0)>=10?counts.page_view:null,linkClicks:(counts.link_click||0)>=10?counts.link_click:null};
  }
  validateMetric(input);
  const row=(await database.query('SELECT id,published FROM origen_institutions WHERE slug=$1 AND published IS NOT NULL',[input.slug])).rows[0];
  if(!row)throw fail(404,'page_not_found');
  if(input.metric==='link_click'&&(input.linkIndex===-1?!row.published.website:!row.published.links?.[input.linkIndex]))throw fail(400,'invalid_metric');
  await database.query('INSERT INTO origen_institution_metrics(institution_id,month,metric,count) VALUES($1,$2,$3,1) ON CONFLICT(institution_id,month,metric) DO UPDATE SET count=origen_institution_metrics.count+1',[row.id,month,input.metric]);
  return {ok:true};
 };
}
export function createMetricsHandler(database,clock){
 const run=createMetricsRepository(database,clock);let budget={month:0,count:0};
 return async(req,res,next)=>{
  const path=req.url?.split('?')[0];if(!['/api/institution-metrics/event','/api/institution-metrics/report'].includes(path))return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method!=='POST')return send(405,{error:'method_not_allowed'});
  const reporting=path.endsWith('/report');
  if(reporting&&!req.origenAuthorized)return send(401,{error:'authentication_required'});
  if(!reporting&&!req.headers.origin)return send(403,{error:'origin_required'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'json_required'});
  if(!reporting){const minute=Math.floor(Date.now()/60000);if(budget.month!==minute)budget={month:minute,count:0};if(++budget.count>600){res.setHeader('Retry-After','60');return send(429,{error:'rate_limited'});}}
  try{
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>512)return send(413,{error:'too_large'});}
   let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid_metric'});}
   if(reporting){if(!input||Object.keys(input).some(k=>k!=='id'))return send(400,{error:'invalid_metric'});input={...input,action:'report'};}
   return send(200,await run(req.origenIdentity?.sub,input));
  }catch(error){const known=[400,401,404].includes(error.status);if(!known)req.log?.({event:'database_error',code:safeErrorCode(error)});return send(known?error.status:503,{error:known?error.message:'metrics_unavailable'});}
 };
}
