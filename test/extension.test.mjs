import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const content = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 100));

function row(id, icon, extra = '') {
  return `<li class="notifications-list-item" id="${id}" ${extra}>
    <input type="checkbox" class="js-notification-bulk-action-check-item" aria-label="Select ${id}">
    <a class="notification-list-item-link" href="/acme/repo/issues/${id}">
      <svg class="octicon ${icon}"></svg>${id}
    </a></li>`;
}

function setup(path = '/notifications') {
  const dom = new JSDOM(`<main><div class="js-check-all-container">
    <div class="Box-header"><div><label id="select-all"><input type="checkbox"
      class="js-notifications-mark-all-prompt">Select all</label></div><button>Done</button></div><ul>
    ${row('closed', 'octicon-issue-closed')}
    ${row('skipped', 'octicon-skip')}
    ${row('open', 'octicon-issue-opened')}
    ${row('merged', 'octicon-git-merge')}
    ${row('closed-pr', 'octicon-git-pull-request-closed')}
    ${row('open-pr', 'octicon-git-pull-request')}
    ${row('draft', 'octicon-git-pull-request-draft')}
    ${row('hidden', 'octicon-issue-closed', 'hidden')}
    ${row('disabled', 'octicon-issue-closed')}
  </ul></div></main>`, {
    url: `https://github.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const observers = [];
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super(callback);
      observers.push(this);
    }
  };
  window.HTMLElement.prototype.getClientRects = () => [{}];
  window.document.querySelector('#disabled input').disabled = true;
  const messages = [];
  window.chrome = { runtime: { sendMessage: async message => {
    messages.push(message);
    return { opened: message.urls.length, failed: 0 };
  } } };
  window.eval(content);
  const checkbox = id => window.document.querySelector(`#${id} input`);
  const ui = () => window.document.querySelector('github-notification-actions')?.shadowRoot;
  const selected = () => [...window.document.querySelectorAll('input:checked')]
    .map(input => input.closest('li').id);
  const close = () => {
    observers.forEach(observer => observer.disconnect());
    window.close();
  };
  return { window, messages, checkbox, ui, selected, close };
}

test('Closed always selects both types and replaces selection using native events', async t => {
  const page = setup('/notifications?query=is%3Aunread');
  t.after(page.close);
  let changes = 0;
  page.window.document.addEventListener('change', () => changes++);
  page.checkbox('open').click();
  page.ui().getElementById('closed').click();
  await settle();
  assert.deepEqual(page.selected(), ['closed', 'skipped', 'merged', 'closed-pr']);
  assert.equal(changes, 6);
  page.ui().getElementById('closed').click();
  await settle();
  assert.equal(changes, 6);
  assert.equal(page.ui().getElementById('open').textContent, 'Open in tabs');
  assert.match(page.ui().getElementById('open').title, /4 selected/);
});

test('closed menu immediately selects a type without changing the main button', async t => {
  const page = setup();
  t.after(page.close);
  page.ui().getElementById('closed-menu-button').click();
  assert.equal(page.ui().getElementById('closed-menu').hidden, false);
  page.ui().getElementById('closed-issues').click();
  await settle();
  assert.deepEqual(page.selected(), ['closed', 'skipped']);
  assert.equal(page.ui().getElementById('closed-menu').hidden, true);
  page.ui().getElementById('closed-menu-button').click();
  page.ui().getElementById('closed-prs').click();
  await settle();
  assert.deepEqual(page.selected(), ['merged', 'closed-pr']);
  page.ui().getElementById('closed').click();
  await settle();
  assert.deepEqual(page.selected(), ['closed', 'skipped', 'merged', 'closed-pr']);
});

test('closed menu supports keyboard navigation, escape, and outside dismissal', t => {
  const page = setup();
  t.after(page.close);
  const ui = page.ui();
  const trigger = ui.getElementById('closed-menu-button');
  const menu = ui.getElementById('closed-menu');
  const key = (element, value) => element.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: value, bubbles: true }));
  key(trigger, 'ArrowDown');
  assert.equal(ui.activeElement.id, 'closed-prs');
  key(menu, 'ArrowDown');
  assert.equal(ui.activeElement.id, 'closed-issues');
  key(menu, 'Escape');
  assert.equal(menu.hidden, true);
  assert.equal(ui.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  page.window.document.body.dispatchEvent(new page.window.Event('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true);
});

test('type buttons select only that type in all states, including draft PRs', async t => {
  const page = setup();
  t.after(page.close);
  page.ui().getElementById('issues').click();
  await settle();
  assert.deepEqual(page.selected(), ['closed', 'skipped', 'open']);
  page.ui().getElementById('prs').click();
  await settle();
  assert.deepEqual(page.selected(), ['merged', 'closed-pr', 'open-pr', 'draft']);
});

test('Open in tabs activates on selection and disables when selection is cleared', async t => {
  const page = setup();
  t.after(page.close);
  const button = page.ui().getElementById('open');
  assert.equal(button.disabled, true);
  assert.ok(button.querySelector('svg'));
  page.checkbox('open').click();
  await settle();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Open in tabs');
  page.checkbox('open').click();
  await settle();
  assert.equal(button.disabled, true);
});

test('mounts at the end of the bar and follows a replaced header without duplication', async t => {
  const page = setup();
  t.after(page.close);
  const document = page.window.document;
  assert.equal(document.querySelector('.Box-header').lastElementChild.shadowRoot, page.ui());
  document.querySelector('.Box-header').innerHTML = '<label id="replacement"><input type="checkbox" class="js-notifications-mark-all-prompt">Select all</label>';
  await settle();
  assert.equal(document.querySelector('.Box-header').lastElementChild.shadowRoot, page.ui());
  assert.equal(document.querySelectorAll('github-notification-actions').length, 1);
});

test('opens manual selection, deduplicates links, and handles runtime failure', async t => {
  const page = setup();
  t.after(page.close);
  assert.equal(page.ui().getElementById('open').disabled, true);
  page.checkbox('open').click();
  page.checkbox('draft').click();
  page.window.document.querySelector('#draft a').href = '/acme/repo/issues/open';
  await settle();
  page.ui().getElementById('open').click();
  page.ui().getElementById('open').click();
  await settle();
  assert.equal(page.messages.length, 1);
  assert.deepEqual(Array.from(page.messages[0].urls), ['https://github.com/acme/repo/issues/open']);
  assert.equal(page.ui().getElementById('status').textContent, 'Opened 1 tab.');
  page.window.chrome.runtime.sendMessage = async () => { throw new Error('Extension context invalidated'); };
  page.ui().getElementById('open').click();
  await settle();
  assert.match(page.ui().getElementById('status').textContent, /Reload this page/);
  assert.equal(page.ui().getElementById('open').disabled, false);
});

test('mounts once on client navigation, handles new rows, and removes itself on exit', async t => {
  const page = setup('/acme/repo');
  t.after(page.close);
  assert.equal(page.ui(), undefined);
  page.window.history.pushState({}, '', '/notifications');
  page.window.document.dispatchEvent(new page.window.Event('turbo:load'));
  await settle();
  assert.ok(page.ui());
  page.window.document.querySelector('ul').insertAdjacentHTML('beforeend', row('new', 'octicon-issue-closed'));
  await settle();
  page.ui().getElementById('issues').click();
  await settle();
  assert.ok(page.checkbox('new').checked);
  assert.equal(page.window.document.querySelectorAll('github-notification-actions').length, 1);
  page.window.history.pushState({}, '', '/acme/repo');
  page.window.dispatchEvent(new page.window.PopStateEvent('popstate'));
  await settle();
  assert.equal(page.ui(), undefined);
});

function worker(failUrl) {
  let listener;
  const opened = [];
  const chrome = {
    runtime: { id: 'test-extension', getURL: file => `chrome-extension://test-extension/${file}`, onMessage: { addListener(value) { listener = value; } } },
    tabs: { async create(options) {
      if (options.url === failUrl) throw new Error('Tab failed');
      opened.push(options);
    } },
  };
  vm.runInNewContext(background.replace(/^import .*;\n/m, ''), { chrome, URL, createActivityService: () => ({}) });
  const sender = { id: 'test-extension', url: 'https://github.com/notifications', frameId: 0,
    tab: { windowId: 4 } };
  const send = (urls, overrides = {}) => new Promise(resolve => {
    assert.equal(listener({ type: 'open-notifications', urls }, { ...sender, ...overrides }, resolve), true);
  });
  return { opened, send };
}

test('worker opens unique background tabs and reports partial failures', async () => {
  const a = 'https://github.com/acme/repo/issues/1';
  const b = 'https://github.com/acme/repo/pull/2';
  const instance = worker(b);
  const result = await instance.send([a, a, b]);
  assert.equal(result.opened, 1);
  assert.equal(result.failed, 1);
  assert.equal(instance.opened[0].active, false);
  assert.equal(instance.opened[0].windowId, 4);
});

test('worker rejects invalid messages before opening any tabs', async () => {
  const instance = worker();
  for (const urls of [null, ['javascript:alert(1)'], ['https://example.com'], [5],
    ['https://github.com/good', 'bad-url'], ['https://user:pass@github.com/private']]) {
    assert.ok((await instance.send(urls)).error);
  }
  for (const overrides of [{ url: 'https://github.com/acme' }, { frameId: 1 },
    { id: 'other-extension' }, { tab: undefined }, { url: 'https://example.com/notifications' }]) {
    assert.ok((await instance.send(['https://github.com/acme'], overrides)).error);
  }
  assert.equal(instance.opened.length, 0);
});

test('manifest references existing scripts and stays scoped to GitHub', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://github.com/*']);
  for (const file of [manifest.background.service_worker, ...manifest.content_scripts[0].js]) {
    assert.ok(readFileSync(new URL(`../${file}`, import.meta.url)).length);
  }
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://api.github.com/*']);
});

test('only the extension options page can save or disconnect credentials', async () => {
  let listener;
  let connects = 0;
  const chrome = {runtime:{id:'test-extension',getURL:file=>`chrome-extension://test-extension/${file}`,onMessage:{addListener(value){listener=value;}}}};
  const activity = {async connect(){connects++;return {connected:true,login:'viewer'};},async disconnect(){return {connected:false};},async status(){return {connected:true,login:'viewer'};}};
  vm.runInNewContext(background.replace(/^import .*;\n/m,''),{chrome,URL,createActivityService:()=>activity});
  const send = (type,url)=>new Promise(resolve=>listener({type,token:'example'}, {id:'test-extension',url,tab:{windowId:1},frameId:0},resolve));
  assert.ok((await send('activity-connect','https://github.com/notifications')).error);
  assert.ok((await send('activity-disconnect','https://github.com/notifications')).error);
  assert.equal(connects,0);
  assert.equal((await send('activity-connect','chrome-extension://test-extension/options.html')).connected,true);
  assert.equal(connects,1);
});
