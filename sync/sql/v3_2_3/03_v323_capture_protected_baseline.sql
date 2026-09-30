-- v3.2.3: Run ONCE after stopping the ERP and immediately before the first live production sequence (and separately on a rehearsal clone if desired).
-- Creates verification-only fingerprints for users, sessions, and user_privileges.
CREATE TABLE IF NOT EXISTS migration_v323_protected_baseline (
  object_name VARCHAR(64) NOT NULL,
  row_count BIGINT NOT NULL,
  xor_checksum BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sum_checksum DECIMAL(30,0) NOT NULL DEFAULT 0,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (object_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DELETE FROM migration_v323_protected_baseline
WHERE object_name IN ('users','sessions','user_privileges');

INSERT INTO migration_v323_protected_baseline(object_name,row_count,xor_checksum,sum_checksum)
SELECT 'users', COUNT(*),
       COALESCE(BIT_XOR(CAST(CRC32(CONCAT_WS('|',id,username,password,role,created_at)) AS UNSIGNED)),0),
       COALESCE(SUM(CAST(CRC32(CONCAT_WS('|',id,username,password,role,created_at)) AS UNSIGNED)),0)
FROM users
UNION ALL
SELECT 'sessions', COUNT(*),
       COALESCE(BIT_XOR(CAST(CRC32(CONCAT_WS('|',session_id,expires,data)) AS UNSIGNED)),0),
       COALESCE(SUM(CAST(CRC32(CONCAT_WS('|',session_id,expires,data)) AS UNSIGNED)),0)
FROM sessions
UNION ALL
SELECT 'user_privileges', COUNT(*),
       COALESCE(BIT_XOR(CAST(CRC32(CONCAT_WS('|',id,user_id,sub_ui,module)) AS UNSIGNED)),0),
       COALESCE(SUM(CAST(CRC32(CONCAT_WS('|',id,user_id,sub_ui,module)) AS UNSIGNED)),0)
FROM user_privileges;

SELECT * FROM migration_v323_protected_baseline ORDER BY object_name;
