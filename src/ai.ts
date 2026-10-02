import {apiFetch} from './api';
/** Purpose-based boundary. Real OpenAI calls must run on a server, never with browser API keys. */
export type AIPurpose = 'conversation' | 'college-research' | 'opportunity-search' | 'roadmap';
export interface SearchPreferences {interest:string;location:string;distance:string;availability:string;type:string;paid:string;stage:string}
export interface AIRequest { audience?:'parent'|'student'; searchPreferences?:SearchPreferences; purpose: AIPurpose; studentId: string; message: string; language: 'en' | 'es'; guidanceTopic?:string; guidanceMode?:'interests'|'pathways'|'affordability'; studentContext?: {name:string;stage:string;interest:string;gpa:string;parentNotes:string;school?:string;activities?:string;goals?:string;needs?:string;notes?:string;institutions?:string;entryTerm?:string}; history?: {role:'parent'|'assistant';text:string}[] }
export interface AIResponse { steps?:import('./planning').PlanDraft[]; text: string; parts?:{text:string;url?:string;title?:string}[]; checkedAt?:string; mode: 'demo' | 'live'; sources: { title: string; url: string; checkedAt: string }[] }
export interface AIGateway { respond(request: AIRequest): Promise<AIResponse> }
export const liveGateway: AIGateway = {
  async respond(request) {
    const response = await apiFetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(280000)});
    const data = await response.json().catch(()=>({error:'connection_error'}));
    if(!response.ok || typeof data.text!=='string') throw new Error(data.error||'connection_error');
    return data;
  }
};
// Replace this adapter with a server endpoint. The server selects a model per purpose.
// Research adapters must retrieve and verify sources; reasoning alone is not current search.
export const demoGateway: AIGateway = {
  async respond({ purpose, language, studentContext }) {
    const es = language === 'es';
    const text = purpose === 'conversation'
      ? es ? 'Podemos empezar con lo que disfruta tu estudiante, dentro y fuera de la escuela. ¿Qué actividad le gustaría explorar? Esta es una respuesta de ejemplo; todavía no hay una conexión con IA.' : 'We can start with what your student enjoys, in and outside school. What is one interest they would like to explore? This is a sample response; live AI is not connected yet.'
      : es ? 'Esta vista muestra cómo funcionará la búsqueda. Todavía no hemos realizado una búsqueda en vivo ni verificado oportunidades actuales.' : 'This preview shows how research will work. No live search has been performed and no current opportunities have been verified.';
    if(purpose==='conversation'&&studentContext){
      const name=studentContext.name;
      const transfer=studentContext.stage==='Community college';
      return {text:es?`Ejemplo para ${name}: ${transfer?'podemos organizar preguntas sobre carreras y cursos para una conversación con su consejero de transferencia.':'podemos comenzar por una conversación sobre lo que disfruta y una actividad que le gustaría explorar.'} ${studentContext.parentNotes?'Incluiste contexto adicional que un modelo en vivo podrá usar para personalizar la orientación.':'Cuéntanos qué le interesa o qué le está resultando difícil.'} Esta respuesta es una demostración, no un análisis de tu pregunta con IA.`:`Example for ${name}: ${transfer?'we could organize questions about majors and courses for a conversation with a transfer counselor.':'we could start with what they enjoy and one activity they would like to explore.'} ${studentContext.parentNotes?'You added context that a live model can use to personalize guidance.':'Tell us what interests them or what they find challenging.'} This is a demonstration response, not an AI analysis of your question.`,mode:'demo',sources:[]};
    }
    return { text, mode: 'demo', sources: [] };
  }
};
