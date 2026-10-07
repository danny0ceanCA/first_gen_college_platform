export function rebaseInstitutionDraft(base,draft,latest){
 const merged={},conflicts=[];
 for(const field of new Set([...Object.keys(base),...Object.keys(draft),...Object.keys(latest)])){
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const edited=!same(draft[field],base[field]);
  merged[field]=edited?draft[field]:latest[field];
  if(edited&&!same(latest[field],base[field])&&!same(latest[field],draft[field]))conflicts.push(field);
 }
 return {merged,conflicts};
}
