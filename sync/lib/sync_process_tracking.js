'use strict';
// Report only children created by this process. With no IPC channel (ordinary
// CLI tools), this is a no-op. Used as a Windows fallback to taskkill /T.
function track(child) {
  const send = message => {if(process.connected)process.send(message,()=>{});};
  if(child.pid)send({type:'sync-child-start',pid:child.pid});
  child.on('message',message=>{
    if(['sync-child-start','sync-child-end'].includes(message?.type))send(message);
  });
  child.once('close',()=>{if(child.pid)send({type:'sync-child-end',pid:child.pid});});
  return child;
}
module.exports={track};
