const form = document.getElementById('connect-form');
const token = document.getElementById('token');
const connect = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');
const status = document.getElementById('status');
const connection = document.getElementById('connection');

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result || result.error) throw new Error(result?.error ?? 'The extension did not respond. Reload this page.');
  return result;
}
function render(result) {
  connection.textContent = result.connected ? `Connected as @${result.login}` : 'Not connected. Bulk actions work without a connection.';
  disconnect.hidden = !result.connected;
  connect.textContent = result.connected ? 'Replace token' : 'Connect GitHub';
}
async function initialize() {
  try { render(await send({ type: 'activity-status' })); }
  catch (error) { status.textContent = error.message; status.setAttribute('data-error',''); }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  connect.disabled = disconnect.disabled = true;
  status.removeAttribute('data-error');
  status.textContent = 'Connecting…';
  try {
    const granted = await chrome.permissions.request({ origins: ['https://api.github.com/*'] });
    if (!granted) throw new Error('Allow access to api.github.com to load activity summaries.');
    render(await send({ type: 'activity-connect', token: token.value }));
    token.value = '';
    status.textContent = 'Connected. Return to GitHub Notifications to see activity summaries.';
  } catch (error) { status.textContent = error.message; status.setAttribute('data-error',''); }
  finally { connect.disabled = disconnect.disabled = false; }
});
disconnect.addEventListener('click', async () => {
  connect.disabled = disconnect.disabled = true;
  try {
    render(await send({ type: 'activity-disconnect' }));
    token.value = '';
    status.removeAttribute('data-error');
    status.textContent = 'Token and cached activity removed.';
  } catch (error) { status.textContent = error.message; status.setAttribute('data-error',''); }
  finally { connect.disabled = disconnect.disabled = false; }
});
initialize();
