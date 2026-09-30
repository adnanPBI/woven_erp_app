#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const {ROOT,readJson}=require('./common');const {parseDate}=require('../../lib/source_index');
const required=[
 'import.js','mappings/mapping-contract-v2.json','schema/weavonpq_weaving.schema.json','sql/v3_2_3/01_v323_support_schema.sql',
 'scripts/local/fetch_google_sheets.js','scripts/local/prepare_sources.js','scripts/local/run_migration.js','scripts/local/dashboard_server.js','config/local_google_sheets.json'
];
const errors=[];for(const r of required)if(!fs.existsSync(path.join(ROOT,r)))errors.push(`missing:${r}`);
const cfg=readJson(path.join(ROOT,'config/local_google_sheets.json'));if(!cfg||cfg.profiles?.length!==9)errors.push('google_config_profile_count');
const env=fs.readFileSync(path.join(ROOT,'.env'),'utf8');if(!/^DB_NAME=.*_local\s*$/m.test(env))errors.push('local_db_guard_missing');
const dateCases=[['Outside-8-Sep-2026','2026-09-08'],['Reject-22-Mar-2024','2024-03-22'],['Outside-2-3-Feb-2025','2025-02-03']];for(const [v,e] of dateCases){const a=parseDate(v,'dmy');if(a!==e)errors.push(`date:${v}:${a}:${e}`);}
const secretBackups=fs.readdirSync(ROOT).filter(n=>/^\.env\.pre-/.test(n));if(secretBackups.length)errors.push('secret_env_backups_present');
if(errors.length){console.error(JSON.stringify({ok:false,errors},null,2));process.exit(1);}console.log(JSON.stringify({ok:true,profiles:9,localDbGuard:true,prefixedDateParsing:true,secretEnvBackups:false},null,2));
