const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../../extension');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const sharedShell=path.join(root,'../../tooling/shared/panel-shell.js');
if(fs.existsSync(sharedShell)&&!fs.readFileSync(sharedShell).equals(fs.readFileSync(path.join(root,'src/panel-shell.js'))))throw Error('Shared panel shell is out of sync');
if(manifest.name!=='Slack Channel Exporter'||!/^\d+\.\d+\.\d+$/.test(manifest.version)||manifest.author!=='aipieksel')throw Error('Wrong identity/version');
if(JSON.stringify(manifest.permissions)!==JSON.stringify(['activeTab','scripting','downloads']))throw Error('Unexpected permissions');
if(JSON.stringify(manifest.optional_host_permissions)!==JSON.stringify(['https://files.slack.com/*']))throw Error('Unexpected attachment access');
const seen=new Set();
function visit(file){
 file=path.posix.normalize(file);if(file.startsWith('../')||path.isAbsolute(file))throw Error('Unsafe runtime dependency');
 if(seen.has(file))return;seen.add(file);
 const bytes=fs.readFileSync(path.join(root,file));
 if(file.endsWith('.js')){
  cp.execFileSync(process.execPath,['--check',path.join(root,file)]);
  const source=bytes.toString();
  for(const match of source.matchAll(/importScripts\(['"]([^'"]+)['"]\)/g))visit(path.posix.join(path.posix.dirname(file),match[1]));
  for(const match of source.matchAll(/getURL\(['"]([^'"]+)['"]\)/g))visit(match[1]);
  for(const match of source.matchAll(/files:\s*\[([^\]]+)\]/g))for(const entry of match[1].matchAll(/['"]([^'"]+\.js)['"]/g))visit(entry[1]);
 }else if(file.endsWith('.html')){
  for(const match of bytes.toString().matchAll(/(?:src|href)="([^"#]+)"/g))visit(path.posix.join(path.posix.dirname(file),match[1]));
 }
}
visit('manifest.json');visit(manifest.background.service_worker);
for(const file of Object.values(manifest.icons))visit(file);
for(const group of manifest.web_accessible_resources)for(const file of group.resources)visit(file);
if(!seen.has('src/adapter.js')||!seen.has('src/content.js'))throw Error('Missing injection dependency');
for(const name of ['run.cjs'])cp.execFileSync(process.execPath,[path.join(root,'../tooling/tests',name)],{stdio:'inherit'});
console.log('PASS manifest permissions, actual dependency closure and all runtime syntax ('+seen.size+' files)');
if(process.argv.includes('--integration'))for(const name of ['dom.cjs','regressions.cjs','panel.cjs','attachments.cjs'])cp.execFileSync(process.execPath,[path.join(root,'../tooling/tests',name)],{stdio:'inherit'});
