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
