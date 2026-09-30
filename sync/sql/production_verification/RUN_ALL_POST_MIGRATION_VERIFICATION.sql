-- v3.2 combined post-migration verification.
-- IMPORTANT: edit the two UNRESOLVED unit variables inside sections 05 and 08 before execution.

-- ==================================================================
-- BEGIN 01_post_import_table_counts.sql
-- ==================================================================
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
-- END 01_post_import_table_counts.sql

-- ==================================================================
-- BEGIN 02_master_chain_and_required_keys.sql
-- ==================================================================
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
-- END 02_master_chain_and_required_keys.sql

-- ==================================================================
-- BEGIN 03_post_import_orphan_checks.sql
-- ==================================================================
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
-- END 03_post_import_orphan_checks.sql

-- ==================================================================
-- BEGIN 04_post_import_duplicate_checks.sql
-- ==================================================================
-- Every result set should return zero rows.
SELECT pre_costing_no, COUNT(*) duplicate_count FROM pre_costing_data GROUP BY pre_costing_no HAVING COUNT(*) > 1;
SELECT po_no, COUNT(*) duplicate_count FROM PO_form_data GROUP BY po_no HAVING COUNT(*) > 1;
SELECT dispo_no, COUNT(*) duplicate_count FROM dispo_plan_form GROUP BY dispo_no HAVING COUNT(*) > 1;
SELECT dispo_number, COUNT(*) duplicate_count FROM dispo_form_data GROUP BY dispo_number HAVING COUNT(*) > 1;
SELECT dispo_number, sl_no, COUNT(*) duplicate_count FROM warp_yarn_details GROUP BY dispo_number, sl_no HAVING COUNT(*) > 1;
SELECT dispo_number, sl_no, COUNT(*) duplicate_count FROM weft_yarn_details GROUP BY dispo_number, sl_no HAVING COUNT(*) > 1;
SELECT dispo_number, COUNT(*) duplicate_count FROM warp_broken_section GROUP BY dispo_number HAVING COUNT(*) > 1;
SELECT dispo_number, sl_no, COUNT(*) duplicate_count FROM warp_broken_pattern GROUP BY dispo_number, sl_no HAVING COUNT(*) > 1;
SELECT yarn_count, yarn_brand, yarn_lot, received_start_date, received_against_dispo_nos, challan_no, COUNT(*) duplicate_count
FROM yarn_receive_form GROUP BY yarn_count, yarn_brand, yarn_lot, received_start_date, received_against_dispo_nos, challan_no HAVING COUNT(*) > 1;
SELECT yarn_receive_form_id, dispo_number, received_date, quantity_kgs, COUNT(*) duplicate_count
FROM yarn_received_details GROUP BY yarn_receive_form_id, dispo_number, received_date, quantity_kgs HAVING COUNT(*) > 1;
SELECT yarn_count, yarn_lot, issue_date, received_against_dispo_nos, issue_challan_no, COUNT(*) duplicate_count
FROM yarn_issue_form GROUP BY yarn_count, yarn_lot, issue_date, received_against_dispo_nos, issue_challan_no HAVING COUNT(*) > 1;
SELECT yarn_issue_form_id, dispo_number, issue_date, issued_quantity, COUNT(*) duplicate_count
FROM yarn_issue_details GROUP BY yarn_issue_form_id, dispo_number, issue_date, issued_quantity HAVING COUNT(*) > 1;
SELECT dispo_number, warping_program_no, warping_date, COUNT(*) duplicate_count
FROM warping_form GROUP BY dispo_number, warping_program_no, warping_date HAVING COUNT(*) > 1;
SELECT warping_form_id, warping_date, warping_program_no, warping_set, COUNT(*) duplicate_count
FROM warping_breakdown GROUP BY warping_form_id, warping_date, warping_program_no, warping_set HAVING COUNT(*) > 1;
SELECT dispo_number, warping_program_no, sizing_date, COUNT(*) duplicate_count
FROM sizing_form GROUP BY dispo_number, warping_program_no, sizing_date HAVING COUNT(*) > 1;
SELECT sizing_form_id, sizing_date, COUNT(*) duplicate_count
FROM sizing_breakdown GROUP BY sizing_form_id, sizing_date HAVING COUNT(*) > 1;
SELECT dispo_number, weaving_date, COUNT(*) duplicate_count
FROM loom_production_form GROUP BY dispo_number, weaving_date HAVING COUNT(*) > 1;
SELECT loom_production_id, loom_production_date, COUNT(*) duplicate_count
FROM loom_production_breakdown GROUP BY loom_production_id, loom_production_date HAVING COUNT(*) > 1;
SELECT dispo_number, folding_production_date, COUNT(*) duplicate_count
FROM folding_production_form GROUP BY dispo_number, folding_production_date HAVING COUNT(*) > 1;
SELECT folding_production_id, folding_production_date, COUNT(*) duplicate_count
FROM folding_production_breakdown GROUP BY folding_production_id, folding_production_date HAVING COUNT(*) > 1;
SELECT dispo_number, delivery_date, challan_no, COUNT(*) duplicate_count
FROM greige_delivery_form GROUP BY dispo_number, delivery_date, challan_no HAVING COUNT(*) > 1;
SELECT greige_delivery_id, greige_delivery_date, COUNT(*) duplicate_count
FROM greige_delivery_breakdown GROUP BY greige_delivery_id, greige_delivery_date HAVING COUNT(*) > 1;
-- END 04_post_import_duplicate_checks.sql

-- ==================================================================
-- BEGIN 05_post_import_formula_and_lookup_checks.sql
-- ==================================================================
-- v3.2.2 sanitized formula, canonical-key, and critical-enrichment verification.
-- READ THIS FIRST:
-- Replace each UNRESOLVED value below with exactly 'meters' or 'yards'.
-- The values must match the approved migration environment and source manifest.
SET @folding_source_unit := 'UNRESOLVED';
SET @delivery_source_unit := 'UNRESOLVED';
SET @folding_factor := CASE LOWER(@folding_source_unit)
  WHEN 'meters' THEN 1.0936133
  WHEN 'yards' THEN 1.0
  ELSE NULL
END;
SET @delivery_factor := CASE LOWER(@delivery_source_unit)
  WHEN 'meters' THEN 1.0936133
  WHEN 'yards' THEN 1.0
  ELSE NULL
END;
SET @tolerance := 0.02;

-- A. Compact gate. Every failure_count must be zero.
SELECT 'approved_folding_unit' AS test_name,
       IF(@folding_factor IS NULL, 1, 0) AS failure_count
UNION ALL
SELECT 'approved_delivery_unit', IF(@delivery_factor IS NULL, 1, 0)
UNION ALL
SELECT 'yarn_issue_total_issued_formula', COUNT(*)
FROM yarn_issue_form
WHERE ABS(COALESCE(total_issued_kg,0) -
          (COALESCE(outside_issue_kg,0)+COALESCE(total_warp_issue_kgs,0)+COALESCE(total_weft_issue_kgs,0))) > 0.01
UNION ALL
SELECT 'yarn_issue_remaining_formula', COUNT(*)
FROM yarn_issue_form
WHERE ABS(COALESCE(remaining_stock_kg,0) -
          (COALESCE(total_received_kg,0)-COALESCE(total_issued_kg,0))) > 0.01
UNION ALL
SELECT 'yarn_issue_total_received_lot_only', COUNT(*)
FROM yarn_issue_form yi
LEFT JOIN (
  SELECT LOWER(TRIM(yrf.yarn_lot)) AS lot_key,
         SUM(COALESCE(rd.quantity_kgs,0)) AS expected_received_kg
  FROM yarn_receive_form yrf
  JOIN yarn_received_details rd ON rd.yarn_receive_form_id=yrf.id
  WHERE NULLIF(TRIM(yrf.yarn_lot),'') IS NOT NULL
  GROUP BY LOWER(TRIM(yrf.yarn_lot))
) r ON r.lot_key=LOWER(TRIM(yi.yarn_lot))
WHERE ABS(COALESCE(yi.total_received_kg,0)-COALESCE(r.expected_received_kg,0)) > 0.01
UNION ALL
SELECT 'yarn_issue_child_sum', COUNT(*)
FROM yarn_issue_form p
LEFT JOIN (
  SELECT yarn_issue_form_id, SUM(COALESCE(issued_quantity,0)) AS child_total
  FROM yarn_issue_details
  GROUP BY yarn_issue_form_id
) c ON c.yarn_issue_form_id=p.id
WHERE ABS(COALESCE(p.total_issued_kg,0)-COALESCE(c.child_total,0)) > 0.01
UNION ALL
SELECT 'warping_breakdown_mirror', COUNT(*)
FROM warping_breakdown b
JOIN warping_form p ON p.id=b.warping_form_id
WHERE NOT (b.dispo_number <=> p.dispo_number)
   OR NOT (b.warping_date <=> p.warping_date)
   OR NOT (b.warping_program_no <=> p.warping_program_no)
   OR NOT (b.warping_set <=> p.warping_set)
   OR NOT (b.total_beam_no <=> p.total_no_of_beam)
   OR ABS(COALESCE(b.warping_length_mtr,0)-COALESCE(p.actual_warp_length_mtr,0)) > 0.01
UNION ALL
SELECT 'sizing_breakdown_mirror', COUNT(*)
FROM sizing_breakdown b
JOIN sizing_form p ON p.id=b.sizing_form_id
WHERE NOT (b.dispo_number <=> p.dispo_number)
   OR NOT (b.sizing_date <=> p.sizing_date)
   OR ABS(COALESCE(b.sizing_qty_mtr,0)-COALESCE(p.actual_sizing_length_mtr,0)) > 0.01
   OR NOT (b.total_weavers_beam <=> p.total_warp_beam)
UNION ALL
SELECT 'sizing_warping_date_lookup', COUNT(*)
FROM sizing_form s
WHERE NOT (s.warping_date <=> (
  SELECT w.warping_date
  FROM warping_form w
  WHERE LOWER(TRIM(w.dispo_number))=LOWER(TRIM(s.dispo_number))
    AND LOWER(TRIM(COALESCE(w.warping_program_no,'')))=LOWER(TRIM(COALESCE(s.warping_program_no,'')))
    AND (s.sizing_date IS NULL OR w.warping_date IS NULL OR w.warping_date<=s.sizing_date)
  ORDER BY w.warping_date DESC, w.id DESC
  LIMIT 1
))
UNION ALL
SELECT 'loom_breakdown_formula', COUNT(*)
FROM loom_production_breakdown b
JOIN loom_production_form p ON p.id=b.loom_production_id
WHERE NOT (b.dispo_number <=> p.dispo_number)
   OR NOT (b.loom_production_date <=> p.weaving_date)
   OR ABS(COALESCE(b.loom_production_quantity_yds,0)-(
       COALESCE(CAST(NULLIF(REPLACE(TRIM(p.in_house_production_day),',',''),'') AS DECIMAL(18,4)),0)
       + COALESCE(p.outside_production_day,0)
   )) > 0.01
UNION ALL
SELECT 'folding_internal_balance', COUNT(*)
FROM folding_production_breakdown
WHERE ABS(COALESCE(folding_balance,0)-
          (COALESCE(loom_production_qty_yds,0)-COALESCE(folding_production_qty_yds,0))) > @tolerance
UNION ALL
SELECT 'folding_cumulative_folding', COUNT(*)
FROM folding_production_breakdown b
JOIN folding_production_form current_f ON current_f.id=b.folding_production_id
WHERE @folding_factor IS NOT NULL
  AND ABS(COALESCE(b.folding_production_qty_yds,0)-COALESCE((
    SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
    FROM folding_production_form f
    WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(current_f.dispo_number))
      AND (f.folding_production_date<current_f.folding_production_date
           OR (f.folding_production_date=current_f.folding_production_date AND f.id<=current_f.id))
  ),0)) > @tolerance
UNION ALL
SELECT 'folding_cumulative_loom', COUNT(*)
FROM folding_production_breakdown b
WHERE ABS(COALESCE(b.loom_production_qty_yds,0)-COALESCE((
  SELECT SUM(COALESCE(l.loom_production_quantity_yds,0))
  FROM loom_production_breakdown l
  WHERE LOWER(TRIM(l.dispo_number))=LOWER(TRIM(b.dispo_number))
    AND l.loom_production_date<=b.folding_production_date
),0)) > @tolerance
UNION ALL
SELECT 'folding_latest_loom_date', COUNT(*)
FROM folding_production_breakdown b
WHERE NOT (b.loom_production_date <=> (
  SELECT MAX(l.loom_production_date)
  FROM loom_production_breakdown l
  WHERE LOWER(TRIM(l.dispo_number))=LOWER(TRIM(b.dispo_number))
    AND l.loom_production_date<=b.folding_production_date
))
UNION ALL
SELECT 'delivery_internal_balance', COUNT(*)
FROM greige_delivery_breakdown
WHERE ABS(COALESCE(delivery_balance,0)-
          (COALESCE(greige_folding_qty_yds,0)-COALESCE(greige_delivery_qty_yds,0))) > @tolerance
UNION ALL
SELECT 'delivery_cumulative_folding_cross_source', COUNT(*)
FROM greige_delivery_breakdown b
JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
WHERE @folding_factor IS NOT NULL
  AND ABS(COALESCE(b.greige_folding_qty_yds,0)-COALESCE((
    -- Cross-source rule: include ALL folding rows through the delivery date.
    -- Never compare delivery row numbers/IDs with folding row numbers/IDs.
    SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
    FROM folding_production_form f
    WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(g.dispo_number))
      AND f.folding_production_date<=g.delivery_date
  ),0)) > @tolerance
UNION ALL
SELECT 'delivery_cumulative_delivery', COUNT(*)
FROM greige_delivery_breakdown b
JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
WHERE @delivery_factor IS NOT NULL
  AND ABS(COALESCE(b.greige_delivery_qty_yds,0)-COALESCE((
    SELECT SUM((COALESCE(g2.delivery_quantity_a_grade,0)+COALESCE(g2.delivery_quantity_b_grade,0)+COALESCE(g2.delivery_quantity_c_grade,0)+COALESCE(g2.delivery_quantity_reject,0))*@delivery_factor)
    FROM greige_delivery_form g2
    WHERE LOWER(TRIM(g2.dispo_number))=LOWER(TRIM(g.dispo_number))
      AND (
        g2.delivery_date<g.delivery_date
        OR (g2.delivery_date=g.delivery_date AND (
          /* v3.2.2 shared runtime/SQL challan order:
             blank first; 1-65 digit values numeric; remaining approved ASCII
             identifiers lowercase bytewise; target id mirrors source-row tie-break. */
          (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
            < (CASE WHEN TRIM(COALESCE(g.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
          OR (
            (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
              = (CASE WHEN TRIM(COALESCE(g.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
            AND (
              ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=1
                AND CAST(TRIM(g2.challan_no) AS DECIMAL(65,0)) < CAST(TRIM(g.challan_no) AS DECIMAL(65,0)))
              OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=2
                AND BINARY LOWER(TRIM(g2.challan_no)) < BINARY LOWER(TRIM(g.challan_no)))
              OR (
                (
                  (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=0
                  OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=1
                    AND CAST(TRIM(g2.challan_no) AS DECIMAL(65,0)) = CAST(TRIM(g.challan_no) AS DECIMAL(65,0)))
                  OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=2
                    AND BINARY LOWER(TRIM(g2.challan_no)) = BINARY LOWER(TRIM(g.challan_no)))
                )
                AND g2.id<=g.id
              )
            )
          )
        ))
      )
  ),0)) > @tolerance
UNION ALL
SELECT 'delivery_latest_folding_date', COUNT(*)
FROM greige_delivery_breakdown b
JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
WHERE NOT (b.greige_folding_date <=> (
  SELECT MAX(f.folding_production_date)
  FROM folding_production_form f
  WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(g.dispo_number))
    AND f.folding_production_date<=g.delivery_date
))
UNION ALL
SELECT 'business_critical_lookup_fields_blank',
  (SELECT COUNT(*) FROM yarn_receive_form WHERE NULLIF(TRIM(received_against_po_no),'') IS NULL)+
  (SELECT COUNT(*) FROM yarn_issue_form WHERE NULLIF(TRIM(received_against_po_no),'') IS NULL)+
  (SELECT COUNT(*) FROM warping_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR dispo_quantity_yds IS NULL OR required_warp_length_meter IS NULL)+
  (SELECT COUNT(*) FROM sizing_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL)+
  (SELECT COUNT(*) FROM loom_production_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)+
  (SELECT COUNT(*) FROM folding_production_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)+
  (SELECT COUNT(*) FROM greige_delivery_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)
UNION ALL
SELECT 'downstream_dispo_not_canonical',
  (SELECT COUNT(*) FROM yarn_receive_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.received_against_dispo_nos)) WHERE BINARY x.received_against_dispo_nos<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM yarn_issue_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.received_against_dispo_nos)) WHERE BINARY x.received_against_dispo_nos<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM warping_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM sizing_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM loom_production_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM folding_production_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
  (SELECT COUNT(*) FROM greige_delivery_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)
ORDER BY test_name;

-- B. Detailed yarn-receipt aggregate mismatches. Expected zero rows.
-- This mirrors ERP server.js: SUM(yarn_received_details.quantity_kgs) by TRIM(yarn_lot) only.
SELECT yi.id, yi.yarn_lot, yi.yarn_count, yi.yarn_brand,
       yi.total_received_kg,
       COALESCE(r.expected_received_kg,0) AS expected_received_kg
FROM yarn_issue_form yi
LEFT JOIN (
  SELECT LOWER(TRIM(yrf.yarn_lot)) AS lot_key,
         SUM(COALESCE(rd.quantity_kgs,0)) AS expected_received_kg
  FROM yarn_receive_form yrf
  JOIN yarn_received_details rd ON rd.yarn_receive_form_id=yrf.id
  WHERE NULLIF(TRIM(yrf.yarn_lot),'') IS NOT NULL
  GROUP BY LOWER(TRIM(yrf.yarn_lot))
) r ON r.lot_key=LOWER(TRIM(yi.yarn_lot))
WHERE ABS(COALESCE(yi.total_received_kg,0)-COALESCE(r.expected_received_kg,0)) > 0.01
ORDER BY yi.id;

-- C. Detailed cross-source delivery/folding mismatches. Expected zero rows.
SELECT b.id, g.dispo_number, g.delivery_date, g.challan_no,
       b.greige_folding_qty_yds,
       COALESCE((
         SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
         FROM folding_production_form f
         WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(g.dispo_number))
           AND f.folding_production_date<=g.delivery_date
       ),0) AS expected_folding_through_delivery_date,
       b.greige_delivery_qty_yds,
       b.delivery_balance
FROM greige_delivery_breakdown b
JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
WHERE @folding_factor IS NOT NULL
  AND ABS(COALESCE(b.greige_folding_qty_yds,0)-COALESCE((
    SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
    FROM folding_production_form f
    WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(g.dispo_number))
      AND f.folding_production_date<=g.delivery_date
  ),0))>@tolerance
ORDER BY g.dispo_number,g.delivery_date,g.challan_no,g.id;
-- END 05_post_import_formula_and_lookup_checks.sql

-- ==================================================================
-- BEGIN 06_audit_synthetic_and_rejection_checks.sql
-- ==================================================================
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
-- END 06_audit_synthetic_and_rejection_checks.sql

-- ==================================================================
-- BEGIN 07_data_quality_and_date_checks.sql
-- ==================================================================
-- Review counts. Zero is expected unless the source business history legitimately contains the condition.
SELECT 'negative_yarn_receipt_qty' test_name, COUNT(*) review_count FROM yarn_receive_form WHERE receipt_qty_kgs < 0 UNION ALL
SELECT 'negative_yarn_issue_qty', COUNT(*) FROM yarn_issue_form WHERE total_issued_kg < 0 UNION ALL
SELECT 'negative_warp_length', COUNT(*) FROM warping_form WHERE actual_warp_length_mtr < 0 UNION ALL
SELECT 'negative_sizing_length', COUNT(*) FROM sizing_form WHERE actual_sizing_length_mtr < 0 UNION ALL
SELECT 'negative_loom_qty', COUNT(*) FROM loom_production_breakdown WHERE loom_production_quantity_yds < 0 UNION ALL
SELECT 'negative_folding_qty', COUNT(*) FROM folding_production_breakdown WHERE folding_production_qty_yds < 0 UNION ALL
SELECT 'negative_delivery_qty', COUNT(*) FROM greige_delivery_breakdown WHERE greige_delivery_qty_yds < 0 UNION ALL
SELECT 'yarn_receive_date_reversed', COUNT(*) FROM yarn_receive_form WHERE received_start_date IS NOT NULL AND last_received_date IS NOT NULL AND last_received_date < received_start_date UNION ALL
SELECT 'yarn_issue_date_before_receive', COUNT(*) FROM yarn_issue_form WHERE issue_date IS NOT NULL AND received_start_date IS NOT NULL AND issue_date < received_start_date UNION ALL
SELECT 'sizing_before_warping', COUNT(*) FROM sizing_form WHERE sizing_date IS NOT NULL AND warping_date IS NOT NULL AND sizing_date < warping_date UNION ALL
SELECT 'folding_before_loom_checkpoint', COUNT(*) FROM folding_production_breakdown WHERE folding_production_date IS NOT NULL AND loom_production_date IS NOT NULL AND folding_production_date < loom_production_date UNION ALL
SELECT 'delivery_before_folding_checkpoint', COUNT(*) FROM greige_delivery_breakdown WHERE greige_delivery_date IS NOT NULL AND greige_folding_date IS NOT NULL AND greige_delivery_date < greige_folding_date
ORDER BY test_name;
-- END 07_data_quality_and_date_checks.sql

-- ==================================================================
-- BEGIN 08_final_gate_summary.sql
-- ==================================================================
-- v3.2 compact final gate. Every mandatory result must be PASS.
-- Replace UNRESOLVED with exactly the approved values used by the importer.
SET @folding_source_unit := 'UNRESOLVED';
SET @delivery_source_unit := 'UNRESOLVED';
SET @folding_factor := CASE LOWER(@folding_source_unit) WHEN 'meters' THEN 1.0936133 WHEN 'yards' THEN 1.0 ELSE NULL END;
SET @delivery_factor := CASE LOWER(@delivery_source_unit) WHEN 'meters' THEN 1.0936133 WHEN 'yards' THEN 1.0 ELSE NULL END;
SET @tol := 0.02;

SELECT test_name, failure_count,
       CASE WHEN failure_count=0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM (
  SELECT 'database_name' AS test_name, IF(DATABASE()='weavonpq_weaving',0,1) AS failure_count
  UNION ALL SELECT 'approved_folding_unit', IF(@folding_factor IS NULL,1,0)
  UNION ALL SELECT 'approved_delivery_unit', IF(@delivery_factor IS NULL,1,0)
  UNION ALL SELECT 'required_tables_missing', 25-COUNT(*)
    FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_type='BASE TABLE'
      AND table_name IN ('pre_costing_data','PO_form_data','dispo_plan_form','dispo_form_data','warp_yarn_details','weft_yarn_details','warp_broken_section','warp_broken_pattern','yarn_receive_form','yarn_received_details','yarn_issue_form','yarn_issue_details','warping_form','warping_breakdown','sizing_form','sizing_breakdown','loom_production_form','loom_production_breakdown','folding_production_form','folding_production_breakdown','greige_delivery_form','greige_delivery_breakdown','import_manual_dispo_resolution','import_placeholder_dispo_audit','import_unmatched_dispo_audit')
  UNION ALL SELECT 'po_without_precosting', COUNT(*)
    FROM PO_form_data c LEFT JOIN pre_costing_data p ON p.pre_costing_no=c.pre_costing_no
    WHERE p.pre_costing_no IS NULL
  UNION ALL SELECT 'dispo_without_po', COUNT(*)
    FROM dispo_form_data c LEFT JOIN PO_form_data p ON p.po_no=c.po_no
    WHERE p.po_no IS NULL
  UNION ALL SELECT 'child_orphans',
    (SELECT COUNT(*) FROM warp_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL)+
    (SELECT COUNT(*) FROM weft_yarn_details c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL)+
    (SELECT COUNT(*) FROM warp_broken_section c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL)+
    (SELECT COUNT(*) FROM warp_broken_pattern c LEFT JOIN dispo_form_data p ON p.dispo_number=c.dispo_number WHERE p.dispo_number IS NULL)+
    (SELECT COUNT(*) FROM yarn_received_details c LEFT JOIN yarn_receive_form p ON p.id=c.yarn_receive_form_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM yarn_issue_details c LEFT JOIN yarn_issue_form p ON p.id=c.yarn_issue_form_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM warping_breakdown c LEFT JOIN warping_form p ON p.id=c.warping_form_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM sizing_breakdown c LEFT JOIN sizing_form p ON p.id=c.sizing_form_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM loom_production_breakdown c LEFT JOIN loom_production_form p ON p.id=c.loom_production_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM folding_production_breakdown c LEFT JOIN folding_production_form p ON p.id=c.folding_production_id WHERE p.id IS NULL)+
    (SELECT COUNT(*) FROM greige_delivery_breakdown c LEFT JOIN greige_delivery_form p ON p.id=c.greige_delivery_id WHERE p.id IS NULL)
  UNION ALL SELECT 'parent_natural_key_duplicates',
    (SELECT COUNT(*) FROM (SELECT pre_costing_no FROM pre_costing_data GROUP BY pre_costing_no HAVING COUNT(*)>1) q1)+
    (SELECT COUNT(*) FROM (SELECT po_no FROM PO_form_data GROUP BY po_no HAVING COUNT(*)>1) q2)+
    (SELECT COUNT(*) FROM (SELECT dispo_no FROM dispo_plan_form GROUP BY dispo_no HAVING COUNT(*)>1) q3)+
    (SELECT COUNT(*) FROM (SELECT dispo_number FROM dispo_form_data GROUP BY dispo_number HAVING COUNT(*)>1) q4)+
    (SELECT COUNT(*) FROM (SELECT yarn_count,yarn_brand,yarn_lot,received_start_date,received_against_dispo_nos,challan_no FROM yarn_receive_form GROUP BY yarn_count,yarn_brand,yarn_lot,received_start_date,received_against_dispo_nos,challan_no HAVING COUNT(*)>1) q5)+
    (SELECT COUNT(*) FROM (SELECT yarn_count,yarn_lot,issue_date,received_against_dispo_nos,issue_challan_no FROM yarn_issue_form GROUP BY yarn_count,yarn_lot,issue_date,received_against_dispo_nos,issue_challan_no HAVING COUNT(*)>1) q6)+
    (SELECT COUNT(*) FROM (SELECT dispo_number,warping_program_no,warping_date FROM warping_form GROUP BY dispo_number,warping_program_no,warping_date HAVING COUNT(*)>1) q7)+
    (SELECT COUNT(*) FROM (SELECT dispo_number,warping_program_no,sizing_date FROM sizing_form GROUP BY dispo_number,warping_program_no,sizing_date HAVING COUNT(*)>1) q8)+
    (SELECT COUNT(*) FROM (SELECT dispo_number,weaving_date FROM loom_production_form GROUP BY dispo_number,weaving_date HAVING COUNT(*)>1) q9)+
    (SELECT COUNT(*) FROM (SELECT dispo_number,folding_production_date FROM folding_production_form GROUP BY dispo_number,folding_production_date HAVING COUNT(*)>1) q10)+
    (SELECT COUNT(*) FROM (SELECT dispo_number,delivery_date,challan_no FROM greige_delivery_form GROUP BY dispo_number,delivery_date,challan_no HAVING COUNT(*)>1) q11)
  UNION ALL SELECT 'business_critical_lookup_fields_blank',
    (SELECT COUNT(*) FROM yarn_receive_form WHERE NULLIF(TRIM(received_against_po_no),'') IS NULL)+
    (SELECT COUNT(*) FROM yarn_issue_form WHERE NULLIF(TRIM(received_against_po_no),'') IS NULL)+
    (SELECT COUNT(*) FROM warping_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR dispo_quantity_yds IS NULL OR required_warp_length_meter IS NULL)+
    (SELECT COUNT(*) FROM sizing_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL)+
    (SELECT COUNT(*) FROM loom_production_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)+
    (SELECT COUNT(*) FROM folding_production_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)+
    (SELECT COUNT(*) FROM greige_delivery_form WHERE NULLIF(TRIM(po_number),'') IS NULL OR NULLIF(TRIM(buyer),'') IS NULL OR NULLIF(TRIM(production_construction),'') IS NULL OR NULLIF(TRIM(fabric_composition),'') IS NULL OR po_quantity_yds IS NULL OR dispo_quantity_yds IS NULL)
  UNION ALL SELECT 'downstream_dispo_not_canonical',
    (SELECT COUNT(*) FROM yarn_receive_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.received_against_dispo_nos)) WHERE BINARY x.received_against_dispo_nos<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM yarn_issue_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.received_against_dispo_nos)) WHERE BINARY x.received_against_dispo_nos<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM warping_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM sizing_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM loom_production_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM folding_production_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)+
    (SELECT COUNT(*) FROM greige_delivery_form x JOIN dispo_form_data d ON LOWER(TRIM(d.dispo_number))=LOWER(TRIM(x.dispo_number)) WHERE BINARY x.dispo_number<>BINARY d.dispo_number)
  UNION ALL SELECT 'yarn_issue_arithmetic', COUNT(*)
    FROM yarn_issue_form
    WHERE ABS(COALESCE(total_issued_kg,0)-(COALESCE(outside_issue_kg,0)+COALESCE(total_warp_issue_kgs,0)+COALESCE(total_weft_issue_kgs,0)))>0.01
       OR ABS(COALESCE(remaining_stock_kg,0)-(COALESCE(total_received_kg,0)-COALESCE(total_issued_kg,0)))>0.01
  UNION ALL SELECT 'yarn_received_lot_only_aggregation', COUNT(*)
    FROM yarn_issue_form yi
    LEFT JOIN (
      SELECT LOWER(TRIM(yrf.yarn_lot)) lot_key,SUM(COALESCE(rd.quantity_kgs,0)) expected_received_kg
      FROM yarn_receive_form yrf JOIN yarn_received_details rd ON rd.yarn_receive_form_id=yrf.id
      WHERE NULLIF(TRIM(yrf.yarn_lot),'') IS NOT NULL
      GROUP BY LOWER(TRIM(yrf.yarn_lot))
    ) r ON r.lot_key=LOWER(TRIM(yi.yarn_lot))
    WHERE ABS(COALESCE(yi.total_received_kg,0)-COALESCE(r.expected_received_kg,0))>0.01
  UNION ALL SELECT 'folding_balance_arithmetic', COUNT(*)
    FROM folding_production_breakdown
    WHERE ABS(COALESCE(folding_balance,0)-(COALESCE(loom_production_qty_yds,0)-COALESCE(folding_production_qty_yds,0)))>@tol
  UNION ALL SELECT 'delivery_balance_arithmetic', COUNT(*)
    FROM greige_delivery_breakdown
    WHERE ABS(COALESCE(delivery_balance,0)-(COALESCE(greige_folding_qty_yds,0)-COALESCE(greige_delivery_qty_yds,0)))>@tol
  UNION ALL SELECT 'folding_cumulative_formula', COUNT(*)
    FROM folding_production_breakdown b JOIN folding_production_form current_f ON current_f.id=b.folding_production_id
    WHERE @folding_factor IS NOT NULL
      AND ABS(COALESCE(b.folding_production_qty_yds,0)-COALESCE((
        SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
        FROM folding_production_form f
        WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(current_f.dispo_number))
          AND (f.folding_production_date<current_f.folding_production_date OR (f.folding_production_date=current_f.folding_production_date AND f.id<=current_f.id))
      ),0))>@tol
  UNION ALL SELECT 'delivery_cross_source_folding_formula', COUNT(*)
    FROM greige_delivery_breakdown b JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
    WHERE @folding_factor IS NOT NULL
      AND ABS(COALESCE(b.greige_folding_qty_yds,0)-COALESCE((
        SELECT SUM((COALESCE(f.a_grade_mtr,0)+COALESCE(f.b_grade_mtr,0)+COALESCE(f.c_grade_mtr,0)+COALESCE(f.reject_c_grade_mtr,0))*@folding_factor)
        FROM folding_production_form f
        WHERE LOWER(TRIM(f.dispo_number))=LOWER(TRIM(g.dispo_number)) AND f.folding_production_date<=g.delivery_date
      ),0))>@tol
  UNION ALL SELECT 'delivery_cumulative_formula', COUNT(*)
    FROM greige_delivery_breakdown b JOIN greige_delivery_form g ON g.id=b.greige_delivery_id
    WHERE @delivery_factor IS NOT NULL
      AND ABS(COALESCE(b.greige_delivery_qty_yds,0)-COALESCE((
        SELECT SUM((COALESCE(g2.delivery_quantity_a_grade,0)+COALESCE(g2.delivery_quantity_b_grade,0)+COALESCE(g2.delivery_quantity_c_grade,0)+COALESCE(g2.delivery_quantity_reject,0))*@delivery_factor)
        FROM greige_delivery_form g2
        WHERE LOWER(TRIM(g2.dispo_number))=LOWER(TRIM(g.dispo_number))
          AND (g2.delivery_date<g.delivery_date
               OR (g2.delivery_date=g.delivery_date AND (
                 /* v3.2.2 shared runtime/SQL challan order:
                    blank first; 1-65 digit values numeric; remaining approved ASCII
                    identifiers lowercase bytewise; target id mirrors source-row tie-break. */
                 (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
                   < (CASE WHEN TRIM(COALESCE(g.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
                 OR (
                   (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
                     = (CASE WHEN TRIM(COALESCE(g.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)
                   AND (
                     ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=1
                       AND CAST(TRIM(g2.challan_no) AS DECIMAL(65,0)) < CAST(TRIM(g.challan_no) AS DECIMAL(65,0)))
                     OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=2
                       AND BINARY LOWER(TRIM(g2.challan_no)) < BINARY LOWER(TRIM(g.challan_no)))
                     OR (
                       (
                         (CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=0
                         OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=1
                           AND CAST(TRIM(g2.challan_no) AS DECIMAL(65,0)) = CAST(TRIM(g.challan_no) AS DECIMAL(65,0)))
                         OR ((CASE WHEN TRIM(COALESCE(g2.challan_no,''))='' THEN 0 WHEN LOWER(TRIM(g2.challan_no)) REGEXP '^[0-9]{1,65}$' THEN 1 ELSE 2 END)=2
                           AND BINARY LOWER(TRIM(g2.challan_no)) = BINARY LOWER(TRIM(g.challan_no)))
                       )
                       AND g2.id<=g.id
                     )
                   )
                 )
               )))
      ),0))>@tol
  UNION ALL SELECT 'pending_unmatched_dispos', COUNT(*)
    FROM import_unmatched_dispo_audit WHERE status IN ('pending-review','historical-unmatched')
  UNION ALL SELECT 'ready_resolutions_not_applied', COUNT(*)
    FROM import_manual_dispo_resolution WHERE status='ready'
  UNION ALL SELECT 'synthetic_business_identifiers',
    (SELECT COUNT(*) FROM pre_costing_data WHERE UPPER(pre_costing_no) LIKE 'AUTO-%' OR UPPER(pre_costing_no) LIKE 'NO-%')+
    (SELECT COUNT(*) FROM PO_form_data WHERE UPPER(po_no) LIKE 'AUTO-%' OR UPPER(po_no) LIKE 'NO-%')+
    (SELECT COUNT(*) FROM dispo_form_data WHERE UPPER(dispo_number) LIKE 'AUTO-%' OR UPPER(dispo_number) LIKE 'NO-DISPO-%')+
    (SELECT COUNT(*) FROM yarn_receive_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%')+
    (SELECT COUNT(*) FROM greige_delivery_form WHERE UPPER(COALESCE(challan_no,'')) LIKE 'NO-CHALLAN-%')
) gates
ORDER BY test_name;

-- Evidence that each source module actually produced target rows.
-- A zero count is REVIEW and must reconcile to the approved source manifest.
SELECT 'pre_costing_data' table_name,COUNT(*) row_count FROM pre_costing_data UNION ALL
SELECT 'PO_form_data',COUNT(*) FROM PO_form_data UNION ALL
SELECT 'dispo_form_data',COUNT(*) FROM dispo_form_data UNION ALL
SELECT 'yarn_receive_form',COUNT(*) FROM yarn_receive_form UNION ALL
SELECT 'yarn_issue_form',COUNT(*) FROM yarn_issue_form UNION ALL
SELECT 'warping_form',COUNT(*) FROM warping_form UNION ALL
SELECT 'sizing_form',COUNT(*) FROM sizing_form UNION ALL
SELECT 'loom_production_form',COUNT(*) FROM loom_production_form UNION ALL
SELECT 'folding_production_form',COUNT(*) FROM folding_production_form UNION ALL
SELECT 'greige_delivery_form',COUNT(*) FROM greige_delivery_form;
-- END 08_final_gate_summary.sql
