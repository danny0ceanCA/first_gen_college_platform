import {budgetAudit} from '../src/publishedBudget.mjs';
import {requestedResearchAspects} from '../src/researchQuestion.mjs';

export function requestsCoa(question){
 const aspects=requestedResearchAspects(question);
 if(aspects.includes('total_budget'))return true;
 if(aspects.includes('tuition_fees'))return false;
 return /\b(?:costs?|cu[aá]nto cuesta|costos?|costo)\b/iu.test(question||'');
}

export function hasCoaBreakdown(finding){
 if(finding?.aspect!=='total_budget'||finding.status==='unverified'||!finding.sourceIds?.length)return false;
 if(finding.budget)return budgetAudit(finding.budget).complete;
 const [summary,breakdown]=finding.answer.split(/\b(?:published breakdown|desglose publicado)\s*:/iu);
 if(!breakdown||!/(?:US\$|USD\s*\$?|\$|€|£)\s*\d/u.test(summary))return false;
 // Official categories can be combined. Require labeled amounts and preserve
 // the source's categories rather than inventing a fixed cost template.
 const components=breakdown.match(/[\p{L}][\p{L}\s/&,()-]*:\s*(?:USD\s*)?(?:US\$|\$|€|£)\s*\d[\d,.]*/gu)||[];
 return components.length>=3;
}
