-- Run before dry-run and after dry-run. ERP table counts must not change during dry-run.
SELECT 'PO_form_data' AS table_name, COUNT(*) AS rows_count FROM PO_form_data
UNION ALL SELECT 'dispo_form_data', COUNT(*) FROM dispo_form_data
UNION ALL SELECT 'yarn_receive_form', COUNT(*) FROM yarn_receive_form
UNION ALL SELECT 'yarn_received_details', COUNT(*) FROM yarn_received_details
UNION ALL SELECT 'yarn_issue_form', COUNT(*) FROM yarn_issue_form
UNION ALL SELECT 'yarn_issue_details', COUNT(*) FROM yarn_issue_details
UNION ALL SELECT 'warping_form', COUNT(*) FROM warping_form
UNION ALL SELECT 'warping_breakdown', COUNT(*) FROM warping_breakdown
UNION ALL SELECT 'sizing_form', COUNT(*) FROM sizing_form
UNION ALL SELECT 'sizing_breakdown', COUNT(*) FROM sizing_breakdown
UNION ALL SELECT 'loom_production_form', COUNT(*) FROM loom_production_form
UNION ALL SELECT 'loom_production_breakdown', COUNT(*) FROM loom_production_breakdown
UNION ALL SELECT 'folding_production_form', COUNT(*) FROM folding_production_form
UNION ALL SELECT 'folding_production_breakdown', COUNT(*) FROM folding_production_breakdown
UNION ALL SELECT 'greige_delivery_form', COUNT(*) FROM greige_delivery_form
UNION ALL SELECT 'greige_delivery_breakdown', COUNT(*) FROM greige_delivery_breakdown;
