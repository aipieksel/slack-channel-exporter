"use strict";
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
(async()=>{
  const {marked}=await import(require.resolve('marked'));
  const expected=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../tooling/evidence/slack-benchmark/20260910/expected.json')));
  const markdown=fs.readFileSync(process.argv[2],'utf8');
  const dom=new JSDOM(marked.parse(markdown));
  const records=new Map();let heading='',body=[],parentId=null;
  const normalize=s=>s.replace(/\s+/g,' ').trim();
  function flush(){
    const text=normalize(body.join(' '));
    const id=text.match(/SCE-QA-20260910 ([PR]\d{3})\//)?.[1];
    if(!id)return;
    assert.ok(!records.has(id),`Duplicate ${id}`);
    if(id.startsWith('P'))parentId=id;
    records.set(id,{heading,text,parentId});
  }
  for(const node of dom.window.document.body.children){
    if(/^H[23]$/.test(node.tagName)){flush();heading=node.textContent;body=[];}
    else body.push(node.textContent);
  }
  flush();
  assert.equal(records.size,300);
  assert.doesNotMatch(markdown,/\]\(https:\/\/[^\s)]+\/archives\/C065W24HSEM\/p\d/);
  for(const item of [...expected.parents,...expected.replies]){
    const actual=records.get(item.id);
    assert.ok(actual,`Missing ${item.id}`);
    assert.match(actual.heading,/^2026-09-10 \d{2}:\d{2}:\d{2} - Byron Jacobs$/);
    const original=normalize(item.text);
    assert.equal(actual.text.slice(0,original.length),original,`Full body ${item.id}`);
    const extra=actual.text.slice(original.length).trim();
    assert.ok(!extra||/^(?:File:|Reactions:)/.test(extra),`Unexpected body suffix ${item.id}: ${extra.slice(0,80)}`);
    if(item.parentId)assert.equal(actual.parentId,item.parentId,`Thread ${item.id}`);
  }
  dom.window.close();
  console.log('PASS actual Markdown: all 300 complete original bodies, authors, date-first headings and parent/reply relationships; no added message links');
})().catch(error=>{console.error(error);process.exitCode=1;});
