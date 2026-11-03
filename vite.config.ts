import {createSummaryHandler} from './server/conversation-summary.mjs';
import {createAdmissionsResearchHandler} from './server/admissions-research.mjs';
import {createDiagnostics,createDiagnosticHandler} from './server/diagnostics.mjs';
import {createFinanceResearchHandler} from './server/finance-research.mjs';
import { createProfileVoiceHandler } from './server/profile-voice.mjs';
import { defineConfig, loadEnv } from 'vite';
import { createAIHandler } from './server/ai.mjs';

export default defineConfig(({mode}) => {
  // Loaded here only: never place secrets in define, VITE_ variables, or client code.
  const env = {...loadEnv(mode, process.cwd(), ''), ...process.env};
  // Optional local UI against the deployed API. User bearer tokens still undergo
  // the API's normal authorization; no server credentials are added here.
  const apiTarget = mode === 'development' ? env.DEV_API_PROXY_TARGET : undefined;
  const log=createDiagnostics(); const diagnostics=createDiagnosticHandler(log);
  const admissionsMiddleware=createAdmissionsResearchHandler(env,fetch,log);
  const financeMiddleware=createFinanceResearchHandler(env,fetch,log);
  const summaryMiddleware=createSummaryHandler(env); const middleware = createAIHandler(env); const voiceMiddleware = createProfileVoiceHandler(env,fetch,log);
  return {
    server: {host:'127.0.0.1',port:5173,strictPort:true,proxy:apiTarget?{
      '/api':{target:apiTarget,changeOrigin:true,configure(proxy){
        // This is a server-to-server request, rather than browser CORS.
        proxy.on('proxyReq',request=>request.removeHeader('origin'));
      }}
    }:undefined},
    preview: {host:'127.0.0.1'},
    plugins:[{name:'camino-local-api',configureServer(server){if(apiTarget)return;server.middlewares.use(summaryMiddleware);server.middlewares.use(diagnostics);server.middlewares.use(financeMiddleware);server.middlewares.use(admissionsMiddleware);server.middlewares.use(voiceMiddleware);server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(summaryMiddleware);server.middlewares.use(diagnostics);server.middlewares.use(financeMiddleware);server.middlewares.use(admissionsMiddleware);server.middlewares.use(voiceMiddleware);server.middlewares.use(middleware);}}]
  };
});
