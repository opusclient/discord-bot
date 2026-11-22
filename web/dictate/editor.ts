(() => {
  'use strict';

  type PickerItem = { id: string; label: string; username?: string };
  type UploadedImage = { id: string; filename: string; name: string; size: number; preview: string | null };
  type Draft = { channelId: string; format: string; title: string; color: string; content: string; images: string[] };
  type Session = {
    channelOptions: PickerItem[];
    mentionChannelOptions?: PickerItem[];
    roleOptions: PickerItem[];
    userOptions: PickerItem[];
    images?: UploadedImage[];
    draft?: Partial<Draft>;
    version?: number;
    guildName: string;
    expiresAt: number;
  };
  type ValidationError = { field: 'destination' | 'content' | 'color' | 'title' | 'images'; message: string };

  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing editor element: ' + id);
    return element as T;
  };
  const el = {
    workspace: $('workspace'), error: $('error'), errorMessage: $('error-message'),
    status: $('status'), expires: $('expires'), destination: $<HTMLInputElement>('destination'),
    destinationSelect: $('destination-select'), destinationTrigger: $<HTMLButtonElement>('destination-trigger'),
    destinationValue: $('destination-value'), destinationMenu: $('destination-menu'),
    destinationSearch: $<HTMLInputElement>('destination-search'), destinationOptions: $('destination-options'),
    formatEmbed: $<HTMLButtonElement>('format-embed'), formatText: $<HTMLButtonElement>('format-text'),
    validationAlert: $('validation-alert'), validationMessage: $('validation-message'),
    destinationError: $('destination-error'), contentError: $('content-error'),
    colorError: $('color-error'), titleError: $('title-error'), imagesError: $('images-error'),
    imageAdd: $<HTMLButtonElement>('image-add'), imageInput: $<HTMLInputElement>('image-input'), imageList: $('image-list'),
    imageDrop: $('image-drop'), imageHint: $('image-hint'), imageLimit: $('image-limit'),
    format: $<HTMLInputElement>('format'), formatOptions: $('format-options'), title: $<HTMLInputElement>('title'),
    color: $<HTMLInputElement>('color'), colorPicker: $<HTMLInputElement>('color-picker'), content: $<HTMLTextAreaElement>('content'),
    counter: $('counter'), preview: $('preview-message'),
    publish: $<HTMLButtonElement>('publish'),
    mentionPerson: $<HTMLButtonElement>('mention-person'), mentionChannel: $<HTMLButtonElement>('mention-channel'),
    picker: $('picker'), pickerTitle: $('picker-title'), pickerClose: $<HTMLButtonElement>('picker-close'),
    pickerTabs: $('picker-tabs'), pickerSearch: $<HTMLInputElement>('picker-search'),
    pickerResults: $('picker-results'), confirm: $<HTMLDialogElement>('confirm'),
    confirmText: $('confirm-text'), confirmPublish: $<HTMLButtonElement>('confirm-publish'),
    publishError: $('publish-error'), cancel: $<HTMLButtonElement>('cancel'), draftStatus: $('draft-status')
  };

  let token = '';
  let data!: Session;
  let selection: { start: number; end: number; length: number } | null = null;
  let pickerType = '';
  let activeTab = 'user';
  let publishing = false;
  let draftVersion = 0;
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let savePromise: Promise<void> = Promise.resolve();
  let destinationHighlight = 0;
  let images: UploadedImage[] = [];
  let imageBusy = false;

  function escapeHtml(value: unknown) {
    return String(value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    } as Record<string, string>)[c] ?? c);
  }

  function mentionHtml(tokenText: string) {
    const match = /^<(@!?|@&|#)(\d{16,23})>$/.exec(tokenText);
    if (!match) return escapeHtml(tokenText);
    const [, type, id] = match;
    const source = type === '#' ? (data.mentionChannelOptions ?? data.channelOptions) : type === '@&' ? data.roleOptions : data.userOptions;
    const label = source.find(item => item.id === id)?.label;
    if (!label) return escapeHtml(tokenText);
    const prefix = type === '#' ? '#' : '@';
    return '<span class="mention">' + escapeHtml(prefix + label) + '</span>';
  }

  function inlineMarkdown(chunk: string) {
    return escapeHtml(chunk)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>');
  }

  function renderContent(text: string) {
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
      content: el.content.value,
      images: images.map(item => item.id)
    };
  }

  function syncSelectors() {
    if (!data) return;
    const selected = data.channelOptions.find(item => item.id === el.destination.value);
    el.destinationValue.textContent = selected ? '# ' + selected.label : 'Select a channel';
    el.destinationTrigger.classList.toggle('has-value', Boolean(selected));
    el.formatEmbed.setAttribute('aria-pressed', String(el.format.value === 'embed'));
    el.formatText.setAttribute('aria-pressed', String(el.format.value === 'text'));
  }

  function closeDestination() {
    el.destinationMenu.hidden = true;
    el.destinationTrigger.setAttribute('aria-expanded', 'false');
  }

  function highlightDestination() {
    for (const [index, item] of [...el.destinationOptions.children].entries()) {
      if (item.className.startsWith('select-option')) {
        item.classList.toggle('highlighted', index === destinationHighlight);
      }
    }
  }

  function drawDestinations() {
    const query = el.destinationSearch.value.trim().toLocaleLowerCase();
    const items = data.channelOptions.filter(item => item.label.toLocaleLowerCase().includes(query));
    el.destinationOptions.replaceChildren();
    destinationHighlight = Math.max(0, items.findIndex(item => item.id === el.destination.value));
    if (destinationHighlight >= 8) destinationHighlight = 0;
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'select-empty';
      empty.textContent = 'No matching channels';
      el.destinationOptions.append(empty);
      return;
    }
    for (const [index, item] of items.entries()) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'select-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(item.id === el.destination.value));
      option.textContent = '# ' + item.label;
      option.addEventListener('click', () => {
        el.destination.value = item.id;
        closeDestination();
        syncSelectors();
        el.destination.dispatchEvent(new Event('change', { bubbles: true }));
        el.destinationTrigger.focus();
      });
      option.addEventListener('mouseenter', () => {
        destinationHighlight = index;
        highlightDestination();
      });
      el.destinationOptions.append(option);
    }
    highlightDestination();
  }

  function toggleDestination() {
    if (!el.destinationMenu.hidden) {
      closeDestination();
      return;
    }
    if (!el.picker.hidden) hidePicker();
    el.destinationSearch.value = '';
    el.destinationMenu.hidden = false;
    el.destinationTrigger.setAttribute('aria-expanded', 'true');
    drawDestinations();
    el.destinationSearch.focus();
  }

  function refresh() {
    if (!data) return;
    syncSelectors();
    const value = el.content.value;
    const max = el.format.value === 'embed' ? 4000 : 2000;
    el.counter.textContent = value.length + ' / ' + max;
    el.counter.classList.toggle('over', value.length > max);
    el.formatOptions.hidden = el.format.value !== 'embed';
    el.imageLimit.textContent = el.format.value === 'embed' ? 'Embed · 1 image' : 'Text · up to 10 images';
    el.imageInput.multiple = el.format.value === 'text';
    el.imageAdd.textContent = imageBusy ? 'Uploading…' : el.format.value === 'embed' ? 'Add image' : 'Add images';
    el.imageAdd.disabled = imageBusy || images.length >= (el.format.value === 'embed' ? 1 : 10);
    drawImages();
    if (!value.trim() && !el.title.value.trim() && !images.length) {
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
      el.preview.querySelector<HTMLElement>('.embed-preview')!.style.borderLeftColor = color;
    } else {
      el.preview.innerHTML = body;
    }
    const parent = el.format.value === 'embed'
      ? el.preview.querySelector('.embed-preview') : el.preview;
    if (images.length) {
      const gallery = document.createElement('div');
      gallery.className = el.format.value === 'embed' ? 'embed-image-gallery' : 'text-image-gallery';
      for (const item of images.slice(0, el.format.value === 'embed' ? 1 : 10)) {
        const photo = document.createElement('img');
        photo.className = 'message-image';
        photo.alt = 'Attached image';
        if (item.preview) photo.src = item.preview;
        gallery.append(photo);
      }
      parent?.append(gallery);
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

  function insertToken(item: PickerItem, type: string = activeTab) {
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

  function openPicker(type: string) {
    if (!data) return;
    closeDestination();
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

  async function api(path: string, options: { method?: string; body?: unknown } = {}) {
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

  function drawImages() {
    el.imageList.replaceChildren();
    for (const item of images) {
      const card = document.createElement('div');
      card.className = 'image-item';
      const thumb = document.createElement('img');
      thumb.alt = '';
      if (item.preview) thumb.src = item.preview;
      const details = document.createElement('div');
      details.className = 'image-item-details';
      const name = document.createElement('strong');
      name.textContent = item.name ?? item.filename;
      const size = document.createElement('span');
      size.textContent = Math.ceil(item.size / 1024) + ' KB';
      details.append(name, size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'image-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + (item.name ?? item.filename));
      remove.addEventListener('click', () => {
        images = images.filter(image => image.id !== item.id);
        if (item.preview) URL.revokeObjectURL(item.preview);
        refresh();
        queueSave();
        updateValidation();
      });
      card.append(thumb, details, remove);
      el.imageList.append(card);
    }
  }

  async function addImages(files: File[]) {
    if (imageBusy || !data || !files.length) return;
    const limit = el.format.value === 'embed' ? 1 : 10;
    if (images.length + files.length > limit) {
      showValidation({ field: 'images', message: el.format.value === 'embed'
        ? 'An embed can contain only one image. Remove the current image to replace it.'
        : 'Plain text supports up to 10 images per message.' });
      return;
    }
    imageBusy = true;
    refresh();
    el.imageHint.textContent = 'Uploading securely…';
    try {
      await persistDraft();
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
          throw new Error('Only PNG, JPG, GIF and WebP images are supported.');
        }
        if (file.size > 8 * 1024 * 1024) throw new Error('Each image must be 8 MB or less.');
        const response = await fetch('/dictate/api/image', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': file.type },
          body: file, cache: 'no-store', credentials: 'omit'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Image upload failed');
        images.push({ ...result, name: file.name, preview: URL.createObjectURL(file) });
        dirty = true;
        refresh();
        await persistDraft();
      }
      clearValidation();
    } catch (error) {
      showValidation({ field: 'images', message: (error instanceof Error ? error.message : String(error)) });
    } finally {
      imageBusy = false;
      el.imageHint.textContent = 'PNG, JPG, GIF or WebP · 8 MB per image';
      refresh();
    }
  }

  async function restoreImages() {
    const restored = data.images ?? [];
    images = restored.map(item => ({ ...item, name: item.filename, preview: null }));
    refresh();
    await Promise.all(images.map(async item => {
      try {
        const response = await fetch('/dictate/api/image?id=' + encodeURIComponent(item.id), {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store', credentials: 'omit'
        });
        if (!response.ok) throw new Error('Image unavailable');
        item.preview = URL.createObjectURL(await response.blob());
        refresh();
      } catch {
        el.imageHint.textContent = 'Some images could not be loaded. Refresh the private link.';
      }
    }));
  }

  function queueSave() {
    if (!token || !data || publishing) return;
    dirty = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persistDraft().catch(error => {
        el.draftStatus.textContent = 'Draft not saved: ' + (error instanceof Error ? error.message : String(error));
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

  function fail(message: string) {
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
    void restoreImages();
    el.colorPicker.value = /^#[\da-fA-F]{6}$/.test(el.color.value) ? el.color.value : '#f36b35';
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

  function validate(): ValidationError | null {
    const value = draft();
    if (!value.channelId) return { field: 'destination', message: 'Choose a destination channel before publishing.' };
    if (!value.content.trim() && !images.length) return { field: 'content', message: 'Write a message or add at least one image before publishing.' };
    if (value.format === 'embed' && images.length > 1) return { field: 'images', message: 'Embed supports one image only.' };
    if (value.format === 'text' && images.length > 10) return { field: 'images', message: 'Plain text supports up to 10 images.' };
    if (value.content.length > (value.format === 'embed' ? 4000 : 2000)) return { field: 'content', message: 'Message exceeds the Discord length limit.' };
    if (value.format === 'embed' && !/^#[\da-fA-F]{6}$/.test(value.color)) return { field: 'color', message: 'Enter a valid six-digit hex color.' };
    if (value.title.length > 256) return { field: 'title', message: 'Embed title exceeds 256 characters.' };
    return null;
  }

  function clearValidation() {
    el.validationAlert.hidden = true;
    el.validationMessage.textContent = '';
    for (const field of ['destination', 'content', 'color', 'title', 'images'] as const) {
      const control = field === 'destination' ? el.destinationTrigger : field === 'images' ? el.imageAdd : el[field];
      control.setAttribute('aria-invalid', 'false');
      const inline = ({ destination: el.destinationError, content: el.contentError, color: el.colorError, title: el.titleError, images: el.imagesError })[field];
      inline.hidden = true;
      inline.textContent = '';
    }
  }

  function showValidation(error: ValidationError) {
    clearValidation();
    el.validationAlert.hidden = false;
    el.validationMessage.textContent = error.message;
    const control = error.field === 'destination' ? el.destinationTrigger
      : error.field === 'images' ? el.imageAdd : el[error.field];
    const inline = ({ destination: el.destinationError, content: el.contentError, color: el.colorError, title: el.titleError, images: el.imagesError })[error.field];
    inline.textContent = error.message;
    inline.hidden = false;
    control.setAttribute('aria-invalid', 'true');
    control.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    if (error.field === 'destination') {
      if (el.destinationMenu.hidden) toggleDestination();
    } else {
      control.focus();
    }
  }

  function updateValidation() {
    if (el.validationAlert.hidden) return;
    const error = validate();
    if (!error || ({ destination: el.destinationError, content: el.contentError, color: el.colorError, title: el.titleError, images: el.imagesError })[error.field].hidden) clearValidation();
  }

  function showReview() {
    const error = validate();
    if (error) {
      showValidation(error);
      return;
    }
    clearValidation();
    const target = data.channelOptions.find(item => item.id === el.destination.value);
    if (!target) {
      showValidation({ field: 'destination', message: 'Choose a destination channel before publishing.' });
      return;
    }
    el.confirmText.textContent =
      'Destination: #' + target.label + '. Publish as Opus System? ' +
      (el.format.value === 'text'
        ? 'Text mentions may notify members.'
        : 'Embed mentions appear once and do not send notifications.');
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
      el.error.querySelector('.section-number')!.textContent = 'PUBLISHED';
      el.error.querySelector('h2')!.textContent = 'Message published';
      el.errorMessage.textContent = result.auditLogged
        ? 'Your message has been sent successfully and recorded in Audit Logs.'
        : 'Your message was sent, but the audit entry could not be recorded.';
      const link = document.createElement('a');
      link.href = result.url;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.textContent = 'Open published message';
      link.style.color = '#f36b35';
      el.error.append(link);
      token = '';
      el.status.textContent = 'Published';
    } catch (error) {
      el.publishError.textContent = (error instanceof Error ? error.message : String(error));
      el.publishError.scrollIntoView?.({ block: 'nearest' });
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
      fail((error instanceof Error ? error.message : String(error)));
    }
  }

  for (const id of ['format', 'destination', 'color', 'title', 'content']) {
    const eventName = ['content', 'color', 'title'].includes(id) ? 'input' : 'change';
    $(id).addEventListener(eventName, refresh);
    $(id).addEventListener(eventName, queueSave);
    $(id).addEventListener(eventName, updateValidation);
  }
  el.destinationTrigger.addEventListener('click', toggleDestination);
  el.destinationSearch.addEventListener('input', drawDestinations);
  el.destinationSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDestination();
      el.destinationTrigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = el.destinationOptions.children.length;
      if (count && el.destinationOptions.children[0].className.startsWith('select-option')) {
        destinationHighlight = (destinationHighlight + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        highlightDestination();
        el.destinationOptions.children[destinationHighlight].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = el.destinationOptions.children[destinationHighlight];
      if (option?.className.startsWith('select-option')) (option as HTMLElement).click();
    }
  });
  for (const [button, value] of [[el.formatEmbed, 'embed'], [el.formatText, 'text']] as const) {
    button.addEventListener('click', () => {
      if (el.format.value === value) return;
      if (value === 'embed' && images.length > 1) {
        showValidation({ field: 'images', message: 'Remove extra images before switching to Embed (maximum one image).' });
        return;
      }
      el.format.value = value;
      el.format.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  document.addEventListener('pointerdown', event => {
    if (!el.destinationMenu.hidden && !el.destinationSelect.contains(event.target as Node | null)) {
      closeDestination();
    }
  });
  el.imageAdd.addEventListener('click', () => el.imageInput.click());
  el.imageInput.addEventListener('change', () => {
    void addImages(Array.from(el.imageInput.files ?? []));
    el.imageInput.value = '';
  });
  el.imageDrop.addEventListener('dragover', event => {
    event.preventDefault();
    el.imageDrop.classList.add('dragging');
  });
  el.imageDrop.addEventListener('dragleave', () => {
    el.imageDrop.classList.remove('dragging');
  });
  el.imageDrop.addEventListener('drop', event => {
    event.preventDefault();
    el.imageDrop.classList.remove('dragging');
    void addImages(Array.from(event.dataTransfer?.files ?? []));
  });
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
      const first = el.pickerResults.querySelector<HTMLButtonElement>('.picker-result');
      if (first) first.click();
    }
  });
  el.pickerClose.addEventListener('click', hidePicker);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !el.picker.hidden) hidePicker();
    if (event.key === 'Escape' && !el.destinationMenu.hidden) closeDestination();
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
