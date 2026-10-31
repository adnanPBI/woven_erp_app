'use strict';
const fs=require('fs'),path=require('path');
function resolveHostedResume(dataDir,value){
 if(value===undefined)return null;
 if(typeof value!=='string'||!value)throw Error('Specify an existing certified hosted cycle');
 const base=path.resolve(dataDir,'cycles'),cycle=path.resolve(value),state=path.join(cycle,'local_state.json');
 if(!cycle.startsWith(base+path.sep))throw Error('Only an existing certified hosted cycle can resume');
 try{
  const dir=fs.lstatSync(cycle),file=fs.lstatSync(state),realBase=fs.realpathSync(base),realCycle=fs.realpathSync(cycle);
  if(!dir.isDirectory()||dir.isSymbolicLink()||!file.isFile()||file.isSymbolicLink()||!realCycle.startsWith(realBase+path.sep))throw Error('linked or invalid cycle');
 }catch(error){throw Error('Only an existing certified hosted cycle can resume: '+error.message);}
 return cycle;
}
module.exports={resolveHostedResume};
