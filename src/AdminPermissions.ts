import {createContext,useContext} from 'react';
export const AdminPermissions=createContext<string[]>([]);
export const useAdminAction=(action:string)=>useContext(AdminPermissions).includes(action);
