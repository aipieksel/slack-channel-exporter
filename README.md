# Slack Channel Exporter
By aipieksel.

Version: 1.0.0 (unpublished).

## Overview

Slack Channel Exporter is a local-first Chrome extension that exports the currently open Slack web channel as readable Markdown. It can optionally create a ZIP with attachments downloaded from Slack. Thread replies appear beneath their parent in timestamp order.

## Install

1. Extract this package.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Enable **Developer mode**, click **Load unpacked**, and select `slack-channel-exporter/extension`, containing `manifest.json`.
4. Pin **Slack Channel Exporter** to the browser toolbar.
5. Open a channel in Slack web (`https://app.slack.com/client/WORKSPACE/CHANNEL`), select its Messages view, and click the extension.

No build, Slack app registration, API token or server is required. This package is an unpacked extension, not a Chrome Web Store listing.

## Export

1. Leave both dates blank for all available history, or set the desired date range.
2. Replies and timestamps are always included. Message headings use `YYYY-MM-DD HH:mm:ss - Person`, with the original body below. Message permalinks are not added; original links within message bodies are preserved.
3. Enable **Include attachments** for a ZIP with the files downloaded automatically from Slack.
4. Click **Export channel**. It first scrolls upward through channel history to the beginning or selected start date, then revisits captured parents to read replies. The page is covered during capture/download, with the panel on top. Keep Slack open; do not switch channels or reload the page.
5. Review the captured message counts and verification. Saving attachments may prompt for narrowly scoped access to `files.slack.com`. There is no local file picker or manual matching. A failed attachment download stops ZIP creation and reports the failure; it does not silently omit the file.
6. The result downloads automatically; **Downloaded:** appears only when the browser confirms completion. Failures offer **Retry download**. Any capture limitations remain visible and inside the downloaded export; downloading does not imply completeness. A verified result requires the latest boundary, an explicit channel-beginning marker or selected-date boundary, overlapping scroll windows without reported gaps, and matching counts for every opened thread. Failed checks are listed specifically and the output is labelled partial. No generic acknowledgement checkbox is required.

The panel uses the same shared shell as ChatGPT Chat Exporter: drag its header to move it or resize from any of its four corners. Closing it hides it; clicking the toolbar restores it. **Stop capture** retains the collected partial result. Reloading Slack discards the in-memory capture.

### Capture behavior

Historical Slack high-activity posting notices remain in the transcript but no longer fail export verification. A capture that passes the history, overlap and reply checks is verified, not partial. Unknown senders on ordinary messages, missing replies, interrupted captures and other capture failures still prevent verification.

#### Downloads

Export channel automatically downloads the result, without a second save step or an extension-requested Save dialog. Completion is reported only after the browser confirms the download. Interrupted downloads offer a retry. The attachments row is compact with regular-weight text, and the panel cannot stretch beyond its content height. Slack's high-activity notice is reported specifically without hiding the limitation or guessing its author.

Exports the Slack web channel you have open to Markdown, or a ZIP containing Markdown and attachments downloaded from Slack. Thread replies appear beneath their parent in timestamp order.

#### History

Faster overlapping history traversal, fewer redundant waits, and early completion for fully captured threads. Reopened virtual threads are identified before scrolling their parent into view. Compact same-sender messages, Slack paragraph-break spans, and literal Markdown punctuation retain their original meaning. The history pass still finishes before any replies are opened.

#### Capture checks

Corrected scroll budgets, stale thread controls, channel-change handling, hidden thread failures, duplicate broadcast replies, extraction of multiple text blocks, file preflight checks and save-state races. A gap between rendered windows now produces an explicit partial warning.

**Updating the unpacked installation:** select the new `extension/` runtime folder, click **Reload** in the extensions page, and refresh the Slack tab. In-memory captures from the old version are discarded by refresh.

### Date and thread rules

Dates use the browser's local timezone. Start is inclusive at midnight; end includes the full selected day, capped at the instant collection started. Blank start means all accessible history; blank end means export start.

Parents sort oldest first; replies sort oldest first under each parent using Slack timestamps, preserving microsecond order. When a start date is set, only parents in the selected range and their in-range replies are exported; unrelated older threads are not scanned. Timestamps use the selected export timezone.

## Media and attachments

With **Include attachments** enabled, files download directly from Slack and are bundled with the transcript. Access is scoped to `files.slack.com` and may require a permission prompt. There is no local file picker or manual matching. Unsupported hosts, redirects, login HTML and failed downloads stop ZIP creation rather than silently omitting files.

## Output

- ZIP: `Tools Channel YYYY-MM-DD to YYYY-MM-DD.zip`, using the earliest and latest captured message dates in the selected timezone.
- Transcript: `Tools.md` (channel-derived), standalone or inside the ZIP, plus collision-safe `media/filename-0001.ext` entries. There is no extra `manifest.md`.
- ZIP entries use the current local modification date/time. Original source text, including numbers in test messages, is retained.
- Links to unbundled Slack files are retained; a link does not mean the file is included.
- No JSON conversation snapshot is published.

## Troubleshooting

- If the toolbar shows **OPEN**, open a supported Slack web channel's Messages view and retry.
- If the toolbar shows **ERR**, refresh Slack and open the exporter again.
- If a capture is incomplete, review its boundary, overlap and thread warnings; downloading does not make it complete.
- If a download fails, use **Retry download** to reuse the retained capture.
- If attachment permission is denied, grant the narrowly scoped access on the next export attempt, or export without attachments.
- After updating the unpacked extension, reload it and refresh Slack. This discards the old in-memory capture.

## Limits

Verification covers available Slack history in the selected scope, not deleted messages or content outside your access. The exporter checks rendered boundaries, scroll-window overlap and Slack's exposed reply counts. A stabilised scroll boundary without a channel-beginning marker is not enough to verify the start of history.

The Slack selectors are isolated in `extension/src/adapter.js`. Slack UI changes, localisation, specialised content, canvases, clips, collapsed app blocks and unusually rendered attachments can require adapter changes. Unknown authors remain explicitly unknown. The initial implementation expands known message-expansion controls, preserves rendered text/code/links/lists/reactions and detects rendered file links and inline images; it does not claim full fidelity for every Slack block type.

Limits: 20,000 messages including replies, 30 minutes, 3,000 actual scroll steps, 300 cycles per thread direction, 20 MiB collected message/metadata payload, 25 MiB rendered transcript, 500 attachments, 50 MiB per file and 250 MiB total archive input. Attachment requests use the browser's existing session without extracting tokens or cookies, with a 60-second per-file timeout. Unsupported download hosts, redirects, login HTML and failed downloads stop ZIP creation. Interrupted or limited collection is explicitly partial. Scrolling may mark messages read in Slack. Existing scroll and thread positions are not restored.

## Privacy

All transcript processing is local. There is no telemetry, analytics, remote backend, account API, or token/cookie extraction. Captures remain in memory until the Slack page is reloaded. Attachment requests use the browser's existing session. Scrolling may mark messages read in Slack; original scroll and thread positions are not restored.

## Project layout

`extension/` contains the complete browser runtime, manifest and icons. `tooling/` contains regression tests and packaging scripts. `dist/` holds the single unpublished 1.0.0 package. Workspace `../tooling/` groups shared panel code, synchronization scripts and benchmark evidence. Chrome requires the manifest at the release ZIP root, not wrapped in `extension/`.

Both main UI controllers are `panel.js` and use the same shared shell. Slack embeds `panel.html`; ChatGPT generates its main panel and has a distinct `media.*` view. ChatGPT separates formatting, validation and startup into modules; Slack groups corresponding responsibilities in its core, adapter and content modules. File inventories need not be identical to share a panel.

## Development

Runtime: plain JavaScript, Manifest V3, no dependencies or remote code.

```sh
node tooling/scripts/verify.cjs
# Browser fixtures require Playwright and Chromium, for development only:
npm install --no-save playwright
npx playwright install chromium
node tooling/tests/browser.cjs
# Optional simulated DOM checks:
npm install --no-save jsdom
node tooling/scripts/verify.cjs --integration
python3 tooling/scripts/package.py
```

Automated fixture tests are included. The 2026-09-10 live benchmark uses 200 synthetic parent messages, 100 replies in ten threads, and twelve uploaded files. The benchmark scripts check message identities, full text, authors, chronology, thread relationships, and attachment byte counts and SHA-256 hashes. Installed-panel workflow acceptance is tracked separately from collector and file-byte verification; a collector test alone does not establish the complete user workflow. There is no manual attachment-selection step.

## Attribution

Derived from the user-supplied ChatGPT Chat Exporter by aipieksel. Its dependency-free ZIP writer is retained and namespaced for Slack. Original ownership is preserved; both exporter repositories are licensed under MIT. Independent extension, not affiliated with Slack or Salesforce.

## License

Copyright (c) 2026 aipieksel. Licensed under the [MIT License](LICENSE).
