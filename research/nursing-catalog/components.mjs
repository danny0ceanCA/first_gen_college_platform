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
];
export function componentText(value){return aliases.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),fold(value));}
const nouns='health insurance|personal expenses|application fee|document fee|student id|tuition|books|supplies|equipment|uniform|transportation|food|housing';
export function nursingComponentQuery(question,{institution}={}){
 const excluded=new RegExp(`\\b(?:excluding|without|not including|except|sin incluir|sin|excluyendo|no incluyas) (?:the |el |la |los |las )?(?:${nouns})(?: (?:and|y) (?:${nouns}))*\\b`,'gu');
 // A college name identifies the subject, not a requested charge. Remove the
 // complete name before fee matching; an explicit fee outside it stays intact.
 const campus=fold(institution),query=campus?(' '+fold(question)+' ').split(' '+campus+' ').join(' ').trim():fold(question);
 const scoped=query.replace(/\b(?:housing scenario (?:off campus housing arrangement unspecified|renting off campus|living with family)|modalidad de vivienda (?:alojamiento fuera del campus modalidad sin especificar|alquiler fuera del campus|vivir con familiares))$/u,'');
 const text=componentText(scoped).replace(excluded,' ').replace(/\s+/gu,' ').trim();
 const requested=new RegExp(`\\b(?:${nouns})\\b`,'u').test(text);
 const componentTotal=new RegExp(`\\b(?:(?:total (?:costs? (?:of|for) )?(?:the )?|(?:costs?|budget|costo|costos|presupuesto)(?: total)? (?:of|for|de|del|para) (?:the |los |las |el |la )?)(?:${nouns})|(?:${nouns}) (?:costs?|budget|costo|costos|presupuesto))\\b`,'u').test(text);
 const overall=/\b(?:coa|cost of attendance|costo de asistencia|(?:whole|entire) program|total (?:nursing )?program|overall (?:cost|budget)|presupuesto total de enfermeria|(?:costo total|presupuesto) del programa)\b/u.test(text);
 return {text,requested,componentTotal:componentTotal&&!overall};
}
