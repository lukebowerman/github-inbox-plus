(() => {
  const host = document.createElement('github-notification-actions');
  const root = host.attachShadow({ mode: 'open' });
  const icon = paths => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
  const prIcon = icon(['M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z']);
  const issueIcon = icon(['M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z']);
  const openIcon = icon(['M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z']);
  const caretIcon = icon(['m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z']);
  const layout = document.createElement('style');
  layout.textContent = `:has(> github-notification-actions) {
    display: flex !important; align-items: center; flex-wrap: wrap; gap: 8px;
  }`;
  document.head.append(layout);
  root.innerHTML = `
    <style>
      :host { display: block; margin-inline-start: auto; max-width: 100%;
        color: var(--fgColor-default, #1f2328);
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .actions, .filters, .split { display: flex; align-items: center; }
      .actions { gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
      .filters { gap: 4px; flex-wrap: wrap; }
      button { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        box-sizing: border-box; font: inherit; font-weight: 500; height: 28px;
        padding: 0 8px; border-radius: 6px; border: 1px solid transparent;
        cursor: pointer; background: transparent; color: inherit; white-space: nowrap; }
      svg { flex: none; }
      .filters button { border-color: var(--borderColor-default, #d1d9e0);
        background: var(--button-default-bgColor-rest, #f6f8fa); }
      button:hover:not(:disabled) { background: var(--button-default-bgColor-hover, #eaeef2); }
      button:focus-visible { outline: 2px solid var(--fgColor-accent, #0969da);
        outline-offset: 2px; position: relative; z-index: 1; }
      button:disabled { color: var(--fgColor-disabled, #8c959f); cursor: default; }
      .split { color: var(--fgColor-done, var(--color-done-fg, #8250df)); }
      #closed { border-radius: 6px 0 0 6px; padding-inline-end: 6px; }
      #closed-menu-button { width: 24px; padding: 0; border-radius: 0 6px 6px 0; margin-inline-start: -1px; }
      #closed-menu-button svg { transform: translateY(-1px); }
      .open-action { padding-inline-start: 12px; border-inline-start: 1px solid var(--borderColor-default, #d1d9e0); }
      #open { border-color: var(--button-default-borderColor-rest, #d1d9e0);
        background: var(--button-default-bgColor-rest, #f6f8fa); }
      #open:not(:disabled) { color: var(--button-primary-fgColor-rest, #fff);
        background: var(--button-primary-bgColor-rest, #1f883d);
        border-color: var(--button-primary-borderColor-rest, #1f883d); }
      #open:hover:not(:disabled) { background: var(--button-primary-bgColor-hover, #1a7f37); }
      #closed-menu { position: fixed; inset: auto; margin: 0; padding: 4px; width: 176px;
        box-sizing: border-box; border: 1px solid var(--borderColor-default, #d1d9e0);
        border-radius: 8px; background: var(--bgColor-default, #fff); color: var(--fgColor-default, #1f2328);
        box-shadow: 0 8px 24px #0002; z-index: 100; }
      #closed-menu[hidden] { display: none; }
      #closed-menu button { width: 100%; justify-content: flex-start; height: 32px; }
      #status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      #status[data-error] { position: static; width: auto; height: auto; clip-path: none;
        margin: 6px 0 0; color: var(--fgColor-danger, #cf222e); }
    </style>
    <div class="actions">
      <div class="filters" role="group" aria-label="Select notifications on this page">
        <div class="split">
          <button type="button" id="closed" title="Select closed issues and closed or merged pull requests">Closed</button>
          <button type="button" id="closed-menu-button" aria-label="Select closed items by type"
            aria-haspopup="menu" aria-controls="closed-menu" aria-expanded="false">${caretIcon}</button>
        </div>
        <button type="button" id="prs" title="Select pull requests in any state">${prIcon}Pull Requests</button>
        <button type="button" id="issues" title="Select issues in any state">${issueIcon}Issues</button>
      </div>
      <div class="open-action">
        <button type="button" id="open" disabled>${openIcon}<span>Open in tabs</span></button>
      </div>
      <button type="button" id="activity" title="Connect GitHub and manage activity summaries">Activity settings</button>
    </div>
    <div id="closed-menu" popover="auto" role="menu" aria-label="Select closed items" hidden>
      <button type="button" id="closed-prs" role="menuitem">${prIcon}Pull Requests</button>
      <button type="button" id="closed-issues" role="menuitem">${issueIcon}Issues</button>
    </div>
    <p id="status" role="status"></p>`;

  root.getElementById('activity').addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'activity-options' });
      if (result?.error) throw new Error(result.error);
    } catch {
      status.setAttribute('data-error', '');
      status.textContent = 'Reload GitHub to reconnect to the extension.';
    }
  });

  const closedButton = root.getElementById('closed');
  const menuButton = root.getElementById('closed-menu-button');
  const menu = root.getElementById('closed-menu');
  const menuItems = [...menu.querySelectorAll('button')];
  const issuesButton = root.getElementById('issues');
  const prsButton = root.getElementById('prs');
  const openButton = root.getElementById('open');
  const status = root.getElementById('status');
  let busy = false;
  let pending = false;

  function onNotifications() {
    return /^\/notifications\/?$/.test(location.pathname);
  }

  function rows() {
    return [...document.querySelectorAll('.notifications-list-item')]
      .filter(row => !row.closest('[hidden]') && row.getClientRects().length > 0)
      .map(row => ({
        row,
        checkbox: row.querySelector('input.js-notification-bulk-action-check-item'),
        link: row.querySelector('a.notification-list-item-link'),
      }))
      .filter(item => item.checkbox && !item.checkbox.disabled);
  }

  function selectedUrls() {
    return [...new Set(rows().filter(item => item.checkbox.checked && item.link)
      .map(item => item.link.href)
      .filter(href => {
        try { return new URL(href).origin === 'https://github.com'; }
        catch { return false; }
      }))];
  }

  function refresh() {
    pending = false;
    if (!onNotifications()) {
      closeMenu();
      host.remove();
      status.textContent = '';
      return;
    }
    const selectAll = document.querySelector('input.js-notifications-mark-all-prompt');
    const anchor = selectAll?.closest('.Box-header') ?? selectAll?.closest('label')?.parentElement;
    if (!anchor) {
      host.remove();
      return;
    }
    if (anchor.lastElementChild !== host) anchor.append(host);
    const count = selectedUrls().length;
    openButton.title = count ? `Open ${count} selected notification${count === 1 ? '' : 's'} in background tabs` : 'Select notifications to open in tabs';
    openButton.disabled = busy || count === 0;
    issuesButton.disabled = busy;
    prsButton.disabled = busy;
    closedButton.disabled = busy;
    menuButton.disabled = busy;
  }

  function scheduleRefresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(refresh);
  }

  async function select(selector) {
    if (busy || !onNotifications()) return;
    busy = true;
    status.removeAttribute('data-error');
    refresh();
    let selected = 0;
    const items = rows();
    try {
      for (let i = 0; i < items.length; i += 20) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (!onNotifications()) break;
        for (const { row, checkbox } of items.slice(i, i + 20)) {
          if (checkbox.isConnected && !checkbox.disabled) {
            const matches = Boolean(row.querySelector(selector));
            if (checkbox.checked !== matches) checkbox.click();
            if (checkbox.checked) selected++;
          }
        }
      }
      status.textContent = `Selected ${selected} notification${selected === 1 ? '' : 's'} on this page.`;
    } finally {
      busy = false;
      refresh();
    }
  }

  const closedSelectors = {
    issues: '.octicon-issue-closed, .octicon-skip',
    prs: '.octicon-git-pull-request-closed, .octicon-git-merge',
  };
  function closeMenu(restoreFocus = false) {
    if (menu.hidePopover && !menu.hidden) menu.hidePopover();
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuButton.focus();
  }

  function openMenu(last = false) {
    if (busy) return;
    menu.hidden = false;
    menu.showPopover?.();
    const bounds = menuButton.getBoundingClientRect();
    const width = menu.offsetWidth || 176;
    const height = menu.offsetHeight || 74;
    menu.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    menu.style.top = `${bounds.bottom + height + 4 > window.innerHeight
      ? Math.max(8, bounds.top - height - 4) : bounds.bottom + 4}px`;
    menuButton.setAttribute('aria-expanded', 'true');
    menuItems[last ? menuItems.length - 1 : 0].focus();
  }

  menuButton.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu(true));
  menuButton.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp');
    }
  });
  menu.addEventListener('toggle', event => {
    if (event.newState === 'closed') closeMenu();
  });
  menu.addEventListener('keydown', event => {
    const index = menuItems.indexOf(root.activeElement);
    const offsets = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in offsets || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? menuItems.length - 1
        : (index + offsets[event.key] + menuItems.length) % menuItems.length;
      menuItems[next].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeMenu(true);
    }
  });
  document.addEventListener('pointerdown', event => {
    const path = event.composedPath();
    if (!menu.hidden && !path.includes(menu) && !path.includes(menuButton)) closeMenu();
  });
  window.addEventListener('resize', () => closeMenu());
  document.addEventListener('scroll', () => closeMenu(), true);
  for (const type of ['prs', 'issues']) {
    root.getElementById(`closed-${type}`).addEventListener('click', async () => {
      closeMenu();
      await select(closedSelectors[type]);
      menuButton.focus();
    });
  }
  closedButton.addEventListener('click', () => select(`${closedSelectors.issues}, ${closedSelectors.prs}`));
  issuesButton.addEventListener('click', () => select('.octicon-issue-opened, .octicon-issue-closed, .octicon-skip'));
  prsButton.addEventListener('click', () => select('.octicon-git-pull-request, .octicon-git-pull-request-draft, .octicon-git-pull-request-closed, .octicon-git-merge'));
  openButton.addEventListener('click', async () => {
    if (busy || !onNotifications()) return;
    const urls = selectedUrls();
    if (!urls.length) return;
    busy = true;
    status.removeAttribute('data-error');
    refresh();
    status.textContent = 'Opening selected notifications…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'open-notifications', urls });
      if (!result || result.error) throw new Error(result?.error ?? 'No response from the extension.');
      status.toggleAttribute('data-error', Boolean(result.failed));
      status.textContent = `Opened ${result.opened} tab${result.opened === 1 ? '' : 's'}.` +
        (result.failed ? ` ${result.failed} could not be opened.` : '');
    } catch (error) {
      status.setAttribute('data-error', '');
      status.textContent = `Could not open tabs: ${error.message} Reload this page and try again.`;
    } finally {
      busy = false;
      refresh();
    }
  });

  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'checked', 'hidden', 'disabled', 'href'],
  });
  document.addEventListener('change', scheduleRefresh);
  document.addEventListener('turbo:load', scheduleRefresh);
  document.addEventListener('pjax:end', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  window.navigation?.addEventListener('navigatesuccess', scheduleRefresh);
  refresh();
})();
