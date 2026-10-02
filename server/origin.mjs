// Only the production gateway can set this flag after origin and JWT validation.
export function allowedRequest(req,allowMissing=false){
 if(req.origenAuthorized===true)return true;
 const host=req.headers.host;
 return /^(localhost|127\.0\.0\.1):\d+$/.test(host||'') && ((allowMissing&&!req.headers.origin)||req.headers.origin===`http://${host}`);
}
