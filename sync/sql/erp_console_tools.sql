-- Additive metadata only; no existing ERP business rows are modified.
CREATE TABLE IF NOT EXISTS erp_console_access (
  user_id INT NOT NULL PRIMARY KEY,
  can_view TINYINT NOT NULL DEFAULT 0,
  granted_by INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS erp_console_row_grants (
  table_name VARCHAR(64) NOT NULL,
  row_hash CHAR(64) NOT NULL,
  user_id INT NOT NULL,
  granted_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_name,row_hash,user_id), KEY(user_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS erp_console_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  table_name VARCHAR(64) NULL,
  row_key TEXT NULL,
  details_json MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS erp_console_history_clears (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  from_at DATETIME NOT NULL,
  to_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY(user_id,to_at)
) ENGINE=InnoDB;
