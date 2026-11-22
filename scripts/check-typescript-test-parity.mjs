import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(root, 'scripts', 'test-typescript-dist.mjs');

function run(mode) {
  const args = [runner, ...(mode === 'baseline' ? ['--baseline'] : [])];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
  const failures = [];
  let summary = false;
  for (const line of output.split('\n')) {
    if (line.startsWith('✖ failing tests:')) summary = true;
    if (summary || !line.startsWith('✖ ')) continue;
    failures.push(line.slice(2).trim().replace(/ \(\d+(?:\.\d+)?ms\)$/, ''));
  }
  const passed = output.split('\n').filter(line => line.startsWith('✔ ')).length;
  if (result.status !== 0 && failures.length === 0) {
    throw new Error(mode + ' runner terminated without test results: ' + output.slice(-2500));
  }
  return { exit: result.status, passed, failures: failures.sort() };
}

const baseline = run('baseline');
const migrated = run('migrated');
const newFailures = migrated.failures.filter(name => !baseline.failures.includes(name));
const missingTests = baseline.passed + baseline.failures.length !== migrated.passed + migrated.failures.length;
const result = {
  baselinePassed: baseline.passed,
  migratedPassed: migrated.passed,
  baselineFailures: baseline.failures,
  migratedFailures: migrated.failures,
  newFailures,
  missingTests,
  parity: baseline.exit === 0 && migrated.exit === 0 && !missingTests && newFailures.length === 0 &&
    baseline.failures.length === migrated.failures.length &&
    baseline.failures.every((name, index) => name === migrated.failures[index]),
};

console.log(JSON.stringify(result, null, 2));
if (!result.parity) process.exitCode = 1;
