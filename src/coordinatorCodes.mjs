export function normalizeCoordinatorCode(value){
 if(typeof value!=='string'||value.length>100)return null;
 const code=value.toUpperCase().replace(/[\s-]/g,'');
 return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(code)?code:null;
}
// Sanitize before local recovery and again before server summarization. Spelled
// codes/ambiguous linking turns are omitted, never retained as student memories.
export function redactCoordinatorCodes(value){
 if(typeof value!=='string'||['[Coordinator connection details omitted]','[Connection code omitted]'].includes(value))return value;
 if(/\b(coordinator|coordinador[a]?|connection|conexi[oó]n)\b/i.test(value)&&/\b(code|key|c[oó]digo|clave)\b/i.test(value))return '[Coordinator connection details omitted]';
 // The code alphabet also matches ordinary words ("understand", "assessment")
 // and phrases ("study plans"). In prose, require a code cue or code-like casing,
 // digits, or a hyphen. Linking exchanges and actual lookups are also omitted
 // by redactCoordinatorTurns and the voice tool's onCode callback.
 return value.replace(/\b(?:[23456789A-HJ-NP-Z][\s-]+){9}[23456789A-HJ-NP-Z]\b|\b[23456789A-HJ-NP-Z]{5}[\s-][23456789A-HJ-NP-Z]{5}\b|\b[23456789A-HJ-NP-Z]{10}\b/gi,(match,offset)=>{
  const codeCue=/\b(code|key|c[oó]digo|clave)\s*(?:(?:is|es)\s*)?[:=]?\s*$/i.test(value.slice(0,offset));
  const spelled=/^(?:[23456789A-HJ-NP-Z][\s-]+){9}[23456789A-HJ-NP-Z]$/i.test(match);
  return codeCue||spelled||/[2-9-]/.test(match)||match===match.toUpperCase()?'[connection code omitted]':match;
 });
}
export function redactCoordinatorTurns(turns){
 let awaitingCode=false;
 return turns.map(turn=>{
  const text=redactCoordinatorCodes(turn.text),linkTurn=text==='[Coordinator connection details omitted]';
  const omit=awaitingCode&&turn.role==='user';
  if(omit)awaitingCode=false;
  if(linkTurn)awaitingCode=true;
  return {...turn,text:omit?'[Connection code omitted]':text};
 });
}
