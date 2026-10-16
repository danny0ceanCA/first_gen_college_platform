import ts from 'typescript';
import {readdir,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// These CLI reports intentionally print operator-facing output. They are not
// HTTP paths or agent tools; their output must never be imported as telemetry.
const operatorCLI=new Set(['server/guidance-report.mjs','server/progress-report.mjs','server/model-evaluation.mjs','server/migrate.mjs','server/production-config.mjs']);
export function loggingPolicyIssues(source,path){
 if(operatorCLI.has(path)||path.endsWith('.test.mjs'))return [];
 const issues=[],tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 function visit(node){
  if((ts.isIdentifier(node)&&node.text==='console')||(ts.isStringLiteral(node)&&node.text==='console'&&ts.isElementAccessExpression(node.parent)))issues.push('console_access');
  if(path!=='server/observability/logger.mjs'&&ts.isPropertyAccessExpression(node)&&node.expression.getText(tree)==='process'&&['stdout','stderr'].includes(node.name.text))issues.push('direct_log_stream');
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(tree)==='JSON'&&node.expression.name.text==='stringify'&&node.arguments.some(arg=>ts.isIdentifier(arg)&&/^(?:e|err|error|exception)$/i.test(arg.text)))issues.push('raw_error_serialization');
  ts.forEachChild(node,visit);
 }
 visit(tree);return [...new Set(issues)];
}
export async function checkLoggingPolicy(root=new URL('../server/',import.meta.url)){
 const issues=[];
 async function walk(url,prefix){for(const entry of await readdir(url,{withFileTypes:true})){
  if(entry.isDirectory())await walk(new URL(entry.name+'/',url),prefix+entry.name+'/');
  else if(entry.name.endsWith('.mjs')){
   const path=prefix+entry.name;
   for(const code of loggingPolicyIssues(await readFile(new URL(entry.name,url),'utf8'),path))issues.push({path,code});
  }
 }}
 await walk(root,'server/');return issues;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const issues=await checkLoggingPolicy();
 if(issues.length){for(const issue of issues)process.stderr.write(`${issue.path}: ${issue.code}\n`);process.exitCode=1;}
 else process.stdout.write('Production logging policy checks passed.\n');
}
