import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const files = readdirSync('tests')
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join('tests', name));
const result = spawnSync(process.execPath, [
  '--test',
  '--test-concurrency=1',
  ...files
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    CONFIG_PATH: path.resolve('tests/fixtures/config.test.json')
  }
});
process.exit(result.status ?? 1);
