import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
const script = readFileSync(new URL('../summaries.js',import.meta.url),'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve,80));
function setup(handler) {
  const dom = new JSDOM(`<meta name="user-login" content="viewer"><main><div class="notifications-list-item notification-unread"><a class="notification-list-item-link" href="/acme/repo/pull/42/changes/old..new"><div class="flex-auto"><p class="markdown-title">A PR</p></div></a><relative-time datetime="2026-09-29T12:00:00Z"></relative-time></div></main>`,{url:'https://github.com/notifications',runScripts:'outside-only',pretendToBeVisual:true});
  const {window}=dom;
  const observations=[];
  const timers=[];
  let now=1000;
  window.Date.now=()=>now;
  window.setInterval=callback=>{timers.push(callback);return timers.length;};
  const mutations=[];
  const Observer=window.MutationObserver;
  window.MutationObserver=class extends Observer { constructor(callback) { super(callback); mutations.push(this); } };
  window.IntersectionObserver=class {
    constructor(callback) { this.callback=callback; observations.push(this); }
    observe(row) { this.row=row; }
    unobserve() {}
    disconnect() {}
  };
  window.HTMLElement.prototype.getClientRects=()=>[{}];
  window.chrome={runtime:{sendMessage:handler}};
  window.eval(script);
  return { window, observations, advance() { now+=121_000;timers.forEach(callback=>callback()); }, document:window.document, show() { const o=observations[0]; o.callback([{target:o.row,isIntersecting:true}]); }, close() { mutations.forEach(m=>m.disconnect());window.close(); } };
}
test('loads only visible rows and inserts safe text directly below the title', async t=>{
  const requests=[];
  const page=setup(async message=>{
    requests.push(message);
    return message.type==='activity-status'?{connected:true}:{text:'@stalbot commented: <img src=x onerror=alert(1)>',detail:'since your review',avatar:'https://evil.example/avatar'};
  });
  t.after(page.close);
  await settle();
  assert.equal(requests.length,1);
  page.show(); await settle();
  const summary=page.document.querySelector('.ghna-summary');
  assert.equal(page.document.querySelector('.markdown-title').nextElementSibling,summary);
  assert.equal(summary.querySelector('img'),null);
  assert.match(summary.textContent,/<img src=x/);
  assert.equal(requests[1].login,'viewer');
  assert.match(requests[1].url,/\/changes\//);
});
test('ignores a stale response after row identity changes and refreshes for new timestamps',async t=>{
  let resolve;
  let count=0;
  const page=setup(message=>message.type==='activity-status'?Promise.resolve({connected:true}):++count===1?new Promise(r=>{resolve=r;}):Promise.resolve({text:'Fresh activity'}));
  t.after(page.close);
  await settle(); page.show();
  page.document.querySelector('relative-time').setAttribute('datetime','2026-09-29T13:00:00Z');
  await settle(); page.show(); await settle();
  resolve({text:'Stale activity'}); await settle();
  assert.equal(page.document.querySelectorAll('.ghna-summary').length,1);
  assert.equal(page.document.querySelector('.ghna-summary').textContent,'Fresh activity');
});
test('does not add summary placeholders when disconnected',async t=>{
  const page=setup(async()=>({connected:false})); t.after(page.close); await settle();
  assert.equal(page.document.querySelector('.ghna-summary'),null);
});
test('clears private summaries when leaving the inbox',async t=>{
  const page=setup(async message=>message.type==='activity-status'?{connected:true}:{text:'Private activity'});t.after(page.close);
  await settle();page.show();await settle();
  page.window.history.pushState({},'','/acme/repo');
  page.document.querySelector('main').append(page.document.createElement('div'));
  await settle();
  assert.equal(page.document.querySelector('.ghna-summary'),null);
});
test('focus preserves loaded DOM and does not refetch fresh summaries',async t=>{
  let calls=0;
  const page=setup(async message=>message.type==='activity-status'?{connected:true,login:'viewer'}:(calls++,{text:'Stable activity'}));
  t.after(page.close);
  await settle();page.show();await settle();
  const element=page.document.querySelector('.ghna-summary');
  const text=element.firstChild;
  page.window.dispatchEvent(new page.window.Event('focus'));await settle();
  assert.equal(page.document.querySelector('.ghna-summary'),element);
  assert.equal(element.firstChild,text);
  assert.equal(calls,1);
});
test('timestamp refresh preserves content while loading and after a transient error',async t=>{
  let resolve;
  let calls=0;
  const page=setup(message=>message.type==='activity-status'?Promise.resolve({connected:true}):
    ++calls===1?Promise.resolve({text:'Existing activity'}):new Promise(r=>{resolve=r;}));
  t.after(page.close);
  await settle();page.show();await settle();
  const element=page.document.querySelector('.ghna-summary');
  page.document.querySelector('relative-time').setAttribute('datetime','2026-09-29T14:00:00Z');
  await settle();page.show();await settle();
  assert.equal(page.document.querySelector('.ghna-summary'),element);
  assert.equal(element.textContent,'Existing activity');
  resolve({error:'GitHub could not be reached'});await settle();
  assert.equal(element.textContent,'Existing activity');
  assert.match(element.title,/Update failed/);
});

test('periodic refresh leaves unchanged summary nodes intact and disconnect clears them',async t=>{
  let connected=true;
  const page=setup(async message=>message.type==='activity-status'?{connected}:{text:'Stable activity'});
  t.after(page.close);
  await settle();page.show();await settle();
  const element=page.document.querySelector('.ghna-summary');
  const child=element.firstChild;
  page.advance();await settle();
  assert.equal(element.textContent,'Stable activity');
  page.show();await settle();
  assert.equal(element.firstChild,child);
  connected=false;
  page.window.dispatchEvent(new page.window.Event('focus'));await settle();
  assert.equal(page.document.querySelector('.ghna-summary'),null);
});
