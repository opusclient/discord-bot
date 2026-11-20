import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../web/dictate/editor.js', import.meta.url), 'utf8')
  .replace('  void init();', `  globalThis.__probe = {
    setData(value) { data = value; },
    openPicker, snapshotSelection, insertToken
  };`);

function createEditor() {
  const elements = new Map();
  const document = {
    activeElement: null,
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() { return makeElement(); }
  };
  function makeElement() {
    const listeners = new Map();
    return {
      value: '', selectionStart: 0, selectionEnd: 0, hidden: false,
      children: [], textContent: '', innerHTML: '', className: '',
      style: {}, classList: { toggle() {} },
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      dispatchEvent(event) {
        for (const fn of listeners.get(event.type) ?? []) fn(event);
        return true;
      },
      click() { this.dispatchEvent({ type: 'click' }); },
      focus() {
        document.activeElement = this;
        this.dispatchEvent({ type: 'focus' });
      },
      setAttribute() {},
      replaceChildren() { this.children = []; },
      append(...items) { this.children.push(...items); },
      querySelector(selector) {
        if (selector === '.picker-result') {
          return this.children.find(child => child.className === 'picker-result') ?? null;
        }
        return { style: {} };
      },
      setRangeText(value, start, end) {
        this.value = this.value.slice(0, start) + value + this.value.slice(end);
        this.selectionStart = start + value.length;
        this.selectionEnd = this.selectionStart;
      }
    };
  }
  const script = { document, Event: class { constructor(type) { this.type = type; } } };
  runInNewContext(source, script);
  const ids = {
    user: '123456789012345601',
    role: '123456789012345602',
    channel: '123456789012345603'
  };
  script.__probe.setData({
    guildName: 'Opus',
    channelOptions: [{ id: ids.channel, label: 'announcements' }],
    mentionChannelOptions: [{ id: ids.channel, label: 'voice-chat' }],
    userOptions: [{ id: ids.user, label: 'Alice', username: 'alice' }],
    roleOptions: [{ id: ids.role, label: 'Engineering' }]
  });
  const el = id => elements.get(id);
  el('format').value = 'text';
  el('destination').value = ids.channel;
  el('color').value = '#5865F2';
  el('picker').hidden = true;
  return { ...script.__probe, el, ids, document };
}

test('role picker inserts a mention into the content at the saved cursor', () => {
  const editor = createEditor();
  const content = editor.el('content');
  content.value = 'Hello world';
  content.selectionStart = 6;
  content.selectionEnd = 6;
  content.focus();
  editor.openPicker('people');
  editor.el('picker-tabs').children[1].click();
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Hello <@&' + editor.ids.role + '> world');
  assert.equal(editor.el('mention-count').textContent, '1');
  assert.match(editor.el('preview-message').innerHTML, /@Engineering/);
  assert.equal(editor.el('picker').hidden, true);
  assert.equal(editor.document.activeElement, content);
});

test('channel picker replaces selected text and resolves voice channel names', () => {
  const editor = createEditor();
  const content = editor.el('content');
  content.value = 'Go HERE now';
  content.selectionStart = 3;
  content.selectionEnd = 7;
  content.focus();
  editor.openPicker('channels');
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Go <#' + editor.ids.channel + '> now');
  assert.match(editor.el('preview-message').innerHTML, /#voice-chat/);
});

test('mention picker appends when no previous cursor position is known', () => {
  const editor = createEditor();
  const content = editor.el('content');
  content.value = 'Welcome';
  editor.openPicker('people');
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Welcome <@' + editor.ids.user + '> ');
});

test('toolbar buttons insert user role and channel into the same editable draft', () => {
  const editor = createEditor();
  const content = editor.el('content');
  content.value = 'Hello';
  content.selectionStart = 5;
  content.selectionEnd = 5;
  content.focus();
  editor.el('mention-person').click();
  editor.el('picker-tabs').children[1].click();
  editor.el('picker-search').value = 'Engineering';
  editor.el('picker-search').dispatchEvent({ type: 'input' });
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Hello <@&' + editor.ids.role + '> ');
  content.selectionStart = content.value.length;
  content.selectionEnd = content.selectionStart;
  content.dispatchEvent({ type: 'keyup' });
  editor.el('mention-channel').click();
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Hello <@&' + editor.ids.role + '> <#' + editor.ids.channel + '> ');
  assert.equal(editor.el('mention-count').textContent, '2');
  assert.match(editor.el('preview-message').innerHTML, /@Engineering/);
  assert.match(editor.el('preview-message').innerHTML, /#voice-chat/);
});

test('picker safely appends if the draft changes after the saved cursor position', () => {
  const editor = createEditor();
  const content = editor.el('content');
  content.value = 'Hi';
  content.selectionStart = 0;
  content.selectionEnd = 0;
  content.focus();
  editor.el('mention-person').click();
  content.value = 'Updated content';
  editor.el('picker-results').children[0].click();
  assert.equal(content.value, 'Updated content <@' + editor.ids.user + '> ');
});
