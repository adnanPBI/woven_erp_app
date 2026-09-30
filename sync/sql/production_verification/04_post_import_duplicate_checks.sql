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
