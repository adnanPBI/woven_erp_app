CREATE TABLE erp_sync_row_changes (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 run_id VARCHAR(191) NOT NULL,
 profile VARCHAR(64) NULL,
 source_uid CHAR(64) NULL,
 source_file VARCHAR(255) NULL,
 source_row INT NULL,
 source_action VARCHAR(20) NULL,
 dispo VARCHAR(255) NOT NULL DEFAULT '',
 table_name VARCHAR(64) NOT NULL,
 action ENUM('added','updated','deleted') NOT NULL,
 row_key TEXT NOT NULL,
 identity_scope VARCHAR(32) NOT NULL,
 affected_rows INT NOT NULL,
 changed_columns TEXT NOT NULL,
 before_json MEDIUMTEXT NULL,
 after_json MEDIUMTEXT NULL,
 note TEXT NULL,
 KEY(run_id),KEY(created_at),KEY(table_name),KEY(dispo)
) ENGINE=InnoDB;
CREATE TABLE erp_sync_history_meta (
 id INT PRIMARY KEY,
 enabled_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
INSERT INTO erp_sync_history_meta(id) VALUES(1);
