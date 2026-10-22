import {defineConfig} from 'vite';
// Fixed synthetic snapshot: no production environment, API proxy or filesystem
// watcher over the busy disposable PostgreSQL data/evidence directories.
export default defineConfig({
 root:process.cwd(),envDir:false,
 define:{'import.meta.env.VITE_AUTH0_DOMAIN':JSON.stringify('synthetic.example'),'import.meta.env.VITE_AUTH0_CLIENT_ID':JSON.stringify('synthetic'),'import.meta.env.VITE_AUTH0_AUDIENCE':JSON.stringify('synthetic'),'import.meta.env.VITE_API_URL':JSON.stringify('')},
 optimizeDeps:{entries:['index.html']},
 server:{host:'127.0.0.1',port:5179,strictPort:true,watch:null},
});
