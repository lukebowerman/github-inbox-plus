import { parseItem, reviewBaseline, summarizeActivity } from './activity-summary.mjs';

const API = 'https://api.github.com';
const TTL = 120_000;
const COMMON_EVENTS = `__typename
  ... on IssueComment { createdAt bodyText author { login avatarUrl } }
  ... on ClosedEvent { createdAt actor { login avatarUrl } }
  ... on ReopenedEvent { createdAt actor { login avatarUrl } }
  ... on RenamedTitleEvent { createdAt actor { login avatarUrl } }`;
const PR_EVENTS = `
  ... on HeadRefForcePushedEvent { createdAt actor { login avatarUrl } }
  ... on BaseRefForcePushedEvent { createdAt actor { login avatarUrl } }
  ... on PullRequestCommit { commit { oid committedDate messageHeadline author { user { login avatarUrl } } } }
  ... on PullRequestReview { submittedAt state bodyText author { login avatarUrl } comments(last:1) { nodes { bodyText } } }
  ... on ReviewRequestedEvent { createdAt actor { login avatarUrl } requestedReviewer { ... on User { login }  } }
  ... on ReviewDismissedEvent { createdAt actor { login avatarUrl } }
  ... on MergedEvent { createdAt actor { login avatarUrl } }
  ... on ReadyForReviewEvent { createdAt actor { login avatarUrl } }
  ... on ConvertToDraftEvent { createdAt actor { login avatarUrl } }`;

export function timelineQuery(type, hasBaseline) {
  return `query($owner:String!,$repo:String!,$number:Int!,$cursor:String${hasBaseline ? ',$since:DateTime!' : ''}) {
    repository(owner:$owner,name:$repo) {
      subject: ${type === 'pull' ? 'pullRequest' : 'issue'}(number:$number) {
        timelineItems(${hasBaseline ? 'first:100,after:$cursor,since:$since' : 'last:100,before:$cursor'}) {
          pageInfo { hasNextPage endCursor hasPreviousPage startCursor }
          nodes { ${COMMON_EVENTS} ${type === 'pull' ? PR_EVENTS : ''} }
        }
      }
    }
  }`;
}

export function createActivityService(chrome, fetcher = fetch, now = Date.now) {
  const pending = new Map();
  async function protectStorage() {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }
  async function getAuth() {
    await protectStorage();
    return (await chrome.storage.local.get('activityAuth')).activityAuth;
  }
  async function status() {
    const auth = await getAuth();
    return { connected: Boolean(auth), login: auth?.login ?? null, revision: auth?.revision ?? null };
  }
  async function request(auth, path, body) {
    const { activityBackoff = 0 } = await chrome.storage.session.get('activityBackoff');
    if (activityBackoff > now()) throw new Error('GitHub rate limit reached. Activity will retry later.');
    let response;
    try {
      response = await fetcher(`${API}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`,
          'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('GitHub could not be reached. Retry when you are online.'); }
    let rateLimited = false;
    if (response.status === 403) {
      try { rateLimited = /rate limit/i.test((await response.json()).message ?? ''); }
      catch { rateLimited = false; }
    }
    if (rateLimited || response.status === 429 || (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
      const retry = Number(response.headers.get('retry-after')) || 60;
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      await chrome.storage.session.set({ activityBackoff: Math.max(now() + retry * 1000, reset || 0) });
      throw new Error('GitHub rate limit reached. Activity will retry later.');
    }
    if (response.status === 401) throw new Error('GitHub token expired or invalid. Reconnect in Activity settings.');
    if (response.status === 403) throw new Error('GitHub denied access. Check token scopes and organization SSO authorization.');
    if (response.status === 404) throw new Error('Activity unavailable: repository or commit is inaccessible.');
    if (!response.ok) throw new Error(`GitHub returned ${response.status}. Try again later.`);
    const data = await response.json();
    if (data.errors?.length && !data.data?.repository) {
      if (data.errors.some(error => error.type === 'RATE_LIMITED')) {
        await chrome.storage.session.set({ activityBackoff: now() + 60_000 });
      }
      throw new Error('GitHub could not load this activity. Check repository access or retry later.');
    }
    return { data, headers: response.headers };
  }
  async function connect(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(token.trim())) throw new Error('Enter a valid GitHub personal access token.');
    await protectStorage();
    const auth = { token: token.trim() };
    const { data: user } = await request(auth, '/user');
    await request(auth, '/notifications?all=true&per_page=1');
    if (!user.login) throw new Error('Unable to identify the GitHub account.');
    await chrome.storage.session.clear();
    await chrome.storage.local.set({ activityAuth: { ...auth, login: user.login, revision: crypto.randomUUID() } });
    return { connected: true, login: user.login };
  }
  async function disconnect() {
    await protectStorage();
    await chrome.storage.local.remove('activityAuth');
    await chrome.storage.session.clear();
    return { connected: false };
  }
  async function cached(key, auth, load, version = '') {
    const saved = (await chrome.storage.session.get(key))[key];
    if (saved?.revision === auth.revision && saved.version === version && saved.expires > now()) return saved.value;
    const flightKey = `${auth.revision}:${key}:${version}`;
    if (pending.has(flightKey)) return pending.get(flightKey);
    const work = (async () => {
      const value = await load();
      const latest = await getAuth();
      if (latest?.revision !== auth.revision) throw new Error('GitHub connection changed. Refresh notifications.');
      await chrome.storage.session.set({ [key]: { revision: auth.revision, version, expires: now() + TTL, value } });
      return value;
    })();
    pending.set(flightKey, work);
    try { return await work; } finally { pending.delete(flightKey); }
  }
  async function notification(item, auth) {
    const records = await cached(`notifications:${item.owner}/${item.repo}`, auth, async () => {
      const results = [];
      for (let page = 1; page <= 100; page++) {
        const { data, headers } = await request(auth, `/repos/${item.owner}/${item.repo}/notifications?all=true&per_page=50&page=${page}`);
        if (!Array.isArray(data)) throw new Error('Unexpected GitHub notification response.');
        results.push(...data.map(row => ({ url: row.subject?.url, lastRead: row.last_read_at })));
        if (!/rel="next"/.test(headers.get('link') ?? '')) return results;
      }
      throw new Error('Too many notification pages to establish a read baseline.');
    });
    const url = `${API}/repos/${item.owner}/${item.repo}/${item.type === 'pull' ? 'pulls' : 'issues'}/${item.number}`;
    return records.find(row => row.url === url);
  }
  async function loadItem(item, auth) {
    const note = await notification(item, auth);
    let review = null;
    let head = null;
    if (item.type === 'pull') {
      const { data } = await request(auth, '/graphql', { query: `query($owner:String!,$repo:String!,$number:Int!,$login:String!) {
        repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
          headRefOid reviews(last:1,author:$login,states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) {
            nodes { submittedAt state commit { oid } }
          }
        } }
      }`, variables: { owner: item.owner, repo: item.repo, number: item.number, login: auth.login } });
      const pr = data.data?.repository?.pullRequest;
      if (!pr) throw new Error('This pull request is not accessible with your token.');
      head = pr.headRefOid;
      review = pr.reviews.nodes[0] ?? null;
    }
    const baseline = reviewBaseline(review, note?.lastRead);
    const events = [];
    let cursor = null;
    let complete = true;
    for (let page = 0; page < 20; page++) {
      const { data } = await request(auth, '/graphql', { query: timelineQuery(item.type, Boolean(baseline)),
        variables: { owner: item.owner, repo: item.repo, number: item.number, cursor, ...(baseline ? { since: baseline.at } : {}) } });
      const timeline = data.data?.repository?.subject?.timelineItems;
      if (!timeline) throw new Error('This notification is not accessible with your token.');
      events.push(...timeline.nodes.filter(Boolean));
      if (!baseline) { complete = !timeline.pageInfo.hasPreviousPage; break; }
      if (!timeline.pageInfo.hasNextPage) break;
      cursor = timeline.pageInfo.endCursor;
      if (page === 19) throw new Error('Activity history is too large to summarize completely. Open the conversation for details.');
    }
    let comparison = null;
    let comparisonError = null;
    if (review?.commit?.oid && head && review.commit.oid !== head) {
      try {
        const added = new Set();
        let compared;
        for (let page = 1; page <= 100; page++) {
          const { data, headers } = await request(auth, `/repos/${item.owner}/${item.repo}/compare/${review.commit.oid}...${head}?per_page=100&page=${page}`);
          compared ??= data;
          for (const commit of data.commits ?? []) added.add(commit.sha);
          if (!/rel="next"/.test(headers.get('link') ?? '')) break;
          if (page === 100) throw new Error('Commit comparison is too large to summarize completely.');
        }
        comparison = { status: compared.status, newCommits: null,
          fileCount: compared.files && compared.files.length < 300 ? compared.files.length : null };
        if (compared.status === 'ahead') {
          const prCommits = new Set();
          let after = null;
          for (let page = 0; page < 100; page++) {
            const { data } = await request(auth, '/graphql', { query: `query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
              repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
                commits(first:100,after:$cursor) { pageInfo { hasNextPage endCursor } nodes { commit { oid } } }
              } }
            }`, variables: { owner: item.owner, repo: item.repo, number: item.number, cursor: after } });
            const commits = data.data?.repository?.pullRequest?.commits;
            if (!commits) throw new Error('Unable to establish which commits belong to this pull request.');
            for (const node of commits.nodes) prCommits.add(node.commit.oid);
            if (!commits.pageInfo.hasNextPage) break;
            after = commits.pageInfo.endCursor;
            if (page === 99) throw new Error('Pull request has too many commits to summarize completely.');
          }
          comparison.newCommits = [...prCommits].filter(oid => added.has(oid)).length;
        }
      } catch (error) {
        comparison = null;
        comparisonError = error.message;
      }
    }
    let result = summarizeActivity({ events, baseline, comparison, review, complete });
    if (!result.hasActivity) {
      const { data } = await request(auth, '/graphql', { query: `query($owner:String!,$repo:String!,$number:Int!) {
        repository(owner:$owner,name:$repo) { subject: ${item.type === 'pull' ? 'pullRequest' : 'issue'}(number:$number) {
          bodyText author { login avatarUrl }
        } }
      }`, variables: { owner: item.owner, repo: item.repo, number: item.number } });
      const subject = data.data?.repository?.subject;
      if (subject?.bodyText) {
        const body = subject.bodyText.replace(/\s+/g, ' ').trim();
        result = { ...result, text: `Description: ${body.length > 150 ? body.slice(0,147) + '…' : body}`,
          detail: 'Conversation description; GitHub returned no supported activity after your read or review baseline.',
          avatar: subject.author?.avatarUrl ?? null };
      }
    }
    if (comparisonError) result.detail += ' · Commit comparison unavailable; showing conversation activity';
    return result;
  }
  async function summary(url, login, stamp = '') {
    const item = parseItem(url);
    const auth = await getAuth();
    if (!auth) return { needsSetup: true };
    if (typeof login !== 'string' || login.toLowerCase() !== auth.login.toLowerCase()) {
      throw new Error('The connected GitHub account does not match this page. Reconnect in Activity settings.');
    }
    if (typeof stamp !== 'string' || stamp.length > 100) throw new Error('Invalid notification timestamp.');
    return cached(`summary:v2:${item.key}`, auth, () => loadItem(item, auth), stamp);
  }
  return { status, connect, disconnect, summary };
}
