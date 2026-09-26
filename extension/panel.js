(() => {
  'use strict';
  const A = SlackExporter, $ = id => document.getElementById(id);
  const tabId = Number(new URLSearchParams(location.search).get('tab'));
  let snapshot, options, phase = 'idle', pendingDownload = null;
  const send = (type, extra = {}) => chrome.tabs.sendMessage(tabId, {type, tabId, ...extra});
  const status = text => { $('status').textContent = text; };
  function updateControls() {
    const busy = phase !== 'idle';
    $('options').disabled = busy;
    $('start').disabled = busy;
    $('cancel').hidden = phase !== 'collecting';
    $('save').disabled = busy || !snapshot;
    $('close').disabled = busy;
    if (Number.isSafeInteger(tabId) && tabId > 0) send('sce:lock', {locked:busy}).catch(() => {});
  }
  $('close').onclick = () => send('sce:close').catch(e => status(e.message));
  $('cancel').onclick = async () => {
    if (phase !== 'collecting') return;
    $('cancel').disabled = true; status('Stopping capture…');
    try { await send('sce:cancel'); } catch (e) { status(e.message); }
  };
  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id === chrome.runtime.id && m.type === 'sce:progress' && m.tabId === tabId && phase === 'collecting') status(m.text);
  });
  $('start').onclick = async () => {
    if (phase !== 'idle') return;
    try {
      // Validation happens before discarding a previous result.
      const nextOptions = A.validateOptions({range: A.range($('from').value, $('to').value), timestamps: true,
        threads: true, olderThreads: !$('from').value, messageLinks: false, media: $('media').checked});
      phase = 'collecting'; options = nextOptions; snapshot = null;
      $('results').hidden = true; $('save').hidden = true; $('cancel').disabled = false;
      updateControls(); status('Finding channel history…');
      // Request optional access in the initiating click, before collection loses user activation.
      if (options.media && !await chrome.permissions.request({origins: ['https://files.slack.com/*']}))
        throw Error('Slack attachment access was not granted. Nothing was downloaded.');
      const result = await send('sce:collect', {options});
      if (!result || result.error) throw Error(result?.error || 'The Slack tab disconnected. Reopen the exporter.');
      snapshot = result.snapshot;
      $('verification').textContent = snapshot.verification?.status === 'verified'
        ? 'Available history and reply counts checked.' : '';
      $('verification').hidden = ! $('verification').textContent;
      $('summary').textContent = `${snapshot.parents.length} parent messages · ${snapshot.parents.reduce((n, p) => n + p.replies.length, 0)} replies. ${snapshot.boundary || 'Boundary not reached'}.`;
      $('warnings').replaceChildren(...snapshot.warnings.map(w => { const li = document.createElement('li'); li.textContent = w; return li; }));
      $('attachments').hidden = !options.media;
      $('attachments').textContent = `${A.exportAttachments(snapshot).length} attachments`;
      $('save').textContent = 'Retry download';
      $('results').hidden = false;
      phase = 'idle';
      await downloadExport();
    } catch (e) { phase = 'idle'; status(e.message); updateControls(); }
  };
  function finishDownload(id, error) {
    if (!pendingDownload || pendingDownload.id !== id) return;
    const filename = pendingDownload.filename;
    URL.revokeObjectURL(pendingDownload.url); pendingDownload = null; phase = 'idle';
    $('save').hidden = !error; updateControls();
    status(error ? 'Download failed: ' + error + '. Retry download.' : 'Downloaded: ' + filename);
  }
  chrome.downloads.onChanged.addListener(delta => {
    if (pendingDownload?.id === delta.id && delta.filename?.current)
      pendingDownload.filename = delta.filename.current.split(/[\\/]/).pop();
    if (delta.error || delta.state?.current === 'interrupted') finishDownload(delta.id, delta.error?.current || 'Interrupted');
    else if (delta.state?.current === 'complete') finishDownload(delta.id);
  });
  async function downloadExport() {
    if (phase !== 'idle' || !snapshot) return;
    // Pin the complete export input before the first asynchronous file read.
    const runSnapshot = snapshot, runOptions = options;
    const filename = runOptions.media ? A.exportName(runSnapshot) + '.zip' : A.channelTitle(runSnapshot) + '.md';
    phase = 'saving'; updateControls(); status('Building export…');
    let url;
    try {
      const runMappings = runOptions.media ? await A.downloadAttachments(runSnapshot, status) : [];
      const blob = runOptions.media ? await A.bundle(runSnapshot, runOptions, runMappings)
        : new Blob([A.markdown(runSnapshot, runOptions)], {type: 'text/markdown;charset=utf-8'});
      url = URL.createObjectURL(blob);
      const id = await chrome.downloads.download({url, filename, saveAs: false, conflictAction: 'uniquify'});
      pendingDownload = {id, url, filename}; phase = 'downloading'; updateControls(); status('Downloading…');
      // A tiny download may complete before the download() promise returns.
      try {
        const [item] = await chrome.downloads.search({id});
        if (item?.filename && pendingDownload?.id === id) pendingDownload.filename = item.filename.split(/[\\/]/).pop();
        if (item?.state === 'complete') finishDownload(id);
        else if (item?.state === 'interrupted') finishDownload(id, item.error || 'Interrupted');
      } catch { /* The onChanged listener still owns this active download. */ }
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      pendingDownload = null; phase = 'idle'; $('save').hidden = false; updateControls(); status('Download failed: ' + e.message);
    }
  }
  $('save').onclick = downloadExport;
  if (!Number.isSafeInteger(tabId) || tabId <= 0) {
    phase = 'invalid'; updateControls(); $('close').disabled = true;
    status('Open this exporter from its toolbar button on a Slack channel.');
  } else {
    updateControls();
    if (typeof ResizeObserver !== 'undefined') {
      let lastHeight = 0;
      new ResizeObserver(() => {
        const height = Math.ceil(document.body.getBoundingClientRect().height);
        if (height !== lastHeight) { lastHeight = height; send('sce:resize', {height}).catch(() => {}); }
      }).observe(document.body);
    }
  }
})();
