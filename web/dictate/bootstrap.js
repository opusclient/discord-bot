(() => {
  'use strict';

  async function boot() {
    const message = document.getElementById('access-status');
    const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    history.replaceState(null, '', location.pathname);
    if (!/^[A-Za-z0-9_-]{42,64}$/.test(token)) {
      message.textContent = 'Access denied. Open a fresh private link from /dictate in Discord.';
      return;
    }
    try {
      const response = await fetch('/dictate/api/editor', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
        credentials: 'omit'
      });
      if (!response.ok) throw new Error('This private editor link is invalid, expired, or already used.');
      const markup = await response.text();
      document.body.innerHTML = markup;
      window.__dictateToken = token;
      const script = document.createElement('script');
      script.src = '/dictate/editor.js';
      script.onerror = () => {
        delete window.__dictateToken;
        document.body.textContent = 'Unable to load the private editor.';
      };
      document.body.append(script);
    } catch (error) {
      message.textContent = error.message;
    }
  }

  void boot();
})();
