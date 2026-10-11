// The API never serves an application document or requests device permissions.
export function apiSecurityHeaders(res,production=false){
 res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
 if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
