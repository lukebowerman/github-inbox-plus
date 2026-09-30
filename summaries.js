(() => {
  const style = document.createElement('style');
  style.textContent = `
    .ghna-summary { display: flex; align-items: flex-start; gap: 6px; margin-top: 4px;
      color: var(--fgColor-muted, #59636e); font-size: 12px; font-weight: 400; line-height: 1.5; min-height: 18px; }
    .ghna-summary img { border-radius: 50%; flex: none; margin-top: 1px; width: 16px; height: 16px; }
    .ghna-summary span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    .notification-list-item-link:has(.ghna-summary) > .flex-auto { min-width: 0; }
  `;
  document.head.append(style);
  const states = new Map();
  const queue = [];
  let active = 0;
  let connected = false;
  let generation = 0;
  let scheduled = false;
  let checking = false;
  let account = null;
  const onInbox = () => /^\/notifications\/?$/.test(location.pathname);
  const visible = row => row.getClientRects().length > 0 && !row.closest('[hidden]');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states.get(entry.target);
      if (entry.isIntersecting && state && !state.queued) {
        state.queued = true;
        queue.push(state);
        observer.unobserve(entry.target);
      }
    }
    void drain();
  }, { rootMargin: '200px' });

  function clear() {
    generation++;
    queue.length = 0;
    observer.disconnect();
    for (const state of states.values()) state.element.remove();
    states.clear();
  }
  function render(state, result) {
    const element = state.element;
    if (result.error && state.result?.text) {
      element.title = state.result.text + '\nUpdate failed: ' + result.error;
      return;
    }
    const signature = JSON.stringify(result);
    if (state.signature === signature) return;
    state.signature = signature;
    state.result = result;
    element.replaceChildren();
    if (result.avatar) {
      try {
        const url = new URL(result.avatar);
        if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com') {
          const avatar = document.createElement('img');
          avatar.src = url.href;
          avatar.alt = '';
          avatar.referrerPolicy = 'no-referrer';
          avatar.addEventListener('error', () => avatar.remove());
          element.append(avatar);
        }
      } catch { /* Ignore invalid avatar URLs. */ }
    }
    const text = document.createElement('span');
    text.textContent = result.error ? result.error : result.text;
    element.append(text);
    element.title = result.error ?? [result.text, result.detail && !result.text.includes(result.detail) ? result.detail : null].filter(Boolean).join('\n');
  }
  async function drain() {
    while (active < 2 && queue.length) {
      const state = queue.shift();
      if (!connected || !onInbox() || !state.row.isConnected || states.get(state.row) !== state) continue;
      active++;
      void load(state);
    }
  }
  async function load(state) {
    const current = generation;
    const stamp = state.stamp;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'activity-summary', url: state.url,
        login: document.querySelector('meta[name="user-login"]')?.content ?? '', stamp: state.stamp });
      if (current !== generation || !onInbox() || !state.row.isConnected || states.get(state.row) !== state || stamp !== state.stamp) return;
      if (result?.needsSetup) { connected = false; clear(); return; }
      render(state, result?.text || result?.error ? result : { error: 'No activity response. Reload GitHub and try again.' });
    } catch {
      if (current === generation && states.get(state.row) === state && stamp === state.stamp) render(state, { error: 'Reload GitHub to reconnect to the extension.' });
    } finally { state.loadedAt = Date.now(); active--; void drain(); }
  }
  function scan() {
    scheduled = false;
    if (!onInbox()) { clear(); return; }
    if (!connected) return;
    for (const [row, state] of states) {
      if (!row.isConnected || !visible(row)) {
        observer.unobserve(row);
        state.element.remove();
        states.delete(row);
      }
    }
    for (const row of document.querySelectorAll('.notifications-list-item')) {
      if (!visible(row)) continue;
      const link = row.querySelector('a.notification-list-item-link');
      const title = link?.querySelector('.markdown-title');
      if (!title || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/[1-9]\d*(?:[/?#]|$)/.test(link.href)) continue;
      const stamp = `${row.querySelector('relative-time')?.getAttribute('datetime') ?? ''}:${row.classList.contains('notification-unread')}`;
      const previous = states.get(row);
      if (previous?.url === link.href && previous.stamp === stamp && previous.element.isConnected) continue;
      const reuse = previous?.url === link.href && previous.element.isConnected;
      if (previous) { observer.unobserve(row); if (!reuse) previous.element.remove(); }
      const element = reuse ? previous.element : document.createElement('span');
      element.className = 'ghna-summary';
      if (!reuse) title.after(element);
      const state = { ...(reuse ? previous : {}), row, url: link.href, stamp, element, queued: false, loadedAt: 0 };
      states.set(row, state);
      observer.observe(row);
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }
  async function checkConnection() {
    if (!onInbox() || checking) return;
    checking = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'activity-status' });
      const nextAccount = result?.revision ?? result?.login ?? null;
      if (!result?.connected || nextAccount !== account) clear();
      connected = Boolean(result?.connected);
      account = nextAccount;
      if (connected) {
        for (const state of states.values()) {
          if (state.loadedAt && Date.now() - state.loadedAt >= 120_000) {
            state.queued = false;
            state.loadedAt = 0;
            observer.observe(state.row);
          }
        }
      }
      schedule();
    } catch { /* Keep existing summaries until the connection can be checked again. */ }
    finally { checking = false; }
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['href', 'datetime', 'class', 'hidden'],
  });
  document.addEventListener('turbo:load', checkConnection);
  document.addEventListener('pjax:end', checkConnection);
  window.addEventListener('popstate', checkConnection);
  window.navigation?.addEventListener('navigatesuccess', checkConnection);
  window.addEventListener('focus', checkConnection);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkConnection(); });
  setInterval(() => { if (!document.hidden) void checkConnection(); }, 120_000);
  void checkConnection();
})();
