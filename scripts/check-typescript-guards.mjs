import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = mkdtempSync(path.join(tmpdir(), 'opus-ts-guards-'));
const env = {
  ...process.env,
  OPUS_TS_CUTOVER: '',
  OPUS_TS_ALLOW_COMMAND_DEPLOY: '',
  CONFIG_PATH: path.join(workspace, 'config.json'),
  DB_PATH: path.join(workspace, 'test.sqlite'),
  DISCORD_TOKEN: '',
  CLIENT_ID: ''
};

const cases = [
  {
    filename: 'index.js',
    expected: 'OPUS_TS_CUTOVER=1 is required'
  },
  {
    filename: 'deploy-commands.js',
    expected: 'OPUS_TS_ALLOW_COMMAND_DEPLOY=1'
  }
];

try {
  for (const testCase of cases) {
    const result = spawnSync(process.execPath, [path.join(root, 'dist', testCase.filename)], {
      cwd: workspace,
      env,
      encoding: 'utf8',
      timeout: 15000
    });
    if (result.error) throw result.error;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    assert.notEqual(result.status, 0, testCase.filename + ' must refuse without authorization');
    assert.ok(output.includes(testCase.expected), testCase.filename + ' did not reject for the expected reason');
    console.log(testCase.filename + ': guarded');
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
