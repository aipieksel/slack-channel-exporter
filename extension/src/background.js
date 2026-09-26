importScripts('core.js');
const ACTION_ICONS = Object.fromEntries(['light', 'dark'].map(theme => [theme,
  Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${theme}-${size}.png`]))
]));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'sce:icon-theme' || !Number.isInteger(sender.tab?.id)) return;
  const theme = message.theme === 'dark' ? 'dark' : 'light';
  chrome.action.setIcon({tabId: sender.tab.id, path: ACTION_ICONS[theme]}).catch(() => {});
});
chrome.action.onClicked.addListener(async tab => {
  if (!SlackExporter.channelIdentity(tab.url || '')) {
    await chrome.action.setBadgeText({tabId: tab.id, text: 'OPEN'});
    await chrome.action.setTitle({tabId: tab.id, title: 'Open a Slack web channel, then click again.'});
    return;
  }
  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['src/core.js', 'src/adapter.js', 'src/panel-shell.js', 'src/content.js']});
    await chrome.tabs.sendMessage(tab.id, {type: 'sce:open', tabId: tab.id});
    await chrome.action.setBadgeText({tabId: tab.id, text: ''});
    await chrome.action.setTitle({tabId: tab.id, title: 'Slack Channel Exporter'});
  } catch {
    await chrome.action.setBadgeText({tabId: tab.id, text: 'ERR'});
    await chrome.action.setTitle({tabId: tab.id, title: 'Exporter could not open. Refresh Slack and click again.'});
  }
});
