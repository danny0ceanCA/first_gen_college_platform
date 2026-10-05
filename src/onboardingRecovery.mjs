// Account-scoped, short-lived drafts. No audio, credentials, or access tokens.
export function onboardingRecovery(storage,key,now=Date.now){
 return {
  read(fallback){try{const record=JSON.parse(storage.getItem(key)||'null');return record&&record.version===1&&now()-record.at<86400000?record.value:fallback;}catch{return fallback;}},
  write(value){try{storage.setItem(key,JSON.stringify({version:1,at:now(),value}));return true;}catch{return false;}},
  clear(){try{storage.removeItem(key);}catch{}}
 };
}
