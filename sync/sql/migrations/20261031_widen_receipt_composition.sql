-- Existing installations only. New installations use the matching schema files.
-- A legitimate 52-character fiber composition cannot fit VARCHAR(50). Preserve
-- the full value and widen to the issue table's existing 100-character limit;
-- never truncate source text or disable the mapped-column capacity check.
--
-- BEFORE running: hold the scheduler file/database locks, verify actual source
-- lengths, take/gzip/hash-check a consistent SQL backup, and record an ordered
-- logical hash of all existing receipt rows (including IDs/nulls/whitespace).
-- Set these TWO session variables explicitly after the backup is verified:
--   SET @migration_expected_database = '<actual approved database>';
--   SET @migration_backup_verified = 1;
--
-- The statement may copy the table because widening utf8mb4 50->100 crosses
-- the one-/two-byte VARCHAR length-prefix boundary. Reads remain available;
-- writes can wait for the copy. Coordinate the window rather than weakening
-- locks or changing the character set. No data UPDATE/DELETE is performed.
SET @receipt_composition_type = NULL;
SET @receipt_composition_capacity = NULL;
SET @receipt_composition_shape_ok = 0;
SELECT COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH,
       CHARACTER_SET_NAME = 'utf8mb4'
       AND COLLATION_NAME = 'utf8mb4_unicode_ci'
       AND IS_NULLABLE = 'YES'
       AND (COLUMN_DEFAULT IS NULL OR COLUMN_DEFAULT = 'NULL')
       AND COLUMN_COMMENT = ''
  INTO @receipt_composition_type, @receipt_composition_capacity,
       @receipt_composition_shape_ok
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'yarn_receive_form'
  AND COLUMN_NAME = 'yarn_composition';

SET @receipt_composition_ddl = CASE
  WHEN COALESCE(@migration_expected_database, '') <> COALESCE(DATABASE(), '')
       OR COALESCE(@migration_backup_verified, 0) <> 1
    THEN 'SELECT ''BLOCKED: verify database and backup session bindings'' AS migration_status'
  WHEN @receipt_composition_type LIKE 'varchar(%)'
       AND @receipt_composition_capacity >= 100
    THEN 'SELECT ''ALREADY WIDE: no column change performed'' AS migration_status'
  WHEN @receipt_composition_type = 'varchar(50)'
       AND @receipt_composition_shape_ok = 1
    THEN 'ALTER TABLE yarn_receive_form MODIFY COLUMN yarn_composition VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL, ALGORITHM=COPY, LOCK=SHARED'
  ELSE 'SELECT ''BLOCKED: unexpected column definition; review it separately'' AS migration_status'
END;
PREPARE receipt_composition_statement FROM @receipt_composition_ddl;
EXECUTE receipt_composition_statement;
DEALLOCATE PREPARE receipt_composition_statement;

-- Confirm VARCHAR(100), unchanged charset/collation/null/default, and the SAME
-- ordered logical row count/hash after the ALTER. On a failed check, investigate
-- concurrent writes; never auto-shrink a widened column. Then rerun the actual
-- production-backed full dry run before allowing the normal backed-up import.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE,
       CHARACTER_SET_NAME, COLLATION_NAME, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'yarn_receive_form'
  AND COLUMN_NAME = 'yarn_composition';
