import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.DELETED_MEDIA_CACHE_DIR || './data/deleted-media');
const ttl = 7 * 24 * 60 * 60 * 1000;
const maxCacheBytes = 512 * 1024 * 1024;
const maxMessageBytes = 8 * 1024 * 1024;
const maxImages = 4;
const pending = new Map();
let lastPruned = 0;

function validId(id) {
  return typeof id === 'string' && /^\d{16,23}$/.test(id);
}

function isImage(attachment) {
  return /^image\/(png|jpeg|gif|webp)$/i.test(attachment.contentType || '') ||
    /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || '');
}

function safeName(name, id) {
  const cleaned = String(name || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return String(id) + '-' + cleaned;
}

async function fetchImage(url, maxBytes, fetcher) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (!['cdn.discordapp.com', 'media.discordapp.net', 'cdn.discordapp.net'].includes(hostname)) return null;
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.body) return null;
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) {
    await response.body.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function prune(dir) {
  const now = Date.now();
  if (now - lastPruned < 15 * 60 * 1000) return;
  lastPruned = now;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = [];
  let total = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    const folder = path.join(dir, entry.name);
    const info = await stat(folder).catch(() => null);
    if (!info) continue;
    if (now - info.mtimeMs > ttl) {
      await rm(folder, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    const files = await readdir(folder).catch(() => []);
    let bytes = 0;
    for (const file of files) {
      const fileInfo = await stat(path.join(folder, file)).catch(() => null);
      if (fileInfo?.isFile()) bytes += fileInfo.size;
    }
    total += bytes;
    items.push({ folder, bytes, time: info.mtimeMs });
  }
  items.sort((a, b) => a.time - b.time);
  for (const item of items) {
    if (total <= maxCacheBytes) break;
    await rm(item.folder, { recursive: true, force: true }).catch(() => {});
    total -= item.bytes;
  }
}

async function archive(message, dir, fetcher) {
  if (!validId(message?.id) || !message.attachments?.size) return;
  const attachments = [...message.attachments.values()].filter(isImage).slice(0, maxImages);
  if (!attachments.length) return;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await prune(dir);
  const folder = path.join(dir, message.id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const records = [];
  let remaining = maxMessageBytes;
  for (const attachment of attachments) {
    if (!validId(attachment.id) || !attachment.url || attachment.size > remaining) continue;
    try {
      const data = await fetchImage(attachment.url, remaining, fetcher);
      if (!data?.length) continue;
      const name = safeName(attachment.name, attachment.id);
      await writeFile(path.join(folder, attachment.id), data, { mode: 0o600 });
      records.push({ id: attachment.id, name, size: data.length });
      remaining -= data.length;
    } catch (error) {
      console.warn('[auditlog] Could not cache deleted-media image:', error.message);
    }
  }
  if (records.length) {
    await writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ savedAt: Date.now(), records }), { mode: 0o600 });
  } else {
    await rm(folder, { recursive: true, force: true });
  }
}

export function cacheDeletedMessageMedia(message, { dir = root, fetcher = fetch } = {}) {
  if (!validId(message?.id) || !message.attachments?.size) return Promise.resolve();
  if (pending.has(message.id)) return pending.get(message.id);
  const task = archive(message, dir, fetcher).catch((error) => {
    console.warn('[auditlog] Media capture failed:', error.message);
  }).finally(() => {
    if (pending.get(message.id) === task) pending.delete(message.id);
  });
  pending.set(message.id, task);
  return task;
}

export async function getDeletedMessageMedia(messageId, { dir = root } = {}) {
  if (!validId(messageId)) return [];
  if (pending.has(messageId)) await pending.get(messageId);
  const folder = path.join(dir, messageId);
  const manifest = await readFile(path.join(folder, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!manifest || Date.now() - manifest.savedAt > ttl) return [];
  const files = [];
  for (const record of manifest.records.slice(0, maxImages)) {
    if (!validId(record.id)) continue;
    const data = await readFile(path.join(folder, record.id)).catch(() => null);
    if (data) files.push({ name: record.name, attachment: data });
  }
  return files;
}

export async function clearDeletedMessageMedia(messageId, { dir = root } = {}) {
  if (!validId(messageId)) return;
  if (pending.has(messageId)) await pending.get(messageId);
  await rm(path.join(dir, messageId), { recursive: true, force: true }).catch(() => {});
}
