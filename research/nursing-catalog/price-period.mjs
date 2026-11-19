const text=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/(?<=\d),(?=\d)/gu,'.').replace(/[^a-z0-9.]+/gu,' ').trim();
const frequencies=[
 ['unit','per semester unit|per unit|per credit|por unidad|por credito'],
 ['month','monthly|per month|each month|al mes|por mes|mensual'],
 ['year','annual|annually|yearly|per year|each year|academic year|anual|anualmente|por ano'],
 ['semester','per semester|each semester|por semestre|semestral'],
 ['quarter','per quarter|each quarter|quarterly|por trimestre|trimestral'],
];
function describe(value,source=false){
 const input=text(value),kinds=[];let remaining=input;
 for(const [kind,pattern] of frequencies){
  const expression=new RegExp(`\\b(?:${pattern})\\b`,'gu');
  if(expression.test(remaining)){kinds.push(kind);remaining=remaining.replace(expression,' ');}
 }
 if(source){
  if(/\bprogram\s*year\s*\d/u.test(remaining))kinds.push('year');
  const several=/\b(?:two|three|four|five|six|[2-9]\d*)\s*(?:semesters|quarters)\b/u.test(remaining);
  if(!several&&/\bsemester(?:\b|\d)/u.test(remaining))kinds.push('semester');
  if(!several&&/\bquarter(?:\b|\d)/u.test(remaining))kinds.push('quarter');
 }
 const words={one:1,two:2,three:3,four:4,six:6,nine:9,ten:10,twelve:12,un:1,uno:1,dos:2,tres:3,cuatro:4,seis:6,nueve:9,diez:10,doce:12};
 const months=[...input.matchAll(/\b(\d+(?:\.\d+)?|one|two|three|four|six|nine|ten|twelve|un|uno|dos|tres|cuatro|seis|nueve|diez|doce)\s*(?:months?|meses|mes)\b/gu)].map(m=>words[m[1]]??Number(m[1]));
 return {kinds:[...new Set(kinds)],months:[...new Set(months)]};
}
export function nursingPricePeriodMatches(question,period){
 // The load is assessed per term; that phrase does not request a term price.
 const query=text(question).replace(/\b\d+(?:\.\d+)?\s*(?:units?|credits?|credit hours?|unidades?|creditos?)\s+(?:per|each|por|cada)\s+(?:semester|term|quarter|semestre|trimestre)\b/gu,' ');
 const requested=describe(query);
 if(!requested.kinds.length&&!requested.months.length)return true;
 if(requested.kinds.length>1||requested.months.length>1)return false;
 const own=describe(period,true);
 if(requested.kinds.length){
  const kind=requested.kinds[0];
  if(own.kinds.length===1&&own.kinds[0]===kind)return true;
  return kind==='year'&&!own.kinds.length&&own.months.length===1&&own.months[0]===12;
 }
 return own.months.length===1&&own.months[0]===requested.months[0];
}
