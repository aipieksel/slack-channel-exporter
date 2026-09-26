(() => {
  'use strict';
  const A = globalThis.SlackExporter;
  const downloadLinks = new WeakMap();
  const fileIdentity = value => String(value).match(/(?:\/|-)(F[A-Z0-9]+)(?:\/|$)/)?.[1];
  const S = Object.freeze({
    row: '[data-message-id], [data-item-key], .c-message_kit__message',
    thread: '[data-qa="threads_flexpane"], [data-qa="thread_view"], .p-thread_view',
    channel: '[data-qa="message_pane"], .p-message_pane',
    scroll: '.c-virtual_list__scroll_container, .c-scrollbar__hider, [data-qa="slack_kit_scrollbar"]',
    body: '[data-qa="message-text"], .c-message_kit__text, .c-message__body',
    reply: '[data-qa="reply_bar"], .c-message__reply_bar, [data-qa="thread_replies"]',
    expand: '[data-qa="message_expand"], [data-qa="expand_message"], [data-qa="message-text-see-more"]',
    busy: '[aria-busy="true"], [role="progressbar"], [data-qa="loading_spinner"]',
    close: '[data-qa="close_flexpane"], [data-qa="close_thread"], button[aria-label="Close"], button[aria-label="Close sidebar"]'
  });
  const visible = e => {
    if (!e || !e.isConnected || e.closest('[hidden]') || !e.getClientRects().length) return false;
    // Slack masks the visible client from accessibility when its thread dialog has focus.
    const masked = e.closest('[aria-hidden="true"]');
    if (masked && !masked.matches('.p-client_container')) return false;
    const style = getComputedStyle(e);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  const outermost = list => {
    const candidates = new Set(list);
    return list.filter(e => { for(let p=e.parentElement;p;p=p.parentElement) if(candidates.has(p)) return false; return true; });
  };
  const timestampLink = e => e.querySelector('a[data-ts], a.c-timestamp, a[data-qa="message_timestamp"]');
  function id(e) {
    if (!e) return null;
    if (e.matches('[data-qa="virtual-list-item"]') && !e.querySelector('[data-qa="message_container"], .c-message_kit__message')) return null;
    if (e.matches('.p-message_pane__foreword') || e.querySelector('.p-message_pane__foreword')) return null;
    return A.ts(e.getAttribute('data-message-id')) || A.ts(e.getAttribute('data-item-key')) || A.ts(e.id)
      || A.ts(timestampLink(e)?.getAttribute('data-ts')) || A.ts(timestampLink(e)?.getAttribute('href'));
  }
  function rows(root) {
    if (!root) return [];
    return outermost([...root.querySelectorAll(S.row)].filter(e => id(e) && visible(e)));
  }
  function scroller(root) {
    const candidates = [...root.querySelectorAll(S.scroll)].filter(e => visible(e) && e.clientHeight > 0);
    const populated = candidates.filter(e => rows(e).length);
    // Slack's inner virtual list lays out messages; its outer overflow element scrolls.
    const scrolling = populated.filter(e => /^(auto|scroll|overlay)$/.test(getComputedStyle(e).overflowY));
    const surfaces = scrolling.length ? scrolling : populated;
    const leaves = surfaces.filter(e => !surfaces.some(p => p !== e && e.contains(p)));
    if (leaves.length > 1) throw new A.ExportError('AMBIGUOUS_VIEW', 'Multiple message scroll surfaces found. Close search and extra panes.');
    if (leaves.length === 1) return leaves[0];
    if (candidates.length === 1) return candidates[0];
    throw new A.ExportError('VIEW_MISSING', 'The message scroll surface is unavailable.');
  }
  function channelPane() {
    const panes = outermost([...document.querySelectorAll(S.channel)].filter(e => visible(e) && !e.closest(S.thread)));
    if (panes.length !== 1) throw new A.ExportError('AMBIGUOUS_VIEW', 'Open one Slack channel Messages view and close search or split channel panes.');
    return panes[0];
  }
  const channelRoot = () => scroller(channelPane());
  function markdown(node) {
    if (node.nodeType === 3) return node.textContent.replace(/([\\`*_~\[\]<>#])/g, '\\$1')
      .replace(/^(\s*)([-+])(?=\s)/gm, '$1\\$2')
      .replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2');
    // Slack hides visual line breaks from accessibility, not from the rendered message.
    if (node.nodeType === 1 && node.tagName === 'BR' && !node.hasAttribute('hidden')) return '\n';
    if (node.nodeType !== 1 || node.matches('[hidden], [aria-hidden="true"]')) return '';
    if (node.matches('.c-mrkdwn__br[data-stringify-type="paragraph-break"]')) return '\n\n';
    const tag = node.tagName.toLowerCase();
    if (tag === 'button' && node.matches('.c-message__rollup_member')) return A.escape(node.textContent);
    if (['button', 'script', 'style', 'svg'].includes(tag)) return '';
    const content = () => [...node.childNodes].map(markdown).join('');
    const fenceFor = (text, minimum) => {
      let length = minimum;
      for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
      return '`'.repeat(length);
    };
    if (tag === 'br') return '\n';
    if (tag === 'img') return A.escape(node.alt || '');
    if (tag === 'pre') { const text = node.textContent, fence = fenceFor(text, 3); return `\n${fence}\n${text}\n${fence}\n`; }
    if (tag === 'code') { const text = node.textContent, fence = fenceFor(text, 1); return `${fence} ${text} ${fence}`; }
    if (tag === 'a') { const url = A.link(node.href); return url ? `[${content()}](${url})` : content(); }
    if (['b', 'strong'].includes(tag)) return '**' + content() + '**';
    if (['i', 'em'].includes(tag)) return '*' + content() + '*';
    if (tag === 's') return '~~' + content() + '~~';
    if (tag === 'blockquote') return '\n' + content().trim().split('\n').map(l => '> ' + l).join('\n') + '\n';
    if (tag === 'li') return '\n' + (node.parentElement?.tagName === 'OL' ? ([...node.parentElement.children].indexOf(node) + Number(node.parentElement.start || 1)) + '. ' : '- ') + content().trim();
    if (['p', 'div', 'ul', 'ol'].includes(tag)) return '\n' + content() + '\n';
    return content();
  }
  function parse(e, channelURL) {
    const ts = id(e);
    if (!ts) return null;
    const author = e.querySelector('[data-qa="message_sender_name"]')?.textContent.trim()
      || e.querySelector('[data-qa="message_sender"]')?.getAttribute('data-stringify-text')?.trim()
      || e.querySelector('.c-message__sender, .c-message_kit__sender')?.textContent.trim()
      || e.querySelector(`[data-qa^="aria-labelledby-"][id$="-${ts}-sender"]`)?.textContent.trim().replace(/:$/, '').trim()
      || e.getAttribute('data-sender-name') || 'Unknown author';
    const bodies = outermost([...e.querySelectorAll(S.body)]);
    const slackNotice = !!e.querySelector('.c-missing_text--unknown') && bodies.some(body =>
      /^Due to a high volume of activity, we are not displaying some messages sent by this application\./.test(body.textContent.trim()));
    const files = [];
    const addFile = (url, name, downloadUrl) => {
      const fileId = fileIdentity(url);
      const existing = files.find(f => f.url === url || (fileId && fileIdentity(f.url) === fileId));
      const direct = /^https:\/\/files\.slack\.com\/files-pri\//.test(url) ? url : downloadUrl;
      if (existing) { if (direct) existing.downloadUrl = direct; return; }
      if (files.length >= A.LIMITS.maxAttachmentsPerMessage) throw new A.ExportError('LIMIT', 'Attachment count limit reached within a message.');
      files.push({key: ts + '|' + (fileId || url), name: String(name).trim().slice(0, 512), url, ...(direct ? {downloadUrl:direct} : {})});
    };
    for (const a of e.querySelectorAll('a[href]')) {
      const url = A.link(a.href);
      if (!url) continue;
      const u = new URL(url);
      const slackFile = /(^|\.)slack\.com$/i.test(u.hostname) && /\/files(?:-pri)?\//.test(u.pathname);
      if (!slackFile && u.hostname !== 'files.slack.com' && !a.closest('[data-qa="file_attachment"], .c-file')) continue;
      addFile(url, a.getAttribute('download') || a.querySelector('[data-qa="file_name"]')?.textContent || a.getAttribute('aria-label') || a.textContent.trim() || u.pathname.split('/').pop() || 'attachment', downloadLinks.get(a));
    }
    for (const body of bodies) for (const img of body.querySelectorAll('img')) {
      const url = A.link(img.currentSrc || img.src);
      if (!url || img.closest('.emoji') || /emoji/i.test((img.className || '') + ' ' + (img.getAttribute('data-qa') || ''))) continue;
      addFile(url, img.alt || new URL(url).pathname.split('/').pop() || 'image');
    }
    const reply = e.querySelector(S.reply);
    const countText = reply?.getAttribute('aria-label') || reply?.textContent || '';
    const count = countText.match(/(?:^|\s)(\d[\d,]*)\s+(?:repl|response)/i);
    const observedURL = timestampLink(e)?.href;
    const url = observedURL && A.ts(observedURL) === ts ? A.link(observedURL) : A.messageURL(channelURL, ts);
    return {ts, author, ...(slackNotice ? {slackNotice: 'hidden-application-messages'} : {}), authorContinues: !!e.querySelector('.p-message_pane_message__compact_timestamp--adjacent, .p-thread_compact_gutter_generic--adjacent'),
      text: bodies.map(markdown).join('\n').replace(/\n{3,}/g, '\n\n').trim(), url, files,
      reactions: [...new Set([...e.querySelectorAll('[data-qa="reaction"]')].map(x => x.getAttribute('aria-label') || x.textContent.trim()))].join('; '),
      hasThread: !!reply, expectedReplies: count ? Number(count[1].replace(/,/g, '')) : null, replies: []};
  }
  A.adapter = {selectors: S, rows, id, parse, markdown, channelRoot};
  A.collect = async (input, job, progress = () => {}) => {
    const options = A.validateOptions(input);
    const identity = A.channelIdentity(location.href);
    if (!identity) throw new A.ExportError('INVALID_INPUT', 'Open a channel in Slack web first.');
    const url = location.origin + identity, started = Date.now();
    const snapshot = {title: document.querySelector('[data-qa="channel_name"], [data-qa="channel_name_button"]')?.textContent.trim() || document.title,
      url, range: options.range, exportedAt: new Date(started).toISOString(), parents: [], warnings: [], boundary: null, stopped: false, threadIssues: [],
      coverage: {scrollSteps: 0, observedMessages: 0, threadsAttempted: 0, threadsVerified: 0, latestReached: false, startEvidence: null}};
    job.snapshot = snapshot;
    const parents = new Map(), payloads = new Map(), threadDone = new Set(), warnings = new Set();
    const inspectedDownloads = new WeakMap();
    let bytes = 0;
    const fatal = new Set(['CANCELLED', 'CHANNEL_CHANGED', 'LIMIT', 'AMBIGUOUS_VIEW']);
    const guard = () => {
      if (job.cancelled) throw new A.ExportError('CANCELLED', 'Cancelled. Captured messages are available as a partial export.');
      if (A.channelIdentity(location.href) !== identity) throw new A.ExportError('CHANNEL_CHANGED', 'Channel changed; capture stopped.');
      if (Date.now() - started > A.LIMITS.maxRunMs) throw new A.ExportError('LIMIT', 'Capture time limit reached.');
    };
    const pause = async (milliseconds = A.LIMITS.settleMs) => { guard(); await new Promise(r => setTimeout(r, milliseconds)); guard(); };
    const account = m => {
      const {replies, threadWarning, ...payload} = m;
      const encoded = new TextEncoder().encode(JSON.stringify(payload)).length;
      const nextBytes = bytes - (payloads.get(m.ts) || 0) + encoded;
      if ((!payloads.has(m.ts) && payloads.size >= A.LIMITS.maxMessages) || nextBytes > A.LIMITS.maxCaptureBytes)
        throw new A.ExportError('LIMIT', 'Message count or capture memory limit reached. Narrow the date range.');
      payloads.set(m.ts, encoded); bytes = nextBytes; snapshot.coverage.observedMessages = payloads.size;
    };
    const resolveAuthors = messages => {
      let previous = null;
      for (const message of [...messages].sort(A.compare)) {
        if (message.author === 'Unknown author' && message.authorContinues && previous) {
          message.author = previous; account(message);
        }
        previous = message.author === 'Unknown author' ? null : message.author;
      }
    };
    const busy = root => (root.matches(S.busy) && visible(root)) || [...root.querySelectorAll(S.busy)].some(visible);
    const fingerprint = root => rows(root).map(e => [id(e), e.textContent, ...[...e.querySelectorAll('[href],[src]')].map(n => n.getAttribute('href') || n.getAttribute('src'))].join('|')).join('\n');
    const settle = async (getRoot, fast = false) => {
      let previous = '', stable = 0;
      const interval = fast ? Math.min(70, A.LIMITS.settleMs) : A.LIMITS.settleMs;
      const polls = Math.ceil(A.LIMITS.maxSettlePolls * A.LIMITS.settleMs / interval);
      const quietChecks = fast ? Math.max(2, A.LIMITS.quietChecks) : A.LIMITS.quietChecks;
      for (let n = 0; n < polls; n++) {
        await pause(interval); const root = getRoot(); const current = fingerprint(root);
        stable = current === previous && !busy(root) ? stable + 1 : 0;
        if (stable >= quietChecks) return root;
        previous = current;
      }
      throw new A.ExportError('LOAD_TIMEOUT', 'Slack content did not settle before the loading timeout.');
    };
    const move = async (getRoot, direction, jump = false) => {
      guard();
      if (++snapshot.coverage.scrollSteps > A.LIMITS.maxCycles) throw new A.ExportError('LIMIT', 'Scroll-step limit reached.');
      const root = getRoot();
      const step = Math.max(1, root.clientHeight * 0.85);
      root.scrollTop = jump ? root.scrollHeight : Math.max(0, root.scrollTop + direction * step);
      const next = getRoot();
      const interior = next.scrollTop > 1 && next.scrollTop + next.clientHeight < next.scrollHeight - 2;
      return settle(getRoot, getRoot === channelRoot && interior);
    };
    const expand = async (getRoot, ts) => {
      if (options.media) {
        const row = rows(getRoot()).find(e => id(e) === ts);
        for (const link of row?.querySelectorAll('[data-qa="message_file_link"]') || []) {
          guard();
          if (inspectedDownloads.get(link) === link.href) continue;
          link.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
          await pause();
          const fileId = fileIdentity(link.href);
          const download = [...row.querySelectorAll('a[data-qa="download_action"][href]')]
            .find(a => fileId && fileIdentity(a.href) === fileId);
          if (download) {
            downloadLinks.set(link, download.href);
            inspectedDownloads.set(link, link.href);
          }
          link.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
        }
      }
      for (let n = 0; n < A.LIMITS.maxExpansions; n++) {
        guard(); const row = rows(getRoot()).find(e => id(e) === ts);
        if (!row) return null;
        const button = [...row.querySelectorAll(S.expand)].find(visible);
        if (!button) return row;
        button.click(); await settle(getRoot);
      }
      const row = rows(getRoot()).find(e => id(e) === ts);
      if (row?.querySelector(S.expand)) warnings.add(`Message ${ts}: a text expansion control remains; text may be truncated.`);
      return row;
    };
    const merge = (map, m) => {
      const old = map.get(m.ts);
      if (old && old.text && m.text && old.text !== m.text) warnings.add(`Message ${m.ts} changed while being read; the latest rendered version was retained.`);
      if (old) {
        // Do not replace a populated row with a transient empty skeleton.
        const next = {...old, ...m, text: m.text || old.text, author: m.author === 'Unknown author' ? old.author : m.author,
          files: [...new Map([...old.files, ...m.files.map(f => ({...old.files.find(previous => previous.key === f.key), ...f}))].map(f => [f.key, f])).values()], replies: old.replies};
        account(next); Object.assign(old, next); return old;
      }
      account(m); map.set(m.ts, m); return m;
    };
    const overlap = (before, after, label) => {
      if (before.length && after.length && !after.some(ts => before.includes(ts))) {
        warnings.add(`${label}: consecutive rendered windows did not overlap; messages may have been skipped.`);
        snapshot.stopped = true;
      }
    };
    const threadIssue = (parent, message) => {
      parent.threadWarning = message;
      snapshot.threadIssues.push({ts: parent.ts, url: parent.url, message});
      snapshot.stopped = true;
    };
    async function thread(parent) {
      guard(); snapshot.coverage.threadsAttempted++;
      let ownedPane;
      try {
        const element = rows(channelRoot()).find(e => id(e) === parent.ts);
        const button = element?.querySelector(S.reply);
        if (!element || !button) throw new A.ExportError('ROW_MISSING', 'Parent row or reply button disappeared during Slack rendering.');
        (button.querySelector('[data-qa="reply_bar_count"], button') || button).click();
        for (let n = 0; n < A.LIMITS.maxSettlePolls; n++) {
          await pause();
          const panes = outermost([...document.querySelectorAll(S.thread)].filter(visible));
          ownedPane = panes.find(e => rows(e).some(r => id(r) === parent.ts));
          if (ownedPane) break;
          // Slack can reopen a virtualised thread at its last reply. Its visible
          // broadcast control identifies the thread even while the parent is offscreen.
          const channelId = identity.split('/').pop();
          const identified = panes.filter(e => [...e.querySelectorAll('[data-qa="threads_footer_broadcast_checkbox"]')]
            .some(control => control.id === `p-thread_footer__broadcast_checkbox--${channelId}-${parent.ts}--Thread`));
          if (identified.length === 1) scroller(identified[0]).scrollTop = 0;
        }
        if (!ownedPane) throw new A.ExportError('THREAD_IDENTITY', 'The requested parent was not found in the opened thread.');
        const getRoot = () => {
          guard();
          if (!visible(ownedPane)) {
            const replacements = outermost([...document.querySelectorAll(S.thread)].filter(visible))
              .filter(pane => A.ts(pane.getAttribute('data-thread-ts')) === parent.ts || rows(pane).some(row => id(row) === parent.ts));
            if (replacements.length !== 1) throw new A.ExportError('THREAD_REPLACED', 'Thread pane was replaced without a unique matching parent.');
            ownedPane = replacements[0];
          }
          const marked = A.ts(ownedPane.getAttribute('data-thread-ts'));
          if (marked && marked !== parent.ts) throw new A.ExportError('THREAD_REPLACED', 'Thread identity changed while reading.');
          return scroller(ownedPane);
        };
        const replies = new Map();
        const harvest = async () => {
          getRoot();
          // Capture synchronously before any click can detach sibling rows.
          for (const e of rows(ownedPane)) { const m = parse(e, url); if (m && m.ts !== parent.ts) { merge(replies, m); parent.replies = [...replies.values()].sort(A.compare); } }
          for (const ts of rows(ownedPane).filter(e => e.querySelector(S.expand) || (options.media && e.querySelector('[data-qa="message_file_link"]'))).map(id)) {
            const e = await expand(() => ownedPane, ts); if (e && ts !== parent.ts) merge(replies, parse(e, url));
          }
          parent.replies = [...replies.values()].sort(A.compare);
        };
        await settle(getRoot);
        for (const direction of [-1, 1]) {
          let stable = 0;
          for (let n = 0; ; n++) {
            guard(); if (n >= A.LIMITS.maxThreadCycles) throw new A.ExportError('THREAD_LIMIT', 'Thread scroll limit reached.');
            await harvest(); const r = getRoot(), before = rows(r).map(id), signature = fingerprint(r);
            const next = await move(getRoot, direction); await harvest();
            overlap(before, rows(next).map(id), `Thread ${parent.ts}`);
            // A settled, fully expanded thread matching Slack's count needs no
            // repeated boundary probes. Keep the first move to verify pane identity.
            if (parent.expectedReplies !== null && replies.size === parent.expectedReplies
              && rows(ownedPane).some(e => id(e) === parent.ts) && !busy(ownedPane)
              && !rows(ownedPane).some(e => [...e.querySelectorAll(S.expand)].some(visible))) break;
            const edge = direction < 0 ? next.scrollTop <= 1 : next.scrollTop + next.clientHeight >= next.scrollHeight - 2;
            stable = edge && signature === fingerprint(next) && !busy(ownedPane) ? stable + 1 : 0;
            if (stable >= A.LIMITS.stableChecks) break;
          }
        }
        resolveAuthors([parent, ...replies.values()]);
        if (parent.expectedReplies !== null && replies.size !== parent.expectedReplies)
          threadIssue(parent, `Expected ${parent.expectedReplies} replies; captured ${replies.size} before date filtering.`);
        else if (parent.expectedReplies === null) {
          parent.threadWarning = 'Reply count was not exposed; thread completeness could not be verified.';
          warnings.add(`Thread ${parent.ts}: reply count unavailable.`);
        } else snapshot.coverage.threadsVerified++;
      } catch (error) {
        threadIssue(parent, error.message);
        if (fatal.has(error.code)) throw error;
      } finally {
        // Do not close an unrelated pane or mutate a channel the user navigated to.
        if (A.channelIdentity(location.href) === identity && visible(ownedPane)) ownedPane.querySelector(S.close)?.click();
      }
    }
    try {
      guard(); await settle(channelRoot);
      let stable = 0;
      // Establish the latest end before the overlapping upward collection pass.
      while (stable < A.LIMITS.stableChecks) {
        const signature = fingerprint(channelRoot()); const next = await move(channelRoot, 1, true);
        stable = next.scrollTop + next.clientHeight >= next.scrollHeight - 2 && signature === fingerprint(next) ? stable + 1 : 0;
      }
      snapshot.coverage.latestReached = true;
      stable = 0;
      while (true) {
        guard(); const r = channelRoot();
        if ([...r.querySelectorAll('.c-message_kit__message')].some(e => visible(e) && !id(e) && !id(e.closest('[data-message-id], [data-item-key]')))) {
          warnings.add('Some visible message rows had no supported timestamp identity and were skipped.'); snapshot.stopped = true;
        }
        const batch = rows(r).map(e => parse(e, url)).filter(Boolean);
        for (const m of batch) merge(parents, m);
        for (const ts of rows(r).filter(e => e.querySelector(S.expand) || (options.media && e.querySelector('[data-qa="message_file_link"]'))).map(id)) {
          const e = await expand(channelRoot, ts);
          if (e) merge(parents, parse(e, url));
          else { warnings.add(`Message ${ts}: row disappeared before expansion inspection.`); snapshot.stopped = true; }
        }
        progress(`Scrolling up · ${parents.size} channel messages`);
        const current = channelRoot(), before = rows(current).map(id), signature = fingerprint(current);
        const earliest = before.slice().sort()[0];
        if (!options.olderThreads && earliest && +earliest < options.range.start) { snapshot.boundary = 'Crossed selected start date'; snapshot.coverage.startEvidence = 'date-boundary'; break; }
        if (current.scrollTop <= 1 && !busy(channelPane())
          && [...channelPane().querySelectorAll('.p-message_pane__foreword')].some(visible)) {
          snapshot.boundary = 'Slack channel beginning reached';
          snapshot.coverage.startEvidence = 'channel-beginning';
          break;
        }
        const next = await move(channelRoot, -1);
        overlap(before, rows(next).map(id), 'Channel');
        stable = next.scrollTop <= 1 && signature === fingerprint(next) && !busy(channelPane()) ? stable + 1 : 0;
        if (stable >= A.LIMITS.stableChecks) {
          const beginning = [...channelPane().querySelectorAll('.p-message_pane__foreword')].some(visible);
          snapshot.coverage.startEvidence = beginning ? 'channel-beginning' : null;
          snapshot.boundary = beginning ? 'Slack channel beginning reached' : 'Top of accessible channel stabilised';
          if (!beginning) warnings.add('Slack stopped loading earlier messages without exposing its channel-beginning marker. The start of history is not verified.');
          break;
        }
      }
      // Finish the upward history pass before opening any thread. Revisit parents
      // in overlapping downward windows so no permalink navigation is necessary.
      snapshot.coverage.historyMs = Date.now() - started;
      resolveAuthors(parents.values());
      if (options.threads) {
        const pending = new Set([...parents.values()].filter(p => p.hasThread
          && (options.olderThreads || +p.ts >= options.range.start) && +p.ts < options.range.end).map(p => p.ts));
        let bottomStable = 0;
        while (pending.size) {
          guard();
          const root = channelRoot();
          for (const ts of rows(root).map(id)) {
            if (!pending.has(ts)) continue;
            progress(`Reading replies · ${threadDone.size} threads checked · ${pending.size} remaining`);
            await thread(parents.get(ts));
            pending.delete(ts); threadDone.add(ts); await settle(channelRoot);
          }
          if (!pending.size) break;
          const current = channelRoot(), before = rows(current).map(id), signature = fingerprint(current);
          const next = await move(channelRoot, 1);
          overlap(before, rows(next).map(id), 'Thread revisit');
          bottomStable = next.scrollTop + next.clientHeight >= next.scrollHeight - 2
            && signature === fingerprint(next) && !busy(channelPane()) ? bottomStable + 1 : 0;
          if (bottomStable >= A.LIMITS.stableChecks) {
            for (const ts of pending) threadIssue(parents.get(ts), 'Parent could not be revisited during the reply pass.');
            break;
          }
        }
      }
    } catch (error) { snapshot.stopped = true; warnings.add(error.message); }
    snapshot.parents = A.select([...parents.values()], options.range);
    for (const issue of snapshot.threadIssues) warnings.add(`Thread ${issue.ts}: ${issue.message} Parent: ${issue.url}`);
    // Historical Slack posting notices remain in the transcript, not capture failures.
    if (snapshot.parents.some(p => [p, ...p.replies].some(m => m.author === 'Unknown author' && m.slackNotice !== 'hidden-application-messages'))) warnings.add('Some messages did not expose an author; no author was guessed.');
    if (!snapshot.parents.length) warnings.add('No matching messages captured. This is not proof the channel has no messages in this period.');
    snapshot.warnings = [...warnings];
    snapshot.verification = {
      status: !snapshot.stopped && !warnings.size && snapshot.coverage.latestReached && snapshot.coverage.startEvidence
        && (!options.threads || snapshot.coverage.threadsAttempted === snapshot.coverage.threadsVerified) ? 'verified' : 'incomplete',
      scope: options.threads ? (options.olderThreads ? 'Available channel messages and threaded replies in the selected date range' : 'Channel messages in the selected date range and their in-range replies') : 'Available channel messages in the selected date range; replies excluded by selection',
      checks: [
        snapshot.coverage.latestReached ? 'Latest channel boundary reached and settled' : 'Latest channel boundary not reached',
        snapshot.coverage.startEvidence === 'channel-beginning' ? 'Slack channel-beginning marker reached' : snapshot.coverage.startEvidence === 'date-boundary' ? 'Selected start-date boundary crossed' : 'Start boundary not verified',
        `${snapshot.coverage.threadsVerified} of ${snapshot.coverage.threadsAttempted} opened threads matched Slack reply counts before date filtering`
      ]
    };
    return snapshot;
  };
})();
