import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(base, suffix) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        files.push(path.relative(base, full).replaceAll(path.sep, '/'));
      }
    }
  }
  await visit(base);
  return files.sort();
}

async function compare(legacyRoot, typescriptRoot) {
  const original = await walk(legacyRoot, '.js');
  const converted = await walk(typescriptRoot, '.ts');
  const expected = original.map(file => file.replace(/\.js$/, '.ts'));
  const missing = expected.filter(file => !converted.includes(file));
  const extra = converted.filter(file => !expected.includes(file));
  const modified = [];

  for (const file of original) {
    const target = file.replace(/\.js$/, '.ts');
    if (missing.includes(target)) continue;
    const a = await readFile(path.join(legacyRoot, file));
    const b = await readFile(path.join(typescriptRoot, target));
    if (!a.equals(b)) modified.push(file);
  }
  return { original, converted, modified, missing, extra };
}

const app = await compare(path.join(root, 'legacy', 'src'), path.join(root, 'src'));
const browser = await compare(path.join(root, 'legacy', 'web', 'dictate'), path.join(root, 'web', 'dictate'));

const verifyDist = process.argv.includes('--dist');
let missingDist = [];
let missingWebDist = [];

if (verifyDist) {
  const emitted = await walk(path.join(root, 'dist'), '.js');
  const emittedWeb = await walk(path.join(root, 'dist-web', 'dictate'), '.js');
  missingDist = app.original.filter(file => !emitted.includes(file));
  missingWebDist = browser.original.filter(file => !emittedWeb.includes(file));
}

const result = {
  sourceFiles: app.original.length,
  typescriptFiles: app.converted.length,
  originalUnchanged: app.original.length - app.modified.length,
  modified: app.modified,
  missing: app.missing,
  extra: app.extra,
  webSourceFiles: browser.original.length,
  webTypescriptFiles: browser.converted.length,
  modifiedWeb: browser.modified,
  missingWeb: browser.missing,
  extraWeb: browser.extra,
  missingDist,
  missingWebDist,
  verifiedDist: verifyDist,
};

console.log(JSON.stringify(result, null, 2));
if (result.missing.length || result.extra.length ||
    result.missingWeb.length || result.extraWeb.length ||
    missingDist.length || missingWebDist.length) {
  process.exitCode = 1;
}
