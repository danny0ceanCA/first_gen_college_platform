export function loadCoordinatorApplicationPage<T>(request:(input:{action:'applications';after:string})=>Promise<{applications?:T[]}>,after?:string):Promise<{applications:T[];after:string}>;
