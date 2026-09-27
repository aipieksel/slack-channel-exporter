# Slack Channel Exporter
By aipieksel.

Version: 1.0.0.

## Overview

Slack Channel Exporter helps you save a readable record of the channel open in Slack web. It writes messages and threaded replies to Markdown, with optional date filtering and a ZIP of attachments it can download through your existing Slack session. The result is a local file you can review and keep with your own records.

Choose a channel and date range, then start the export from the floating panel. The extension collects available history before opening threads, checks the capture boundaries and reply counts, and marks an export partial when it cannot prove coverage. Attachments are included only when their downloads succeed. It does not recover deleted or inaccessible messages or export an entire Slack account.

## Install

1. Extract this package.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Enable **Developer mode**, click **Load unpacked**, and select `slack-channel-exporter/extension`, containing `manifest.json`.
4. Pin **Slack Channel Exporter** to the browser toolbar.
5. Open a channel in Slack web (`https://app.slack.com/client/WORKSPACE/CHANNEL`), select its Messages view, and click the extension.

Loading this source folder requires no build, Slack app registration, API token, or server.

## Export

1. Leave both dates blank for all available history, or set the desired date range.
2. Replies and timestamps are always included. Message headings use `YYYY-MM-DD HH:mm:ss - Person`, with the original body below. Message permalinks are not added; original links within message bodies are preserved.
3. Enable **Include attachments** for a ZIP with the files downloaded automatically from Slack.
4. Click **Export channel**. It first scrolls upward through channel history to the beginning or selected start date, then revisits captured parents to read replies. The page is covered during capture/download, with the panel on top. Keep Slack open; do not switch channels or reload the page.
5. Review the captured message counts and verification. Saving attachments may prompt for narrowly scoped access to `files.slack.com`. There is no local file picker or manual matching. A failed attachment download stops ZIP creation and reports the failure; it does not silently omit the file.
6. The result downloads automatically; **Downloaded:** appears only when the browser confirms completion. Failures offer **Retry download**. Any capture limitations remain visible and inside the downloaded export; downloading does not imply completeness. A verified result requires the latest boundary, an explicit channel-beginning marker or selected-date boundary, overlapping scroll windows without reported gaps, and matching counts for every opened thread. Failed checks are listed specifically and the output is labelled partial. No generic acknowledgement checkbox is required.

The panel uses the same shared shell as ChatGPT Chat Exporter: drag its header to move it or resize from any of its four corners. Closing it hides it; clicking the toolbar restores it. **Stop capture** retains the collected partial result. Reloading Slack discards the in-memory capture.

### What the capture checks

The exporter covers channel history with overlapping scroll windows before it opens threads. It checks the selected beginning and end, gaps between rendered windows, and the reply count of each opened thread. A Slack high-activity notice stays in the transcript but does not by itself make the capture partial. Unknown senders, missing replies, interrupted collection, and other coverage failures do.

The result downloads automatically after capture. **Downloaded:** appears only after the browser confirms the file; an interrupted download offers **Retry download**. Compact same-sender messages, paragraph breaks, code, links, lists, and reactions retain their rendered meaning where supported.

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

`extension/` contains the browser runtime and manifest; `tooling/` contains tests and packaging scripts; `dist/` holds generated packages. The channel adapter and export logic live under `extension/src/`. Chrome expects `manifest.json` at the root of an extension package. The [documentation index](documentation/0-index.md) routes deeper implementation questions.

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
