(() => {
  'use strict';
  const A = globalThis.SlackExporter;
  A.exportAttachments = snapshot => [...new Map(snapshot.parents.flatMap(p => [p, ...p.replies])
    .flatMap(m => m.files || []).map(f => [f.key, f])).values()];
  A.downloadAttachments = async (snapshot, progress = () => {}) => {
    const attachments = A.exportAttachments(snapshot), mappings = [];
    if (attachments.length > A.LIMITS.maxMediaEntries) throw Error('Attachment count exceeds the export limit.');
    let total = 0;
    const started = Date.now();
    for (const attachment of attachments) {
      const remaining = A.LIMITS.maxRunMs - (Date.now() - started);
      if (remaining <= 0) throw Error('Attachment download time limit reached. No ZIP was saved.');
      let url;
      try { url = new URL(attachment.downloadUrl || attachment.url); } catch { throw Error(`No download link for ${attachment.name}.`); }
      if (url.protocol !== 'https:' || url.hostname !== 'files.slack.com' || !url.pathname.startsWith('/files-pri/') || url.username || url.password)
        throw Error(`Slack did not expose a supported download link for ${attachment.name}.`);
      progress(`Downloading attachments: ${mappings.length + 1} of ${attachments.length}`);
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(60000, remaining));
      try {
        const response = await fetch(url.href, {credentials: 'include', signal: controller.signal, redirect: 'error'});
        if (!response.ok) throw Error(`Slack returned HTTP ${response.status}`);
        const html = /text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '');
        // HTML reports are valid files only when Slack explicitly serves an attachment.
        if (html && !(/^attachment\s*(?:;|$)/i.test(response.headers.get('content-disposition') || '')
          && /\.(?:html?|xhtml)$/i.test(url.pathname))) throw Error('Slack returned a web page instead of a file');
        const declared = Number(response.headers.get('content-length') || 0);
        if (declared > A.LIMITS.maxMediaBytes || total + declared > A.LIMITS.maxArchiveInputBytes) throw Error('Attachment size limit exceeded');
        const reader = response.body?.getReader();
        if (!reader) throw Error('Slack returned no file body');
        const chunks = []; let size = 0;
        try {
          while (true) {
            const {done, value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > A.LIMITS.maxMediaBytes || total + size > A.LIMITS.maxArchiveInputBytes) throw Error('Attachment size limit exceeded');
            chunks.push(value);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        if (!size || (declared && declared !== size)) throw Error('Slack returned an empty or truncated file');
        total += size;
        const filename = decodeURIComponent(url.pathname.split('/').pop()) || attachment.name;
        mappings.push({attachment, file: new File(chunks, A.safeName(filename), {type: response.headers.get('content-type') || 'application/octet-stream'})});
      } catch (error) { throw Error(`Could not download ${attachment.name}: ${error.message}. No ZIP was saved.`); }
      finally { clearTimeout(timer); }
    }
    return mappings;
  };
})();
