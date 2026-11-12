// Exact public campus aliases only; never fuzzy-match an unrelated institution.
const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/^(?:university of california|universidad de california)(?: (?:at|en))? /u,'uc ');
const campuses=['Berkeley','Los Angeles','Merced','Irvine','Davis','Riverside','Santa Cruz','San Francisco','Santa Barbara','San Diego'];
const acronyms=['ucb','ucla','ucm','uci','ucd','ucr','ucsc','ucsf','ucsb','ucsd'];
const aliases=new Map();
campuses.forEach((campus,index)=>{
 const name=index===1?'UCLA':'UC '+campus;
 for(const alias of [campus,'UC '+campus,acronyms[index]])aliases.set(normalize(alias),name);
});
export const costCampusName=value=>aliases.get(normalize(value))||null;
