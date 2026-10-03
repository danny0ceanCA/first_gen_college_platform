// Only the gateway sets these flags after validating origins and access policy.
export function allowedRequest(req,allowMissing=false){
 if(req.origenAuthorized===true||req.origenPreview===true)return true;
 const host=req.headers.host;
 return /^(localhost|127\.0\.0\.1):\d+$/.test(host||'') && ((allowMissing&&!req.headers.origin)||req.headers.origin===`http://${host}`);
}
