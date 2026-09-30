-- v3.2.3 support-schema verification.
-- Run after 01_v323_support_schema.sql. Every row in the first two result sets
-- must be PASS. Before the first migration/dry-run, total_rows must be 0.

SELECT expected.object_name,
       expected.expected_type,
       COALESCE(t.table_type, '<missing>') AS actual_type,
       CASE WHEN t.table_name IS NOT NULL AND t.table_type = expected.expected_type THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'migration_import_provenance' object_name, 'BASE TABLE' expected_type
  UNION ALL SELECT 'import_placeholder_precosting_audit', 'BASE TABLE'
  UNION ALL SELECT 'import_unlinked_source_row_audit', 'BASE TABLE'
) expected
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE() AND t.table_name = expected.object_name
ORDER BY expected.object_name;

SELECT expected.table_name,
       expected.column_name,
       CASE WHEN c.column_name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
       COALESCE(c.column_type, '<missing>') AS column_type,
       COALESCE(c.is_nullable, '<missing>') AS is_nullable
FROM (
  SELECT 'migration_import_provenance' table_name, 'profile' column_name
  UNION ALL SELECT 'migration_import_provenance','source_uid'
  UNION ALL SELECT 'migration_import_provenance','source_manifest_sha256'
  UNION ALL SELECT 'migration_import_provenance','source_file'
  UNION ALL SELECT 'migration_import_provenance','source_row_number'
  UNION ALL SELECT 'migration_import_provenance','target_table'
  UNION ALL SELECT 'migration_import_provenance','target_primary_key'
  UNION ALL SELECT 'migration_import_provenance','first_run_id'
  UNION ALL SELECT 'migration_import_provenance','last_run_id'
  UNION ALL SELECT 'import_placeholder_precosting_audit','placeholder_pre_costing_no'
  UNION ALL SELECT 'import_placeholder_precosting_audit','po_no'
  UNION ALL SELECT 'import_placeholder_precosting_audit','source_uid'
  UNION ALL SELECT 'import_placeholder_precosting_audit','source_manifest_sha256'
  UNION ALL SELECT 'import_placeholder_precosting_audit','first_run_id'
  UNION ALL SELECT 'import_placeholder_precosting_audit','last_run_id'
  UNION ALL SELECT 'import_unlinked_source_row_audit','profile'
  UNION ALL SELECT 'import_unlinked_source_row_audit','source_uid'
  UNION ALL SELECT 'import_unlinked_source_row_audit','field_name'
  UNION ALL SELECT 'import_unlinked_source_row_audit','reason'
  UNION ALL SELECT 'import_unlinked_source_row_audit','source_manifest_sha256'
  UNION ALL SELECT 'import_unlinked_source_row_audit','first_run_id'
  UNION ALL SELECT 'import_unlinked_source_row_audit','last_run_id'
) expected
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = expected.table_name
 AND c.column_name = expected.column_name
ORDER BY expected.table_name, expected.column_name;

SELECT 'v323_support_tables_empty_before_migration' AS test_name,
       CASE WHEN ((SELECT COUNT(*) FROM migration_import_provenance)
                + (SELECT COUNT(*) FROM import_placeholder_precosting_audit)
                + (SELECT COUNT(*) FROM import_unlinked_source_row_audit)) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       ((SELECT COUNT(*) FROM migration_import_provenance)
        + (SELECT COUNT(*) FROM import_placeholder_precosting_audit)
        + (SELECT COUNT(*) FROM import_unlinked_source_row_audit)) AS total_rows;
