import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivityService, timelineQuery } from '../activity-api.mjs';
import { parseItem, reviewBaseline, summarizeActivity } from '../activity-summary.mjs';

const before = '2026-09-28T10:00:00Z';
const after = '2026-09-29T10:00:00Z';
const review = { submittedAt: before, state: 'APPROVED', commit: { oid: 'old' } };
const commit = { __typename: 'PullRequestCommit', commit: { oid: 'new', committedDate: after, messageHeadline: 'Rename helpers' } };
const comment = { __typename: 'IssueComment', createdAt: after, author: { login: 'stalbot' }, bodyText: '<script>alert(1)</script>\nUseful comment' };
const force = { __typename: 'HeadRefForcePushedEvent', createdAt: after, actor: { login: 'engineer' } };
function memory(initial = {}) {
  const data = { ...initial };
  return { data, access: null,
    async get(key) { return { [key]: data[key] }; },
    async set(value) { Object.assign(data, value); },
    async remove(key) { delete data[key]; },
    async clear() { for (const key of Object.keys(data)) delete data[key]; },
    async setAccessLevel({ accessLevel }) { this.access = accessLevel; },
  };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function harness(route, auth = { token: 'secret', login: 'viewer', revision: 'a' }) {
  const chrome = { storage: { local: memory(auth ? { activityAuth: auth } : {}), session: memory() } };
  const requests = [];
  let now = 1000;
  const service = createActivityService(chrome, async (url, options) => {
    requests.push({ url, options });
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return route(url, options.body ? JSON.parse(options.body) : null);
  }, () => now);
  return { service, chrome, requests, advance() { now += 121_000; } };
}
function timeline(nodes, pageInfo = {}) {
  return json({ data: { repository: { subject: { timelineItems: {
    nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false, ...pageInfo },
  } } } } });
}
function basicRoute(url, body) {
  if (url.includes('/notifications?')) return json([]);
  if (body?.query.includes('reviews(')) return json({ data: { repository: { pullRequest: { headRefOid: 'old', reviews: { nodes: [review] } } } } });
  if (body?.query.includes('timelineItems')) return timeline([comment]);
  throw new Error(`Unexpected request: ${url}`);
}

test('notification URLs normalize changes links and reject foreign hosts', () => {
  assert.equal(parseItem('https://github.com/acme/repo/pull/42/changes/abc..def?notification_referrer_id=123').key, 'acme/repo/42');
  for (const url of ['https://example.com/acme/repo/pull/42', 'https://user:pass@github.com/acme/repo/pull/42', 'https://github.com/acme/repo/actions/42']) assert.throws(() => parseItem(url));
});
test('baseline uses the most recent read or submitted review, with approval wording', () => {
  assert.equal(reviewBaseline(review, null).label, 'since your approval');
  assert.equal(reviewBaseline(review, after).label, 'since you last read');
  assert.equal(reviewBaseline({ ...review, state: 'COMMENTED' }, null).label, 'since your review');
  assert.equal(reviewBaseline(null,null), null);
});
test('force-push is never presented as a confirmed rebase', () => {
  const summary = summarizeActivity({ events: [commit, force], baseline: reviewBaseline(review), comparison: { status: 'diverged' }, review });
  const forced = summarizeActivity({ events: [force], baseline: reviewBaseline(review), comparison: { status: 'diverged' }, review });
  assert.match(forced.text, /force-pushed/);
  assert.match(forced.detail, /does not prove a rebase-only/);
  assert.match(summary.text, /force-pushed/);
});
test('commit counts come from PR membership, not all commits in the branch comparison', () => {
  const result = summarizeActivity({ events: [commit], review, baseline: reviewBaseline(review), comparison: { status: 'ahead', ahead_by: 63, newCommits: 1, fileCount: 3 } });
  assert.equal(result.text, '1 new commit since your approval · Rename helpers · 3 files changed');
});
test('uses comment authors verbatim and removes old events without assuming notification cause', () => {
  const result = summarizeActivity({ events: [{ ...comment, createdAt: before }, comment], baseline: reviewBaseline(review) });
  assert.match(result.text, /^@stalbot commented/);
  assert.match(result.text, /<script>/);
  assert.equal(result.detail, 'since your approval');
  assert.match(summarizeActivity({ events: [], complete: false }).detail, /older events were not loaded/);
});
test('cache survives service worker recreation, expires, and separates row update stamps', async () => {
  const h = harness(basicRoute);
  const url = 'https://github.com/acme/repo/pull/42';
  const first = await h.service.summary(url,'viewer','a');
  const count = h.requests.length;
  const restarted = createActivityService(h.chrome, () => { throw new Error('Should use cached data'); }, () => 1000);
  assert.deepEqual(await restarted.summary(url,'viewer','a'), first);
  assert.equal(h.requests.length, count);
  await h.service.summary(url,'viewer','b');
  assert.ok(h.requests.length > count);
  const next = h.requests.length;
  h.advance();
  await h.service.summary(url,'viewer','b');
  assert.ok(h.requests.length > next);
  assert.equal(h.chrome.storage.local.access, 'TRUSTED_CONTEXTS');
  assert.equal(h.chrome.storage.session.access, 'TRUSTED_CONTEXTS');
});
test('paginates notifications and activity rather than claiming a partial set is complete', async () => {
  const h = harness((url,body) => {
    if (url.includes('/notifications?')) return new URL(url).searchParams.get('page') === '1'
      ? json([],200,{ link:'<https://api.github.com/next>; rel="next"' })
      : json([{ subject:{url:'https://api.github.com/repos/acme/repo/issues/42'}, last_read_at:before }]);
    assert.ok(body.query.includes('since:$since'));
    return body.variables.cursor ? timeline([comment]) : timeline([], { hasNextPage:true, endCursor:'next' });
  });
  const result = await h.service.summary('https://github.com/acme/repo/issues/42','viewer');
  assert.match(result.text, /commented/);
  assert.equal(h.requests.length, 4);
});
test('intersects paginated comparison commits with all PR commits', async () => {
  const h = harness((url,body) => {
    if (url.includes('/notifications?')) return json([]);
    if (body?.query.includes('reviews(')) return json({ data:{ repository:{ pullRequest:{ headRefOid:'new',reviews:{nodes:[review]} } } } });
    if (body?.query.includes('timelineItems')) return timeline([commit]);
    if (url.includes('/compare/')) return new URL(url).searchParams.get('page') === '1'
      ? json({status:'ahead',ahead_by:63,commits:[{sha:'base-change'}],files:[{}]},200,{link:'<https://api.github.com/next>; rel="next"'})
      : json({status:'ahead',commits:[{sha:'new'}]});
    if (body?.query.includes('commits(first:')) return json({data:{repository:{pullRequest:{commits:{
      nodes:[{commit:{oid:body.variables.cursor ? 'new' : 'old'}}],
      pageInfo:{hasNextPage:!body.variables.cursor,endCursor:'next'},
    }}}}});
    throw new Error('Unexpected request');
  });
  assert.match((await h.service.summary('https://github.com/acme/repo/pull/42','viewer')).text, /^1 new commit/);
});
test('missing setup and account mismatch do not make network requests', async () => {
  const h = harness(() => { throw new Error('Unexpected network'); }, null);
  assert.deepEqual(await h.service.summary('https://github.com/acme/repo/issues/42','viewer'),{needsSetup:true});
  const ready = harness(() => { throw new Error('Unexpected network'); });
  await assert.rejects(ready.service.summary('https://github.com/acme/repo/issues/42','other'), /does not match/);
  assert.equal(ready.requests.length,0);
});
test('API failures are explicit and rate-limit backoff persists across requests', async () => {
  const limited = harness(() => json({},429,{'retry-after':'60'}));
  const url='https://github.com/acme/repo/issues/42';
  await assert.rejects(limited.service.summary(url,'viewer'), /rate limit/);
  await assert.rejects(limited.service.summary(url,'viewer'), /rate limit/);
  assert.equal(limited.requests.length,1);
  const unauthorized = harness(() => json({},401));
  await assert.rejects(unauthorized.service.summary(url,'viewer'), /expired or invalid/);
  const partial = harness(() => json({data:{},errors:[{message:'secret diagnostic'}]}));
  await assert.rejects(partial.service.summary(url,'viewer'), /could not load/);
});
test('disconnect removes credentials and caches; settings responses never contain the token', async () => {
  const h = harness((url) => url.endsWith('/user') ? json({login:'viewer'}) : json([]), null);
  const result = await h.service.connect('ghp_123456789012345678901234');
  assert.deepEqual(result,{connected:true,login:'viewer'});
  assert.equal(JSON.stringify(await h.service.status()).includes('ghp_'), false);
  await h.chrome.storage.session.set({cached:'private'});
  await h.service.disconnect();
  assert.deepEqual(h.chrome.storage.local.data,{});
  assert.deepEqual(h.chrome.storage.session.data,{});
});
test('issue timeline query excludes PR-only event fragments', () => {
  assert.equal(timelineQuery('issues',true).includes('HeadRefForcePushedEvent'),false);
  assert.equal(timelineQuery('pull',true).includes('HeadRefForcePushedEvent'),true);
});

test('disconnected or replaced credentials cannot repopulate caches from an in-flight request', async () => {
  let release;
  const h = harness((url, body) => url.includes('/notifications?')
    ? new Promise(resolve => { release = () => resolve(json([])); }) : basicRoute(url,body));
  const request = h.service.summary('https://github.com/acme/repo/issues/42','viewer');
  while (!release) await new Promise(resolve => setTimeout(resolve,0));
  await h.service.disconnect();
  release();
  await assert.rejects(request,/connection changed/);
  assert.deepEqual(h.chrome.storage.session.data,{});
});
test('an inline review comment is previewed when the review body is empty', () => {
  const result = summarizeActivity({events:[{__typename:'PullRequestReview',submittedAt:after,state:'COMMENTED',author:{login:'reviewer'},bodyText:'',comments:{nodes:[{bodyText:'Please rename this helper.'}]}}]});
  assert.match(result.text,/Please rename this helper/);
});
test('partial GraphQL data preserves usable PR activity despite restricted optional fields',async()=>{
 const h=harness((url,body)=>{
  if(body?.query.includes('timelineItems')) return json({data:{repository:{subject:{timelineItems:{
    nodes:[comment],pageInfo:{hasNextPage:false}
  }}}},errors:[{type:'FORBIDDEN',message:'Optional reviewer unavailable'}]});
  return basicRoute(url,body);
 });
 assert.match((await h.service.summary('https://github.com/acme/repo/pull/42','viewer')).text,/commented/);
});
test('failed optional comparison does not discard the timeline',async()=>{
 const h=harness((url,body)=>{
  if(body?.query.includes('reviews(')) return json({data:{repository:{pullRequest:{headRefOid:'new',reviews:{nodes:[review]}}}}});
  if(url.includes('/compare/')) return json({},422);
  return basicRoute(url,body);
 });
 const result=await h.service.summary('https://github.com/acme/repo/pull/42','viewer');
 assert.match(result.text,/commented/);
 assert.match(result.detail,/comparison unavailable/);
});
test('empty timelines fall back to a labeled description, not an invented activity',async()=>{
 const h=harness((url,body)=>{
  if(url.includes('/notifications?')) return json([]);
  if(body.query.includes('timelineItems')) return timeline([]);
  return json({data:{repository:{subject:{bodyText:'Useful context',author:{login:'author'}}}}});
 });
 const result=await h.service.summary('https://github.com/acme/repo/issues/42','viewer');
 assert.equal(result.text,'Description: Useful context');
});
