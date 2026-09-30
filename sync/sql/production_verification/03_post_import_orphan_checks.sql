-- Every orphan_count must be zero.
SELECT 'PO_form_data' child_table, COUNT(*) orphan_count
FROM PO_form_data c LEFT JOIN pre_costing_data p ON p.pre_costing_no = c.pre_costing_no WHERE p.pre_costing_no IS NULL UNION ALL
SELECT 'dispo_form_data', COUNT(*)
FROM dispo_form_data c LEFT JOIN PO_form_data p ON p.po_no = c.po_no WHERE p.po_no IS NULL UNION ALL
SELECT 'warp_yarn_details', COUNT(*)
FROM warp_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number = c.dispo_number WHERE p.dispo_number IS NULL UNION ALL
SELECT 'weft_yarn_details', COUNT(*)
FROM weft_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number = c.dispo_number WHERE p.dispo_number IS NULL UNION ALL
SELECT 'warp_broken_section', COUNT(*)
FROM warp_broken_section c LEFT JOIN dispo_form_data p ON p.dispo_number = c.dispo_number WHERE p.dispo_number IS NULL UNION ALL
SELECT 'warp_broken_pattern', COUNT(*)
FROM warp_broken_pattern c LEFT JOIN dispo_form_data p ON p.dispo_number = c.dispo_number WHERE p.dispo_number IS NULL UNION ALL
SELECT 'yarn_received_details', COUNT(*)
FROM yarn_received_details c LEFT JOIN yarn_receive_form p ON p.id = c.yarn_receive_form_id WHERE p.id IS NULL UNION ALL
SELECT 'yarn_issue_details', COUNT(*)
FROM yarn_issue_details c LEFT JOIN yarn_issue_form p ON p.id = c.yarn_issue_form_id WHERE p.id IS NULL UNION ALL
SELECT 'warping_breakdown', COUNT(*)
FROM warping_breakdown c LEFT JOIN warping_form p ON p.id = c.warping_form_id WHERE p.id IS NULL UNION ALL
SELECT 'sizing_breakdown', COUNT(*)
FROM sizing_breakdown c LEFT JOIN sizing_form p ON p.id = c.sizing_form_id WHERE p.id IS NULL UNION ALL
SELECT 'loom_production_breakdown', COUNT(*)
FROM loom_production_breakdown c LEFT JOIN loom_production_form p ON p.id = c.loom_production_id WHERE p.id IS NULL UNION ALL
SELECT 'folding_production_breakdown', COUNT(*)
FROM folding_production_breakdown c LEFT JOIN folding_production_form p ON p.id = c.folding_production_id WHERE p.id IS NULL UNION ALL
SELECT 'greige_delivery_breakdown', COUNT(*)
FROM greige_delivery_breakdown c LEFT JOIN greige_delivery_form p ON p.id = c.greige_delivery_id WHERE p.id IS NULL
ORDER BY child_table;
