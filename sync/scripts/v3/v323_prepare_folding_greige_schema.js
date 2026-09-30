'use strict';

const path = require('path');
try { require('dotenv').config({ path: '/home/weavonpq/import_mapper_cli/.env', override: false }); } catch (_e) {}
const mysql = require('/home/weavonpq/import_mapper_cli/node_modules/mysql2/promise');

const repair = process.argv.includes('--repair');
const DB = 'weavonpq_weaving';

if (String(process.env.ALLOW_PRODUCTION_DB || 'false') === 'true' || String(process.env.BACKUP_CONFIRMED || 'false') === 'true') {
  console.error('STOP: close live-write gates before remaining-schema check/repair.');
  process.exit(2);
}

const specs = {
  folding_production_form: {
    idType: 'INT(10) UNSIGNED',
    primary: ['id'],
    indexes: [
      ['idx_folding_production_date', false, ['folding_production_date']],
      ['idx_dispo_number', false, ['dispo_number']],
      ['idx_po_number', false, ['po_number']],
      ['idx_buyer', false, ['buyer']],
      ['idx_folding_dropdown_created_id', false, ['created_at', 'id']]
    ]
  },
  folding_production_breakdown: {
    idType: 'INT(10) UNSIGNED',
    primary: ['dispo_number', 'id'],
    indexes: [
      ['uq_folding_production_breakdown_id', true, ['id']],
      ['idx_folding_production_id', false, ['folding_production_id']],
      ['idx_loom_production_date', false, ['loom_production_date']],
      ['idx_folding_production_date', false, ['folding_production_date']]
    ]
  },
  greige_delivery_form: {
    idType: 'INT(10) UNSIGNED',
    primary: ['id'],
    indexes: [
      ['idx_dispo_number', false, ['dispo_number']],
      ['idx_po_number', false, ['po_number']],
      ['idx_delivery_date', false, ['delivery_date']],
      ['idx_challan_no', false, ['challan_no']],
      ['idx_greige_delivery_dropdown_created_id', false, ['created_at', 'id']]
    ]
  },
  greige_delivery_breakdown: {
    idType: 'INT(10) UNSIGNED',
    primary: ['dispo_number', 'id'],
    indexes: [
      ['uq_greige_delivery_breakdown_id', true, ['id']],
      ['idx_greige_delivery_id', false, ['greige_delivery_id']]
    ]
  }
};

const fkSpecs = [
  {
    table: 'folding_production_breakdown',
    name: 'fk_folding_production_breakdown',
    column: 'folding_production_id',
    refTable: 'folding_production_form',
    refColumn: 'id',
    ddl: 'ALTER TABLE `folding_production_breakdown` ADD CONSTRAINT `fk_folding_production_breakdown` FOREIGN KEY (`folding_production_id`) REFERENCES `folding_production_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
  },
  {
    table: 'greige_delivery_breakdown',
    name: 'greige_delivery_breakdown_ibfk_1',
    column: 'greige_delivery_id',
    refTable: 'greige_delivery_form',
    refColumn: 'id',
    ddl: 'ALTER TABLE `greige_delivery_breakdown` ADD CONSTRAINT `greige_delivery_breakdown_ibfk_1` FOREIGN KEY (`greige_delivery_id`) REFERENCES `greige_delivery_form` (`id`) ON DELETE CASCADE'
  }
];

async function indexColumns(c, table, name) {
  const [r] = await c.query(`
    SELECT COLUMN_NAME, NON_UNIQUE
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?
    ORDER BY SEQ_IN_INDEX
  `, [DB, table, name]);
  return r;
}

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: DB
  });

  try {
    const [db] = await c.query('SELECT DATABASE() db');
    if (db[0].db !== DB) throw new Error(`Wrong database: ${db[0].db}`);

    const counts = {};
    for (const table of Object.keys(specs)) {
      const [r] = await c.query(`SELECT COUNT(*) n FROM \`${table}\``);
      counts[table] = Number(r[0].n);
    }
    console.log('ROW_COUNTS=' + JSON.stringify(counts));

    const issues = [];

    for (const [table, spec] of Object.entries(specs)) {
      const primary = await indexColumns(c, table, 'PRIMARY');
      const pkCols = primary.map(x => x.COLUMN_NAME);
      if (JSON.stringify(pkCols) !== JSON.stringify(spec.primary)) {
        issues.push(`${table}:PRIMARY expected=${JSON.stringify(spec.primary)} actual=${JSON.stringify(pkCols)}`);
        if (repair) {
          if (primary.length) throw new Error(`Unexpected existing PRIMARY on ${table}; refusing automatic replacement.`);
          if (counts[table] !== 0) throw new Error(`${table} has rows; refusing to add missing PRIMARY automatically.`);
          await c.query(`ALTER TABLE \`${table}\` ADD PRIMARY KEY (${spec.primary.map(x => `\`${x}\``).join(',')})`);
          console.log(`REPAIRED ${table} PRIMARY`);
        }
      }

      for (const [name, unique, cols] of spec.indexes) {
        const existing = await indexColumns(c, table, name);
        const actualCols = existing.map(x => x.COLUMN_NAME);
        const actualUnique = existing.length ? Number(existing[0].NON_UNIQUE) === 0 : null;
        const ok = JSON.stringify(actualCols) === JSON.stringify(cols) && actualUnique === unique;
        if (!ok) {
          issues.push(`${table}:${name} expected=${unique ? 'UNIQUE ' : ''}${JSON.stringify(cols)} actual=${JSON.stringify(actualCols)}`);
          if (repair) {
            if (existing.length) throw new Error(`Index ${table}.${name} exists with unexpected definition; refusing replacement.`);
            if (counts[table] !== 0) throw new Error(`${table} has rows; refusing to add missing index ${name} automatically.`);
            await c.query(`ALTER TABLE \`${table}\` ADD ${unique ? 'UNIQUE ' : ''}KEY \`${name}\` (${cols.map(x => `\`${x}\``).join(',')})`);
            console.log(`REPAIRED ${table}.${name}`);
          }
        }
      }

      const [idRows] = await c.query(`
        SELECT COLUMN_TYPE, EXTRA
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='id'
      `, [DB, table]);
      if (!idRows.length) throw new Error(`${table}.id missing`);
      const ai = String(idRows[0].EXTRA || '').toLowerCase().includes('auto_increment');
      if (!ai) {
        issues.push(`${table}.id missing AUTO_INCREMENT`);
        if (repair) {
          if (counts[table] !== 0) throw new Error(`${table} has rows; refusing AUTO_INCREMENT repair automatically.`);
          await c.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` ${spec.idType} NOT NULL AUTO_INCREMENT`);
          console.log(`REPAIRED ${table}.id AUTO_INCREMENT`);
        }
      }
    }

    for (const fk of fkSpecs) {
      const [r] = await c.query(`
        SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [DB, fk.table, fk.column]);
      const correct = r.find(x => x.REFERENCED_TABLE_NAME === fk.refTable && x.REFERENCED_COLUMN_NAME === fk.refColumn);
      if (!correct) {
        issues.push(`${fk.table}.${fk.column} missing FK -> ${fk.refTable}.${fk.refColumn}`);
        if (repair) {
          if (counts[fk.table] !== 0) throw new Error(`${fk.table} has rows; refusing FK repair automatically.`);
          await c.query(fk.ddl);
          console.log(`REPAIRED FK ${fk.name}`);
        }
      }
    }

    if (repair) {
      console.log('REPAIR_PHASE_COMPLETE=YES');
      await c.end();
      // Re-run as a fresh check-only process so verification is independent of stale metadata.
      const { spawnSync } = require('child_process');
      const me = path.resolve(__filename);
      const x = spawnSync(process.execPath, [me], { stdio: 'inherit', env: { ...process.env, ALLOW_PRODUCTION_DB: 'false', BACKUP_CONFIRMED: 'false' } });
      process.exit(x.status === null ? 1 : x.status);
    }

    if (issues.length) {
      console.log('REMAINING_SCHEMA_READY=NO');
      console.log('ISSUES=' + JSON.stringify(issues, null, 2));
      process.exitCode = 10;
    } else {
      console.log('REMAINING_SCHEMA_READY=YES');
    }
  } finally {
    try { await c.end(); } catch (_e) {}
  }
}

main().catch(e => {
  console.error('REMAINING_SCHEMA_CHECK_REPAIR=FAIL');
  console.error(e.code || '');
  console.error(e.message);
  process.exitCode = 1;
});
