import { createActivityService } from './activity-api.mjs';

const activity = createActivityService(chrome);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['open-notifications', 'activity-status', 'activity-summary', 'activity-options', 'activity-connect', 'activity-disconnect'].includes(message?.type)) return;
  (async () => {
    try {
      const optionsSender = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
      if (['activity-connect', 'activity-disconnect'].includes(message.type)) {
        if (!optionsSender) throw new Error('Connect GitHub from the extension settings page.');
        sendResponse(message.type === 'activity-connect'
          ? await activity.connect(message.token) : await activity.disconnect());
        return;
      }
      if (optionsSender && message.type === 'activity-status') {
        sendResponse(await activity.status());
        return;
      }
      const source = new URL(sender.url);
      if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 ||
          source.origin !== 'https://github.com' || !/^\/notifications\/?$/.test(source.pathname)) {
        throw new Error('Open tabs from the GitHub notifications page.');
      }
      if (message.type === 'activity-options') {
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }
      if (message.type === 'activity-status') {
        sendResponse(await activity.status());
        return;
      }
      if (message.type === 'activity-summary') {
        sendResponse(await activity.summary(message.url, message.login, message.stamp));
        return;
      }
      if (!Array.isArray(message.urls) || message.urls.some(value => {
        if (typeof value !== 'string') return true;
        const url = new URL(value);
        return url.origin !== 'https://github.com' || Boolean(url.username || url.password);
      })) {
        throw new Error('Only GitHub notification links can be opened.');
      }
      let opened = 0;
      let failed = 0;
      for (const url of new Set(message.urls)) {
        try {
          await chrome.tabs.create({ url, active: false, windowId: sender.tab.windowId });
          opened++;
        } catch {
          failed++;
        }
      }
      sendResponse({ opened, failed });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  })();
  return true;
});
