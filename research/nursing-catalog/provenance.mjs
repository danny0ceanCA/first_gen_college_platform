export function catalogDate(value){
 if(value instanceof Date)return Number.isFinite(value.getTime())?value.toISOString():null;
 if(typeof value!=='string')return null;
 const text=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)?value+'Z':value;
 const time=Date.parse(text);return Number.isFinite(time)?new Date(time).toISOString():null;
}

// Provenance is issued only from an explicitly published database row. It
// authorizes bounded reuse of a workbook-reported reference, not source review.
export function nursingSourceProvenance(row,url,now){
 const record=row.payload??row,checkedAt=catalogDate(record.values['Source checked']);
 const validUntil=catalogDate(row.valid_until),retrievedAt=new Date(now).toISOString();
 const published=row.caveated_publication===true&&row.publication_id&&
  /^[a-f0-9]{64}$/u.test(row.batch_id||'')&&/^[a-f0-9]{64}$/u.test(row.record_digest||'')&&
  /^NUR-\d{4}$/u.test(record.id||'')&&checkedAt&&validUntil&&Date.parse(checkedAt)<=now&&now<Date.parse(validUntil);
 const catalogValidity=published?{version:1,kind:'published_catalog',batchId:row.batch_id,recordId:record.id,recordDigest:row.record_digest,
  sourceUrl:url,sourceCheckedAt:checkedAt,reviewedAt:checkedAt,retrievedAt,validUntil,reviewBasis:'workbook_reported'}:null;
 return {checkedAt,catalogValidity};
}
