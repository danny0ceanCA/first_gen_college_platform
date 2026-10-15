import type {jsPDF} from 'jspdf';
import type {BinderExport} from './binderExport.mjs';
export function binderPdf(data:BinderExport,options?:{now?:Date}):jsPDF;
