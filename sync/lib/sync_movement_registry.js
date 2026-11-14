'use strict';
// Only these three additive metadata tables may be written by observation.
const assert=require('assert/strict'),m=require('./sync_movement_identity');
const ddl=[
`CREATE TABLE IF NOT EXISTS sync_movement_identity (
 movement_uid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 profile VARCHAR(32) NOT NULL, spreadsheet_id VARCHAR(128) NOT NULL, sheet_id BIGINT UNSIGNED NOT NULL,
 legacy_source_uid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 primary_table VARCHAR(64) NOT NULL, primary_id BIGINT UNSIGNED NOT NULL,
 source_group CHAR(64) NOT NULL, source_digest CHAR(64) NOT NULL,
 state ENUM('provisional','verified','held','retired') NOT NULL DEFAULT 'provisional',
 bindings_json LONGTEXT NOT NULL, payload_json LONGTEXT NOT NULL, payload_hash CHAR(64) NOT NULL,
 first_manifest CHAR(64) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY movement_legacy (profile,legacy_source_uid),
 UNIQUE KEY movement_physical (profile,primary_table,primary_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS sync_movement_revision (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, movement_uid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision_hash CHAR(64) NOT NULL, kind ENUM('baseline','observed-change','source-verified','applied','retired') NOT NULL,
 before_json LONGTEXT NULL, after_json LONGTEXT NOT NULL, source_manifest CHAR(64) NOT NULL,
 actor VARCHAR(128) NOT NULL, actor_verified BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY movement_revision (movement_uid,revision_hash,kind),
 CONSTRAINT movement_revision_identity FOREIGN KEY (movement_uid) REFERENCES sync_movement_identity(movement_uid) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS sync_movement_lineage (
 lineage_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 kind ENUM('split','merge','reallocate') NOT NULL, state ENUM('planned','verified','applied') NOT NULL DEFAULT 'planned',
 inputs_json LONGTEXT NOT NULL, outputs_json LONGTEXT NOT NULL, approval_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`];
async function install(db,{expectedDatabase}){const [[who]]=await db.query('SELECT DATABASE() db');assert.equal(who.db,expectedDatabase);assert(/^weavonpq_(?:weaving_main|muidqa1111)$/.test(who.db));for(const sql of ddl)await db.query(sql);const [cols]=await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sync_movement_identity','sync_movement_revision','sync_movement_lineage')");for(const [t,c]of [['sync_movement_identity','legacy_source_uid'],['sync_movement_revision','actor_verified'],['sync_movement_lineage','approval_hash']])assert(cols.some(x=>x.TABLE_NAME===t&&x.COLUMN_NAME===c),'Unexpected preexisting movement schema');}
async function observe(db,analysis){assert.equal(analysis.mode,'observe');assert(/^[a-f0-9]{64}$/.test(analysis.manifestSha256));const counts={inserted:0,observedChanges:0,unchanged:0,heldMovements:new Set(analysis.findings.map(x=>x.profile+':'+(x.legacyUid||x.sourceDigest))).size};
 await db.beginTransaction();try{for(const r of analysis.candidates){assert.equal(r.state,'provisional');assert.equal(r.movementUid,m.provisionalUid(r.sourceScope,r.legacyUid));m.validateBindings(r.sourceScope.profile,r.bindings);assert.equal(m.hash(r.payload),r.payloadHash);const [old]=await db.query('SELECT * FROM sync_movement_identity WHERE movement_uid=? OR (profile=? AND legacy_source_uid=?) FOR UPDATE',[r.movementUid,r.sourceScope.profile,r.legacyUid]);assert(old.length<=1,'Registry identity collision');
  if(old.length){const p=old[0];assert.equal(p.movement_uid,r.movementUid);assert.equal(p.profile,r.sourceScope.profile);assert.equal(p.spreadsheet_id,r.sourceScope.spreadsheetId);assert.equal(Number(p.sheet_id),r.sourceScope.sheetId);assert.deepEqual(JSON.parse(p.bindings_json),r.bindings,'Original SQL binding drift');assert.equal(p.state,'provisional','Observation cannot alter active bindings');if(p.source_digest===r.sourceDigest&&p.payload_hash===r.payloadHash){counts.unchanged++;continue}
   await db.query('INSERT INTO sync_movement_revision (movement_uid,revision_hash,kind,before_json,after_json,source_manifest,actor,actor_verified) VALUES (?,?,?,?,?,?,?,FALSE)',[r.movementUid,m.hash({before:p.payload_hash,after:r.payloadHash,digest:r.sourceDigest,manifest:analysis.manifestSha256}),'observed-change',p.payload_json,JSON.stringify(r.payload),analysis.manifestSha256,'verified-legacy-sync-observer']);
   await db.query('UPDATE sync_movement_identity SET source_digest=?,source_group=?,payload_json=?,payload_hash=? WHERE movement_uid=?',[r.sourceDigest,r.sourceGroup,JSON.stringify(r.payload),r.payloadHash,r.movementUid]);counts.observedChanges++;
  }else{const parent=r.bindings.find(x=>x.table.endsWith('_form'));assert(parent);await db.query('INSERT INTO sync_movement_identity (movement_uid,profile,spreadsheet_id,sheet_id,legacy_source_uid,primary_table,primary_id,source_group,source_digest,state,bindings_json,payload_json,payload_hash,first_manifest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[r.movementUid,r.sourceScope.profile,r.sourceScope.spreadsheetId,r.sourceScope.sheetId,r.legacyUid,parent.table,parent.id,r.sourceGroup,r.sourceDigest,'provisional',JSON.stringify(r.bindings),JSON.stringify(r.payload),r.payloadHash,analysis.manifestSha256]);await db.query('INSERT INTO sync_movement_revision (movement_uid,revision_hash,kind,before_json,after_json,source_manifest,actor,actor_verified) VALUES (?,?,?,?,?,?,?,FALSE)',[r.movementUid,r.payloadHash,'baseline',null,JSON.stringify(r.payload),analysis.manifestSha256,'legacy-snapshot-qualification']);counts.inserted++}
 }await db.commit();return counts}catch(e){await db.rollback();throw e}}
module.exports={ddl,install,observe};
