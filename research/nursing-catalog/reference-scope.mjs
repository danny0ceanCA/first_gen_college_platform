import {costCampusName} from '../cost-catalog/campus.mjs';
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const nursingInstitutionKey=value=>fold(costCampusName(value)||value).replace(/\b(?:university|college|of|the)\b/gu,'').replace(/\s+/gu,' ').trim();

export function nursingSiteRequest(question,rows){
 const locations=[...new Set(rows.flatMap(r=>String(r.payload.values['Institution / location note']||'').split(/[;()]/u).map(fold)).filter(s=>s&&!['california','not specified','not applicable','unknown'].includes(s)))];
 const text=fold(String(question||'').replace(/\b(?:don|doesn|isn|aren)[’']t\b/giu,'not')),padded=' '+text+' ',candidates=[];
 for(const location of locations){
  let at=padded.indexOf(' '+location+' ');
  while(at>=0){candidates.push({start:at,end:at+location.length,location});at=padded.indexOf(' '+location+' ',at+1);}
 }
 candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
 const spans=[];
 for(const candidate of candidates)if(!spans.some(s=>candidate.start<s.end&&candidate.end>s.start))spans.push(candidate);
 const included=new Set(),excluded=new Set();
 for(const span of spans){
  const negative=/\b(?:not|no|except|excluding)(?: (?:at|in|from|en|de|attend|attending))?$/u.test(text.slice(0,span.start).trimEnd());
  (negative?excluded:included).add(span.location);
 }
 return {included:[...included],excluded:[...excluded],conflict:[...included].some(site=>excluded.has(site))};
}
export function nursingSiteMatches(note,requested){
 const source=' '+fold(note)+' ',has=site=>source.includes(' '+site+' ');
 if(requested.conflict)return false;
 // All positive sites must be covered. A shared-site price may cover a
 // requested positive site without implying attendance at the excluded one.
 if(requested.included.length)return requested.included.every(has);
 return !requested.excluded.some(has);
}

export function nursingQuestionInstitutions(question,campuses){
 const text=fold(question).slice(0,10000),padded=' '+text+' ',candidates=[];
 for(const campus of campuses){
  const name=fold(campus);let at=padded.indexOf(' '+name+' ');
  while(at>=0){candidates.push({start:at,end:at+name.length,key:nursingInstitutionKey(campus)});at=padded.indexOf(' '+name+' ',at+1);}
 }
 const words=[...text.matchAll(/\S+/gu)];
 for(let start=0;start<words.length;start++)for(let length=1;length<=12&&start+length<=words.length;length++){
  const from=words[start].index,to=words[start+length-1].index+words[start+length-1][0].length,alias=text.slice(from,to),campus=costCampusName(alias);
  // Bare city names are also UC aliases in the shared UI. A nursing site in
  // San Diego or Los Angeles does not identify UC San Diego or UCLA.
  if(campus&&(/\b(?:university|universidad|uc|csu|state|cal poly)\b/u.test(alias)||/^(?:uc[a-z]{1,3}|csu[a-z]{0,4}|sdsu|sfsu|sjsu|cpp|sacstate)$/u.test(alias)))candidates.push({start:from,end:to,key:nursingInstitutionKey(campus)});
 }
 candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
 const spans=[];
 for(const candidate of candidates)if(!spans.some(s=>candidate.start<s.end&&candidate.end>s.start))spans.push(candidate);
 const included=new Set(),excluded=new Set();
 for(const span of spans){
  const negative=/\b(?:not|except|excluding|no)(?: (?:at|from|en|de|the|el|la))?$/u.test(text.slice(0,span.start).trimEnd());
  (negative?excluded:included).add(span.key);
 }
 return {included:[...included],excluded:[...excluded]};
}

export function nursingAcademicYears(question){
 const years=[];
 // Skip full calendar dates. Academic-year separators and spacing do not
 // change which source year is being requested, including a two-year program.
 const text=String(question||'').replace(/\b(20\d{2})\s*[-–—/]\s*(20\d{2}|\d{2})(?!\d|\s*[-–—/]\s*\d)\b/gu,(_,start,end)=>{years.push(start+'-'+end.slice(-2));return ' ';});
 return {years:[...new Set(years)],text};
}
export function nursingAcademicYearMatches(row,year){
 return row.academic_year_key===year||nursingAcademicYears(row.academic_year_raw).years.includes(year);
}
