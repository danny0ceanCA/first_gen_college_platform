// A collection flag never authorizes content or changes event fields. Detailed success spans expire automatically.
export function detailedSpansEnabled(env=process.env,now=Date.now()){
 const start=Date.parse(env.OBSERVABILITY_DETAIL_STARTED_AT),end=Date.parse(env.OBSERVABILITY_DETAIL_EXPIRES_AT);
 return env.OBSERVABILITY_DETAILED_SPANS==='true'&&Number.isFinite(start)&&Number.isFinite(end)&&start<=now&&end>now&&end>start&&end-start<=3600000;
}
