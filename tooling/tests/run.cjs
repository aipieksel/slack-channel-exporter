const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
require('../../extension/src/core.js');require('../../extension/src/zip.js');const A=SlackExporter;
let tests=0;function test(name,fn){fn();tests++;console.log('PASS '+name);}
test('Timestamp precision and permalink parsing',()=>{assert.equal(A.ts('https://a.slack.com/archives/C1/p1780000000123456'),'1780000000.123456');assert.equal(A.ts('1780000000.12'),'1780000000.120000');assert.equal(A.ts('today'),null);});
test('Date validation and inclusive end day',()=>{const r=A.range('2026-07-01','2026-07-31',Date.UTC(2026,8,1));assert.equal(r.end-r.start,31*86400);assert.throws(()=>A.range('2026-02-31',''));assert.throws(()=>A.range('2026-08-01','2026-07-01'));});
const m=(ts,text='hello')=>({ts,author:'Byron',text,files:[],replies:[]});
test('Attachment numbers are suffixes before the extension',()=>{
 assert.equal(A.numberedName('report.xlsx',1),'report-0001.xlsx');
 assert.equal(A.numberedName('report.xlsx',2),'report-0002.xlsx');
 assert.equal(A.numberedName('archive.tar.gz',12),'archive.tar-0012.gz');
 assert.equal(A.numberedName('README',3),'README-0003');
 assert.equal(A.numberedName('../unsafe.txt',4),'_unsafe-0004.txt');
});
test('Export name uses captured dates including replies in the capture timezone',()=>{
 const s={title:'#tools',range:{timezone:'Africa/Johannesburg'},exportedAt:'2026-09-08',parents:[{...m(String(Date.UTC(2026,8,6,23)/1000)),replies:[m(String(Date.UTC(2026,8,7,23)/1000))]},m(String(Date.UTC(2026,8,5)/1000))]};
 assert.equal(A.exportName(s),'Tools Channel 2026-09-05 to 2026-09-08');
 assert.equal(A.exportName({...s,parents:[]}),'Tools Channel - No messages');
 assert.equal(A.exportName({...s,verification:{status:'verified'}}),A.exportName(s));
});
test('Older parent retained as context for recent replies; boundaries and order',()=>{const p={...m('1780000000.000001'),replies:[m('1780000040.000001'),m('1780000030.000002'),m('1780000030.000001')]};const result=A.select([p,m('1780000050.000000')],{start:1780000030,end:1780000040});assert.equal(result.length,1);assert.equal(result[0].context,true);assert.deepEqual(result[0].replies.map(x=>x.ts),['1780000030.000001','1780000030.000002']);});
test('Markdown escaping and truthfulness',()=>{const s={title:'<script>',url:'https://app.slack.com/client/T1/C1',range:{from:'a',to:'b',timezone:'UTC'},exportedAt:'now',warnings:['partial'],parents:[m('1780000000.000001')],stopped:true};const md=A.markdown(s,{timestamps:true});assert.match(md,/PARTIAL/);assert.match(md,/\\<script\\>/);assert.match(md,/Byron/);assert.equal(A.link('javascript:alert(1)'),'');});
test('ZIP CRC and traversal/collision guards',()=>{assert.equal(A.zipCrc32(new TextEncoder().encode('123456789')),0xcbf43926);assert.throws(()=>A.createZipBytes([{path:'../x',data:'x'}]));assert.throws(()=>A.createZipBytes([{path:'a',data:'x'},{path:'A',data:'y'}]));fs.writeFileSync('/tmp/slack-test.zip',A.createZipBytes([{path:'channel.md',data:'héllo'},{path:'media/0001-file.txt',data:'abc'}]));});
test('Broadcast replies appear once beneath their parent',()=>{const r=m('1780000001.000000');const p={...m('1780000000.000000'),replies:[r]};const result=A.select([p,r],{start:0,end:1900000000});assert.equal(result.length,1);assert.equal(result[0].replies.length,1);});
test('Channel identity requires an exact Slack route',()=>{assert.equal(A.channelIdentity('https://app.slack.com/client/T123/C123/thread/abc'),'/client/T123/C123');assert.equal(A.channelIdentity('https://app.slack.com/client/T123/C123evil?x'),'/client/T123/C123evil');assert.equal(A.channelIdentity('https://evil.example/client/T123/C123'),null);assert.equal(A.channelIdentity('https://app.slack.com/client/T123/D123'),null);});
(async()=>{const s={title:'files',url:'https://app.slack.com/client/T/C',exportedAt:'now',range:{},warnings:[],parents:[{...m('1780000000.000001'),files:[{key:'a',name:'same.txt',url:'https://files.slack.com/a'},{key:'b',name:'same.txt',url:'https://files.slack.com/b'}]}]};const blob=await A.bundle(s,{},[{attachment:{key:'a',name:'same.txt'},file:new File(['a'],'same.txt')},{attachment:{key:'b',name:'same.txt'},file:new File(['b'],'same.txt')}]);fs.writeFileSync('/tmp/slack-bundle-test.zip',new Uint8Array(await blob.arrayBuffer()));console.log('PASS explicit matching with duplicate filenames');console.log(`${++tests} core tests passed`);})().catch(e=>{console.error(e);process.exit(1);});
