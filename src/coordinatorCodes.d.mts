export function normalizeCoordinatorCode(value:unknown):string|null;
export function redactCoordinatorCodes(value:string):string;
export function redactCoordinatorTurns<T extends {role:string;text:string}>(turns:T[]):T[];
