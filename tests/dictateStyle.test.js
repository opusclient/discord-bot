import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/dictate/editor.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/dictate/editor.css', import.meta.url), 'utf8');

test('Dictate uses the restrained dark and orange design system', () => {
  assert.match(css, /--background:\s*#101011/i);
  assert.match(css, /--accent:\s*#f36b35/i);
  for (const property of ['gradient', 'box-shadow', 'text-shadow', 'backdrop-filter', 'filter:blur']) {
    assert.doesNotMatch(css.toLowerCase(), new RegExp(property));
  }
  assert.match(css, /@media\s*\(max-width:\s*670px\)/);
});

test('minimal editor layout preserves all interactive surfaces', () => {
  const required = [
    'workspace', 'error', 'error-message', 'status', 'expires', 'destination',
    'format', 'format-options', 'title', 'color', 'color-picker', 'content',
    'counter', 'preview-message', 'destination-select', 'destination-trigger',
    'destination-value', 'format-embed', 'format-text', 'publish', 'mention-person', 'mention-channel', 'picker',
    'picker-title', 'picker-close', 'picker-tabs', 'picker-search',
    'picker-results', 'confirm', 'confirm-text', 'confirm-publish',
    'publish-error', 'cancel', 'draft-status'
  ];
  for (const id of required) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /<h2>Compose<\/h2>/);
  assert.match(html, /Add user \/ role/);
  assert.match(html, /Add channel/);
});
