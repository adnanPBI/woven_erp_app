-- Run after migration while the ERP is still stopped.
-- All three rows must be PASS. Perform this comparison before reopening the application.
SELECT b.object_name,
       b.row_count AS before_rows,
       c.row_count AS after_rows,
       b.xor_checksum AS before_xor,
       c.xor_checksum AS after_xor,
       b.sum_checksum AS before_sum,
       c.sum_checksum AS after_sum,
       CASE WHEN b.row_count=c.row_count
              AND b.xor_checksum=c.xor_checksum
              AND b.sum_checksum=c.sum_checksum
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM migration_v3_protected_baseline b
JOIN (
  SELECT 'users' object_name, COUNT(*) row_count,
         COALESCE(BIT_XOR(CAST(CRC32(CONCAT_WS('|',id,username,password,role,created_at)) AS UNSIGNED)),0) xor_checksum,
         COALESCE(SUM(CAST(CRC32(CONCAT_WS('|',id,username,password,role,created_at)) AS UNSIGNED)),0) sum_checksum
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
  FROM user_privileges
) c ON c.object_name=b.object_name
ORDER BY b.object_name;
