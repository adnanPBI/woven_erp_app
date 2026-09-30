'use strict';
const fs=require('fs');
const path=require('path');
const {cfg,connect}=require('./db');
const {DATA_ROOT,ensureDir,stamp,writeJson}=require('./common');
(async()=>{
 const db=cfg(),c=await connect();
 try{await c.query('SELECT 1');}finally{await c.end();}
 const file='C:/xampp/phpMyAdmin/config.inc.php',original=fs.readFileSync(file,'utf8');
 const php=s=>"'"+String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
 let next=original;
 for(const [key,value]of Object.entries({user:db.user,password:db.password,host:db.host})){
  const re=new RegExp("(\\$cfg\\['Servers'\\]\\[\\$i\\]\\['"+key+"'\\]\\s*=\\s*)[^;]*;");
  if(!re.test(next))throw Error('Expected configuration key absent: '+key);
  next=next.replace(re,(_,prefix)=>prefix+php(value)+';');
 }
 const portLine="$cfg['Servers'][$i]['port'] = "+php(db.port)+';';
 if(/\$cfg\['Servers'\]\[\$i\]\['port'\]/.test(next))throw Error('Existing explicit port requires review');
 next=next.replace("$cfg['Servers'][$i]['connect_type'] = 'tcp';","$cfg['Servers'][$i]['connect_type'] = 'tcp';\n"+portLine);
 const backup=path.join(ensureDir(path.join(DATA_ROOT,'backups')),'phpmyadmin_config_before_repair_'+stamp()+'.php');
 fs.writeFileSync(backup,original,{flag:'wx'});
 fs.writeFileSync(file,next);
 writeJson(path.join(DATA_ROOT,'audit','phpmyadmin_repair.json'),{at:new Date().toISOString(),file,backup,reason:'Configured pma_user login rejected; use verified local connection settings',productionTouched:false});
 console.log('Local phpMyAdmin configuration repaired; backup and audit saved.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
