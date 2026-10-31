'use strict';
const {once}=require('events'),{csvCell}=require('../scripts/local/common');
const MAX_API_CELLS=250000;
function boundedChunkRows(configured,columns,{snapshot=false}={}){
 if(!Number.isSafeInteger(configured)||configured<100||configured>50000||!Number.isSafeInteger(columns)||columns<1)throw Error('Invalid Google fetch row/column budget');
 return snapshot?configured:Math.min(configured,Math.max(1,Math.floor(MAX_API_CELLS/columns)));
}
function sourceChildArgs(file,argv,env){
 // Snapshot parsing intentionally retains its existing budget. Only the live
 // paged API fetcher gets this independent cap; the DB worker keeps its limit.
 return file==='scripts/local/fetch_google_sheets.js'&&!env.GOOGLE_SNAPSHOT_DIR?
  ['--expose-gc','--max-old-space-size=128',file,...argv]:[file,...argv];
}
async function writeCsvRow(out,row){
 if(!out.write(row.map(csvCell).join(',')+'\n'))await once(out,'drain');
}
module.exports={boundedChunkRows,sourceChildArgs,writeCsvRow,MAX_API_CELLS};
