-- Strict production migration should finish with no pending unmatched dispos,
-- no unapproved synthetic identifiers, and no unresolved ready records.
SELECT 'pending_unmatched_dispos' test_name, COUNT(*) failure_count
FROM import_unmatched_dispo_audit WHERE status IN ('pending-review','historical-unmatched')
UNION ALL
SELECT 'ready_manual_resolutions_not_applied', COUNT(*)
FROM import_manual_dispo_resolution WHERE status='ready'
UNION ALL
SELECT 'invalid_applied_manual_resolution', COUNT(*)
FROM import_manual_dispo_resolution r
LEFT JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(r.resolved_dispo_number))
WHERE r.status='applied' AND d.dispo_number IS NULL
UNION ALL
SELECT 'placeholder_audit_missing_dispo', COUNT(*)
FROM import_placeholder_dispo_audit a LEFT JOIN dispo_form_data d ON d.dispo_number=a.dispo_number WHERE d.dispo_number IS NULL
UNION ALL
SELECT 'placeholder_audit_missing_po', COUNT(*)
FROM import_placeholder_dispo_audit a LEFT JOIN PO_form_data p ON p.po_no=a.placeholder_po_no WHERE p.po_no IS NULL
UNION ALL
SELECT 'placeholder_audit_missing_precosting', COUNT(*)
FROM import_placeholder_dispo_audit a LEFT JOIN pre_costing_data p ON p.pre_costing_no=a.placeholder_pre_costing_no WHERE p.pre_costing_no IS NULL
UNION ALL
SELECT 'synthetic_precosting_numbers', COUNT(*) FROM pre_costing_data WHERE UPPER(pre_costing_no) LIKE 'AUTO-%' OR UPPER(pre_costing_no) LIKE 'NO-%'
UNION ALL
SELECT 'synthetic_po_numbers', COUNT(*) FROM PO_form_data WHERE UPPER(po_no) LIKE 'AUTO-%' OR UPPER(po_no) LIKE 'NO-%'
UNION ALL
SELECT 'synthetic_dispo_numbers', COUNT(*) FROM dispo_form_data WHERE UPPER(dispo_number) LIKE 'AUTO-%' OR UPPER(dispo_number) LIKE 'NO-DISPO-%'
UNION ALL
SELECT 'synthetic_yarn_receive_challan', COUNT(*) FROM yarn_receive_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%'
UNION ALL
SELECT 'synthetic_yarn_issue_challan', COUNT(*) FROM yarn_issue_form WHERE UPPER(COALESCE(issue_challan_no,'')) LIKE 'NO-CHALLAN-%'
UNION ALL
SELECT 'synthetic_delivery_challan', COUNT(*) FROM greige_delivery_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%'
ORDER BY test_name;

SELECT * FROM import_unmatched_dispo_audit ORDER BY source_module, source_dispo_number;
SELECT * FROM import_manual_dispo_resolution ORDER BY source_module, source_dispo_number;
SELECT * FROM import_placeholder_dispo_audit ORDER BY dispo_number;
