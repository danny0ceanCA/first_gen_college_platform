export function researchTablesEnabled(env){
 return env.ORIGEN_RESEARCH_TABLES==='true'||env.NODE_ENV==='development'&&['true','rules','decisions'].includes(env.ORIGEN_LOCAL_VISUAL_CARDS);
}
