-- v3.2.3 hybrid post-migration gate.
-- Run after clone rehearsal and after each production live sequence while ERP is stopped.
-- FIRST RESULT SET: every failure_count must be 0.
-- Event business-key repeats are intentionally preserved under provenance and are reported
-- in a separate INFORMATIONAL result set at the end; they are not duplicate failures.

SELECT 'orphan_po_to_precost' test_name, COUNT(*) failure_count
FROM PO_form_data p LEFT JOIN pre_costing_data c ON c.pre_costing_no=p.pre_costing_no
WHERE p.pre_costing_no IS NULL OR c.pre_costing_no IS NULL
UNION ALL
SELECT 'orphan_dispo_to_po', COUNT(*)
FROM dispo_form_data d LEFT JOIN PO_form_data p ON p.po_no=d.po_no
WHERE p.po_no IS NULL
UNION ALL
SELECT 'orphan_warp_yarn_to_dispo', COUNT(*)
FROM warp_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL
UNION ALL
SELECT 'orphan_weft_yarn_to_dispo', COUNT(*)
FROM weft_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL
UNION ALL
SELECT 'orphan_warp_broken_section_to_dispo', COUNT(*)
FROM warp_broken_section c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL
UNION ALL
SELECT 'orphan_warp_broken_pattern_to_dispo', COUNT(*)
FROM warp_broken_pattern c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL
UNION ALL
SELECT 'orphan_yarn_received_details', COUNT(*)
FROM yarn_received_details c LEFT JOIN yarn_receive_form p ON p.id=c.yarn_receive_form_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_yarn_issue_details', COUNT(*)
FROM yarn_issue_details c LEFT JOIN yarn_issue_form p ON p.id=c.yarn_issue_form_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_warping_breakdown', COUNT(*)
FROM warping_breakdown c LEFT JOIN warping_form p ON p.id=c.warping_form_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_sizing_breakdown', COUNT(*)
FROM sizing_breakdown c LEFT JOIN sizing_form p ON p.id=c.sizing_form_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_loom_breakdown', COUNT(*)
FROM loom_production_breakdown c LEFT JOIN loom_production_form p ON p.id=c.loom_production_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_folding_breakdown', COUNT(*)
FROM folding_production_breakdown c LEFT JOIN folding_production_form p ON p.id=c.folding_production_id WHERE p.id IS NULL
UNION ALL
SELECT 'orphan_delivery_breakdown', COUNT(*)
FROM greige_delivery_breakdown c LEFT JOIN greige_delivery_form p ON p.id=c.greige_delivery_id WHERE p.id IS NULL
UNION ALL
SELECT 'duplicate_provenance_source_binding', COUNT(*) FROM (
  SELECT profile,source_uid,target_table,COUNT(*) n
  FROM migration_import_provenance
  GROUP BY profile,source_uid,target_table HAVING COUNT(*)>1
) x
UNION ALL
SELECT 'provenance_stale_yarn_receive_target', COUNT(*)
FROM migration_import_provenance p LEFT JOIN yarn_receive_form t ON CAST(t.id AS CHAR)=p.target_primary_key
WHERE p.profile='yarn-receive' AND p.target_table='yarn_receive_form' AND t.id IS NULL
UNION ALL
SELECT 'provenance_stale_yarn_issue_target', COUNT(*)
FROM migration_import_provenance p LEFT JOIN yarn_issue_form t ON CAST(t.id AS CHAR)=p.target_primary_key
WHERE p.profile='yarn-issue' AND p.target_table='yarn_issue_form' AND t.id IS NULL
UNION ALL
SELECT 'provenance_stale_warping_target', COUNT(*)
FROM migration_import_provenance p LEFT JOIN warping_form t ON CAST(t.id AS CHAR)=p.target_primary_key
WHERE p.profile='warping' AND p.target_table='warping_form' AND t.id IS NULL
UNION ALL
SELECT 'provenance_stale_sizing_target', COUNT(*)
FROM migration_import_provenance p LEFT JOIN sizing_form t ON CAST(t.id AS CHAR)=p.target_primary_key
WHERE p.profile='sizing' AND p.target_table='sizing_form' AND t.id IS NULL
UNION ALL
SELECT 'provenance_stale_delivery_target', COUNT(*)
FROM migration_import_provenance p LEFT JOIN greige_delivery_form t ON CAST(t.id AS CHAR)=p.target_primary_key
WHERE p.profile='greige-delivery' AND p.target_table='greige_delivery_form' AND t.id IS NULL
UNION ALL
SELECT 'yarn_receive_target_without_provenance', COUNT(*)
FROM yarn_receive_form t LEFT JOIN migration_import_provenance p
 ON p.profile='yarn-receive' AND p.target_table='yarn_receive_form' AND p.target_primary_key=CAST(t.id AS CHAR)
WHERE p.id IS NULL
UNION ALL
SELECT 'yarn_issue_target_without_provenance', COUNT(*)
FROM yarn_issue_form t LEFT JOIN migration_import_provenance p
 ON p.profile='yarn-issue' AND p.target_table='yarn_issue_form' AND p.target_primary_key=CAST(t.id AS CHAR)
WHERE p.id IS NULL
UNION ALL
SELECT 'warping_target_without_provenance', COUNT(*)
FROM warping_form t LEFT JOIN migration_import_provenance p
 ON p.profile='warping' AND p.target_table='warping_form' AND p.target_primary_key=CAST(t.id AS CHAR)
WHERE p.id IS NULL
UNION ALL
SELECT 'sizing_target_without_provenance', COUNT(*)
FROM sizing_form t LEFT JOIN migration_import_provenance p
 ON p.profile='sizing' AND p.target_table='sizing_form' AND p.target_primary_key=CAST(t.id AS CHAR)
WHERE p.id IS NULL
UNION ALL
SELECT 'delivery_target_without_provenance', COUNT(*)
FROM greige_delivery_form t LEFT JOIN migration_import_provenance p
 ON p.profile='greige-delivery' AND p.target_table='greige_delivery_form' AND p.target_primary_key=CAST(t.id AS CHAR)
WHERE p.id IS NULL
UNION ALL
SELECT 'audited_placeholder_missing_precost_master', COUNT(*)
FROM import_placeholder_precosting_audit a
LEFT JOIN pre_costing_data p ON p.pre_costing_no=a.placeholder_pre_costing_no
WHERE p.pre_costing_no IS NULL
UNION ALL
SELECT 'audited_placeholder_missing_po', COUNT(*)
FROM import_placeholder_precosting_audit a
LEFT JOIN PO_form_data p ON p.po_no=a.po_no
WHERE a.po_no IS NOT NULL AND p.po_no IS NULL
UNION ALL
SELECT 'migpc_precost_missing_audit', COUNT(*)
FROM pre_costing_data p
LEFT JOIN import_placeholder_precosting_audit a ON a.placeholder_pre_costing_no=p.pre_costing_no
WHERE p.pre_costing_no REGEXP '^MIGPC(V)?-[A-Fa-f0-9]{32}$' AND a.id IS NULL
UNION ALL
SELECT 'malformed_migpc_precost_identifier', COUNT(*)
FROM pre_costing_data
WHERE UPPER(pre_costing_no) LIKE 'MIGPC%'
  AND pre_costing_no NOT REGEXP '^MIGPC(V)?-[A-Fa-f0-9]{32}$'
UNION ALL
SELECT 'forbidden_synthetic_precost', COUNT(*)
FROM pre_costing_data
WHERE UPPER(pre_costing_no) LIKE 'AUTO-%' OR UPPER(pre_costing_no) LIKE 'NO-%'
UNION ALL
SELECT 'forbidden_synthetic_po', COUNT(*)
FROM PO_form_data WHERE UPPER(po_no) LIKE 'AUTO-%' OR UPPER(po_no) LIKE 'NO-%'
UNION ALL
SELECT 'forbidden_synthetic_dispo', COUNT(*)
FROM dispo_form_data WHERE UPPER(dispo_number) LIKE 'AUTO-%' OR UPPER(dispo_number) LIKE 'NO-DISPO-%'
UNION ALL
SELECT 'forbidden_synthetic_receive_challan', COUNT(*)
FROM yarn_receive_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%'
UNION ALL
SELECT 'forbidden_synthetic_issue_challan', COUNT(*)
FROM yarn_issue_form WHERE UPPER(COALESCE(issue_challan_no,'')) LIKE 'NO-CHALLAN-%'
UNION ALL
SELECT 'forbidden_synthetic_delivery_challan', COUNT(*)
FROM greige_delivery_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%'
UNION ALL
SELECT 'pending_unmatched_dispo_resolution', COUNT(*)
FROM import_unmatched_dispo_audit WHERE status IN ('pending-review','historical-unmatched')
UNION ALL
SELECT 'ready_manual_dispo_resolution_not_applied', COUNT(*)
FROM import_manual_dispo_resolution WHERE status='ready'
ORDER BY test_name;

-- Core row counts for reconciliation/evidence.
SELECT 'pre_costing_data' table_name,COUNT(*) row_count FROM pre_costing_data UNION ALL
SELECT 'PO_form_data',COUNT(*) FROM PO_form_data UNION ALL
SELECT 'dispo_plan_form',COUNT(*) FROM dispo_plan_form UNION ALL
SELECT 'dispo_form_data',COUNT(*) FROM dispo_form_data UNION ALL
SELECT 'warp_yarn_details',COUNT(*) FROM warp_yarn_details UNION ALL
SELECT 'weft_yarn_details',COUNT(*) FROM weft_yarn_details UNION ALL
SELECT 'warp_broken_section',COUNT(*) FROM warp_broken_section UNION ALL
SELECT 'warp_broken_pattern',COUNT(*) FROM warp_broken_pattern UNION ALL
SELECT 'yarn_receive_form',COUNT(*) FROM yarn_receive_form UNION ALL
SELECT 'yarn_received_details',COUNT(*) FROM yarn_received_details UNION ALL
SELECT 'yarn_issue_form',COUNT(*) FROM yarn_issue_form UNION ALL
SELECT 'yarn_issue_details',COUNT(*) FROM yarn_issue_details UNION ALL
SELECT 'warping_form',COUNT(*) FROM warping_form UNION ALL
SELECT 'warping_breakdown',COUNT(*) FROM warping_breakdown UNION ALL
SELECT 'sizing_form',COUNT(*) FROM sizing_form UNION ALL
SELECT 'sizing_breakdown',COUNT(*) FROM sizing_breakdown UNION ALL
SELECT 'loom_production_form',COUNT(*) FROM loom_production_form UNION ALL
SELECT 'loom_production_breakdown',COUNT(*) FROM loom_production_breakdown UNION ALL
SELECT 'folding_production_form',COUNT(*) FROM folding_production_form UNION ALL
SELECT 'folding_production_breakdown',COUNT(*) FROM folding_production_breakdown UNION ALL
SELECT 'greige_delivery_form',COUNT(*) FROM greige_delivery_form UNION ALL
SELECT 'greige_delivery_breakdown',COUNT(*) FROM greige_delivery_breakdown UNION ALL
SELECT 'migration_import_provenance',COUNT(*) FROM migration_import_provenance UNION ALL
SELECT 'import_placeholder_precosting_audit',COUNT(*) FROM import_placeholder_precosting_audit UNION ALL
SELECT 'import_unlinked_source_row_audit',COUNT(*) FROM import_unlinked_source_row_audit
ORDER BY table_name;

-- Provenance coverage by event profile. target_rows and provenance_rows must be equal.
SELECT 'yarn-receive' profile,(SELECT COUNT(*) FROM yarn_receive_form) target_rows,
       (SELECT COUNT(*) FROM migration_import_provenance WHERE profile='yarn-receive' AND target_table='yarn_receive_form') provenance_rows
UNION ALL
SELECT 'yarn-issue',(SELECT COUNT(*) FROM yarn_issue_form),(SELECT COUNT(*) FROM migration_import_provenance WHERE profile='yarn-issue' AND target_table='yarn_issue_form')
UNION ALL
SELECT 'warping',(SELECT COUNT(*) FROM warping_form),(SELECT COUNT(*) FROM migration_import_provenance WHERE profile='warping' AND target_table='warping_form')
UNION ALL
SELECT 'sizing',(SELECT COUNT(*) FROM sizing_form),(SELECT COUNT(*) FROM migration_import_provenance WHERE profile='sizing' AND target_table='sizing_form')
UNION ALL
SELECT 'greige-delivery',(SELECT COUNT(*) FROM greige_delivery_form),(SELECT COUNT(*) FROM migration_import_provenance WHERE profile='greige-delivery' AND target_table='greige_delivery_form');

-- INFORMATIONAL ONLY: these business-key repeats are deliberately preserved for event profiles.
SELECT 'yarn_receive_business_key_repeat_groups' metric, COUNT(*) value FROM (
 SELECT yarn_count,yarn_brand,yarn_lot,received_start_date,received_against_dispo_nos,challan_no,COUNT(*) n
 FROM yarn_receive_form GROUP BY yarn_count,yarn_brand,yarn_lot,received_start_date,received_against_dispo_nos,challan_no HAVING COUNT(*)>1
) x
UNION ALL
SELECT 'yarn_issue_business_key_repeat_groups', COUNT(*) FROM (
 SELECT yarn_count,yarn_lot,issue_date,received_against_dispo_nos,issue_challan_no,COUNT(*) n
 FROM yarn_issue_form GROUP BY yarn_count,yarn_lot,issue_date,received_against_dispo_nos,issue_challan_no HAVING COUNT(*)>1
) x
UNION ALL
SELECT 'warping_business_key_repeat_groups', COUNT(*) FROM (
 SELECT dispo_number,warping_program_no,warping_date,COUNT(*) n FROM warping_form GROUP BY dispo_number,warping_program_no,warping_date HAVING COUNT(*)>1
) x
UNION ALL
SELECT 'sizing_business_key_repeat_groups', COUNT(*) FROM (
 SELECT dispo_number,sizing_set_no,sizing_date,COUNT(*) n FROM sizing_form GROUP BY dispo_number,sizing_set_no,sizing_date HAVING COUNT(*)>1
) x
UNION ALL
SELECT 'delivery_business_key_repeat_groups', COUNT(*) FROM (
 SELECT dispo_number,delivery_date,challan_no,COUNT(*) n FROM greige_delivery_form GROUP BY dispo_number,delivery_date,challan_no HAVING COUNT(*)>1
) x;
