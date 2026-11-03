import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth0} from '@auth0/auth0-react';
import {apiFetch} from './api';
import StaffVerification,{getStaffAccessToken,staffVerificationErrors} from './StaffVerification';
import {navigateWorkspace,useNavigationGuard} from './workspaceNavigation';
import {actionTemplateDrafts,actionGoals,actionProcesses,actionPrerequisites,actionExclusions,validateActionTemplate,type ActionTemplate} from './recommendationLibrary.mjs';
import './RecommendationTemplateEditor.css';

type Item={revision:number;draft:ActionTemplate;published:ActionTemplate|null;published_revision:number|null;teaching_revision:number|null};
type Capabilities={canAuthor:boolean;canPublish:boolean;processes:string[]};
type Preview={preview:string;content:ActionTemplate;teachingRevision:number|null};
const words=(v:string)=>v.replaceAll('_',' ');
const errors:Record<string,string>={invalid_action_template:'Check both languages, conditions, source links and dates. Review periods must be no longer than one year.',action_template_changed:'The saved action or linked teaching changed. Your edits are still here. Reload the saved action before reviewing and publishing again.',action_review_required:'Complete all three review confirmations.',action_publish_requirements:'Publish the linked teaching first and use current review dates.',action_library_denied:'Your action-library permission does not allow this change. A library operator can assign author or publisher access.',action_teaching_required:'Save or restore the linked teaching before editing its reusable action.',action_library_unavailable:'The library could not confirm the request. Your edits are still here. Retry a save, or reload to check whether publication completed.'};

export default function RecommendationTemplateEditor(props:{teachingId:string;teachingRevision:number;archived:boolean;onDenied:()=>void}){
 const [open,setOpen]=useState(false);
 return <section className="action-template-section"><button className="button outline" aria-expanded={open} onClick={()=>navigateWorkspace(()=>setOpen(v=>!v))}>Reusable action</button>
  {open&&<Editor {...props}/>}</section>;
}
function Editor({teachingId,teachingRevision,archived,onDenied}:{teachingId:string;teachingRevision:number;archived:boolean;onDenied:()=>void}){
 const {getAccessTokenSilently}=useAuth0();
 const [item,setItem]=useState<Item|null>(null),[draft,setDraft]=useState<ActionTemplate>(()=>actionTemplateDrafts()[0].content);
 const [caps,setCaps]=useState<Capabilities>({canAuthor:false,canPublish:false,processes:[]});
 const [current,setCurrent]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[review,setReview]=useState({independentlyAuthored:false,bilingual:false,sourcesAndScope:false});
 const [history,setHistory]=useState<{revision:number;action:string;created_at:string}[]|null>(null);
 const alive=useRef(true),pending=useRef(false),initial=useRef(JSON.stringify(draft));
 const dirty=loaded&&JSON.stringify(draft)!==(item?JSON.stringify(item.draft):initial.current);
 useNavigationGuard(dirty,{locked:busy});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const request=useCallback(async(input:unknown)=>{
  const token=await getStaffAccessToken(()=>getAccessTokenSilently());
  const r=await apiFetch('/api/recommendation-library',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
  const data=await r.json();if(!r.ok){if(r.status===401||data.error==='admin_required')onDenied();throw Error(data.error||'action_library_unavailable');}return data;
 },[getAccessTokenSilently,onDenied]);
 const install=useCallback((data:{item:Item|null;capabilities:Capabilities;current:boolean})=>{setItem(data.item);if(data.item)setDraft(data.item.draft);else{const starter=actionTemplateDrafts().find(d=>data.capabilities.processes.includes(d.content.process))||actionTemplateDrafts()[0];setDraft(starter.content);initial.current=JSON.stringify(starter.content);}setCaps(data.capabilities);setCurrent(data.current);setLoaded(true);setPreview(null);setReview({independentlyAuthored:false,bilingual:false,sourcesAndScope:false});setHistory(null);},[]);
 useEffect(()=>{let live=true;void request({action:'get',id:teachingId}).then(data=>{if(live)install(data);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[request,teachingId,install]);
 useEffect(()=>{setPreview(null);setReview({independentlyAuthored:false,bilingual:false,sourcesAndScope:false});setCurrent(false);},[teachingRevision]);
 const change=(next:ActionTemplate)=>{setDraft(next);setPreview(null);setReview({independentlyAuthored:false,bilingual:false,sourcesAndScope:false});setNotice('');};
 async function command(action:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{
   if(action==='save')validateActionTemplate(draft);
   const data=await request({action,id:teachingId,...(!['get','history'].includes(action)?{revision:item?.revision||0}:{}),...(action==='save'?{content:draft}:{}),...(action==='publish'?{preview:preview?.preview,review}:{})});
   if(!alive.current)return;
   if(action==='preview'){setPreview(data);setReview({independentlyAuthored:false,bilingual:false,sourcesAndScope:false});}
   else if(action==='history')setHistory(data.items);
   else{install(data);setNotice(action==='publish'?'Published to the reviewed action catalog. Student recommendations will use this catalog when that feature is connected.':action==='revoke'?'Publication revoked. This action is unavailable to future catalog reads.':action==='save'?'Action draft saved. A published version stays active until replaced, revoked, or its linked teaching changes.':'Saved action reloaded.');}
  }catch(e){if(alive.current){const code=e instanceof Error?e.message:'action_library_unavailable';setError(code);if(code==='action_template_changed')setPreview(null);}}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 const bilingual=(key:'action'|'explanation',lang:'en'|'es',label:string)=><label>{label}<textarea aria-label={label} rows={key==='action'?2:3} maxLength={key==='action'?500:1000} value={draft[key][lang]} onChange={e=>change({...draft,[key]:{...draft[key],[lang]:e.target.value}})}/></label>;
 const updateSource=(index:number,patch:Partial<ActionTemplate['sources'][number]>)=>change({...draft,sources:draft.sources.map((s,i)=>i===index?{...s,...patch}:s)});
 const canEdit=caps.canAuthor&&caps.processes.includes(draft.process)&&!archived;
 const canPublish=caps.canPublish&&caps.processes.includes(draft.process)&&!archived;
 return <section className="action-template-editor" aria-label="Reusable action editor" aria-busy={busy}>
  <h3>A clear next action</h3><p>Write general guidance for reuse. Keep student requests, family conversations and case-specific replies out of this library.</p>
  <p className="teaching-help">The linked teaching supplies the explanation. This action adds conditions, equivalent English and Spanish wording, and a separate publication review.</p>
  {item&&<p>{current?'Published and current':item.published?'Publication needs review':'Draft'} · Action revision {item.revision}{dirty?' · Unsaved changes':''}</p>}
  {notice&&<p className="teaching-notice" role="status">{notice}</p>}
  {staffVerificationErrors.includes(error)?<StaffVerification requireMfa={false} returnTo="#admin"/>:error&&<p role="alert" className="teaching-error">{errors[error]||errors.action_library_unavailable}</p>}
  {loaded&&!caps.canAuthor&&!caps.canPublish&&<p>Your administrator access can view this action. An operator must separately grant action-library author or publisher permission to make changes.</p>}
  {!loaded?<p>Loading the saved action…</p>:<>
   <fieldset disabled={busy||!canEdit}>
    <label>Start with a general question<select aria-label="Action starting point" value="" onChange={e=>{const selected=actionTemplateDrafts().find(x=>x.key===e.target.value);if(selected)change(selected.content);}}><option value="">Choose a draft…</option>{actionTemplateDrafts().map(x=><option key={x.key} value={x.key} disabled={!caps.processes.includes(x.content.process)}>{x.title}</option>)}</select></label>
    <div className="teaching-two"><label>Goal<select aria-label="Action goal" value={draft.goal} onChange={e=>change({...draft,goal:e.target.value})}>{actionGoals.map(x=><option key={x} value={x}>{words(x)}</option>)}</select></label><label>Process<select aria-label="Action process" value={draft.process} onChange={e=>change({...draft,process:e.target.value})}>{actionProcesses.map(x=><option key={x} value={x} disabled={!caps.processes.includes(x)}>{words(x)}</option>)}</select></label></div>
    {bilingual('action','en','Action in English')}{bilingual('action','es','Action in Spanish')}{bilingual('explanation','en','Why this helps in English')}{bilingual('explanation','es','Why this helps in Spanish')}
    <label>Kind of guidance<select aria-label="Kind of action guidance" value={draft.mode} onChange={e=>{const institutional=e.target.value==='institution_requirement';change({...draft,mode:institutional?'institution_requirement':'general_question',campus:institutional?{name:'',officialHost:''}:null,term:institutional?'':null,sources:[],prerequisites:institutional?[...new Set([...draft.prerequisites,'campus_confirmed','term_confirmed','current_official_requirement'])]:draft.prerequisites.filter(x=>!['campus_confirmed','term_confirmed','current_official_requirement'].includes(x))});}}><option value="general_question">General question to an office</option><option value="institution_requirement">A specific campus requirement</option></select></label>
    {draft.mode==='institution_requirement'&&<section aria-label="Campus and policy sources"><p className="teaching-help">Name the exact campus and term covered by every claim. An official-looking address alone does not prove that a policy applies to a student; current verification is required before use.</p>
     <label>Campus name<input aria-label="Action campus name" maxLength={160} value={draft.campus?.name||''} onChange={e=>change({...draft,campus:{name:e.target.value,officialHost:draft.campus?.officialHost||''}})}/></label>
     <label>Official campus website domain<input aria-label="Official campus domain" placeholder="example.edu" maxLength={253} value={draft.campus?.officialHost||''} onChange={e=>change({...draft,campus:{name:draft.campus?.name||'',officialHost:e.target.value}})}/></label>
     <label>Applicable term<input aria-label="Action term" maxLength={80} placeholder="Fall 2026" value={draft.term||''} onChange={e=>change({...draft,term:e.target.value})}/></label>
     {draft.sources.map((s,i)=><fieldset key={s.id} className="action-source"><legend>Official source {i+1}</legend><label>Source URL<input aria-label={`Action source ${i+1} URL`} type="url" maxLength={2000} value={s.url} onChange={e=>updateSource(i,{url:e.target.value})}/></label>
      {(['en','es'] as const).map(lang=><label key={lang}>Exact reviewed claim ({lang==='en'?'English':'Spanish'})<textarea aria-label={`Source ${i+1} claim ${lang}`} maxLength={1000} value={s.claim[lang]} onChange={e=>updateSource(i,{claim:{...s.claim,[lang]:e.target.value}})}/></label>)}
      <div className="teaching-two"><label>Source checked on<input aria-label={`Source ${i+1} checked on`} type="date" value={s.checkedOn} onChange={e=>updateSource(i,{checkedOn:e.target.value})}/></label><label>Source review by<input aria-label={`Source ${i+1} review by`} type="date" value={s.reviewBy} onChange={e=>updateSource(i,{reviewBy:e.target.value})}/></label></div>
      <button className="text-button" onClick={()=>change({...draft,sources:draft.sources.filter((_,j)=>i!==j)})}>Remove source {i+1}</button></fieldset>)}
     <button className="button outline" disabled={draft.sources.length>=8} onClick={()=>change({...draft,sources:[...draft.sources,{id:crypto.randomUUID(),url:'',claim:{en:'',es:''},checkedOn:draft.reviewedOn,reviewBy:draft.reviewBy}]})}>Add official source</button>
    </section>}
    <details><summary>When the action applies</summary><p>All selected prerequisites must be verified before offering the action.</p>{actionPrerequisites.map(x=><label className="teaching-checkbox" key={x}><input type="checkbox" checked={draft.prerequisites.includes(x)} disabled={draft.mode==='institution_requirement'&&['campus_confirmed','term_confirmed','current_official_requirement'].includes(x)} onChange={e=>change({...draft,prerequisites:e.target.checked?[...draft.prerequisites,x]:draft.prerequisites.filter(v=>v!==x)})}/>{words(x)}</label>)}</details>
    <details><summary>When to withhold the action</summary>{actionExclusions.map(x=><label className="teaching-checkbox" key={x}><input type="checkbox" checked={draft.exclusions.includes(x)} disabled={x!=='decision_received'} onChange={e=>change({...draft,exclusions:e.target.checked?[...draft.exclusions,x]:draft.exclusions.filter(v=>v!==x)})}/>{words(x)}</label>)}</details>
    <div className="teaching-two"><label>Action reviewed on<input aria-label="Action reviewed on" type="date" value={draft.reviewedOn} onChange={e=>change({...draft,reviewedOn:e.target.value})}/></label><label>Action review by<input aria-label="Action review by" type="date" value={draft.reviewBy} onChange={e=>change({...draft,reviewBy:e.target.value})}/></label></div>
   </fieldset>
   <div className="teaching-actions"><button className="button primary" disabled={busy||!canEdit||!!item&&!dirty} onClick={()=>void command('save')}>Save action draft</button><button className="button outline" disabled={busy||dirty||!item||!canPublish} onClick={()=>void command('preview')}>Preview saved action</button><button className="text-button" disabled={busy} onClick={()=>navigateWorkspace(()=>void command('get'))}>Reload saved action</button></div>
   {preview&&<section className="action-template-preview" aria-label="Saved action preview"><h4>Review this exact saved action</h4>
    {(['en','es'] as const).map(lang=><div key={lang} lang={lang}><strong>{lang==='en'?'English':'Spanish'}</strong><p>{preview.content.action[lang]}</p><p>{preview.content.explanation[lang]}</p></div>)}
    <p>Goal: {words(preview.content.goal)} · Process: {words(preview.content.process)}</p><p>{preview.content.campus?`${preview.content.campus.name} · ${preview.content.campus.officialHost} · ${preview.content.term}`:'General question; no campus-specific policy claim.'}</p>
    <p>Requires: {preview.content.prerequisites.map(words).join(', ')||'no additional recorded prerequisite'}. Withhold when: {preview.content.exclusions.map(words).join(', ')}.</p>
    {preview.content.sources.map((s,i)=><div key={s.id}><h4>Source {i+1}</h4><a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a><p lang="en">{s.claim.en}</p><p lang="es">{s.claim.es}</p><p>Checked {s.checkedOn}; review by {s.reviewBy}.</p></div>)}
    <p>Reviewed {preview.content.reviewedOn}; review by {preview.content.reviewBy}.</p><p className="teaching-help">Publication adds reviewed guidance to the catalog. It cannot authorize a student action, determine eligibility, calculate aid, or change Origen’s privacy and tool rules.</p>
    <fieldset disabled={busy||!canPublish}><label className="teaching-checkbox"><input type="checkbox" checked={review.independentlyAuthored} onChange={e=>setReview({...review,independentlyAuthored:e.target.checked})}/>I independently authored this reusable guidance without private student or family records.</label><label className="teaching-checkbox"><input type="checkbox" checked={review.bilingual} onChange={e=>setReview({...review,bilingual:e.target.checked})}/>I reviewed equivalent meaning in English and Spanish.</label><label className="teaching-checkbox"><input type="checkbox" checked={review.sourcesAndScope} onChange={e=>setReview({...review,sourcesAndScope:e.target.checked})}/>I checked the claims, sources, campus, term, dates and conditions. General questions make no policy or eligibility claim.</label>
     <button className="button primary" disabled={!Object.values(review).every(Boolean)||dirty||!preview.teachingRevision} onClick={()=>void command('publish')}>Publish reviewed action</button>{!preview.teachingRevision&&<p>Publish the linked teaching before publishing this action.</p>}</fieldset>
   </section>}
   {item?.published&&<button className="button outline" disabled={busy||dirty||!caps.canPublish} onClick={()=>void command('revoke')}>Revoke action publication</button>}
   {item&&<details onToggle={e=>{if(e.currentTarget.open&&!history)void command('history');}}><summary>Action revision history</summary>{history?.map(h=><p key={h.revision}>Revision {h.revision} · {h.action} · {new Date(h.created_at).toLocaleString()}</p>)}</details>}
  </>}
 </section>;
}
