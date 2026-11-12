// Application-owned provenance, not a claim that retrieval rechecked a website.
// Catalog metadata is issued only from reviewed/test PostgreSQL views. Provider
// search output does not issue this contract. Ordinary web results retain their
// existing five-minute policy; malformed/expired catalog metadata fails closed.
export function sourceIsCurrent(source,now=Date.now()){
 const checked=Date.parse(source?.checkedAt);
 if(source?.catalogValidity===undefined)return Number.isFinite(checked)&&now>=checked&&now-checked<300000;
 const c=source.catalogValidity;
 if(!c||c.version!==1||!['reviewed_catalog','local_testing_catalog'].includes(c.kind)||
  !/^[a-f0-9]{64}$/u.test(c.batchId||'')||!/^[a-f0-9]{64}$/u.test(c.recordDigest||'')||
  !/^[a-zA-Z0-9_-]{1,100}$/u.test(c.recordId||'')||c.sourceUrl!==source.url||c.sourceCheckedAt!==source.checkedAt||
  !['independent_review','workbook_reported'].includes(c.reviewBasis))return false;
 const reviewed=Date.parse(c.reviewedAt),retrieved=Date.parse(c.retrievedAt),expires=Date.parse(c.validUntil);
 return [now,checked,reviewed,retrieved,expires].every(Number.isFinite)&&checked<=retrieved&&reviewed<=retrieved&&
  retrieved<=now&&reviewed<expires&&now<expires&&
  (c.kind!=='reviewed_catalog'||c.reviewBasis==='independent_review');
}

// A shared URL can support records with different approvals/expiry. Do not let
// source deduplication transfer one record's validity to a different record.
export function sameResearchSource(a,b){
 if(a.url!==b.url||a.checkedAt!==b.checkedAt)return false;
 const left=a.catalogValidity,right=b.catalogValidity;
 if(!left||!right)return left===right;
 return ['version','kind','batchId','recordId','recordDigest','sourceUrl','sourceCheckedAt','reviewedAt','validUntil','reviewBasis'].every(key=>left[key]===right[key]);
}
