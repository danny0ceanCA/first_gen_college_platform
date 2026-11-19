const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// Lexical aliases preserve the original source label and amount. They do not
// approve a category mapping, split bundled costs, or establish additivity.
const aliases=[
 [/\b(?:textbooks?|books?|libros?)\b/gu,'books'],
 [/\b(?:supplies|materials|materiales|suministros)\b/gu,'supplies'],
 [/\b(?:matricula|colegiatura|aranceles?)\b/gu,'tuition'],
 [/\b(?:equipment|equipo)\b/gu,'equipment'],
 [/\b(?:uniforms?|uniformes?)\b/gu,'uniform'],
 [/\b(?:transportation|transporte)\b/gu,'transportation'],
 [/\b(?:food|meals?|comida|alimentacion)\b/gu,'food'],
 [/\b(?:housing|vivienda|alojamiento)\b/gu,'housing'],
 [/\bseguro medico\b/gu,'health insurance'],
 [/\bgastos personales\b/gu,'personal expenses'],
 [/\b(?:cuota|costo) de (?:la )?solicitud\b/gu,'application fee'],
 [/\bcuota de documentos?\b/gu,'document fee'],
 [/\bid de estudiante\b/gu,'student id'],
 [/\bcuotas?\b/gu,'fees'],
];
export function componentText(value){return aliases.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),fold(value));}
const nouns='health insurance|personal expenses|application fee|document fee|student id|tuition|books|supplies|equipment|uniform|transportation|food|housing|fees?';
const chargeNames='nclex|teas|hesi|ati|bls|cpr';
const componentNames=value=>[...componentText(value).matchAll(new RegExp(`\\b(?:${nouns})\\b`,'gu'))].map(m=>/^fees?$/u.test(m[0])?'fees':m[0]);
export const nursingChargeIdentifiers=value=>[...new Set((componentText(value).match(new RegExp(`\\b(?:${chargeNames})\\b`,'gu'))||[]))];
export function nursingComponentMentioned(label,name){
 const source=componentText(label);
 return name==='fees'?/\bfees?\b/u.test(source):(' '+source+' ').includes(' '+name+' ');
}
export function nursingComponentQuery(question,{institution}={}){
 const excludedItem=`(?:(?:the|any|all|el|la|los|las) )?(?:(?:estimated|mandatory|required|optional|standard|estimad[oa]s?|obligatori[oa]s?) )?(?:${nouns}|${chargeNames})`;
 const excluded=new RegExp(`\\b(?:excluding|without|not including|except|minus|less|sin incluir|sin|excluyendo|no incluyas|menos) ${excludedItem}(?: (?:and|y|ni) ${excludedItem})*\\b`,'gu');
 // A college name identifies the subject, not a requested charge. Remove the
 // complete name before fee matching; an explicit fee outside it stays intact.
 const campus=fold(institution),query=campus?(' '+fold(question)+' ').split(' '+campus+' ').join(' ').trim():fold(question);
 const scoped=query.replace(/\b(?:housing scenario (?:off campus housing arrangement unspecified|renting off campus|living with family)|modalidad de vivienda (?:alojamiento fuera del campus modalidad sin especificar|alquiler fuera del campus|vivir con familiares))$/u,'');
 const exclusions=[];
 const text=componentText(scoped).replace(excluded,match=>{exclusions.push(...componentNames(match),...nursingChargeIdentifiers(match));return ' ';}).replace(/\s+/gu,' ').trim();
 const components=[...new Set(componentNames(text))],identifiers=nursingChargeIdentifiers(text);
 const requested=Boolean(components.length||identifiers.length);
 const componentTotal=new RegExp(`\\b(?:(?:total (?:costs? (?:of|for) )?(?:the )?|(?:costs?|budget|costo|costos|presupuesto)(?: total)? (?:of|for|de|del|para) (?:the |los |las |el |la )?)(?:${nouns})|(?:${nouns}) (?:costs?|budget|costo|costos|presupuesto))\\b`,'u').test(text);
 const overall=/\b(?:coa|cost of attendance|costo de asistencia|(?:whole|entire) program|total (?:nursing )?program|overall(?:(?: nursing)? program| nursing)? (?:cost|budget)|presupuesto total de enfermeria|(?:costo total|presupuesto) del programa)\b/u.test(text);
 return {text,requested,components,identifiers,exclusions:[...new Set(exclusions)],overall,componentTotal:componentTotal&&!overall};
}
