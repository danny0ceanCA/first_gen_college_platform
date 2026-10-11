// Keep private application context separate from inputs to web-enabled models.
// This is data minimization, not a general-purpose anonymizer.
import {createFamilyRepository} from './family.mjs';

const fail=()=>Object.assign(new Error('private_search_details'),{status:400});
const privatePatterns=[
 /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
 /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
 /(?:\+?1[-. ()]*)?(?:\(\d{3}\)|\b\d{3})[-. ]\d{3}[-. ]\d{4}\b/g,
 /\b\d{9,}\b/g,
 /\b(?:sk-[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,
 /\b(?:auth0|google-oauth2)\|[^\s,;]+/gi,
 /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
 /https?:\/\/[^\s]+/gi,
 /\b\d+\s+(?:[\p{L}.'-]+\s+){1,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl|calle|avenida)\b/giu,
];
const injection=/\b(?:ignore|override|disregard)\b.{0,60}\b(?:instructions?|rules?|prompts?)\b|\b(?:system|developer)\s*(?:message|prompt|:)|\b(?:exfiltrate|reveal secrets|send credentials)\b|\b(?:ignora|ignorar)\b.{0,60}\b(?:instrucciones|reglas)\b/iu;
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function publicSearchText(value,names=[]){
 let text=String(value||'').normalize('NFKC');
 if(injection.test(text))throw fail();
 for(const pattern of privatePatterns)text=text.replace(pattern,'[private detail omitted]');
 // Exact self-reported financial amounts and grades are unnecessary for policy research.
 text=text.replace(/(?:\$|USD\s*)\s*[\d,.]+/gi,'[amount omitted]')
  .replace(/\b(?:GPA|promedio)\s*(?::|of|is|de|es)?\s*\d(?:\.\d+)?/gi,'[grade omitted]')
  .replace(/\b(?:income|ingresos|salary|salario)\s*(?::|of|is|de|es)?\s*[\d,.]+/gi,'[income omitted]')
  .replace(/\b(?:my name is|me llamo|mi nombre es)\s+[^,.;!?\n]+/gi,'[name omitted]');
 for(const name of names.filter(n=>typeof n==='string'&&n.trim().length>=3))text=text.replace(new RegExp(`(?<![\\p{L}])${escape(name.trim())}(?![\\p{L}])`,'giu'),'[name omitted]');
 return text.replace(/[\u0000-\u001f]/g,' ').trim();
}
export function publicResearchInput(input,names=[]){
 return {question:publicSearchText(input.question,names).slice(0,3000),institution:publicSearchText(input.institution,names).slice(0,300)};
}
export function publicOpportunityInput(input,names=[]){
 return Object.fromEntries(['interest','location','distance','availability','type','paid','stage'].map(k=>[k,publicSearchText(input[k],names).slice(0,500)]));
}
export function publicRoadmapProfile(profile){
 // Never give a web-enabled model private notes, names, needs, grades or history.
 return Object.fromEntries(['stage','institutions','entryTerm'].map(k=>[k,publicSearchText(profile[k],[profile.name]).slice(0,1000)]));
}
export async function researchPrivateNames(req,database){
 if(!req.origenAuthorized)return [];
 if(!req.origenIdentity?.sub||!database)throw Object.assign(new Error('history_unavailable'),{status:503});
 const family=await createFamilyRepository(database)(req.origenIdentity.sub,{action:'load'});
 return [family.account.firstName,...family.students.map(s=>s.name)].flatMap(name=>typeof name==='string'?[name,...name.split(/\s+/).filter(part=>part.length>=3)]:[]);
}
