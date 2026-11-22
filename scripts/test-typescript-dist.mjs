import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'opus-system-ts-tests-'));
const testFolder = path.join(temp, 'tests');
const baseline = process.argv.includes('--baseline');
const tests = (await readdir(path.join(root, 'tests')))
  .filter(name => name.endsWith('.test.js'))
  .sort();

try {
  await mkdir(testFolder, { recursive: true });
  await mkdir(path.join(temp, 'data'), { recursive: true });
  const runtime = baseline ? path.join('legacy','src') : 'dist';
  await cp(path.join(root, runtime), path.join(temp, 'src'), { recursive: true });
  if (!baseline) await cp(path.join(root, 'dist'), path.join(temp, 'dist'), { recursive: true });
  await cp(path.join(root, 'web'), path.join(temp, 'web'), { recursive: true });
  if (baseline) {
    for (const file of ['bootstrap.js', 'editor.js']) {
      await copyFile(path.join(root, 'legacy', 'web', 'dictate', file), path.join(temp, 'web', 'dictate', file));
    }
  }
  if (!baseline) {
    for (const file of ['bootstrap.js', 'editor.js']) {
      await copyFile(path.join(root, 'dist-web', 'dictate', file), path.join(temp, 'web', 'dictate', file));
    }
  }
  await cp(path.join(root, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
  await copyFile(path.join(root, 'package.json'), path.join(temp, 'package.json'));
  await copyFile(path.join(root, 'tests', 'fixtures', 'config.test.json'), path.join(temp, 'config.json'));
  await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');

  for (const name of tests) {
    const source = await readFile(path.join(root, 'tests', name), 'utf8');
    await writeFile(path.join(testFolder, name), source, { flag: 'wx' });
  }

  const result = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    ...tests.map(name => path.join(testFolder, name)),
  ], {
    cwd: temp,
    stdio: 'inherit',
    env: {
      ...process.env,
      CONFIG_PATH: path.join(temp, 'config.json'),
      DB_PATH: path.join(temp, 'data', 'bot.sqlite'),
      DISCORD_TOKEN: '',
      CLIENT_ID: '',
      OPUS_LINK_WEBHOOK_SECRET: '',
      OPUS_TS_CUTOVER: '',
      OPUS_SYSTEM_AUTO_INSTALL: '',
    },
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
