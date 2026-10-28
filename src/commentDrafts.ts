// Short interruptions can unmount the shared page. Keep only the author's
// unfinished text in memory, scoped to this session and exact publication.
import {browserPrivacy} from './browserPrivacy.mjs';
type Draft={body:string;kind:string;resourceUrl:string;publicationItemId:string;id?:string;version?:number};
type Retry={payload:string;id:string};
const drafts=new Map<string,{draft:Draft;retry:Retry|undefined;until:number}>();
browserPrivacy.subscribe(()=>drafts.clear());
export function commentDraftKey(scope:unknown[]){return JSON.stringify([browserPrivacy.subject,...scope]);}
export function holdCommentDraft(key:string,draft:Draft|undefined,retry:Retry|undefined){if(browserPrivacy.valid()&&draft?.body?.trim())drafts.set(key,{draft,retry,until:Date.now()+1800000});}
export function takeCommentDraft(key:string){const value=drafts.get(key);drafts.delete(key);return browserPrivacy.valid()&&value&&value.until>Date.now()?value:undefined;}
export const discardCommentDraft=(key:string)=>drafts.delete(key);
