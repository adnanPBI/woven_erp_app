-- v2.5 import audit tables. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS `import_runs` (
  `run_id` varchar(96) NOT NULL,
  `mode` enum('dry-run','live') NOT NULL,
  `importer_scope` varchar(255) DEFAULT NULL,
  `validation_mode` varchar(32) NOT NULL DEFAULT 'strict',
  `status` varchar(32) NOT NULL DEFAULT 'running',
  `source_files` json DEFAULT NULL,
  `stats` json DEFAULT NULL,
  `preview_path` text DEFAULT NULL,
  `error_summary` text DEFAULT NULL,
  `started_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`),
  KEY `idx_import_runs_status_started` (`status`,`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `import_row_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `run_id` varchar(96) NOT NULL,
  `importer_id` varchar(64) NOT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `source_row_number` int DEFAULT NULL,
  `target_table` varchar(128) DEFAULT NULL,
  `action` varchar(64) DEFAULT NULL,
  `status` varchar(32) NOT NULL,
  `candidate_count` int NOT NULL DEFAULT 0,
  `valid_count` int NOT NULL DEFAULT 0,
  `rejected_count` int NOT NULL DEFAULT 0,
  `inserted_count` int NOT NULL DEFAULT 0,
  `updated_count` int NOT NULL DEFAULT 0,
  `deleted_count` int NOT NULL DEFAULT 0,
  `message` text DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_import_row_audit_run` (`run_id`),
  KEY `idx_import_row_audit_dispo` (`dispo_number`),
  CONSTRAINT `fk_import_row_audit_run` FOREIGN KEY (`run_id`) REFERENCES `import_runs` (`run_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `import_rejected_rows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `run_id` varchar(96) NOT NULL,
  `importer_id` varchar(64) NOT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `source_row_number` int DEFAULT NULL,
  `source_file` text DEFAULT NULL,
  `target_table` varchar(128) DEFAULT NULL,
  `candidate_slot` varchar(64) DEFAULT NULL,
  `rejection_code` varchar(96) NOT NULL,
  `reason` text NOT NULL,
  `rule_name` varchar(255) DEFAULT NULL,
  `candidate_data` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_import_rejected_run` (`run_id`),
  KEY `idx_import_rejected_dispo` (`dispo_number`),
  CONSTRAINT `fk_import_rejected_run` FOREIGN KEY (`run_id`) REFERENCES `import_runs` (`run_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
