export function parseItem(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/([1-9]\d*)(?:\/.*)?$/);
  if (url.origin !== 'https://github.com' || url.username || url.password || !match) {
    throw new Error('Unsupported notification link.');
  }
  const [, owner, repo, type, number] = match;
  return { owner, repo, type, number: Number(number), key: `${owner}/${repo}/${number}`, url: `https://github.com/${owner}/${repo}/${type}/${number}` };
}

const plain = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const excerpt = text => { const value = plain(text); return value.length > 150 ? `${value.slice(0,147)}…` : value; };

export function reviewBaseline(review, lastRead) {
  if (lastRead && (!review?.submittedAt || Date.parse(lastRead) >= Date.parse(review.submittedAt))) {
    return { at: lastRead, label: 'since you last read' };
  }
  if (review?.submittedAt) return {
    at: review.submittedAt, label: review.state === 'APPROVED' ? 'since your approval' : 'since your review',
  };
  return null;
}

export function eventSummary(event) {
  const actor = event.actor ?? event.author ?? event.commit?.author?.user;
  const who = actor?.login ? `@${actor.login}` : 'Someone';
  const at = event.submittedAt ?? event.createdAt ?? event.commit?.committedDate;
  let text;
  let kind = 'activity';
  switch (event.__typename) {
    case 'HeadRefForcePushedEvent': text = `${who} force-pushed · branch history changed`; kind = 'force'; break;
    case 'BaseRefForcePushedEvent': text = `${who} force-pushed the base branch`; kind = 'force'; break;
    case 'PullRequestCommit': text = `Commit: ${excerpt(event.commit?.messageHeadline)}`; kind = 'commit'; break;
    case 'IssueComment': text = `${who} commented${event.bodyText ? `: “${excerpt(event.bodyText)}”` : ''}`; kind = 'comment'; break;
    case 'PullRequestReview': {
      if (event.state === 'PENDING') return null;
      const action = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', DISMISSED: 'had a review dismissed' }[event.state] ?? 'reviewed';
      const body = event.bodyText || event.comments?.nodes?.[0]?.bodyText;
      text = `${who} ${action}${body ? `: “${excerpt(body)}”` : ''}`;
      kind = 'review'; break;
    }
    case 'ReviewRequestedEvent': text = `${who} requested review${event.requestedReviewer?.login ? ` from @${event.requestedReviewer.login}` : event.requestedReviewer?.name ? ` from ${event.requestedReviewer.name}` : ''}`; kind = 'review'; break;
    case 'ReviewDismissedEvent': text = `${who} dismissed a review`; kind = 'review'; break;
    case 'ClosedEvent': text = `${who} closed this`; break;
    case 'ReopenedEvent': text = `${who} reopened this`; break;
    case 'MergedEvent': text = `${who} merged this`; break;
    case 'ReadyForReviewEvent': text = `${who} marked this ready for review`; kind = 'review'; break;
    case 'ConvertToDraftEvent': text = `${who} converted this to a draft`; break;
    case 'RenamedTitleEvent': text = `${who} changed the title`; break;
    default: return null;
  }
  return { text, at, actor: actor?.login ?? null, avatar: actor?.avatarUrl ?? null, kind };
}

export function summarizeActivity({ events, baseline, comparison, review, complete = true }) {
  const activity = events.map(eventSummary).filter(event => event?.at && Number.isFinite(Date.parse(event.at)))
    .filter(event => !baseline || Date.parse(event.at) > Date.parse(baseline.at))
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at) || Number(b.kind === 'force') - Number(a.kind === 'force'));
  const latest = activity[0];
  let text = latest?.text ?? (baseline ? `No supported activity ${baseline.label}` : 'No recent activity details available');
  const details = [];
  if (baseline) details.push(baseline.label);
  else details.push('Latest activity; no previous read or review baseline');
  if (review?.commit?.oid && comparison?.status === 'ahead' && comparison.newCommits > 0) {
    const label = review.state === 'APPROVED' ? 'since your approval' : 'since your review';
    const commitText = `${comparison.newCommits} new commit${comparison.newCommits === 1 ? '' : 's'} ${label}`;
    if (latest?.kind === 'commit' || !latest) text = `${commitText}${latest ? ` · ${latest.text.replace(/^Commit: /, '')}` : ''}`;
    else details.push(commitText);
    if (comparison.fileCount !== null && comparison.fileCount !== undefined) {
      const files = `${comparison.fileCount} file${comparison.fileCount === 1 ? '' : 's'} changed`;
      if (latest?.kind === 'commit' || !latest) text += ` · ${files}`;
      else details.push(files);
    }
  } else if (comparison?.status === 'diverged') {
    details.push('Branch history diverged from your reviewed commit; this does not prove a rebase-only change');
  }
  if (latest && baseline && !(latest.kind === 'commit' && comparison?.status === 'ahead' && comparison.newCommits > 0) && !text.includes(baseline.label)) text += ` · ${baseline.label}`;
  if (!complete) details.push('Recent activity only; older events were not loaded');
  return { hasActivity: Boolean(latest || (comparison?.status === 'ahead' && comparison.newCommits > 0)), text, detail: details.join(' · '), kind: latest?.kind ?? 'activity', actor: latest?.actor ?? null, avatar: latest?.avatar ?? null };
}
