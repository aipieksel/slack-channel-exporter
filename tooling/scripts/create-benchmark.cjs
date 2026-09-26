const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = path.resolve(__dirname, '../../../tooling/evidence/slack-benchmark/20260910');
fs.mkdirSync(out, {recursive: true});
const run = 'SCE-QA-20260910';
const variants = [
  'Short synthetic message. Expected value: 42. No action required.',
  'Paragraph one tests line breaks.\n\nParagraph two must remain separate.\nFinal line.',
  'Formatting fixture: *bold*, _italic_, ~struck~, and `inline_code`. All content is synthetic.',
  'Reference link: https://example.com/export-test?q=alpha&n=42 . This is a dummy reference.',
  'List fixture:\n- Alpha item\n- Beta item\n- Gamma item',
  'Code fixture:\n```json\n{"synthetic":true,"count":42,"label":"export benchmark"}\n```',
  'Duplicate-looking body: repeated content must retain its unique message identity.',
  'Special characters: < > & " quotes, brackets [a], parentheses (b), slash / and backslash \\.',
  'Long message fixture. ' + 'This synthetic paragraph measures multiline export fidelity without real business information. '.repeat(35),
  'End-of-group checkpoint. All messages and replies must retain their original ordering.'
];
const parents = Array.from({length: 200}, (_, i) => ({
  id: `P${String(i + 1).padStart(3, '0')}`,
  text: `[${run} P${String(i + 1).padStart(3, '0')}/200] Exporter test data. ${variants[i % variants.length]}`
}));
parents[0].text = `[${run} P001/200] Exporter test data. Synthetic content only. This numbered message is part of an approved completeness and speed benchmark. No action required.`;
const replies = Array.from({length: 100}, (_, i) => ({
  id: `R${String(i + 1).padStart(3, '0')}`,
  parentId: `P${String(Math.floor(i / 10) * 20 + 1).padStart(3, '0')}`,
  text: `[${run} R${String(i + 1).padStart(3, '0')}/100] Synthetic threaded reply ${i % 10 + 1}/10. ${variants[i % variants.length]}`
}));
const files = Array.from({length: 12}, (_, i) => {
  const ext = ['txt', 'csv', 'md', 'html'][i % 4];
  const name = `dummy-${String(i + 1).padStart(2, '0')}.${ext}`;
  const body = ext === 'csv' ? `id,label,value\n${i + 1},${run},42\n` : ext === 'html'
    ? `<!doctype html><html><head><title>Dummy ${i + 1}</title></head><body><h1>${run}</h1><p>Synthetic attachment ${i + 1}. No scripts or external assets.</p></body></html>\n`
    : `${run}\nSynthetic attachment ${i + 1}/12\n${'Known test payload.\n'.repeat(100 + i)}END-${i + 1}\n`;
  const filePath = path.join(out, name);
  fs.writeFileSync(filePath, body);
  return {name, path: filePath, bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex')};
});
const manifest = {run, workspace: 'T065W24DY2V', channel: 'C065W24HSEM', parents, replies, files};
fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({out, parents: parents.length, replies: replies.length, files: files.length}));
