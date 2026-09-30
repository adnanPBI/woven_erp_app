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
