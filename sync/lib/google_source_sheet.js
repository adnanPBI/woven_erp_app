'use strict';
function resolveSourceSheet(profile,metadata,{snapshot=false}={}){
 const sheets=metadata.sheets||[],hasId=profile.sheetId!==undefined&&profile.sheetId!==null;
 // Public CSV export uses gid, so the live API must select the identical tab.
 // Titles can change or belong to a different tab. A missing pinned ID must
 // fail, even when another tab happens to have the old configured title.
 if(hasId&&!snapshot){
  const id=Number(profile.sheetId);if(!Number.isSafeInteger(id)||id<0)throw Error(profile.id+': invalid pinned sheetId');
  const sheet=sheets.find(s=>s.properties?.sheetId===id);if(!sheet)throw Error(profile.id+': pinned source tab is missing');return sheet;
 }
 // Frozen CSV fixtures already bind their file/hash in snapshot.json. Preserve
 // that adapter and legacy API configurations that never supplied an ID.
 const sheet=sheets.find(s=>s.properties?.title===profile.sheetName);
 if(!sheet)throw Error(profile.id+': configured source tab is missing');return sheet;
}
module.exports={resolveSourceSheet};
