// Accept a bare domain without requiring a www prefix. Keep explicit unsafe
// schemes, credentials, fragments and query strings out of application URLs.
export function normalizeCoordinatorWebsite(value=''){
 if(typeof value!=='string')throw new Error('invalid_organization_website');
 const raw=value.trim();if(!raw)return '';
 if(raw.length>2000||/[\s\\\x00-\x1f]/.test(raw))throw new Error('invalid_organization_website');
 const candidate=raw.startsWith('//')?'https:'+raw:/^[a-z][a-z0-9+.-]*:/i.test(raw)?raw:'https://'+raw;
 let url;try{url=new URL(candidate);}catch{throw new Error('invalid_organization_website');}
 if(url.protocol!=='https:'||!url.hostname.includes('.')||url.username||url.password||url.search||url.hash||url.href.length>2000)throw new Error('invalid_organization_website');
 return url.href;
}
