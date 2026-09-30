-- v3.2.3 hybrid normalization + provenance support schema
-- MariaDB/MySQL cPanel-safe static DDL. Run once before v3.2.3 dry-run/clone rehearsal.
-- Does not modify existing ERP business rows.

CREATE TABLE IF NOT EXISTS `migration_import_provenance` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `profile` varchar(64) NOT NULL,
  `source_uid` char(64) NOT NULL,
  `source_manifest_sha256` char(64) DEFAULT NULL,
  `source_file` varchar(255) DEFAULT NULL,
  `source_row_number` int(11) DEFAULT NULL,
  `target_table` varchar(64) NOT NULL,
  `target_primary_key` varchar(128) NOT NULL,
  `action` varchar(32) NOT NULL DEFAULT 'upsert',
  `first_run_id` varchar(191) DEFAULT NULL,
  `last_run_id` varchar(191) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_migration_import_provenance_source` (`profile`,`source_uid`,`target_table`),
  KEY `idx_migration_import_provenance_target` (`target_table`,`target_primary_key`),
  KEY `idx_migration_import_provenance_manifest` (`source_manifest_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `import_placeholder_precosting_audit` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `placeholder_pre_costing_no` varchar(50) NOT NULL,
  `po_no` varchar(50) DEFAULT NULL,
  `source_uid` char(64) DEFAULT NULL,
  `source_file` varchar(255) DEFAULT NULL,
  `source_row_number` int(11) DEFAULT NULL,
  `source_manifest_sha256` char(64) DEFAULT NULL,
  `reason` varchar(255) NOT NULL DEFAULT 'v3.2.3 certified PRE_COSTING placeholder',
  `first_run_id` varchar(191) DEFAULT NULL,
  `last_run_id` varchar(191) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_placeholder_precosting` (`placeholder_pre_costing_no`),
  KEY `idx_placeholder_precosting_po` (`po_no`),
  KEY `idx_placeholder_precosting_manifest` (`source_manifest_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `import_unlinked_source_row_audit` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `profile` varchar(64) NOT NULL,
  `source_uid` char(64) NOT NULL,
  `source_file` varchar(255) DEFAULT NULL,
  `source_row_number` int(11) DEFAULT NULL,
  `field_name` varchar(100) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `source_manifest_sha256` char(64) DEFAULT NULL,
  `first_run_id` varchar(191) DEFAULT NULL,
  `last_run_id` varchar(191) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unlinked_source_finding` (`profile`,`source_uid`,`field_name`),
  KEY `idx_unlinked_source_manifest` (`source_manifest_sha256`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
