// References carry identity only. Validation is not authorization, consent, or
// proof that a response is still available. Resolve again at each point of use.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const invalid=()=>{throw Object.assign(new Error('invalid_review_response_reference'),{status:400});};

export function validateReviewResponseReference(value){
 if(!object(value)||Object.keys(value).some(key=>!['kind','requestId','responseVersion'].includes(key))
  ||value.kind!=='review-response'||!uuid(value.requestId)||!Number.isSafeInteger(value.responseVersion)
  ||value.responseVersion<1||value.responseVersion>2147483647)invalid();
 return {kind:'review-response',requestId:value.requestId.toLowerCase(),responseVersion:value.responseVersion};
}

// These are prospective link purposes, not commands to record activity. In
// particular, a private-choice reference cannot accept a plan or send a reply.
export function validateReviewResponseIntent(value){
 if(!object(value)||Object.keys(value).some(key=>!['purpose','source'].includes(key))
  ||!['conversation-focus','private-choice','related-request'].includes(value.purpose))invalid();
 return {purpose:value.purpose,source:validateReviewResponseReference(value.source)};
}
