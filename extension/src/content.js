(() => {
if(globalThis.__sceInstalled)return;globalThis.__sceInstalled=true;
const colorScheme=matchMedia('(prefers-color-scheme: dark)');
function syncActionIcon(){chrome.runtime.sendMessage({type:'sce:icon-theme',theme:colorScheme.matches?'dark':'light'}).catch(()=>{});}
syncActionIcon();colorScheme.addEventListener('change',syncActionIcon);
let shell,frame,job,activeTabId;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id || !message || typeof message!=='object')return;
 if(message.type!=='sce:open' && message.tabId!==activeTabId){reply({error:'Tab identity mismatch.'});return;}
 if(message.type==='sce:open'){
  if(!Number.isSafeInteger(message.tabId)||message.tabId<=0){reply({error:'Invalid tab.'});return;} activeTabId=message.tabId;
  if(shell?.panel.isConnected){shell.setHidden(!shell.hidden);reply({ok:true});return;}
  document.getElementById('slack-channel-exporter')?.remove();
  document.getElementById('sce-page-lock')?.remove();
  shell=AipiekselPanel.create({id:'slack-channel-exporter',prefix:'sce',name:'Slack Channel Exporter',version:chrome.runtime.getManifest().version});
  frame=document.createElement('iframe');frame.src=chrome.runtime.getURL('panel.html')+'?tab='+message.tabId;frame.title='Slack Channel Exporter';frame.style='display:block;width:100%;height:480px;min-height:0;flex:1 1 auto;border:0;background:#0d0d0d';
  shell.body.style.flex='1 1 auto';shell.body.append(frame);shell.setHidden(false);reply({ok:true});
 }
 if(message.type==='sce:resize'){
  if(frame && Number.isFinite(message.height)){
   frame.style.height=Math.max(100,Math.min(message.height,innerHeight-58))+'px';
   // Keep four-corner resizing, but never stretch beyond the content's natural height.
   shell.panel.style.maxHeight=`min(${Math.max(100,message.height)+42}px, calc(100vh - 16px))`;
   shell.panel.style.height='auto';
   shell.clampToViewport();
  }
  reply({ok:true});
 }
 if(message.type==='sce:close'){if(shell)shell.setHidden(true);reply({ok:true});}
 if(message.type==='sce:lock'){if(shell)shell.setLocked(message.locked===true);reply({ok:true});}
 if(message.type==='sce:cancel'){if(job)job.cancelled=true;reply({ok:true});}
 if(message.type==='sce:collect'){
  if(job?.running){reply({error:'An export is already running.'});return;}
  const currentJob={running:true,cancelled:false};job=currentJob;
  SlackExporter.collect(message.options,currentJob,text=>chrome.runtime.sendMessage({type:'sce:progress',tabId:message.tabId,text}).catch(()=>{})).then(snapshot=>reply({snapshot})).catch(e=>reply({error:e.message})).finally(()=>{currentJob.running=false;});return true;
 }
});
})();
