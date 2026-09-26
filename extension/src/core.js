(() => {
'use strict';
const A = globalThis.SlackExporter = globalThis.SlackExporter || {};
A.LIMITS = Object.freeze({maxMessages:20000,maxCycles:3000,maxRunMs:30*60*1000,settleMs:350,stableChecks:3,quietChecks:1,maxSettlePolls:60,maxExpansions:3,maxAttachmentsPerMessage:100,maxCaptureBytes:20*1024*1024,maxThreadCycles:300,maxMediaEntries:500,maxMediaBytes:50*1024*1024,maxArchiveInputBytes:250*1024*1024,maxTranscriptBytes:25*1024*1024});
A.ERROR_CODES={UNSAFE_PATH:'UNSAFE_PATH',ZIP_INVALID:'ZIP_INVALID',ARCHIVE_LIMIT_EXCEEDED:'ARCHIVE_LIMIT_EXCEEDED'};
A.ExportError=class extends Error {constructor(code,message){super(message);this.code=code;}};
A.ts = value => {
 const s=String(value || '');
 const permalink=s.match(/\/p(\d{10})(\d{6})(?:[?/#]|$)/);
 if(permalink) return permalink[1]+'.'+permalink[2];
 const m=s.match(/(?:^|[^\d])(\d{10})\.(\d{1,6})(?:[^\d]|$)/);
 return m ? m[1]+'.'+m[2].padEnd(6,'0') : null;
};
A.compare=(a,b)=>a.ts.localeCompare(b.ts);
A.channelIdentity = value => {
 try { const u = new URL(value); if(u.protocol !== 'https:' || !/^(?:app|[a-z0-9-]+)\.slack\.com$/i.test(u.hostname)) return null;
 return u.pathname.match(/^\/client\/[A-Z0-9]+\/[CG][A-Z0-9]+(?=\/|$)/i)?.[0] || null; } catch { return null; }
};
// When no observed message permalink exists, link to the known channel, never invent a thread route.
A.messageURL = channelURL => A.link(channelURL);
A.validateOptions = input => {
 if(!input || typeof input !== 'object' || !input.range) throw new A.ExportError('INVALID_INPUT','Export options and date range are required.');
 const {start,end}=input.range;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start) throw new A.ExportError('INVALID_INPUT','Invalid date range.');
 for(const key of ['threads','olderThreads','timestamps','messageLinks','media']) if(input[key]!==undefined && typeof input[key]!=='boolean') throw new A.ExportError('INVALID_INPUT','Invalid export option: '+key);
 return Object.freeze({range:Object.freeze({...input.range}),threads:input.threads!==false,olderThreads:input.threads!==false&&input.olderThreads!==false,timestamps:input.timestamps!==false,messageLinks:input.messageLinks!==false,media:!!input.media});
};
A.safeName=s=>String(s).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,140)||'file';
A.numberedName=(name,index)=>{
 const safe=A.safeName(name), dot=safe.lastIndexOf('.');
 const suffix='-'+String(index).padStart(4,'0');
 return dot>0 ? safe.slice(0,dot)+suffix+safe.slice(dot) : safe+suffix;
};
A.exportName=s=>{
 const title=String(s.title||'Slack').replace(/^#\s*/, '').replace(/\s*\(Channel\).*$/i,'').trim();
 const channel=A.safeName(title.charAt(0).toUpperCase()+title.slice(1))+' Channel';
 const times=s.parents.flatMap(p=>[p,...(p.replies||[])]).map(m=>Number(m.ts)*1000).filter(Number.isFinite);
 if(!times.length)return channel+' - No messages';
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:s.range?.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
 const date=t=>{const parts=Object.fromEntries(formatter.formatToParts(new Date(t)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
 return channel+' '+date(Math.min(...times))+' to '+date(Math.max(...times));
};
A.channelTitle=s=>{
 const title=String(s.title||'Slack').replace(/^#\s*/, '').replace(/\s*\(Channel\).*$/i,'').trim();
 return A.safeName(title.charAt(0).toUpperCase()+title.slice(1));
};
A.displayTimestamp=(ts,timezone)=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Number(ts)*1000)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};
A.link=s=>{try {const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href.replace(/[()]/g,c=>encodeURIComponent(c)):'';}catch{return '';}};
A.escape=s=>String(s).replace(/([\\`*_{}\[\]<>#|])/g,'\\$1').replace(/\r?\n/g,' ');
A.range=(from,to,now=Date.now())=>{
 const date=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Choose a valid date.'); const [y,m,d]=s.split('-').map(Number);const v=new Date(y,m-1,d);if(v.getFullYear()!==y||v.getMonth()!==m-1||v.getDate()!==d)throw Error('Choose a valid date.');return v;};
 const start=from?date(from).getTime():0;let end=now;
 if(to){const v=date(to);v.setDate(v.getDate()+1);end=Math.min(v.getTime(),now);}
 if(start>=end)throw Error('Start date must be before the end date and before now.');
 return {start:start/1000,end:end/1000,from:from||'Earliest accessible',to:to||'Export start',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
};
A.select=(parents,range)=>{
 const selected=parents.map(p=>({...p,replies:(p.replies||[]).filter(m=>+m.ts>=range.start&&+m.ts<range.end).sort(A.compare)}))
   .filter(p=>(+p.ts>=range.start&&+p.ts<range.end)||p.replies.length)
   .map(p=>({...p,context:+p.ts<range.start||+p.ts>=range.end}));
 // A reply broadcast into the channel has the same timestamp as the nested reply.
 const replies=new Set(selected.flatMap(p=>p.replies.map(r=>r.ts)));
 return selected.filter(p=>!replies.has(p.ts)||p.replies.length).sort(A.compare);
};
A.markdown=(s,options,paths={})=>{
 const out=[`# ${A.escape(s.title)}`,`\nSource: ${A.link(s.url)}`,`Exported: ${s.exportedAt}`,`Date range: ${s.range.from} – ${s.range.to} (${s.range.timezone})`,`Capture: ${s.verification?.status === 'verified' && !s.stopped ? 'VERIFIED against available Slack history' : 'PARTIAL — verification incomplete'}`,`Channel boundary: ${s.boundary||'not reached'}`,`Scope: ${s.verification?.scope || 'Available channel history'}`,`\n## Verification\n`,...(s.verification?.checks || []).map(c=>`- ${A.escape(c)}`),...s.warnings.map(w=>`- ${A.escape(w)}`)];
 const render=(m,level,context=false)=>{
 const author=A.escape(m.author||'Unknown author');
 out.push(`\n${'#'.repeat(level)} ${options.timestamps!==false?A.displayTimestamp(m.ts,s.range.timezone)+' - ':''}${author}${context?' (parent outside date range; context only)':''}\n`);
 out.push(m.text||'*No rendered text; see attachments.*');
 for(const f of m.files||[]){const path=paths[f.key];out.push(`\n- File: [${A.escape(f.name)}](${path?path.split('/').map(encodeURIComponent).join('/'):A.link(f.url)})${path?'':' — linked only; not bundled'}`);}
 if(m.reactions)out.push(`\nReactions: ${A.escape(m.reactions)}`);
 };
 for(const p of s.parents){render(p,2,p.context);if(p.threadWarning)out.push(`\n> Thread: ${A.escape(p.threadWarning)}`);for(const r of p.replies)render(r,3);}
 const md=out.join('\n')+'\n';if(new TextEncoder().encode(md).length>A.LIMITS.maxTranscriptBytes)throw Error('Transcript exceeds 25 MiB. Choose a smaller range.');return md;
};
A.bundle=async(s,options,mappings)=>{
 const attachments=new Map(s.parents.flatMap(p=>[p,...p.replies]).flatMap(m=>m.files||[]).map(f=>[f.key,f]));
 const entries=[],paths=Object.create(null),selected=[],seen=new Set();
 let bytes=0;
 // Preflight every selection before the first file read.
 for(const {attachment,file} of mappings){
  if(!file)continue;
  if(!attachments.has(attachment.key)||seen.has(attachment.key))throw Error('Unknown or duplicate attachment mapping.');
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>A.LIMITS.maxMediaBytes||typeof file.arrayBuffer!=='function')throw Error('A selected file exceeds 50 MiB or is invalid.');
  seen.add(attachment.key);bytes+=file.size;
  if(seen.size>A.LIMITS.maxMediaEntries||bytes>A.LIMITS.maxArchiveInputBytes)throw Error('Selected files exceed the archive limits.');
  const path='media/'+A.numberedName(file.name,selected.length+1);
  paths[attachment.key]=path;selected.push({attachment:attachments.get(attachment.key),file,path});
 }
 const md=A.markdown(s,options,paths);
 if(bytes+new TextEncoder().encode(md).length>A.LIMITS.maxArchiveInputBytes)throw Error('Transcript and files exceed the archive budget.');
 entries.push({path:A.channelTitle(s)+'.md',data:md});
 for(const {file,path} of selected){const data=new Uint8Array(await file.arrayBuffer());if(data.length!==file.size)throw Error('A selected file changed while being read.');entries.push({path,data});}
 return A.createZipBlob(entries);
};
})();
