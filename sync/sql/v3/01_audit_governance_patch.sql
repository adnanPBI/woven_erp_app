-- Production Migration v3.2.2 cPanel-compatible governance patch.
-- Static cPanel-compatible DDL; no dynamic statement generation or stored routines.
-- MariaDB/cPanel-safe and idempotent for the documented target schema.
-- Select weavonpq_weaving in phpMyAdmin before running.

SELECT DATABASE() AS connected_database,
       CASE WHEN DATABASE()='weavonpq_weaving' THEN 'PASS' ELSE 'FAIL' END AS database_name_check;

ALTER TABLE `weavonpq_weaving`.`import_manual_dispo_resolution`
  MODIFY COLUMN `action_mode` ENUM(
    'audit_only',
    'relink_to_existing_master',
    'create_approved_placeholder'
  ) NOT NULL DEFAULT 'audit_only',
  ADD COLUMN IF NOT EXISTS `approved_by` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `approved_at` TIMESTAMP NULL DEFAULT NULL;

SELECT c.column_name,c.column_type,c.is_nullable,c.column_default,
       CASE
         WHEN c.column_name='action_mode' AND c.column_type LIKE '%create_approved_placeholder%' THEN 'PASS'
         WHEN c.column_name='approved_by' AND c.column_type='varchar(100)' THEN 'PASS'
         WHEN c.column_name='approved_at' AND c.data_type='timestamp' THEN 'PASS'
         ELSE 'FAIL'
       END AS result
FROM information_schema.columns c
WHERE c.table_schema='weavonpq_weaving'
  AND c.table_name='import_manual_dispo_resolution'
  AND c.column_name IN ('action_mode','approved_by','approved_at')
ORDER BY FIELD(c.column_name,'action_mode','approved_by','approved_at');

SELECT 'v3_2_2_audit_governance_columns' AS test_name,
       CASE WHEN COUNT(*)=3
         AND SUM(column_name='action_mode' AND column_type LIKE '%create_approved_placeholder%')=1
         AND SUM(column_name='approved_by' AND column_type='varchar(100)')=1
         AND SUM(column_name='approved_at' AND data_type='timestamp')=1
       THEN 'PASS' ELSE 'FAIL' END AS result,
       COUNT(*) AS matching_columns
FROM information_schema.columns
WHERE table_schema='weavonpq_weaving'
  AND table_name='import_manual_dispo_resolution'
  AND column_name IN ('action_mode','approved_by','approved_at');
