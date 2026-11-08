import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function verifyIsolation() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/').replace(/\/$/, '')}`, ...args], { cwd: root, encoding: 'utf8' });
  const baseline = JSON.parse(readFileSync(new URL('./runtime-baseline.json', import.meta.url), 'utf8'));
  const hooks = JSON.parse(readFileSync(new URL('./local-call/runtime-hooks.json', import.meta.url), 'utf8')).files;
  if (JSON.stringify(hooks.map(h => h.path).sort()) !== JSON.stringify(['server/index.mjs', 'server/voice-control.mjs'])) throw new Error('unexpected_runtime_hook');
  const paths = git('ls-files', '-z').split('\0').filter(p => p && !p.startsWith('docs/') && p !== 'AGENTS.md' && !p.startsWith('research/decisions/')).sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    let digest = createHash('sha256').update(readFileSync(resolve(root, path))).digest();
    const hook = hooks.find(h => h.path === path);
    if (hook) {
      if (digest.toString('hex') !== hook.reviewedSha256) throw new Error('unreviewed_runtime_hook_change');
      const original = git('show', `${baseline.commit}:${path}`).replace(/\r?\n/g, hook.baselineNewlines === 'crlf' ? '\r\n' : '\n');
      digest = createHash('sha256').update(original).digest();
      if (digest.toString('hex') !== hook.baselineSha256) throw new Error('invalid_hook_baseline');
    }
    hash.update(path + '\0').update(digest);
  }
  const actual = { files: paths.length, sha256: hash.digest('hex') };
  if (actual.files !== baseline.files || actual.sha256 !== baseline.sha256) throw new Error('protected_files_changed');
  return { ...actual, baselineCommit: baseline.commit, matches: true, reviewedLocalHooks: hooks.map(h => h.path), unchangedRuntimeFiles: paths.length - hooks.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyIsolation())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
