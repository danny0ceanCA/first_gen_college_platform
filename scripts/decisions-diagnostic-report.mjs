import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDecisionsDiagnosticReport } from '../research/decisions/local-call/diagnostic-report.mjs';

// Explicitly offline: consumes a user-provided export, never queries production.
const args = process.argv.slice(2);
const usage = 'Usage: node scripts/decisions-diagnostic-report.mjs <events.json|events.jsonl> [--reviews cases.json] [--output report.json]';
try {
  if (!args.length || args[0].startsWith('--')) throw Error(usage);
  const input = args.shift(), options = {};
  while (args.length) {
    const name = args.shift(), value = args.shift();
    if (!['--reviews', '--output'].includes(name) || !value || options[name]) throw Error(usage);
    options[name] = value;
  }
  async function readBounded(file) {
    const path = resolve(file);
    if ((await stat(path)).size > 32 * 1024 * 1024) throw Error('Input exceeds 32 MiB; use a bounded diagnostic export.');
    return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  }
  const text = await readBounded(input);
  const events = input.toLowerCase().endsWith('.jsonl') ? text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)) : JSON.parse(text);
  const reviewedCases = options['--reviews'] ? JSON.parse(await readBounded(options['--reviews'])) : [];
  const output = JSON.stringify(buildDecisionsDiagnosticReport(events, { reviewedCases }), null, 2) + '\n';
  if (options['--output']) await writeFile(resolve(options['--output']), output, { flag: 'wx' });
  else process.stdout.write(output);
} catch (error) {
  // JSON parse messages can include source text. Keep diagnostics exports private.
  process.stderr.write(error instanceof SyntaxError ? 'Invalid JSON in diagnostic input.\n' : `${error.message}\n`);
  process.exitCode = 1;
}
