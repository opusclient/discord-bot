import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function inventory(relative, extension) {
  const result = [];
  const walk = (directory) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const child = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && child.endsWith(extension)) result.push(child);
    }
  };
  walk(relative);
  return result.sort();
}

assert.ok(!existsSync(path.join(root, 'legacy')), 'Legacy JavaScript source must be absent');
assert.equal(inventory('src', '.js').length, 0, 'JavaScript files found in TypeScript source');
const backend = inventory('src', '.ts');
const compiled = inventory('dist', '.js');
assert.deepEqual(compiled, backend.map(file => file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js')));
const browser = inventory('web/dictate', '.ts');
const browserCompiled = inventory('dist-web/dictate', '.js');
assert.deepEqual(browserCompiled, browser.map(file => file.replace(/^web\/dictate\//, 'dist-web/dictate/').replace(/\.ts$/, '.js')));
assert.equal(backend.length, 117);
assert.equal(browser.length, 2);
assert.equal(backend.filter(file => file.startsWith('src/commands/')).length, 27);
assert.equal(backend.filter(file => file.startsWith('src/events/')).length, 21);
for (const file of ['editor.js', 'bootstrap.js']) {
  assert.deepEqual(
    readFileSync(path.join(root, 'dist-web', 'dictate', file)),
    readFileSync(path.join(root, 'web', 'dictate', file))
  );
}
console.log(JSON.stringify({ backend: backend.length, browser: browser.length, commands: 27, events: 21, legacy: 0, buildMatchesSource: true }, null, 2));
