// Preserve unchanged words, including suffixes, when a spoken correction lands.
export function onboardingInk(previous,next){
 const before=String(previous||'').split(/(\s+)/),tokens=String(next||'').split(/(\s+)/);
 let start=0,end=tokens.length,oldEnd=before.length;
 while(start<end&&start<oldEnd&&tokens[start]===before[start])start++;
 while(end>start&&oldEnd>start&&tokens[end-1]===before[oldEnd-1]){end--;oldEnd--;}
 return {tokens,start,end,correction:oldEnd>start&&Boolean(previous)};
}
