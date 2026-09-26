const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

async function main() {
  const {marked} = await import(require.resolve('marked'));
  const base = path.resolve(__dirname, '../../../tooling/evidence/slack-benchmark/20260910');
  const expected = JSON.parse(fs.readFileSync(path.join(base, 'expected.json')));
  const result = JSON.parse(fs.readFileSync(path.resolve(process.argv[2])));
  const snapshot = result.snapshot;
  assert.ok(snapshot, 'The live capture must have a snapshot');
  const parentReceipts = JSON.parse(fs.readFileSync(path.join(base, 'posted.json')));
  const replyReceipts = JSON.parse(fs.readFileSync(path.join(base, 'replies-posted.json')));
  const marker = text => text.match(/SCE-QA-20260910 ([PR]\d{3})\//)?.[1];
  const normalize = text => text.replace(/\r\n/g, '\n').trim();
  const words = text => normalize(text).replace(/\s+/g, ' ');
  function plain(markdown) {
    const dom = new JSDOM(marked.parse(markdown));
    const body = dom.window.document.body;
    function read(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.tagName === 'BR') return '\n';
      const text = [...node.childNodes].map(read).join('');
      return text + (node.tagName === 'P' ? '\n\n' : '');
    }
    const text = [...body.children].map(read).join('');
    dom.window.close();
    return normalize(text);
  }
  const parents = new Map(), replies = new Map();
  for (const parent of snapshot.parents) {
    const parentId = marker(parent.text);
    if (parentId) {
      assert.ok(!parents.has(parentId), `Duplicate parent ${parentId}`);
      parents.set(parentId, parent);
    }
    for (const reply of parent.replies) {
      const id = marker(reply.text);
      if (!id) continue;
      assert.ok(!replies.has(id), `Duplicate reply ${id}`);
      replies.set(id, {message: reply, parentId});
    }
  }
  for (const item of expected.parents) {
    const actual = parents.get(item.id);
    assert.ok(actual, `Missing ${item.id}`);
    const receipt = parentReceipts.find(r => r.id === item.id);
    if (receipt.ts) assert.equal(actual.ts, receipt.ts, `Timestamp ${item.id}`);
    // innerText collapses Slack's empty paragraph-break spans. Check layout
    // against the seeded input and lexical content independently against readback.
    assert.equal(plain(actual.text), normalize(item.text), `Body ${item.id}`);
    assert.equal(words(plain(actual.text)), words(receipt.text || item.text), `Readback ${item.id}`);
    assert.equal(actual.author, 'Byron Jacobs', `Author ${item.id}`);
    assert.ok(actual.url.includes('/archives/' + expected.channel + '/p'), `Link ${item.id}`);
  }
  for (const item of expected.replies) {
    const actual = replies.get(item.id);
    assert.ok(actual, `Missing ${item.id}`);
    assert.equal(actual.parentId, item.parentId, `Thread ${item.id}`);
    const receipt = replyReceipts.find(r => r.id === item.id);
    assert.equal(actual.message.ts, receipt.ts, `Timestamp ${item.id}`);
    assert.equal(plain(actual.message.text), normalize(item.text), `Body ${item.id}`);
    assert.equal(words(plain(actual.message.text)), words(receipt.text || item.text), `Readback ${item.id}`);
    assert.equal(actual.message.author, 'Byron Jacobs', `Author ${item.id}`);
  }
  for (const messages of [snapshot.parents, ...snapshot.parents.map(p => p.replies)]) {
    for (let i = 1; i < messages.length; i++) assert.ok(messages[i - 1].ts < messages[i].ts, 'Chronological order');
  }
  assert.equal(parents.size, 200);
  assert.equal(replies.size, 100);
  console.log(JSON.stringify({seededContent: 'passed', parents: parents.size, replies: replies.size,
    historyMs: snapshot.coverage.historyMs, ms: result.ms, verification: snapshot.verification.status}));
  assert.equal(snapshot.verification.status, 'verified', snapshot.warnings.join('\n'));
  assert.equal(snapshot.coverage.startEvidence, 'channel-beginning');
  assert.equal(snapshot.coverage.threadsVerified, 10);
  console.log(JSON.stringify({parents: parents.size, replies: replies.size, verifiedThreads: 10, ms: result.ms}));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
