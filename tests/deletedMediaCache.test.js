import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cacheDeletedMessageMedia,
  clearDeletedMessageMedia,
  getDeletedMessageMedia
} from '../src/services/deletedMediaCache.js';

const messageId = '1566400594267213887';
const attachmentId = '1573020243771531286';

function imageMessage(size = 4) {
  return {
    id: messageId,
    attachments: new Map([
      [attachmentId, {
        id: attachmentId,
        name: 'example image.png',
        contentType: 'image/png',
        size,
        url: 'https://cdn.discordapp.com/attachments/123/456/file.png'
      }]
    ])
  };
}

test('deleted image is cached, restored as an upload, and removed after logging', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opus-media-'));
  const payload = Buffer.from([137, 80, 78, 71]);
  let requests = 0;
  try {
    const capture = cacheDeletedMessageMedia(imageMessage(), {
      dir,
      fetcher: async () => {
        requests += 1;
        return new Response(payload);
      }
    });
    const stored = await getDeletedMessageMedia(messageId, { dir });
    await capture;
    assert.equal(requests, 1);
    assert.equal(stored.length, 1);
    assert.match(stored[0].name, /^1573020243771531286-/);
    assert.deepEqual(stored[0].attachment, payload);
    await clearDeletedMessageMedia(messageId, { dir });
    assert.deepEqual(await getDeletedMessageMedia(messageId, { dir }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('oversized media is skipped without a download', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opus-media-'));
  try {
    await cacheDeletedMessageMedia(imageMessage(9 * 1024 * 1024), {
      dir,
      fetcher: async () => {
        throw new Error('download should not happen');
      }
    });
    assert.deepEqual(await getDeletedMessageMedia(messageId, { dir }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-discord attachment URLs are never downloaded', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opus-media-'));
  try {
    const message = imageMessage();
    message.attachments.get(attachmentId).url = 'https://example.com/image.png';
    await cacheDeletedMessageMedia(message, {
      dir,
      fetcher: async () => {
        throw new Error('unexpected request');
      }
    });
    assert.deepEqual(await getDeletedMessageMedia(messageId, { dir }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
