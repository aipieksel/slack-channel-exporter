const {JSDOM} = require('jsdom');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../extension');
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
const row = (ts, text, thread = false) => `<div data-item-key="${ts}" style="min-height:100px"><div class="c-message_kit__message"><span data-qa="message_sender_name">Byron</span><a data-ts="${ts}" href="https://example.slack.com/archives/C123/p${ts.replace('.', '')}">Time</a><div data-qa="message-text"><p>${text}</p></div>${thread ? '<button data-qa="reply_bar">2 replies</button>' : ''}</div></div>`;
function env(html) {
  const dom = new JSDOM(`<div data-qa="channel_name">engineering</div><div class="p-message_pane"><div class="c-virtual_list__scroll_container"><div id="channel">${html}</div></div></div><div id="side"></div>`, {url: 'https://app.slack.com/client/T123/C123', runScripts: 'outside-only'});
  const w = dom.window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.setTimeout = fn => setTimeout(fn, 0);
  w.HTMLElement.prototype.getClientRects = function () { return [{width: 600, height: 300}]; };
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', {get() { return this._height || 300; }});
  Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', {get() { return this._virtualHeight || Math.max(300, this.querySelectorAll('[data-item-key]').length * 100); }});
  Object.defineProperty(w.HTMLElement.prototype, 'scrollTop', {get() { return this._top || 0; }, set(v) { this._top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)); this._render?.(); }});
  for (const name of ['core.js', 'adapter.js']) w.eval(fs.readFileSync(path.join(root, 'src', name), 'utf8'));
  const options = {range: {start: 0, end: 1900000000}, threads: true, olderThreads: true};
  return {dom, w, A: w.SlackExporter, options, close: () => dom.window.close()};
}
(async () => {
 await test('historical Slack posting notice is preserved without failing a complete capture', async () => {
   const notice = 'Due to a high volume of activity, we are not displaying some messages sent by this application.';
   const html = row('1780000000.000000', notice).replace('<span data-qa="message_sender_name">Byron</span>', '<span class="c-missing_text c-missing_text--unknown"></span>');
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + html);
   const result = await e.A.collect(e.options, {});
   assert.equal(result.parents[0].author, 'Unknown author');
   assert.equal(result.parents[0].slackNotice, 'hidden-application-messages');
   assert.match(result.parents[0].text, /Due to a high volume/);
   assert.equal(result.verification.status, 'verified');
   assert.equal(result.warnings.length, 0);
   const transcript = e.A.markdown(result, e.options);
   assert.match(transcript, /Capture: VERIFIED/);
   assert.doesNotMatch(transcript, /PARTIAL/);
   assert.match(transcript, /Due to a high volume/);
   assert.match(transcript, /Unknown author/);
   const stopped = await e.A.collect(e.options, {cancelled:true});
   assert.equal(stopped.verification.status, 'incomplete');
   assert.match(e.A.markdown(stopped, e.options), /Capture: PARTIAL/);
   e.close();
   const normal = env(html.replace(notice, 'Ordinary message without sender'));
   const ordinary = await normal.A.collect(normal.options, {});
   assert.match(ordinary.warnings.join(), /did not expose an author/);
   assert.equal(ordinary.parents[0].slackNotice, undefined);
   normal.close();
 });
 await test('an observed channel beginning ends the upward pass without redundant top probes', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'first'));
   const result = await e.A.collect(e.options, {});
   assert.equal(result.coverage.startEvidence, 'channel-beginning');
   assert.equal(result.coverage.scrollSteps, e.A.LIMITS.stableChecks);
   assert.equal(result.parents.length, 1);
   assert.equal(result.verification.status, 'verified');
   e.close();
 });
 await test('fast interior scrolling waits for delayed rendered windows and captures every message', async () => {
   const e = env('');
   const scroll = e.w.document.querySelector('.c-virtual_list__scroll_container');
   scroll._virtualHeight = 2000;
   const render = () => {
     const start = Math.floor(scroll.scrollTop / 100);
     scroll.innerHTML = (start === 0 ? '<div class="p-message_pane__foreword">Beginning</div>' : '')
       + Array.from({length: Math.min(4, 20 - start)}, (_, n) => row(`${1780000000 + start + n}.000000`, `message ${start + n}`)).join('');
   };
   render();
   let pending = 0, shortWaits = 0;
   scroll._render = () => { pending = 3; scroll.setAttribute('aria-busy', 'true'); };
   e.w.setTimeout = (fn, ms) => setTimeout(() => {
     if (ms < e.A.LIMITS.settleMs) shortWaits++;
     if (pending && --pending === 0) { render(); scroll.removeAttribute('aria-busy'); }
     fn();
   }, 0);
   const result = await e.A.collect(e.options, {});
   assert.ok(shortWaits > 0);
   assert.equal(result.parents.length, 20);
   assert.equal(result.verification.status, 'verified', result.warnings.join('\n'));
   e.close();
 });
 await test('nested Slack layout scrolls the overflow parent through all history', async () => {
   const e=env('');
   const inner=e.w.document.querySelector('.c-virtual_list__scroll_container');
   const outer=e.w.document.createElement('div'); outer.className='c-scrollbar__hider'; outer.style.overflowY='scroll';
   inner.before(outer); outer.append(inner); inner.style.overflowY='visible';
   outer._virtualHeight=1800; inner._height=1800;
   Object.defineProperty(inner,'scrollTop',{get:()=>0,set:()=>{throw Error('Non-scrolling layout wrapper selected');}});
   const positions=[]; let reachedTop=false, reachedBottom=false, opened=0;
   outer._render=()=>{
     positions.push(outer.scrollTop);
     if(outer.scrollTop===1500)reachedBottom=true;
     if(reachedBottom&&outer.scrollTop===0)reachedTop=true;
     const start=Math.floor(outer.scrollTop/100);
     inner.innerHTML=(start===0?'<div class="p-message_pane__foreword">Beginning</div>':'')+
       Array.from({length:Math.min(4,18-start)},(_,n)=>row(String(1780000000+start+n)+'.000000','message',[5,15].includes(start+n))).join('');
   };
   outer.addEventListener('click',event=>{
     if(!event.target.matches('[data-qa="reply_bar"]'))return;
     assert.equal(reachedTop,true,'No thread may open before the channel beginning');
     opened++;
     const ts=event.target.closest('[data-item-key]').getAttribute('data-item-key');
     const pane=e.w.document.createElement('div');pane.dataset.qa='thread_view';
     pane.innerHTML='<button data-qa="close_thread">Close</button><div class="c-scrollbar__hider" style="overflow-y:scroll">'+row(ts,'parent')+row(ts.replace('.000000','.000001'),'reply one')+row(ts.replace('.000000','.000002'),'reply two')+'</div>';
     e.w.document.querySelector('#side').append(pane);
     pane.querySelector('button').onclick=()=>pane.remove();
   });
   outer._render();
   assert.equal(e.A.adapter.channelRoot(),outer);
   const s=await e.A.collect(e.options,{});
   assert.equal(s.parents.length,18);
   assert.equal(opened,2);
   assert.equal(s.parents.reduce((n,p)=>n+p.replies.length,0),4);
   assert.equal(s.verification.status,'verified');
   assert.ok(positions.some((p,i)=>i>0&&p<positions[i-1]));
   assert.equal(reachedTop,true);
   e.close();
 });
 await test('attachment hover captures the matching download link without duplicate files', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'file'));
   const element=e.w.document.querySelector('[data-item-key]');
   element.insertAdjacentHTML('beforeend','<a data-qa="message_file_link" href="https://team.slack.com/files/U1/F123/report.xlsx"><span data-qa="file_name">Report</span></a>');
   const link=element.querySelector('[data-qa="message_file_link"]');
   link.onmouseover=()=>{if(!element.querySelector('[data-qa="download_action"]'))element.insertAdjacentHTML('beforeend','<a data-qa="download_action" href="https://files.slack.com/files-pri/T1-F123/download/report.xlsx">Download</a>');};
   link.onmouseout=()=>element.querySelector('[data-qa="download_action"]')?.remove();
   const s=await e.A.collect({...e.options,media:true},{});
   assert.equal(s.parents[0].files.length,1);
   assert.equal(s.parents[0].files[0].downloadUrl,'https://files.slack.com/files-pri/T1-F123/download/report.xlsx');
   e.close();
 });
 await test('Slack thread accessibility mask does not hide the rendered channel', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'visible'));
   const client = e.w.document.createElement('div'); client.className='p-client_container'; client.setAttribute('aria-hidden','true');
   e.w.document.body.append(client); client.append(e.w.document.querySelector('.p-message_pane'));
   const s = await e.A.collect(e.options, {});
   assert.equal(s.parents.length, 1); assert.equal(s.verification.status, 'verified');
   e.w.document.querySelector('[data-item-key]').setAttribute('aria-hidden','true');
   assert.equal(e.A.adapter.rows(e.A.adapter.channelRoot()).length, 0);
   e.close();
 });
 await test('a different replacement thread cannot pass verification', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'parent', true));
   e.w.document.querySelector('[data-qa="reply_bar"]').onclick = () => {
     e.w.document.querySelector('#side').innerHTML = '<div data-qa="thread_view"><div class="c-virtual_list__scroll_container">' + row('1780000000.000000','parent') + row('1780000001.000000','one') + '</div></div>';
     const pane = e.w.document.querySelector('[data-qa="thread_view"]');
     pane.querySelector('.c-virtual_list__scroll_container')._render = () => {
       pane.outerHTML = '<div data-qa="thread_view" data-thread-ts="1780000099.000000"><div class="c-virtual_list__scroll_container">' + row('1780000099.000000','unrelated') + '</div></div>';
     };
   };
   const s = await e.A.collect(e.options, {});
   assert.equal(s.verification.status, 'incomplete');
   assert.equal(s.coverage.threadsVerified, 0);
   assert.equal(s.parents[0].replies.some(r=>r.text==='unrelated'), false);
   assert.match(s.warnings.join(), /unique matching parent/);
   e.close();
 });
 await test('same-parent thread pane replacement retains verified replies', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'parent', true));
   let replaced = false;
   e.w.document.querySelector('[data-qa="reply_bar"]').onclick = () => {
     e.w.document.querySelector('#side').innerHTML = '<div data-qa="thread_view"><button data-qa="close_thread">Close</button><div class="c-virtual_list__scroll_container">' + row('1780000000.000000','parent') + row('1780000001.000000','one') + row('1780000002.000000','two') + '</div></div>';
     const pane = e.w.document.querySelector('[data-qa="thread_view"]');
     pane.querySelector('.c-virtual_list__scroll_container')._render = () => {
       if (replaced) return;
       replaced = true;
       const next = pane.cloneNode(true); pane.replaceWith(next);
       next.querySelector('button').onclick = () => next.remove();
     };
   };
   const s = await e.A.collect(e.options, {});
   assert.equal(replaced, true);
   assert.equal(s.parents[0].replies.length, 2);
   assert.equal(s.verification.status, 'verified');
   e.close();
 });
 await test('Slack accessibility-hidden line breaks retain paragraph flow', async () => {
   const e = env(row('1780000000.000000', 'Report<br aria-hidden="true">First line<br aria-hidden="true">Second line<span aria-hidden="true">duplicate accessibility text</span>'));
   const m = e.A.adapter.parse(e.A.adapter.rows(e.A.adapter.channelRoot())[0], e.w.location.href);
   assert.equal(m.text, 'Report\nFirst line\nSecond line');
   e.close();
 });
 await test('compact Slack sender labels and paragraph-break spans preserve content', async () => {
   const e = env(row('1780000000.000000', 'First paragraph<span class="c-mrkdwn__br" data-stringify-type="paragraph-break" aria-label=" "></span>Second paragraph<br aria-hidden="true">Final line'));
   const element = e.w.document.querySelector('[data-item-key]');
   element.querySelector('[data-qa="message_sender_name"]').remove();
   element.insertAdjacentHTML('afterbegin', '<span hidden id="primary-C123-1780000000.000000-sender" data-qa="aria-labelledby-primary-C123-1780000000.000000-sender">Byron Jacobs:</span>');
   const parsed = e.A.adapter.parse(element, e.w.location.href);
   assert.equal(parsed.author, 'Byron Jacobs');
   assert.equal(parsed.text, 'First paragraph\n\nSecond paragraph\nFinal line');
   element.querySelector('[hidden]').id = 'primary-C123-1780000099.000000-sender';
   assert.equal(e.A.adapter.parse(element, e.w.location.href).author, 'Unknown author');
   e.close();
 });
 await test('literal list and strikethrough punctuation stays literal in Markdown', async () => {
   const e = env(row('1780000000.000000', 'Literal ~text~<br>- Alpha<br>+ Beta<br>1. Gamma<br>2) Delta<ul><li>Real list</li></ul><s>Real strike</s>'));
   const parsed = e.A.adapter.parse(e.w.document.querySelector('[data-item-key]'), e.w.location.href);
   assert.match(parsed.text, /Literal \\~text\\~/);
   assert.ok(parsed.text.includes('\\- Alpha\n\\+ Beta\n1\\. Gamma\n2\\) Delta'));
   assert.match(parsed.text, /\n- Real list/);
   assert.match(parsed.text, /~~Real strike~~/);
   e.close();
 });
 await test('only explicit compact same-sender rows inherit a known preceding author', async () => {
   const e = env('<div class="p-message_pane__foreword">Beginning</div>' + Array.from({length: 5}, (_, i) => row(`178000000${i}.000000`, `message ${i}`)).join(''));
   const elements = [...e.w.document.querySelectorAll('[data-item-key]')];
   for (const i of [1, 2, 3]) elements[i].querySelector('[data-qa="message_sender_name"]').remove();
   for (const i of [1, 3]) elements[i].insertAdjacentHTML('beforeend', '<div class="p-message_pane_message__compact_timestamp--adjacent"></div>');
   elements[1].querySelector('.p-message_pane_message__compact_timestamp--adjacent').className = 'p-thread_compact_gutter_generic--adjacent';
   const result = await e.A.collect(e.options, {});
   assert.deepEqual(Array.from(result.parents, p => p.author), ['Byron', 'Byron', 'Unknown author', 'Unknown author', 'Byron']);
   assert.equal(result.verification.status, 'incomplete');
   e.close();
 });
 await test('complete threads avoid repeated boundary probes without accepting missing replies', async () => {
   for (const count of [1, 2]) {
     const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'parent', true));
     let moves = 0;
     e.w.document.querySelector('[data-qa="reply_bar"]').onclick = () => {
       const pane = e.w.document.createElement('div'); pane.dataset.qa = 'thread_view';
       pane.innerHTML = '<button data-qa="close_thread">Close</button><div class="c-virtual_list__scroll_container">'
         + row('1780000000.000000', 'parent')
         + Array.from({length: count}, (_, n) => row(`178000000${n + 1}.000000`, `reply ${n + 1}`)).join('') + '</div>';
       e.w.document.querySelector('#side').append(pane);
       pane.querySelector('.c-virtual_list__scroll_container')._render = () => { moves++; };
       pane.querySelector('button').onclick = () => pane.remove();
     };
     const result = await e.A.collect(e.options, {});
     assert.equal(result.parents[0].replies.length, count);
     if (count === 2) {
       assert.equal(moves, 2);
       assert.equal(result.verification.status, 'verified');
     } else {
       assert.ok(moves >= 6);
       assert.equal(result.verification.status, 'incomplete');
       assert.match(result.warnings.join(), /Expected 2 replies; captured 1/);
     }
     e.close();
   }
 });
 await test('a reopened virtual thread reveals its parent only after exact UI identity matches', async () => {
   for (const matches of [true, false]) {
     const e = env('<div class="p-message_pane__foreword">Beginning</div>' + row('1780000000.000000', 'parent', true));
     e.A.LIMITS = {...e.A.LIMITS, maxSettlePolls: 4};
     let moved = false;
     e.w.document.querySelector('[data-qa="reply_bar"]').onclick = () => {
       const pane = e.w.document.createElement('div'); pane.dataset.qa = 'threads_flexpane';
       pane.innerHTML = '<button data-qa="close_thread">Close</button><div class="c-scrollbar__hider" style="overflow-y:scroll">'
         + row('1780000002.000000', 'reply two') + '</div><input data-qa="threads_footer_broadcast_checkbox" id="p-thread_footer__broadcast_checkbox--C123-'
         + (matches ? '1780000000.000000' : '1780000099.000000') + '--Thread">';
       e.w.document.querySelector('#side').append(pane);
       const scroll = pane.querySelector('.c-scrollbar__hider'); scroll._virtualHeight = 600; scroll._top = 300;
       scroll._render = () => {
         moved = true;
         scroll.innerHTML = row('1780000000.000000', 'parent') + row('1780000001.000000', 'reply one') + row('1780000002.000000', 'reply two');
       };
       pane.querySelector('button').onclick = () => pane.remove();
     };
     const result = await e.A.collect(e.options, {});
     assert.equal(moved, matches);
     assert.equal(result.verification.status, matches ? 'verified' : 'incomplete');
     assert.equal(result.parents[0].replies.length, matches ? 2 : 0);
     e.close();
   }
 });
 await test('date-name headings omit message permalinks but preserve body and file links', async () => {
   const e = env(row('1780000000.000000', 'hello'));
   const message = e.A.adapter.parse(e.A.adapter.rows(e.A.adapter.channelRoot())[0], e.w.location.href);
   message.text = '[reference](https://example.com)';
   message.files = [{key:'file', name:'report', url:'https://example.com/report.pdf'}];
   const s = {title:'test', url:e.w.location.href, range:{}, exportedAt:'now', parents:[message], warnings:[]};
   assert.equal(e.A.validateOptions(e.options).messageLinks, true);
   assert.doesNotMatch(e.A.markdown(s, {}), /\[Open message\]/);
   assert.match(e.A.markdown(s, {}), /\[reference\]/);
   assert.match(e.A.markdown(s, {}), /report.pdf/);
   assert.match(e.A.markdown(s, {}), /## 2026-05-28 20:26:40 - Byron\n\n\[reference\]/);
   assert.doesNotMatch(e.A.markdown(s, {}), /example.slack.com\/archives/);
   assert.doesNotMatch(e.A.markdown(s, {messageLinks:false}), /## \[Byron\]/);
   assert.throws(()=>e.A.validateOptions({...e.options,messageLinks:'true'}));
   e.close();
 });
 await test('verification requires explicit beginning evidence, not a stationary scrollbar', async () => {
   const e = env(row('1780000000.000000', 'hello'));
   const missing = await e.A.collect(e.options, {});
   assert.equal(missing.verification.status, 'incomplete');
   e.w.document.querySelector('#channel').insertAdjacentHTML('afterbegin', '<div class="p-message_pane__foreword">Beginning</div>');
   const verified = await e.A.collect(e.options, {});
   assert.equal(verified.verification.status, 'verified');
   assert.equal(verified.coverage.latestReached, true);
   assert.equal(verified.coverage.startEvidence, 'channel-beginning');
   assert.equal(verified.warnings.length, 0);
   assert.match(e.A.markdown(verified, {}), /VERIFIED against available Slack history/);
   e.close();
 });
 await test('live Slack foreword, sender badges and automated message bodies', async () => {
   const e = env('<div data-item-key="0000000000.000001"><div class="p-message_pane__foreword">Channel introduction</div></div><div data-qa="virtual-list-item" data-item-key="input" id="thread-1780000001.000000-input">Composer</div><div data-qa="virtual-list-item" data-item-key="separator" id="thread-1780000001.000000-separator">1 reply</div>' + row('1780000000.000000', 'message'));
   const message = e.w.document.querySelector('.c-message_kit__message');
   message.querySelector('[data-qa="message_sender_name"]').outerHTML = '<span class="c-message__sender"><button data-qa="message_sender_name">Byron</button><span>AGENT</span><span hidden>Byron:</span></span>';
   message.querySelector('[data-qa="message-text"]').outerHTML = '<span class="c-message__body">joined tools. Also, <button class="c-message__rollup_member">Helper</button> joined via invite.</span>';
   const rows = e.A.adapter.rows(e.A.adapter.channelRoot());
   assert.equal(rows.length, 1);
   const parsed = e.A.adapter.parse(rows[0], e.w.location.href);
   assert.equal(parsed.author, 'Byron');
   assert.equal(parsed.text, 'joined tools. Also, Helper joined via invite.');
   e.close();
 });
 await test('live Slack reply wrapper activates its nested count button', async () => {
   const e = env(row('1780000000.000000', 'parent', true));
   e.w.document.querySelector('[data-qa="reply_bar"]').outerHTML = '<div data-qa="reply_bar"><button data-qa="reply_bar_count">1 reply</button></div>';
   e.w.document.querySelector('[data-qa="reply_bar_count"]').onclick = () => {
     e.w.document.querySelector('#side').innerHTML = '<div data-qa="threads_flexpane"><button data-qa="close_thread">Close</button><div class="c-virtual_list__scroll_container">' + row('1780000000.000000', 'parent') + row('1780000001.000000', 'reply') + '</div></div>';
     e.w.document.querySelector('[data-qa="close_thread"]').onclick = () => e.w.document.querySelector('#side').replaceChildren();
   };
   const result = await e.A.collect(e.options, {});
   assert.equal(result.parents[0].replies.length, 1);
   assert.equal(result.stopped, false);
   e.close();
 });
 await test('300 messages do not consume the scroll budget', async () => {
   const e = env(Array.from({length: 300}, (_, i) => row(`${1780000000 + i}.000000`, 'message')).join(''));
   const sc = e.w.document.querySelector('.c-virtual_list__scroll_container'); sc._height = 40000;
   e.A.LIMITS = {...e.A.LIMITS, maxCycles: 10};
   const s = await e.A.collect({...e.options, threads: false}, {}, () => {});
   assert.equal(s.stopped, false); assert.equal(s.parents.length, 300); assert.ok(s.coverage.scrollSteps <= 10); e.close();
 });
 await test('virtualised channel recovers all 50 messages with overlapping windows', async () => {
   const e = env(''); const sc = e.w.document.querySelector('.c-virtual_list__scroll_container'); sc._virtualHeight = 5000;
   sc._render = () => { const first = Math.floor(sc.scrollTop / 100); sc.innerHTML = Array.from({length: Math.min(5, 50 - first)}, (_, i) => row(`${1780000000 + first + i}.000000`, `virtual ${first+i}`)).join(''); }; sc._render();
   const s = await e.A.collect({...e.options, threads: false}, {}, () => {});
   assert.equal(s.stopped, false); assert.equal(s.parents.length, 50); e.close();
 });
 await test('channel DOM replacement between two threads does not lose the second thread', async () => {
   const e = env(''); let opened = 0;
   const setup = () => {
     e.w.document.querySelector('#channel').innerHTML = row('1780000000.000000', 'one', true) + row('1780000010.000000', 'two', true);
     for (const button of e.w.document.querySelectorAll('[data-qa="reply_bar"]')) button.onclick = () => {
       opened++; const ts = e.A.adapter.id(button.closest('[data-item-key]')); const seconds = Number(ts.split('.')[0]);
       e.w.document.querySelector('#side').innerHTML = '<div data-qa="thread_view"><button data-qa="close_thread">Close</button><div class="c-virtual_list__scroll_container">' + row(ts, 'parent') + row(`${seconds+1}.000000`, 'reply 1') + row(`${seconds+2}.000000`, 'reply 2') + '</div></div>';
       e.w.document.querySelector('[data-qa="close_thread"]').onclick = () => { e.w.document.querySelector('#side').replaceChildren(); setup(); };
     };
   }; setup();
   const s = await e.A.collect(e.options, {}, () => {});
   assert.equal(opened, 2); assert.equal(s.parents.reduce((n,p)=>n+p.replies.length,0), 4); assert.equal(s.stopped, false); e.close();
 });
 await test('channel change inside a thread is fatal and stops further interactions', async () => {
   const e = env(row('1780000000.000000','one',true)+row('1780000010.000000','two',true)); let clicks = 0;
   for(const button of e.w.document.querySelectorAll('[data-qa="reply_bar"]')) button.onclick = () => {clicks++; e.w.history.replaceState({},'', '/client/T123/C999');};
   const s = await e.A.collect(e.options, {}, () => {});
   assert.equal(clicks,1); assert.equal(s.stopped,true); assert.match(s.warnings.join(),/Channel changed/); e.close();
 });
 await test('failed old thread remains visible in global warnings after date filtering', async () => {
   const e = env(row('1780000000.000000','old',true)); e.A.LIMITS = {...e.A.LIMITS,maxSettlePolls:4};
   const s = await e.A.collect({...e.options,range:{start:1780001000,end:1780002000}}, {}, () => {});
   assert.equal(s.parents.length,0); assert.equal(s.threadIssues.length,1); assert.equal(s.stopped,true); assert.match(s.warnings.join(),/1780000000/); e.close();
 });
 await test('ambiguous channel panes fail without selecting a search or unrelated list', async () => {
   const e = env(row('1780000000.000000','one')); const clone=e.w.document.querySelector('.p-message_pane').cloneNode(true);e.w.document.body.append(clone);
   const s=await e.A.collect(e.options,{},()=>{});assert.equal(s.stopped,true);assert.equal(s.parents.length,0);assert.match(s.warnings.join(),/one Slack channel/);e.close();
 });
 await test('permalinks quoted in text cannot impersonate message timestamps', async () => {
   const e=env('<div class="c-message_kit__message"><a href="https://x.slack.com/archives/C1/p1780000000123456">quoted message</a></div>');
   assert.equal(e.A.adapter.rows(e.w.document).length,0);e.close();
 });
 await test('all text bodies are captured and hidden content excluded', async () => {
   const e=env(row('1780000000.000000','first'));const element=e.w.document.querySelector('[data-item-key]');element.insertAdjacentHTML('beforeend','<div data-qa="message-text">second<span hidden>SECRET</span></div>');
   const m=e.A.adapter.parse(element,'https://app.slack.com/client/T123/C123');assert.match(m.text,/first/);assert.match(m.text,/second/);assert.doesNotMatch(m.text,/SECRET/);e.close();
 });
 await test('busy loading state times out rather than claiming a stable boundary', async () => {
   const e=env(row('1780000000.000000','one')+'<div role="progressbar">loading</div>');e.A.LIMITS={...e.A.LIMITS,maxSettlePolls:4};
   const s=await e.A.collect(e.options,{},()=>{});assert.equal(s.stopped,true);assert.equal(s.boundary,null);assert.match(s.warnings.join(),/loading timeout/);e.close();
 });
 await test('metadata contributes to capture memory budget', async () => {
   const e=env(row('1780000000.000000','x'));e.w.document.querySelector('[data-item-key]').insertAdjacentHTML('beforeend',`<a href="https://files.slack.com/files-pri/${'x'.repeat(3000)}">file</a>`);e.A.LIMITS={...e.A.LIMITS,maxCaptureBytes:1000};
   const s=await e.A.collect(e.options,{},()=>{});assert.equal(s.stopped,true);assert.match(s.warnings.join(),/memory limit/);e.close();
 });
 await test('invalid IPC options rejected at collector boundary', async () => {
   const e=env(row('1780000000.000000','x'));await assert.rejects(e.A.collect({range:{start:NaN,end:1}},{},()=>{}),/Invalid date range/);e.close();
 });
 await test('thread replies use the same bounded expansion as channel messages', async () => {
   const e=env(row('1780000000.000000','parent',true));
   e.w.document.querySelector('[data-qa="reply_bar"]').onclick=()=>{
     e.w.document.querySelector('#side').innerHTML='<div data-qa="thread_view"><button data-qa="close_thread">Close</button><div class="c-virtual_list__scroll_container">'+row('1780000000.000000','parent')+row('1780000001.000000','short <button data-qa="message_expand">More</button>')+row('1780000002.000000','second')+'</div></div>';
     e.w.document.querySelector('[data-qa="message_expand"]').onclick=()=>{e.w.document.querySelector('[data-qa="message_expand"]').parentElement.innerHTML='expanded reply content';};
     e.w.document.querySelector('[data-qa="close_thread"]').onclick=()=>e.w.document.querySelector('#side').replaceChildren();
   };
   const result=await e.A.collect(e.options,{},()=>{});assert.match(result.parents[0].replies[0].text,/expanded reply content/);e.close();
 });
 await test('unexpected virtualisation gaps produce an explicit partial warning',async()=>{
   const e=env('');const sc=e.w.document.querySelector('.c-virtual_list__scroll_container');sc._virtualHeight=5000;
   sc._render=()=>{const first=Math.floor(sc.scrollTop/100);sc.innerHTML=row(`${1780000000+first}.000000`,'sparse viewport');};sc._render();
   const result=await e.A.collect({...e.options,threads:false},{},()=>{});assert.equal(result.stopped,true);assert.match(result.warnings.join(),/did not overlap/);e.close();
 });
 await test('visible rows with unsupported timestamps are flagged as partial',async()=>{
   const e=env(row('1780000000.000000','known')+'<div class="c-message_kit__message">Unknown identity</div>');
   const result=await e.A.collect({...e.options,threads:false},{},()=>{});assert.equal(result.stopped,true);assert.match(result.warnings.join(),/no supported timestamp/);e.close();
 });
 require('../../extension/src/core.js');require('../../extension/src/zip.js');const A=global.SlackExporter;
 await test('ZIP rejects empty, control-character and overlong paths',async()=>{
   for(const name of ['a//b','a/./b','a\u0000b','C:/x','a'.repeat(65536)])assert.throws(()=>A.createZipBytes([{path:name,data:'x'}]));
 });
 await test('all file sizes preflight before any file bytes are read',async()=>{
   let reads=0;const files=[{key:'a',name:'a',url:'https://files.slack.com/a'},{key:'b',name:'b',url:'https://files.slack.com/b'}];
   const s={parents:[{files,replies:[]}]};
   await assert.rejects(A.bundle(s,{},files.map((attachment,i)=>({attachment,file:{size:i?A.LIMITS.maxMediaBytes+1:1,name:'x',arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}}}))),/50 MiB/);assert.equal(reads,0);
 });
 console.log(`${passed} regression tests passed`);
})().catch(e=>{console.error(e);process.exit(1);});
