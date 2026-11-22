import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function inspect(source, output) {
  const loaderUrl = pathToFileURL(path.join(source, 'utils', 'loaders.js')).href;
  const { loadCommands } = await import(loaderUrl);
  const loaded = await loadCommands(path.join(source, 'commands'), new Map());
  const commands = [...loaded.entries()]
    .map(([name, command]) => ({ name, definition: command.data.toJSON() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const events = [];
  for (const entry of await readdir(path.join(source, 'events'))) {
    if (!entry.endsWith('.js')) continue;
    const mod = await import(pathToFileURL(path.join(source, 'events', entry)).href);
    if (typeof mod.name === 'string' && typeof mod.execute === 'function') {
      events.push({ file: entry, name: mod.name, once: mod.once === true });
    }
  }
  events.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(output, JSON.stringify({ commands, events }), { flag: 'wx' });
}

if (process.argv[2] === '--inspect') {
  await inspect(process.argv[3], process.argv[4]);
} else {
  const temp = await mkdtemp(path.join(tmpdir(), 'opus-ts-parity-'));
  try {
    await mkdir(path.join(temp, 'data'), { recursive: true });
    await cp(path.join(root, 'legacy', 'src'), path.join(temp, 'src'), { recursive: true });
    await cp(path.join(root, 'dist'), path.join(temp, 'dist'), { recursive: true });
    await cp(path.join(root, 'web'), path.join(temp, 'web'), { recursive: true });
    await cp(path.join(root, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
    await copyFile(path.join(root, 'package.json'), path.join(temp, 'package.json'));
    await copyFile(path.join(root, 'tests', 'fixtures', 'config.test.json'), path.join(temp, 'config.json'));
    await symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
    const results = [];

    for (const [label, source] of [
      ['javascript', path.join(temp, 'src')],
      ['typescript', path.join(temp, 'dist')],
    ]) {
      const output = path.join(temp, label + '.json');
      const run = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--inspect', source, output],
        {
          cwd: temp,
          encoding: 'utf8',
          timeout: 120000,
          env: {
            ...process.env,
            CONFIG_PATH: path.join(temp, 'config.json'),
            DB_PATH: path.join(temp, 'data', label + '.sqlite'),
            DISCORD_TOKEN: '',
            CLIENT_ID: '',
            OPUS_TS_CUTOVER: '',
            OPUS_LINK_WEBHOOK_SECRET: '',
          },
        }
      );
      if (run.error || run.status !== 0) {
        throw new Error(label + ' inspection failed: ' + (run.error?.message || run.stderr || run.stdout));
      }
      results.push(JSON.parse(await readFile(output, 'utf8')));
    }

    const [legacy, migrated] = results;
    const asMap = items => new Map(items.map(item => [item.name, item]));
    const oldCommands = asMap(legacy.commands);
    const newCommands = asMap(migrated.commands);
    const missing = [...oldCommands.keys()].filter(name => !newCommands.has(name));
    const extra = [...newCommands.keys()].filter(name => !oldCommands.has(name));
    const changed = [...oldCommands.keys()].filter(name =>
      newCommands.has(name) &&
      JSON.stringify(oldCommands.get(name).definition) !== JSON.stringify(newCommands.get(name).definition)
    );
    const eventsEqual = JSON.stringify(legacy.events) === JSON.stringify(migrated.events);
    const result = {
      legacyCommands: legacy.commands.length,
      migratedCommands: migrated.commands.length,
      legacyEvents: legacy.events.length,
      migratedEvents: migrated.events.length,
      missing,
      extra,
      changed,
      eventsEqual,
      pass: missing.length === 0 && extra.length === 0 && changed.length === 0 && eventsEqual,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
