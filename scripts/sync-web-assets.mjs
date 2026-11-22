import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('dist-web/dictate');
const target = path.resolve('web/dictate');
await mkdir(target, { recursive: true });
for (const file of ['bootstrap.js', 'editor.js']) {
  await copyFile(path.join(output, file), path.join(target, file));
}
