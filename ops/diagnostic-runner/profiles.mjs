// Trusted runner policy. Never load commands from package.json or a candidate patch.
export const profiles = Object.freeze({
 'logging-contracts': Object.freeze(['node','--test','--test-reporter=tap','server/observability-schema.test.mjs','server/observability-logging.test.mjs','server/api-logging.test.mjs']),
 'permission-isolation': Object.freeze(['node','--test','--test-reporter=tap','server/account-isolation.test.mjs','server/guardian-permission.test.mjs','server/permission-runner-regression.test.mjs']),
 'voice-summary': Object.freeze(['node','--test','--test-reporter=tap','server/conversation-summary.test.mjs','server/summary-save-queue.test.mjs','server/voice-memory.test.mjs','server/runner-regression.test.mjs']),
 'frontend-build': Object.freeze(['node','/opt/deps/node_modules/typescript/bin/tsc','-b']),
});
export const buildSecondCommand = Object.freeze(['node','/opt/deps/node_modules/vite/bin/vite.js','build']);
export const limits = Object.freeze({cpu:1,memoryMiB:1024,diskMiB:512,pids:128,timeoutMs:300000,outputBytes:20*1024*1024,jobs:2});
