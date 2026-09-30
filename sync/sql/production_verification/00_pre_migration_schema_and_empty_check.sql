-- Run BEFORE the first migration write.
-- Read-only. Select the weavonpq_weaving database in phpMyAdmin first.

SELECT DATABASE() AS connected_database,
       CASE WHEN DATABASE() = 'weavonpq_weaving' THEN 'PASS' ELSE 'FAIL' END AS database_name_check;

-- Required migration and governance objects.
SELECT r.object_name, r.expected_type,
       COALESCE(t.table_type, 'MISSING') AS actual_type,
       CASE WHEN t.table_name IS NOT NULL AND t.table_type = r.expected_type THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'pre_costing_data' object_name, 'BASE TABLE' expected_type UNION ALL
  SELECT 'PO_form_data','BASE TABLE' UNION ALL
  SELECT 'dispo_plan_form','BASE TABLE' UNION ALL
  SELECT 'dispo_form_data','BASE TABLE' UNION ALL
  SELECT 'warp_yarn_details','BASE TABLE' UNION ALL
  SELECT 'weft_yarn_details','BASE TABLE' UNION ALL
  SELECT 'warp_broken_section','BASE TABLE' UNION ALL
  SELECT 'warp_broken_pattern','BASE TABLE' UNION ALL
  SELECT 'yarn_receive_form','BASE TABLE' UNION ALL
  SELECT 'yarn_received_details','BASE TABLE' UNION ALL
  SELECT 'yarn_issue_form','BASE TABLE' UNION ALL
  SELECT 'yarn_issue_details','BASE TABLE' UNION ALL
  SELECT 'warping_form','BASE TABLE' UNION ALL
  SELECT 'warping_breakdown','BASE TABLE' UNION ALL
  SELECT 'sizing_form','BASE TABLE' UNION ALL
  SELECT 'sizing_breakdown','BASE TABLE' UNION ALL
  SELECT 'loom_production_form','BASE TABLE' UNION ALL
  SELECT 'loom_production_breakdown','BASE TABLE' UNION ALL
  SELECT 'folding_production_form','BASE TABLE' UNION ALL
  SELECT 'folding_production_breakdown','BASE TABLE' UNION ALL
  SELECT 'greige_delivery_form','BASE TABLE' UNION ALL
  SELECT 'greige_delivery_breakdown','BASE TABLE' UNION ALL
  SELECT 'import_manual_dispo_resolution','BASE TABLE' UNION ALL
  SELECT 'import_placeholder_dispo_audit','BASE TABLE' UNION ALL
  SELECT 'import_unmatched_dispo_audit','BASE TABLE' UNION ALL
  SELECT 'production_timeline','BASE TABLE' UNION ALL
  SELECT 'order_summary_stats','VIEW' UNION ALL
  SELECT 'v_import_manual_dispo_resolution_review','VIEW'
) r
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE() AND t.table_name = r.object_name
ORDER BY r.object_name;

-- Critical columns used by the corrected v3 runtime and deployed ERP.
SELECT r.table_name, r.column_name,
       CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END AS result,
       c.column_type, c.is_nullable
FROM (
  SELECT 'production_timeline' table_name, 'yarn_ply_received' column_name UNION ALL
  SELECT 'production_timeline','yarn_ply_issue' UNION ALL
  SELECT 'import_manual_dispo_resolution','action_mode' UNION ALL
  SELECT 'import_manual_dispo_resolution','approved_by' UNION ALL
  SELECT 'import_manual_dispo_resolution','approved_at' UNION ALL
  SELECT 'yarn_issue_details','issued_quantity' UNION ALL
  SELECT 'yarn_issue_form','total_received_kg' UNION ALL
  SELECT 'yarn_issue_form','remaining_stock_kg' UNION ALL
  SELECT 'sizing_form','actual_warp_length_mtr' UNION ALL
  SELECT 'sizing_form','warping_date' UNION ALL
  SELECT 'sizing_form','warping_set_no' UNION ALL
  SELECT 'sizing_form','total_warp_beam' UNION ALL
  SELECT 'folding_production_breakdown','folding_production_qty_yds' UNION ALL
  SELECT 'folding_production_breakdown','folding_balance' UNION ALL
  SELECT 'greige_delivery_breakdown','greige_delivery_qty_yds' UNION ALL
  SELECT 'greige_delivery_breakdown','delivery_balance'
) r
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = r.table_name
 AND c.column_name = r.column_name
ORDER BY r.table_name, r.column_name;

-- Exact pre-migration counts. All migration/audit tables should be zero.
SELECT 'pre_costing_data' table_name, COUNT(*) row_count FROM pre_costing_data UNION ALL
SELECT 'PO_form_data', COUNT(*) FROM PO_form_data UNION ALL
SELECT 'dispo_plan_form', COUNT(*) FROM dispo_plan_form UNION ALL
SELECT 'dispo_form_data', COUNT(*) FROM dispo_form_data UNION ALL
SELECT 'warp_yarn_details', COUNT(*) FROM warp_yarn_details UNION ALL
SELECT 'weft_yarn_details', COUNT(*) FROM weft_yarn_details UNION ALL
SELECT 'warp_broken_section', COUNT(*) FROM warp_broken_section UNION ALL
SELECT 'warp_broken_pattern', COUNT(*) FROM warp_broken_pattern UNION ALL
SELECT 'yarn_receive_form', COUNT(*) FROM yarn_receive_form UNION ALL
SELECT 'yarn_received_details', COUNT(*) FROM yarn_received_details UNION ALL
SELECT 'yarn_issue_form', COUNT(*) FROM yarn_issue_form UNION ALL
SELECT 'yarn_issue_details', COUNT(*) FROM yarn_issue_details UNION ALL
SELECT 'warping_form', COUNT(*) FROM warping_form UNION ALL
SELECT 'warping_breakdown', COUNT(*) FROM warping_breakdown UNION ALL
SELECT 'sizing_form', COUNT(*) FROM sizing_form UNION ALL
SELECT 'sizing_breakdown', COUNT(*) FROM sizing_breakdown UNION ALL
SELECT 'loom_production_form', COUNT(*) FROM loom_production_form UNION ALL
SELECT 'loom_production_breakdown', COUNT(*) FROM loom_production_breakdown UNION ALL
SELECT 'folding_production_form', COUNT(*) FROM folding_production_form UNION ALL
SELECT 'folding_production_breakdown', COUNT(*) FROM folding_production_breakdown UNION ALL
SELECT 'greige_delivery_form', COUNT(*) FROM greige_delivery_form UNION ALL
SELECT 'greige_delivery_breakdown', COUNT(*) FROM greige_delivery_breakdown UNION ALL
SELECT 'import_manual_dispo_resolution', COUNT(*) FROM import_manual_dispo_resolution UNION ALL
SELECT 'import_placeholder_dispo_audit', COUNT(*) FROM import_placeholder_dispo_audit UNION ALL
SELECT 'import_unmatched_dispo_audit', COUNT(*) FROM import_unmatched_dispo_audit UNION ALL
SELECT 'production_timeline', COUNT(*) FROM production_timeline
ORDER BY table_name;

SELECT 'migration_tables_empty' AS test_name,
       CASE WHEN total_rows = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       total_rows
FROM (
  SELECT
    (SELECT COUNT(*) FROM pre_costing_data) +
    (SELECT COUNT(*) FROM PO_form_data) +
    (SELECT COUNT(*) FROM dispo_plan_form) +
    (SELECT COUNT(*) FROM dispo_form_data) +
    (SELECT COUNT(*) FROM warp_yarn_details) +
    (SELECT COUNT(*) FROM weft_yarn_details) +
    (SELECT COUNT(*) FROM warp_broken_section) +
    (SELECT COUNT(*) FROM warp_broken_pattern) +
    (SELECT COUNT(*) FROM yarn_receive_form) +
    (SELECT COUNT(*) FROM yarn_received_details) +
    (SELECT COUNT(*) FROM yarn_issue_form) +
    (SELECT COUNT(*) FROM yarn_issue_details) +
    (SELECT COUNT(*) FROM warping_form) +
    (SELECT COUNT(*) FROM warping_breakdown) +
    (SELECT COUNT(*) FROM sizing_form) +
    (SELECT COUNT(*) FROM sizing_breakdown) +
    (SELECT COUNT(*) FROM loom_production_form) +
    (SELECT COUNT(*) FROM loom_production_breakdown) +
    (SELECT COUNT(*) FROM folding_production_form) +
    (SELECT COUNT(*) FROM folding_production_breakdown) +
    (SELECT COUNT(*) FROM greige_delivery_form) +
    (SELECT COUNT(*) FROM greige_delivery_breakdown) +
    (SELECT COUNT(*) FROM import_manual_dispo_resolution) +
    (SELECT COUNT(*) FROM import_placeholder_dispo_audit) +
    (SELECT COUNT(*) FROM import_unmatched_dispo_audit) +
    (SELECT COUNT(*) FROM production_timeline) AS total_rows
) x;

-- Preserve these numbers and send them with the post-migration output.
SELECT (SELECT COUNT(*) FROM users) AS users_before,
       (SELECT COUNT(*) FROM sessions) AS sessions_before;
