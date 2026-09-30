'use strict';
const path = require('path');
const fs = require('fs');
const {cfg} = require('./db');
const {DATA_ROOT, ensureDir, stamp, run, sha256File, writeJson, updateState} = require('./common');
(async () => {
  const db = cfg();
  const executable = path.join(path.dirname(process.env.XAMPP_MYSQL_EXE || 'C:/xampp/mysql/bin/mysql.exe'), 'mysqldump.exe');
  if (!fs.existsSync(executable)) throw new Error('Local mysqldump client not found.');
  const file = path.join(ensureDir(path.join(DATA_ROOT,'backups')), `before_live_${stamp()}.sql`);
  await run(executable, ['--host='+db.host,'--port='+db.port,'--user='+db.user,'--single-transaction','--quick','--triggers','--routines','--events','--result-file='+file,db.database], {env:{MYSQL_PWD:db.password}});
  if (!fs.statSync(file).size) throw new Error('Local backup is empty.');
  const result = {database:db.database,file,bytes:fs.statSync(file).size,sha256:sha256File(file),createdAt:new Date().toISOString()};
  writeJson(file+'.json',result);
  updateState({latestLocalBackup:file,latestLocalBackupSha256:result.sha256});
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
