-- Every failure_count should be zero.
SELECT 'pre_costing_blank_key' test_name, COUNT(*) failure_count
FROM pre_costing_data WHERE pre_costing_no IS NULL OR TRIM(pre_costing_no) = '' UNION ALL
SELECT 'po_blank_key', COUNT(*) FROM PO_form_data WHERE po_no IS NULL OR TRIM(po_no) = '' OR pre_costing_no IS NULL OR TRIM(pre_costing_no) = '' UNION ALL
SELECT 'po_without_precosting', COUNT(*) FROM PO_form_data p LEFT JOIN pre_costing_data pc ON pc.pre_costing_no = p.pre_costing_no WHERE pc.pre_costing_no IS NULL UNION ALL
SELECT 'dispo_plan_blank_key', COUNT(*) FROM dispo_plan_form WHERE dispo_no IS NULL OR TRIM(dispo_no) = '' UNION ALL
SELECT 'dispo_form_blank_key', COUNT(*) FROM dispo_form_data WHERE dispo_number IS NULL OR TRIM(dispo_number) = '' OR po_no IS NULL OR TRIM(po_no) = '' UNION ALL
SELECT 'dispo_without_po', COUNT(*) FROM dispo_form_data d LEFT JOIN PO_form_data p ON p.po_no = d.po_no WHERE p.po_no IS NULL UNION ALL
SELECT 'plan_without_dispo_form', COUNT(*) FROM dispo_plan_form p LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(p.dispo_no)) WHERE p.dispo_no IS NOT NULL AND TRIM(p.dispo_no) <> '' AND d.dispo_number IS NULL UNION ALL
SELECT 'yarn_receive_missing_dispo', COUNT(*) FROM yarn_receive_form y LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(y.received_against_dispo_nos)) WHERE y.received_against_dispo_nos IS NULL OR TRIM(y.received_against_dispo_nos) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'yarn_issue_missing_dispo', COUNT(*) FROM yarn_issue_form y LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(y.received_against_dispo_nos)) WHERE y.received_against_dispo_nos IS NULL OR TRIM(y.received_against_dispo_nos) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'warping_missing_dispo', COUNT(*) FROM warping_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE x.dispo_number IS NULL OR TRIM(x.dispo_number) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'sizing_missing_dispo', COUNT(*) FROM sizing_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE x.dispo_number IS NULL OR TRIM(x.dispo_number) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'loom_missing_dispo', COUNT(*) FROM loom_production_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE x.dispo_number IS NULL OR TRIM(x.dispo_number) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'folding_missing_dispo', COUNT(*) FROM folding_production_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE x.dispo_number IS NULL OR TRIM(x.dispo_number) = '' OR d.dispo_number IS NULL UNION ALL
SELECT 'delivery_missing_dispo', COUNT(*) FROM greige_delivery_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE x.dispo_number IS NULL OR TRIM(x.dispo_number) = '' OR d.dispo_number IS NULL
ORDER BY test_name;

-- Details for any invalid downstream dispo references.
SELECT 'yarn_receive_form' source_table, y.id source_id, y.received_against_dispo_nos dispo_number
FROM yarn_receive_form y LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(y.received_against_dispo_nos))
WHERE y.received_against_dispo_nos IS NULL OR TRIM(y.received_against_dispo_nos) = '' OR d.dispo_number IS NULL
UNION ALL
SELECT 'yarn_issue_form', y.id, y.received_against_dispo_nos
FROM yarn_issue_form y LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(y.received_against_dispo_nos))
WHERE y.received_against_dispo_nos IS NULL OR TRIM(y.received_against_dispo_nos) = '' OR d.dispo_number IS NULL
UNION ALL
SELECT 'warping_form', x.id, x.dispo_number FROM warping_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE d.dispo_number IS NULL
UNION ALL
SELECT 'sizing_form', x.id, x.dispo_number FROM sizing_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE d.dispo_number IS NULL
UNION ALL
SELECT 'loom_production_form', x.id, x.dispo_number FROM loom_production_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE d.dispo_number IS NULL
UNION ALL
SELECT 'folding_production_form', x.id, x.dispo_number FROM folding_production_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE d.dispo_number IS NULL
UNION ALL
SELECT 'greige_delivery_form', x.id, x.dispo_number FROM greige_delivery_form x LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number)) = LOWER(TRIM(x.dispo_number)) WHERE d.dispo_number IS NULL
ORDER BY source_table, source_id;
