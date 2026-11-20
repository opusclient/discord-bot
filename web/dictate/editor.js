(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const el = {
    workspace: $('workspace'), error: $('error'), errorMessage: $('error-message'),
    status: $('status'), expires: $('expires'), destination: $('destination'),
    format: $('format'), formatOptions: $('format-options'), title: $('title'),
    color: $('color'), colorPicker: $('color-picker'), content: $('content'),
    counter: $('counter'), preview: $('preview-message'),
    selectedDestination: $('selected-destination'), selectedFormat: $('selected-format'),
    mentionCount: $('mention-count'), publish: $('publish'),
    mentionPerson: $('mention-person'), mentionChannel: $('mention-channel'),
    picker: $('picker'), pickerTitle: $('picker-title'), pickerClose: $('picker-close'),
    pickerTabs: $('picker-tabs'), pickerSearch: $('picker-search'),
    pickerResults: $('picker-results'), confirm: $('confirm'),
    confirmText: $('confirm-text'), confirmPublish: $('confirm-publish'),
    publishError: $('publish-error'), cancel: $('cancel'), draftStatus: $('draft-status')
  };

  let token = '';
  let data = null;
  let selection = null;
  let pickerType = '';
  let activeTab = 'user';
  let publishing = false;
  let draftVersion = 0;
  let dirty = false;
  let saveTimer = null;
  let savePromise = Promise.resolve();

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function mentionHtml(tokenText) {
    const match = /^<(@!?|@&|#)(\d{16,23})>$/.exec(tokenText);
    if (!match) return escapeHtml(tokenText);
    const [, type, id] = match;
    const source = type === '#' ? (data.mentionChannelOptions ?? data.channelOptions) : type === '@&' ? data.roleOptions : data.userOptions;
    const label = source.find(item => item.id === id)?.label;
    if (!label) return escapeHtml(tokenText);
    const prefix = type === '#' ? '#' : '@';
    return '<span class="mention">' + escapeHtml(prefix + label) + '</span>';
  }

  function inlineMarkdown(chunk) {
    return escapeHtml(chunk)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>');
  }

  function renderContent(text) {
    const regex = /<@!?\d{16,23}>|<@&\d{16,23}>|<#\d{16,23}>/g;
    let out = '';
    let last = 0;
    for (const match of text.matchAll(regex)) {
      out += inlineMarkdown(text.slice(last, match.index));
      out += mentionHtml(match[0]);
      last = match.index + match[0].length;
    }
    return out + inlineMarkdown(text.slice(last));
  }

  function snapshotSelection() {
    const start = el.content.selectionStart;
    const end = el.content.selectionEnd;
    if (Number.isInteger(start) && Number.isInteger(end)) {
      selection = { start, end, length: el.content.value.length };
    }
  }

  function draft() {
    return {
      channelId: el.destination.value,
      format: el.format.value,
      title: el.title.value,
      color: el.color.value,
      content: el.content.value
    };
  }

  function refresh() {
    if (!data) return;
    const value = el.content.value;
    const max = el.format.value === 'embed' ? 4000 : 2000;
    el.counter.textContent = value.length + ' / ' + max;
    el.counter.classList.toggle('over', value.length > max);
    el.formatOptions.hidden = el.format.value !== 'embed';
    el.selectedFormat.textContent = el.format.value === 'embed' ? 'Embed' : 'Markdown text';
    el.selectedDestination.textContent =
      data.channelOptions.find(item => item.id === el.destination.value)?.label ?? 'Not selected';
    el.mentionCount.textContent = String(new Set([
      ...value.matchAll(/<@!?\d{16,23}>|<@&\d{16,23}>|<#\d{16,23}>/g)
    ].map(match => match[0])).size);
    if (!value.trim() && !el.title.value.trim()) {
      el.preview.className = 'preview-message empty';
      el.preview.textContent = 'Your message will appear here as you write.';
      return;
    }
    el.preview.className = 'preview-message';
    const body = renderContent(value || ' ');
    if (el.format.value === 'embed') {
      const color = /^#[\da-fA-F]{6}$/.test(el.color.value) ? el.color.value : '#f36b35';
      const title = el.title.value.trim()
        ? '<div class="embed-title">' + escapeHtml(el.title.value.trim()) + '</div>'
        : '';
      el.preview.innerHTML = '<div class="embed-preview">' + title + body + '</div>';
      el.preview.querySelector('.embed-preview').style.borderLeftColor = color;
    } else {
      el.preview.innerHTML = body;
    }
  }

  function hidePicker() {
    pickerType = '';
    el.picker.hidden = true;
    el.mentionPerson.setAttribute('aria-expanded', 'false');
    el.mentionChannel.setAttribute('aria-expanded', 'false');
    el.content.focus();
  }

  function pickerItems() {
    const query = el.pickerSearch.value.toLocaleLowerCase().trim();
    const options = activeTab === 'user'
      ? data.userOptions
      : activeTab === 'role' ? data.roleOptions : (data.mentionChannelOptions ?? data.channelOptions);
    return options.filter(item =>
      !query || (item.label + ' ' + (item.username ?? '')).toLocaleLowerCase().includes(query)
    ).slice(0, 70);
  }

  function insertToken(item, type = activeTab) {
    const id = String(item.id ?? '');
    if (!/^\d{16,23}$/.test(id)) return;
    const prefix = type === 'channel' ? '<#' : type === 'role' ? '<@&' : '<@';
    const value = prefix + id + '>';
    const text = el.content.value;
    const range = selection?.length === text.length
      ? selection : { start: text.length, end: text.length };
    const at = Math.min(Math.max(0, range.start), text.length);
    const to = Math.min(Math.max(at, range.end), text.length);
    const leftSpace = at > 0 && !/\s/.test(text[at - 1]) ? ' ' : '';
    const rightSpace = to < text.length && /\s/.test(text[to]) ? '' : ' ';
    el.content.focus({ preventScroll: true });
    el.content.setRangeText(leftSpace + value + rightSpace, at, to, 'end');
    snapshotSelection();
    el.content.dispatchEvent(new Event('input', { bubbles: true }));
    hidePicker();
    el.draftStatus.textContent = 'Inserted ' + (type === 'channel' ? '#' : '@') + item.label + ' into message';
  }

  function drawPicker() {
    el.pickerTabs.replaceChildren();
    if (pickerType === 'people') {
      for (const type of ['user', 'role']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = type === 'user' ? 'Users' : 'Roles';
        button.classList.toggle('selected', activeTab === type);
        button.addEventListener('click', () => {
          activeTab = type;
          drawPicker();
        });
        el.pickerTabs.append(button);
      }
    }
    el.pickerResults.replaceChildren();
    const results = pickerItems();
    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-picker';
      empty.textContent = 'No matching ' + (activeTab === 'channel' ? 'channels' : activeTab === 'role' ? 'roles' : 'users');
      el.pickerResults.append(empty);
      return;
    }
    for (const item of results) {
      const button = document.createElement('button');
      button.className = 'picker-result';
      button.type = 'button';
      button.setAttribute('role', 'option');
      const badge = document.createElement('span');
      badge.className = 'avatar';
      badge.textContent = activeTab === 'channel' ? '#' : activeTab === 'role' ? '@' : item.label.slice(0, 1).toUpperCase();
      const text = document.createElement('span');
      text.className = 'picker-label';
      const title = document.createElement('strong');
      title.textContent = item.label;
      const sub = document.createElement('small');
      sub.textContent = activeTab === 'channel' ? 'Text channel'
        : activeTab === 'role' ? 'Discord role' : '@' + (item.username ?? item.label);
      text.append(title, sub);
      button.append(badge, text);
      const type = activeTab;
      button.addEventListener('click', () => insertToken(item, type));
      el.pickerResults.append(button);
    }
  }

  function openPicker(type) {
    if (!data) return;
    if (pickerType === type && !el.picker.hidden) {
      hidePicker();
      return;
    }
    pickerType = type;
    activeTab = type === 'channels' ? 'channel' : 'user';
    el.picker.hidden = false;
    el.pickerTitle.textContent = type === 'channels' ? 'Insert a channel' : 'Insert a user or role';
    el.mentionPerson.setAttribute('aria-expanded', String(type === 'people'));
    el.mentionChannel.setAttribute('aria-expanded', String(type === 'channels'));
    el.pickerSearch.value = '';
    drawPicker();
    el.pickerSearch.focus();
  }

  async function api(path, options = {}) {
    const response = await fetch('/dictate/api/' + path, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      credentials: 'omit'
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Invalid server response');
    }
    if (!response.ok) throw new Error(result.error ?? 'Request failed');
    return result;
  }

  function queueSave() {
    if (!token || !data || publishing) return;
    dirty = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistDraft().catch(error => {
        el.draftStatus.textContent = 'Draft not saved: ' + error.message;
      });
    }, 500);
  }

  async function persistDraft() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty) {
      await savePromise;
      if (dirty) return persistDraft();
      return;
    }
    dirty = false;
    const snapshot = draft();
    const current = savePromise.catch(() => {}).then(async () => {
      const result = await api('draft', {
        method: 'PUT', body: { ...snapshot, version: draftVersion }
      });
      draftVersion = result.version;
      el.draftStatus.textContent = 'Private draft saved';
    });
    savePromise = current;
    try {
      await current;
    } catch (error) {
      dirty = true;
      throw error;
    }
    if (dirty) return persistDraft();
  }

  function fail(message) {
    el.workspace.hidden = true;
    el.error.hidden = false;
    el.status.textContent = 'Session unavailable';
    el.errorMessage.textContent = message;
  }

  function populate() {
    for (const item of data.channelOptions) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = '# ' + item.label;
      el.destination.append(opt);
    }
    const saved = data.draft ?? {};
    el.destination.value = saved.channelId ?? '';
    el.format.value = saved.format ?? 'embed';
    el.title.value = saved.title ?? '';
    el.color.value = saved.color ?? '#F36B35';
    el.content.value = saved.content ?? '';
    draftVersion = data.version ?? 0;
    el.workspace.hidden = false;
    el.status.textContent = 'Private draft · ' + data.guildName;
    el.expires.textContent = 'Expires ' + new Date(data.expiresAt).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    });
    if (!data.channelOptions.length) {
      el.draftStatus.textContent = 'No publishable channels are available';
      el.publish.disabled = true;
    }
    refresh();
  }

  function validate() {
    const value = draft();
    if (!value.channelId) return 'Choose a destination channel.';
    if (!value.content.trim()) return 'Write a message before publishing.';
    if (value.content.length > (value.format === 'embed' ? 4000 : 2000)) return 'Message exceeds the Discord length limit.';
    if (value.format === 'embed' && !/^#[\da-fA-F]{6}$/.test(value.color)) return 'Enter a valid six-digit hex color.';
    if (value.title.length > 256) return 'Embed title exceeds 256 characters.';
    return '';
  }

  function showReview() {
    const error = validate();
    if (error) {
      el.draftStatus.textContent = error;
      return;
    }
    const target = data.channelOptions.find(item => item.id === el.destination.value);
    el.confirmText.textContent =
      'Destination: #' + target.label + '. Publish as Opus System? ' +
      'Any selected user or role mentions may notify members.';
    el.publishError.textContent = '';
    el.confirm.showModal();
  }

  async function doPublish() {
    if (publishing) return;
    publishing = true;
    el.confirmPublish.disabled = true;
    el.cancel.disabled = true;
    el.publishError.textContent = '';
    el.confirmPublish.textContent = 'Publishing…';
    try {
      await persistDraft();
      const result = await api('publish', {
        method: 'POST', body: { version: draftVersion }
      });
      el.confirm.close();
      el.workspace.hidden = true;
      el.error.hidden = false;
      el.error.querySelector('.section-number').textContent = 'PUBLISHED';
      el.error.querySelector('h2').textContent = 'Message published';
      el.errorMessage.textContent = result.auditLogged
        ? 'Your message has been sent successfully and recorded in Audit Logs.'
        : 'Your message was sent, but the audit entry could not be recorded.';
      const link = document.createElement('a');
      link.href = result.url;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.textContent = 'Open published message';
      link.style.color = '#b4aafe';
      el.error.append(link);
      token = '';
      el.status.textContent = 'Published';
    } catch (error) {
      el.publishError.textContent = error.message;
    } finally {
      publishing = false;
      el.confirmPublish.disabled = false;
      el.cancel.disabled = false;
      el.confirmPublish.textContent = 'Publish to Discord';
    }
  }

  async function init() {
    const params = new URLSearchParams(location.hash.slice(1));
    token = typeof window !== 'undefined' && typeof window.__dictateToken === 'string'
      ? window.__dictateToken : (params.get('token') ?? '');
    if (typeof window !== 'undefined') delete window.__dictateToken;
    history.replaceState(null, '', location.pathname);
    if (!token) {
      fail('This link is missing its private authorization token.');
      return;
    }
    try {
      data = await api('session');
      populate();
    } catch (error) {
      fail(error.message);
    }
  }

  for (const id of ['format', 'destination', 'color', 'title', 'content']) {
    const eventName = ['content', 'color', 'title'].includes(id) ? 'input' : 'change';
    $(id).addEventListener(eventName, refresh);
    $(id).addEventListener(eventName, queueSave);
  }
  el.colorPicker.addEventListener('input', () => {
    el.color.value = el.colorPicker.value.toUpperCase();
    refresh();
    queueSave();
  });
  el.color.addEventListener('input', () => {
    if (/^#[\da-fA-F]{6}$/.test(el.color.value)) el.colorPicker.value = el.color.value;
    refresh();
    queueSave();
  });
  for (const event of ['click', 'select', 'keyup', 'input', 'focus', 'mouseup']) {
    el.content.addEventListener(event, snapshotSelection);
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === el.content) snapshotSelection();
  });
  for (const button of [el.mentionPerson, el.mentionChannel]) {
    button.addEventListener('pointerdown', snapshotSelection);
  }
  el.mentionPerson.addEventListener('click', () => openPicker('people'));
  el.mentionChannel.addEventListener('click', () => openPicker('channels'));
  el.pickerSearch.addEventListener('input', drawPicker);
  el.pickerSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') hidePicker();
    if (event.key === 'Enter') {
      const first = el.pickerResults.querySelector('.picker-result');
      if (first) first.click();
    }
  });
  el.pickerClose.addEventListener('click', hidePicker);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !el.picker.hidden) hidePicker();
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !el.workspace.hidden) {
      event.preventDefault();
      showReview();
    }
  });
  el.publish.addEventListener('click', showReview);
  el.cancel.addEventListener('click', () => el.confirm.close());
  el.confirmPublish.addEventListener('click', doPublish);
  void init();
})();
