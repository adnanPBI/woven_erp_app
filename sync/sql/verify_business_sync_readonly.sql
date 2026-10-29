-- Operator template: replace all three SET_* values before running.
-- Empty history for an unset/wrong run ID is NOT verification success.
-- No source records, private run identifiers or production results are included.
-- See docs/CPANEL_OPERATIONS.md; keyed-target list follows current mappings.
-- Read-only verification; no business INSERT/UPDATE/DELETE/DDL.
-- Run the whole file in one connection so session variables persist.

-- Select the production database and consistent read-only snapshot
USE `weavonpq_weaving_main`;
SET @migration_run = 'SET_APPROVED_LIVE_RUN_ID';
SET @start_date = 'SET_START_YYYY_MM_DD';
SET @end_exclusive = 'SET_EXCLUSIVE_END_YYYY_MM_DD';
SET SESSION group_concat_max_len = 1048576;
SET TRANSACTION READ ONLY;
START TRANSACTION WITH CONSISTENT SNAPSHOT;

-- Verify server identity and clocks
SELECT DATABASE() AS database_name, @@hostname AS hostname, @@version AS version,
       @@session.time_zone AS session_time_zone, @@system_time_zone AS system_time_zone,
       NOW() AS server_time, UTC_TIMESTAMP() AS checked_utc_time;

-- Prove committed physical business writes from this exact run
SELECT action, COUNT(*) AS audit_entries, SUM(affected_rows) AS physical_rows
FROM erp_sync_row_changes
WHERE run_id = @migration_run
GROUP BY action
ORDER BY action;

-- Break down committed writes across every affected business table
SELECT table_name, action, COUNT(*) AS audit_entries,
       SUM(affected_rows) AS physical_rows
FROM erp_sync_row_changes
WHERE run_id = @migration_run
GROUP BY table_name, action
ORDER BY table_name, action;

-- Show source/profile operations that caused physical writes
SELECT profile, source_action, COUNT(DISTINCT source_uid) AS source_records_with_writes,
       COUNT(*) AS audit_entries, SUM(affected_rows) AS physical_rows
FROM erp_sync_row_changes
WHERE run_id = @migration_run
GROUP BY profile, source_action
ORDER BY profile, source_action;

-- Count every current table/view and attach migration write counts
SELECT GROUP_CONCAT(
  CONCAT('SELECT ', QUOTE(TABLE_NAME), ' AS table_name, ',
         QUOTE(TABLE_TYPE), ' AS object_type, COUNT(*) AS current_rows FROM `',
         REPLACE(TABLE_SCHEMA, '`', '``'), '`.`', REPLACE(TABLE_NAME, '`', '``'), '`')
  ORDER BY TABLE_NAME SEPARATOR ' UNION ALL '
) INTO @count_sql
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE();

SET @all_tables_sql = CONCAT(
  'SELECT c.*, COALESCE(a.inserted_rows,0) AS migration_inserted_rows, ',
  'COALESCE(a.updated_rows,0) AS migration_updated_rows, ',
  'COALESCE(a.deleted_rows,0) AS migration_deleted_rows FROM (', @count_sql, ') c ',
  'LEFT JOIN (SELECT table_name, ',
  'SUM(CASE WHEN action=''added'' THEN affected_rows ELSE 0 END) inserted_rows, ',
  'SUM(CASE WHEN action=''updated'' THEN affected_rows ELSE 0 END) updated_rows, ',
  'SUM(CASE WHEN action=''deleted'' THEN affected_rows ELSE 0 END) deleted_rows ',
  'FROM erp_sync_row_changes WHERE run_id=@migration_run GROUP BY table_name) a ',
  'ON a.table_name=c.table_name ORDER BY c.table_name');
PREPARE all_tables_check FROM @all_tables_sql;
EXECUTE all_tables_check;
DEALLOCATE PREPARE all_tables_check;

-- Count the requested window across every native date/time column
SELECT GROUP_CONCAT(
  CONCAT('SELECT ', QUOTE(TABLE_NAME), ' AS table_name, ',
         QUOTE(COLUMN_NAME), ' AS date_column, COUNT(*) AS rows_in_window FROM `',
         REPLACE(TABLE_SCHEMA,'`','``'), '`.`', REPLACE(TABLE_NAME,'`','``'),
         '` WHERE `', REPLACE(COLUMN_NAME,'`','``'), '` >= @start_date AND `',
         REPLACE(COLUMN_NAME,'`','``'), '` < @end_exclusive')
  ORDER BY TABLE_NAME, ORDINAL_POSITION SEPARATOR ' UNION ALL '
) INTO @date_window_sql
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND DATA_TYPE IN ('date','datetime','timestamp');
PREPARE date_window_check FROM @date_window_sql;
EXECUTE date_window_check;
DEALLOCATE PREPARE date_window_check;

-- Check that primary-keyed audited targets still exist
SELECT 'PO_form_data' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `PO_form_data` t WHERE t.`po_no` <=> JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."po_no"')))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='PO_form_data'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'folding_production_breakdown' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `folding_production_breakdown` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED) AND t.`dispo_number` <=> JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."dispo_number"')))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='folding_production_breakdown'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'folding_production_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `folding_production_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='folding_production_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'greige_delivery_breakdown' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `greige_delivery_breakdown` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED) AND t.`dispo_number` <=> JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."dispo_number"')))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='greige_delivery_breakdown'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'greige_delivery_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `greige_delivery_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='greige_delivery_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'pre_costing_data' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `pre_costing_data` t WHERE t.`pre_costing_no` <=> JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."pre_costing_no"')))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='pre_costing_data'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'sizing_breakdown' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `sizing_breakdown` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='sizing_breakdown'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'sizing_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `sizing_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='sizing_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'warp_yarn_details' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `warp_yarn_details` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='warp_yarn_details'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'warping_breakdown' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `warping_breakdown` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='warping_breakdown'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'warping_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `warping_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='warping_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'weft_yarn_details' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `weft_yarn_details` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='weft_yarn_details'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'yarn_issue_details' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `yarn_issue_details` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='yarn_issue_details'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'yarn_issue_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `yarn_issue_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS SIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='yarn_issue_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'yarn_receive_form' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `yarn_receive_form` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='yarn_receive_form'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
UNION ALL
SELECT 'yarn_received_details' AS table_name, COUNT(*) AS checked_audit_entries,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `yarn_received_details` t WHERE t.`id` <=> CAST(JSON_UNQUOTE(JSON_EXTRACT(h.row_key, '$."id"')) AS UNSIGNED))),0) AS missing_targets
FROM erp_sync_row_changes h
WHERE h.run_id=@migration_run AND h.table_name='yarn_received_details'
  AND h.identity_scope='unique-row' AND h.action IN ('added','updated')
ORDER BY table_name;

-- Identify the written tables without primary keys
SELECT table_name, identity_scope, COUNT(*) AS audit_entries,
       SUM(affected_rows) AS physical_rows
FROM erp_sync_row_changes
WHERE run_id=@migration_run AND table_name IN ('dispo_form_data', 'dispo_plan_form')
GROUP BY table_name, identity_scope
ORDER BY table_name, identity_scope;

-- Inspect stored before/after values for actual updates
SELECT id, profile, source_action, table_name, action, row_key,
       affected_rows, changed_columns, before_json, after_json, created_at
FROM erp_sync_row_changes
WHERE run_id=@migration_run AND action='updated'
ORDER BY id
LIMIT 100;

-- Inspect the current tracking ledger
SELECT profile, COUNT(*) AS tracked_events, MAX(updated_at) AS last_ledger_change
FROM sheets_sync_events
GROUP BY profile
ORDER BY profile;

-- Release the read-only snapshot
ROLLBACK;
