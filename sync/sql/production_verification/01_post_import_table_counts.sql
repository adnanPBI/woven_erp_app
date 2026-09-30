-- Run after all ten production profiles complete.
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
SELECT 'production_timeline', COUNT(*) FROM production_timeline UNION ALL
SELECT 'users', COUNT(*) FROM users UNION ALL
SELECT 'sessions', COUNT(*) FROM sessions
ORDER BY table_name;
