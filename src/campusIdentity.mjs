// Public institution names only. Exact aliases never turn an arbitrary city,
// college, or an ambiguous "Cal Poly" into a catalog match.
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases=new Map();
function register(name,values){for(const value of [name,...values])aliases.set(fold(value),name);}
const uc=['Berkeley','Los Angeles','Merced','Irvine','Davis','Riverside','Santa Cruz','San Francisco','Santa Barbara','San Diego'];
const acronyms=['ucb','ucla','ucm','uci','ucd','ucr','ucsc','ucsf','ucsb','ucsd'];
uc.forEach((city,i)=>register(i===1?'UCLA':'UC '+city,[city,'UC '+city,acronyms[i],
 'University of California '+city,'University of California at '+city,'Universidad de California '+city,'Universidad de California en '+city]));
export const csuCampuses=[
 ['CSU Bakersfield','Bakersfield',['CSUB','Bakersfield State']],
 ['CSU Channel Islands','Channel Islands',['CSUCI']],
 ['CSU Chico','Chico',['Chico State']],
 ['CSU Dominguez Hills','Dominguez Hills',['CSUDH']],
 ['CSU East Bay','East Bay',['CSUEB']],
 ['CSU Fullerton','Fullerton',['CSUF','Fullerton State']],
 ['CSU Long Beach','Long Beach',['CSULB','Long Beach State']],
 ['CSU Los Angeles','Los Angeles',['Cal State LA','CSULA','CSU LA']],
 ['CSU Monterey Bay','Monterey Bay',['CSUMB']],
 ['CSU Northridge','Northridge',['CSUN']],
 ['CSU Sacramento','Sacramento',['Sacramento State','Sac State','SacState','CSUS']],
 ['CSU San Bernardino','San Bernardino',['CSUSB']],
 ['CSU San Marcos','San Marcos',['CSUSM']],
 ['CSU Stanislaus','Stanislaus',['CSUSTAN','Stanislaus State']],
 ['Fresno State','Fresno',['Fresno State University']],
 ['San Diego State University','San Diego',['San Diego State','SDSU']],
 ['San Francisco State University','San Francisco',['San Francisco State','SF State','SFSU']],
 ['San José State University','San Jose',['San Jose State','SJSU']],
 ['Sonoma State University','Sonoma',['Sonoma State']],
 ['Cal Poly Humboldt','Humboldt',['Humboldt State','Humboldt State University']],
 ['Cal Poly Pomona','Pomona',['CPP','California State Polytechnic University Pomona']],
 ['Cal Poly San Luis Obispo','San Luis Obispo',['Cal Poly SLO','California Polytechnic State University San Luis Obispo']],
 ['Cal Poly Solano Campus / Maritime Academy','Maritime',['Cal Maritime','CSU Maritime','California State University Maritime Academy','Cal Poly Maritime Academy','Cal Poly Solano']],
];
for(const [name,city,other] of csuCampuses)register(name,[...other,'CSU '+city,'Cal State '+city,
 'California State '+city,'California State University '+city,'California State University at '+city,
 'Universidad Estatal de California '+city,'Universidad Estatal de California en '+city,
 'Universidad Estatal de '+city,
 // A caller may mix the system names but still explicitly name Cal State.
 'UC Cal State '+city]);
export const costCampusName=value=>aliases.get(fold(value))||null;

// Prefer the longest public name in a phrase. "San Francisco State" cannot
// simultaneously count as the bare UC alias "San Francisco".
export function mentionedCampuses(text){
 const input=' '+fold(text).slice(0,10000)+' ',candidates=[];
 for(const [alias,campus] of aliases){
  let at=input.indexOf(' '+alias+' ');
  while(at>=0){candidates.push({campus,start:at+1,end:at+1+alias.length});at=input.indexOf(' '+alias+' ',at+1);}
 }
 candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
 const spans=[];
 for(const candidate of candidates)if(!spans.some(s=>candidate.start<s.end&&candidate.end>s.start))spans.push(candidate);
 return [...new Set(spans.sort((a,b)=>a.start-b.start).map(s=>s.campus))];
}
