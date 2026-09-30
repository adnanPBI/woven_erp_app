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
