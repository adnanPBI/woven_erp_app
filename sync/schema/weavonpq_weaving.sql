-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Jul 06, 2026 at 08:03 AM
-- Server version: 11.4.12-MariaDB-cll-lve
-- PHP Version: 8.4.22

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `weavonpq_weaving`
--

-- --------------------------------------------------------

--
-- Table structure for table `dispo_form_data`
--

CREATE TABLE `dispo_form_data` (
  `dispo_number` varchar(50) NOT NULL,
  `po_no` varchar(50) NOT NULL,
  `po_issue_date` date DEFAULT NULL,
  `po_revise_date` date DEFAULT NULL,
  `po_approval_date` date DEFAULT NULL,
  `dispo_creating_date` date DEFAULT NULL,
  `order_no` varchar(50) DEFAULT NULL,
  `precosting_number` varchar(50) DEFAULT NULL,
  `pi_no` varchar(50) DEFAULT NULL,
  `account_holder` text DEFAULT NULL,
  `buyer_name` varchar(50) DEFAULT NULL,
  `buyer_color_reference` varchar(50) DEFAULT NULL,
  `order_status` text DEFAULT NULL,
  `buyer_style_ref` varchar(50) DEFAULT NULL,
  `development_id` varchar(50) DEFAULT NULL,
  `handloom_number` varchar(50) DEFAULT NULL,
  `print_method` text DEFAULT NULL,
  `process_type` text DEFAULT NULL,
  `fabric_type` text DEFAULT NULL,
  `yarn_type` varchar(50) DEFAULT NULL,
  `order_type` text DEFAULT NULL,
  `pp_delivery_date` date DEFAULT NULL,
  `bulk_delivery_date` date DEFAULT NULL,
  `garments_name` text DEFAULT NULL,
  `end_use` text DEFAULT NULL,
  `wash_type` text DEFAULT NULL,
  `light_source` text DEFAULT NULL,
  `weave_type` varchar(50) DEFAULT NULL,
  `sticker_construction` varchar(50) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `sticker_composition` text DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `reed_count` int(11) DEFAULT NULL,
  `ends_per_dent` int(11) DEFAULT NULL,
  `warp_count_1` int(11) DEFAULT NULL,
  `warp_ply_1` int(11) DEFAULT NULL,
  `warp_count_2` int(11) DEFAULT NULL,
  `warp_ply_2` int(11) DEFAULT NULL,
  `warp_count_3` int(11) DEFAULT NULL,
  `warp_ply_3` int(11) DEFAULT NULL,
  `weft_count_1` int(11) DEFAULT NULL,
  `weft_ply_1` int(11) DEFAULT NULL,
  `weft_count_2` int(11) DEFAULT NULL,
  `weft_ply_2` int(11) DEFAULT NULL,
  `weft_count_3` int(11) DEFAULT NULL,
  `weft_ply_3` int(11) DEFAULT NULL,
  `finish_epi` int(11) DEFAULT NULL,
  `finish_ppi` int(11) DEFAULT NULL,
  `calculation_width` varchar(15) DEFAULT NULL,
  `dispo_overall_width` varchar(15) DEFAULT NULL,
  `dispo_cuttable_width` varchar(15) DEFAULT NULL,
  `finish_type` text DEFAULT NULL,
  `selvedge_width` int(11) DEFAULT NULL,
  `selvedge_ends_per_dent` int(11) DEFAULT NULL,
  `body_ends` int(11) DEFAULT NULL,
  `po_qty_yds` varchar(10) DEFAULT NULL,
  `finish_qty_yds` varchar(10) DEFAULT NULL,
  `adjust_qty_yds` varchar(10) DEFAULT NULL,
  `warp_yd_allowance` decimal(10,2) DEFAULT NULL,
  `weft_yd_allowance` decimal(10,2) DEFAULT NULL,
  `finishing_process_loss` decimal(10,2) DEFAULT NULL,
  `print_allowance` decimal(10,2) DEFAULT NULL,
  `loom_contraction` decimal(10,2) DEFAULT NULL,
  `weft_contraction` decimal(10,2) DEFAULT NULL,
  `lower_beam_crimp` decimal(10,2) DEFAULT NULL,
  `reduce_pick` decimal(10,2) DEFAULT NULL,
  `pick_length_inch` decimal(10,2) DEFAULT NULL,
  `creel_repeat` int(11) DEFAULT NULL,
  `extra_cone_length` int(11) DEFAULT NULL,
  `beam_yarn_per_repeat` int(11) DEFAULT NULL,
  `grey_epi` decimal(10,2) DEFAULT NULL,
  `grey_ppi` decimal(10,2) DEFAULT NULL,
  `beam_total_ends` int(11) DEFAULT NULL,
  `actual_section` decimal(10,2) DEFAULT NULL,
  `calculated_section` decimal(10,2) DEFAULT NULL,
  `finish_length_mtr` decimal(10,2) DEFAULT NULL,
  `print_qty_mtr` decimal(10,2) DEFAULT NULL,
  `grey_qty_mtr` decimal(10,2) DEFAULT NULL,
  `loom_production_mtr` decimal(10,2) DEFAULT NULL,
  `warp_beam_length` decimal(10,2) DEFAULT NULL,
  `reed_space_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `warp_consumption_yds` decimal(10,4) DEFAULT NULL,
  `weft_consumption_yds` decimal(10,4) DEFAULT NULL,
  `total_consumption_yds` decimal(10,4) DEFAULT NULL,
  `warp_cover_factor` decimal(10,2) DEFAULT NULL,
  `weft_cover_factor` decimal(10,2) DEFAULT NULL,
  `total_cover_factor` decimal(10,2) DEFAULT NULL,
  `calculated_gsm_regular` decimal(10,2) DEFAULT NULL,
  `calculated_gsm_lycra` decimal(10,2) DEFAULT NULL,
  `left_selvedge_ends` int(11) DEFAULT NULL,
  `right_selvedge_ends` int(11) DEFAULT NULL,
  `selvedge_dents_per_side` int(11) DEFAULT NULL,
  `left_selvedge_spec` varchar(50) DEFAULT NULL,
  `right_selvedge_spec` varchar(50) DEFAULT NULL,
  `dispo_qty_finish_mtr` decimal(10,2) DEFAULT NULL,
  `pc_regular_price_usd` decimal(10,2) DEFAULT NULL,
  `pc_upcharge_price_usd` decimal(10,2) DEFAULT NULL,
  `pc_total_consumption` decimal(10,2) DEFAULT NULL,
  `pc_raw_yarn_cost_usd` decimal(10,2) DEFAULT NULL,
  `pc_pick_rate_usd` decimal(10,2) DEFAULT NULL,
  `total_greige_yarn_cost_usd` decimal(10,2) DEFAULT NULL,
  `weaving_cost_usd` decimal(10,2) DEFAULT NULL,
  `material_overhead_cost_usd` decimal(10,2) DEFAULT NULL,
  `material_overhead_cost_percent` decimal(10,2) DEFAULT NULL,
  `bulk_revised_no` varchar(50) DEFAULT NULL,
  `bulk_revised_reason` text DEFAULT NULL,
  `reproduction_revised_no` varchar(50) DEFAULT NULL,
  `reproduction_revised_reason` text DEFAULT NULL,
  `document_scan_copy` varchar(500) DEFAULT NULL,
  `warp_tear_strength` varchar(10) DEFAULT NULL,
  `weft_tear_strength` varchar(10) DEFAULT NULL,
  `warp_tensile_strength` varchar(10) DEFAULT NULL,
  `weft_tensile_strength` varchar(10) DEFAULT NULL,
  `pilling_grade` varchar(10) DEFAULT NULL,
  `rubbing_grade` varchar(10) DEFAULT NULL,
  `elongation` varchar(10) DEFAULT NULL,
  `growth` varchar(10) DEFAULT NULL,
  `recovery` varchar(10) DEFAULT NULL,
  `buyer_gsm_bw` varchar(10) DEFAULT NULL,
  `buyer_gsm_aw` varchar(10) DEFAULT NULL,
  `warp_shrinkage` varchar(10) DEFAULT NULL,
  `weft_shrinkage` varchar(10) DEFAULT NULL,
  `quality_parameter` varchar(50) DEFAULT NULL,
  `additional_remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dispo_plan_form`
--

CREATE TABLE `dispo_plan_form` (
  `id` int(11) NOT NULL,
  `po_issue_date` date DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `pp_sample_delivery_date` date DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `po_revised_date` date DEFAULT NULL,
  `final_loom_production_date` date DEFAULT NULL,
  `loom_start_date` date DEFAULT NULL,
  `bulk_revised_no` varchar(50) DEFAULT NULL,
  `bulk_revised_reason` varchar(100) DEFAULT NULL,
  `reproduction_revised_no` varchar(50) DEFAULT NULL,
  `reproduction_revised_reason` varchar(100) DEFAULT NULL,
  `po_no` varchar(50) DEFAULT NULL,
  `pi_unit_lc_unit` varchar(100) DEFAULT NULL,
  `order_no` varchar(50) DEFAULT NULL,
  `account_holder` varchar(100) DEFAULT NULL,
  `buyer` varchar(100) DEFAULT NULL,
  `garments_name` varchar(100) DEFAULT NULL,
  `customer_ref_stl` varchar(100) DEFAULT NULL,
  `buyer_color_reference` varchar(100) DEFAULT NULL,
  `weave` varchar(100) DEFAULT NULL,
  `finish_type` varchar(100) DEFAULT NULL,
  `marketing_reff_tracking_no` varchar(100) DEFAULT NULL,
  `desk_loom_strike_off_no` varchar(100) DEFAULT NULL,
  `end_use` varchar(100) DEFAULT NULL,
  `order_type` varchar(50) DEFAULT NULL,
  `yarn_type` varchar(100) DEFAULT NULL,
  `fabric_type` varchar(100) DEFAULT NULL,
  `process_type` varchar(100) DEFAULT NULL,
  `print_method` varchar(100) DEFAULT NULL,
  `dispo_no` varchar(50) DEFAULT NULL,
  `sticker_construction` varchar(100) DEFAULT NULL,
  `production_construction` varchar(100) DEFAULT NULL,
  `sticker_composition` varchar(100) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `loom_construction` varchar(100) DEFAULT NULL,
  `loom_contraction` decimal(10,2) DEFAULT NULL,
  `finish_epi` decimal(10,2) DEFAULT NULL,
  `finish_ppi` decimal(10,2) DEFAULT NULL,
  `grey_epi` decimal(10,2) DEFAULT NULL,
  `grey_ppi` decimal(10,2) DEFAULT NULL,
  `po_quantity_yds` decimal(15,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(15,2) DEFAULT NULL,
  `adjust_quantity_yds` decimal(15,2) DEFAULT NULL,
  `finishing_process_loss` decimal(10,2) DEFAULT NULL,
  `printing_allowance` decimal(10,2) DEFAULT NULL,
  `lower_beam_crimp` decimal(10,2) DEFAULT NULL,
  `left_selvedge_specification` varchar(100) DEFAULT NULL,
  `right_selvedge_specification` varchar(100) DEFAULT NULL,
  `selvedge_width` decimal(10,2) DEFAULT NULL,
  `selvedge_ends_per_dent` int(11) DEFAULT NULL,
  `total_ends_of_body` int(11) DEFAULT NULL,
  `required_print_production_meter` decimal(15,2) DEFAULT NULL,
  `required_greige_production_meter` decimal(15,2) DEFAULT NULL,
  `required_loom_production_meter` decimal(15,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(15,2) DEFAULT NULL,
  `finish_width_inch` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `no_of_section_in_lower_beam` int(11) DEFAULT NULL,
  `creel_repeat_of_lower_beam` int(11) DEFAULT NULL,
  `reed_count` varchar(50) DEFAULT NULL,
  `ends_per_dent` decimal(10,2) DEFAULT NULL,
  `reed_width_inch` decimal(10,2) DEFAULT NULL,
  `flange_to_flange` decimal(10,2) DEFAULT NULL,
  `warp_cover_factor` decimal(10,2) DEFAULT NULL,
  `weft_cover_factor` decimal(10,2) DEFAULT NULL,
  `total_cover_factor` decimal(10,2) DEFAULT NULL,
  `warp_yarn_dyeing_allowance` decimal(10,2) DEFAULT NULL,
  `weft_yarn_dyeing_allowance` decimal(10,2) DEFAULT NULL,
  `warp_consumption` decimal(15,4) DEFAULT NULL,
  `weft_consumption` decimal(15,4) DEFAULT NULL,
  `total_consumption` decimal(15,4) DEFAULT NULL,
  `rpm` int(11) DEFAULT NULL,
  `eff` decimal(10,2) DEFAULT NULL,
  `yarn_dyeing_lead_time` int(11) DEFAULT NULL,
  `dyed_yarn_advance_days_for_inhouse` int(11) DEFAULT NULL,
  `total_greige_lot` int(11) DEFAULT NULL,
  `finishing_lead_time` int(11) DEFAULT NULL,
  `start_up_days` int(11) DEFAULT NULL,
  `per_day_run_loom_in_startup` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dyed_yarn_breakdown`
--

CREATE TABLE `dyed_yarn_breakdown` (
  `id` int(11) UNSIGNED NOT NULL,
  `dyed_yarn_id` int(11) UNSIGNED NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `dyed_yarn_received_date` date DEFAULT NULL,
  `dyed_yarn_received_color` varchar(100) DEFAULT NULL,
  `dyed_yarn_received_qty` decimal(12,2) DEFAULT NULL COMMENT 'In kilograms',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Breakdown details of dyed yarn received by date and color';

-- --------------------------------------------------------

--
-- Table structure for table `dyed_yarn_issue`
--

CREATE TABLE `dyed_yarn_issue` (
  `id` int(11) NOT NULL,
  `yarn_count` varchar(50) DEFAULT NULL,
  `number_of_ply` varchar(20) DEFAULT NULL,
  `buyer` varchar(50) DEFAULT NULL,
  `received_against_po_no` varchar(50) DEFAULT NULL,
  `received_against_dispo_no` varchar(50) DEFAULT NULL,
  `yarn_shade_category` varchar(50) DEFAULT NULL,
  `batch_no` varchar(50) DEFAULT NULL,
  `challan_no` varchar(50) DEFAULT NULL,
  `total_dyed_warp_yarn_issue` decimal(10,2) DEFAULT 0.00,
  `total_dyed_weft_yarn_issue` decimal(10,2) DEFAULT 0.00,
  `remarks` text DEFAULT NULL,
  `dyed_warp_yarn_price` decimal(10,2) DEFAULT 0.00,
  `dyed_weft_yarn_price` decimal(10,2) DEFAULT 0.00,
  `greige_yarn_price` decimal(10,2) DEFAULT 0.00,
  `yarn_dyeing_price` decimal(10,2) DEFAULT 0.00,
  `dollar_rate` decimal(10,2) DEFAULT 120.00,
  `total_dyed_yarn_price` decimal(10,2) DEFAULT 0.00,
  `total_issue_quantity` decimal(10,2) DEFAULT 0.00,
  `remaining_issue_yarn_quantity` decimal(10,2) DEFAULT 0.00,
  `issue_date` date DEFAULT NULL,
  `issue_factory` varchar(50) DEFAULT NULL,
  `issue_type` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dyed_yarn_issue_breakdown`
--

CREATE TABLE `dyed_yarn_issue_breakdown` (
  `id` int(11) NOT NULL,
  `dyed_yarn_issue_id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `dyed_yarn_received_date` date DEFAULT NULL,
  `dyed_yarn_received_color` varchar(50) DEFAULT NULL,
  `dyed_yarn_received_qty` decimal(10,2) DEFAULT 0.00,
  `dyed_yarn_issue_date` date DEFAULT NULL,
  `dyed_yarn_issue_color` varchar(50) DEFAULT NULL,
  `dyed_yarn_issue_qty` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `dyed_yarn_receive`
--

CREATE TABLE `dyed_yarn_receive` (
  `id` int(11) UNSIGNED NOT NULL,
  `dyed_yarn_received_date` date DEFAULT NULL,
  `received_against_po_no` varchar(100) DEFAULT NULL,
  `received_against_dispo_no` varchar(100) DEFAULT NULL,
  `buyer` varchar(200) DEFAULT NULL,
  `batch_no` varchar(100) DEFAULT NULL,
  `yarn_count` varchar(50) DEFAULT NULL,
  `number_of_ply` varchar(50) DEFAULT NULL,
  `yarn_shade_category` varchar(100) DEFAULT NULL,
  `challan_no` varchar(100) DEFAULT NULL,
  `dyed_yarn_received_for_warp` decimal(12,2) DEFAULT NULL COMMENT 'In kilograms',
  `dyed_yarn_received_for_weft` decimal(12,2) DEFAULT NULL COMMENT 'In kilograms',
  `yarn_dyeing_price` decimal(12,2) DEFAULT NULL COMMENT 'Per kg in Taka',
  `greige_yarn_price` decimal(12,2) DEFAULT NULL COMMENT 'Per kg in USD',
  `dollar_rate` decimal(10,2) DEFAULT NULL COMMENT 'Dollar to Taka conversion rate',
  `total_dyed_yarn_price` decimal(12,2) DEFAULT NULL COMMENT 'Per kg in Taka',
  `special_notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Main table for dyed yarn receive records';

-- --------------------------------------------------------

--
-- Table structure for table `finish_delivery_breakdown`
--

CREATE TABLE `finish_delivery_breakdown` (
  `id` int(10) UNSIGNED NOT NULL,
  `finish_delivery_id` int(10) UNSIGNED NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `finish_receive_date` date DEFAULT NULL,
  `finish_receive_qty_yds` decimal(10,2) DEFAULT NULL,
  `finish_delivery_date` date DEFAULT NULL,
  `finish_delivery_qty_yds` decimal(10,2) DEFAULT NULL,
  `finish_stock` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `finish_delivery_form`
--

CREATE TABLE `finish_delivery_form` (
  `id` int(10) UNSIGNED NOT NULL,
  `finish_delivery_date` date DEFAULT NULL,
  `challan_no` varchar(100) DEFAULT NULL,
  `total_no_of_than_roll` int(11) DEFAULT NULL,
  `dispo_number` varchar(100) DEFAULT NULL,
  `buyer` varchar(200) DEFAULT NULL,
  `customer_ref_stl` varchar(200) DEFAULT NULL,
  `weave` varchar(200) DEFAULT NULL,
  `production_construction` varchar(200) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `special_note` text DEFAULT NULL,
  `delivered_finish_qty_fresh_yds` decimal(10,2) DEFAULT NULL,
  `delivered_finish_qty_reject_yds` decimal(10,2) DEFAULT NULL,
  `delivered_fresh_finish_price_per_yds` decimal(10,2) DEFAULT NULL,
  `delivered_reject_finish_price_per_yds` decimal(10,2) DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `po_number` varchar(100) DEFAULT NULL,
  `account_holder` varchar(200) DEFAULT NULL,
  `buyer_dispo` varchar(200) DEFAULT NULL,
  `customer_ref_stl_dispo` varchar(200) DEFAULT NULL,
  `weave_dispo` varchar(200) DEFAULT NULL,
  `finish_type` varchar(200) DEFAULT NULL,
  `end_use` varchar(200) DEFAULT NULL,
  `order_type` varchar(200) DEFAULT NULL,
  `yarn_type` varchar(200) DEFAULT NULL,
  `process_type` varchar(200) DEFAULT NULL,
  `production_construction_dispo` varchar(200) DEFAULT NULL,
  `fabric_composition_dispo` text DEFAULT NULL,
  `po_quantity_yds` decimal(10,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `required_print_production_meter` decimal(10,2) DEFAULT NULL,
  `required_greige_production_meter` decimal(10,2) DEFAULT NULL,
  `required_loom_production_meter` decimal(10,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `reed_count` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `finish_receive_breakdown`
--

CREATE TABLE `finish_receive_breakdown` (
  `id` int(10) UNSIGNED NOT NULL,
  `finish_receive_id` int(10) UNSIGNED NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `greige_delivery_date` date DEFAULT NULL,
  `greige_delivery_qty` decimal(10,2) DEFAULT NULL,
  `finish_receive_date` date DEFAULT NULL,
  `finish_receive_qty_yds` decimal(10,2) DEFAULT NULL,
  `receive_balance` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `finish_receive_form`
--

CREATE TABLE `finish_receive_form` (
  `id` int(10) UNSIGNED NOT NULL,
  `finish_receive_date` date DEFAULT NULL,
  `challan_no` varchar(100) DEFAULT NULL,
  `total_no_of_than_roll` int(11) DEFAULT NULL,
  `dispo_number` varchar(100) DEFAULT NULL,
  `buyer` varchar(200) DEFAULT NULL,
  `customer_ref_stl` varchar(200) DEFAULT NULL,
  `weave` varchar(200) DEFAULT NULL,
  `production_construction` varchar(200) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `finish_fabric_price_per_yds` decimal(10,2) DEFAULT NULL,
  `receive_qty_a_grade` decimal(10,2) DEFAULT NULL,
  `receive_qty_b_grade` decimal(10,2) DEFAULT NULL,
  `receive_qty_c_grade` decimal(10,2) DEFAULT NULL,
  `receive_qty_reject` decimal(10,2) DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `po_number` varchar(100) DEFAULT NULL,
  `account_holder` varchar(200) DEFAULT NULL,
  `buyer_dispo` varchar(200) DEFAULT NULL,
  `customer_ref_stl_dispo` varchar(200) DEFAULT NULL,
  `weave_dispo` varchar(200) DEFAULT NULL,
  `finish_type` varchar(200) DEFAULT NULL,
  `end_use` varchar(200) DEFAULT NULL,
  `order_type` varchar(200) DEFAULT NULL,
  `yarn_type` varchar(200) DEFAULT NULL,
  `process_type` varchar(200) DEFAULT NULL,
  `production_construction_dispo` varchar(200) DEFAULT NULL,
  `fabric_composition_dispo` text DEFAULT NULL,
  `po_quantity_yds` decimal(10,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `required_print_production_meter` decimal(10,2) DEFAULT NULL,
  `required_greige_production_meter` decimal(10,2) DEFAULT NULL,
  `required_loom_production_meter` decimal(10,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `reed_count` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `floor_position`
--

CREATE TABLE `floor_position` (
  `id` int(11) NOT NULL,
  `loom_no` varchar(50) DEFAULT NULL,
  `beam_no` varchar(50) DEFAULT NULL,
  `type_of_loom` varchar(50) DEFAULT NULL,
  `color_capacity` int(11) DEFAULT NULL,
  `no_of_color_in_warp` int(11) DEFAULT NULL,
  `no_of_count_in_weft` int(11) DEFAULT NULL,
  `beam_length_in_yds` decimal(10,2) DEFAULT NULL,
  `weaving_beam_set_no` varchar(50) DEFAULT NULL,
  `beam_finish_time` time DEFAULT NULL,
  `beam_start_date` date DEFAULT NULL,
  `beam_start_time` time DEFAULT NULL,
  `total_down_time` varchar(50) DEFAULT NULL,
  `fill_length` decimal(10,2) DEFAULT NULL,
  `weft_count` varchar(50) DEFAULT NULL,
  `machine_rpm` int(11) DEFAULT NULL,
  `loom_status` varchar(50) DEFAULT NULL,
  `buyer` varchar(100) DEFAULT NULL,
  `po_no` varchar(100) DEFAULT NULL,
  `dispo_no` varchar(100) DEFAULT NULL,
  `construction` varchar(100) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `finished_width` decimal(10,2) DEFAULT NULL,
  `blend` varchar(100) DEFAULT NULL,
  `weave` varchar(100) DEFAULT NULL,
  `reed_count` varchar(50) DEFAULT NULL,
  `crimp_percent` decimal(5,2) DEFAULT NULL,
  `greige_pick` decimal(10,2) DEFAULT NULL,
  `customer_ref_stl` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `folding_production_breakdown`
--

CREATE TABLE `folding_production_breakdown` (
  `id` int(10) UNSIGNED NOT NULL,
  `folding_production_id` int(10) UNSIGNED NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `loom_production_date` date DEFAULT NULL,
  `loom_production_qty_yds` decimal(10,2) DEFAULT NULL,
  `folding_production_date` date DEFAULT NULL,
  `folding_production_qty_yds` decimal(10,2) DEFAULT NULL,
  `folding_balance` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `folding_production_form`
--

CREATE TABLE `folding_production_form` (
  `id` int(10) UNSIGNED NOT NULL,
  `folding_production_date` date DEFAULT NULL,
  `dispo_number` varchar(100) DEFAULT NULL,
  `buyer` varchar(200) DEFAULT NULL,
  `production_construction` varchar(200) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `a_grade_mtr` decimal(10,2) DEFAULT NULL,
  `b_grade_mtr` decimal(10,2) DEFAULT NULL,
  `c_grade_mtr` decimal(10,2) DEFAULT NULL,
  `reject_c_grade_mtr` decimal(10,2) DEFAULT NULL,
  `greige_fabric_price_per_yds` decimal(10,2) DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `po_number` varchar(100) DEFAULT NULL,
  `account_holder` varchar(200) DEFAULT NULL,
  `buyer_dispo` varchar(200) DEFAULT NULL,
  `customer_ref_stl` varchar(200) DEFAULT NULL,
  `weave` varchar(200) DEFAULT NULL,
  `finish_type` varchar(200) DEFAULT NULL,
  `end_use` varchar(200) DEFAULT NULL,
  `order_type` varchar(200) DEFAULT NULL,
  `yarn_type` varchar(200) DEFAULT NULL,
  `process_type` varchar(200) DEFAULT NULL,
  `production_construction_dispo` varchar(200) DEFAULT NULL,
  `fabric_composition_dispo` text DEFAULT NULL,
  `po_quantity_yds` decimal(10,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `required_print_production_meter` decimal(10,2) DEFAULT NULL,
  `required_greige_production_meter` decimal(10,2) DEFAULT NULL,
  `required_loom_production_meter` decimal(10,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `reed_count` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `greige_delivery_breakdown`
--

CREATE TABLE `greige_delivery_breakdown` (
  `id` int(10) UNSIGNED NOT NULL,
  `greige_delivery_id` int(10) UNSIGNED NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `greige_folding_date` date DEFAULT NULL,
  `greige_folding_qty_yds` decimal(10,2) DEFAULT NULL,
  `greige_delivery_date` date DEFAULT NULL,
  `greige_delivery_qty_yds` decimal(10,2) DEFAULT NULL,
  `delivery_balance` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `greige_delivery_form`
--

CREATE TABLE `greige_delivery_form` (
  `id` int(10) UNSIGNED NOT NULL,
  `delivery_date` date DEFAULT NULL,
  `challan_no` varchar(30) DEFAULT NULL,
  `total_no_of_than_roll` int(11) DEFAULT NULL,
  `po_number` varchar(50) DEFAULT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `buyer` varchar(50) DEFAULT NULL,
  `customer_ref` varchar(30) DEFAULT NULL,
  `weave` varchar(30) DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `account_holder` varchar(30) DEFAULT NULL,
  `buyer_dispo` varchar(50) DEFAULT NULL,
  `customer_ref_stl` varchar(30) DEFAULT NULL,
  `weave_dispo` varchar(30) DEFAULT NULL,
  `finish_type` varchar(30) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `greige_fabric_price_per_yds` decimal(10,2) DEFAULT NULL,
  `delivery_quantity_a_grade` decimal(10,2) DEFAULT NULL,
  `delivery_quantity_b_grade` decimal(10,2) DEFAULT NULL,
  `delivery_quantity_c_grade` decimal(10,2) DEFAULT NULL,
  `delivery_quantity_reject` decimal(10,2) DEFAULT NULL,
  `special_note` text DEFAULT NULL,
  `end_use` varchar(20) DEFAULT NULL,
  `order_type` varchar(20) DEFAULT NULL,
  `yarn_type` varchar(30) DEFAULT NULL,
  `process_type` varchar(30) DEFAULT NULL,
  `production_construction_dispo` varchar(50) DEFAULT NULL,
  `fabric_composition_dispo` text DEFAULT NULL,
  `po_quantity_yds` decimal(10,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `required_print_production_meter` decimal(10,2) DEFAULT NULL,
  `required_greige_production_meter` decimal(10,2) DEFAULT NULL,
  `required_loom_production_meter` decimal(10,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `total_ends` int(11) DEFAULT NULL,
  `reed_count` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `import_manual_dispo_resolution`
--

CREATE TABLE `import_manual_dispo_resolution` (
  `id` int(11) NOT NULL,
  `source_module` varchar(50) NOT NULL,
  `source_dispo_number` varchar(150) NOT NULL,
  `resolved_dispo_number` varchar(150) DEFAULT NULL,
  `resolved_po_no` varchar(150) DEFAULT NULL,
  `resolved_pre_costing_no` varchar(150) DEFAULT NULL,
  `action_mode` enum('audit_only','relink_to_existing_master','create_approved_placeholder') NOT NULL DEFAULT 'audit_only',
  `status` enum('pending','ready','applied','rejected') NOT NULL DEFAULT 'pending',
  `notes` text DEFAULT NULL,
  `created_by` varchar(100) DEFAULT NULL,
  `approved_by` varchar(100) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `applied_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `import_placeholder_dispo_audit`
--

CREATE TABLE `import_placeholder_dispo_audit` (
  `dispo_number` varchar(50) NOT NULL,
  `placeholder_pre_costing_no` varchar(50) NOT NULL,
  `placeholder_po_no` varchar(50) NOT NULL,
  `source_modules` varchar(100) DEFAULT NULL,
  `source_rows` int(11) DEFAULT 0,
  `sample_buyer` varchar(100) DEFAULT NULL,
  `sample_construction` varchar(100) DEFAULT NULL,
  `sample_composition` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `import_unmatched_dispo_audit`
--

CREATE TABLE `import_unmatched_dispo_audit` (
  `source_module` varchar(50) NOT NULL,
  `source_table` varchar(100) NOT NULL,
  `source_dispo_number` varchar(150) NOT NULL,
  `source_rows` int(11) NOT NULL DEFAULT 0,
  `sample_buyer` varchar(150) DEFAULT NULL,
  `sample_construction` varchar(150) DEFAULT NULL,
  `sample_composition` text DEFAULT NULL,
  `master_dispo_found` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(50) NOT NULL DEFAULT 'historical-unmatched',
  `note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `loom_production_breakdown`
--

CREATE TABLE `loom_production_breakdown` (
  `id` int(11) NOT NULL,
  `loom_production_id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `loom_production_date` date DEFAULT NULL,
  `run_loom` int(11) DEFAULT 0,
  `loom_production_quantity_yds` decimal(15,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `loom_production_form`
--

CREATE TABLE `loom_production_form` (
  `id` int(11) NOT NULL,
  `weaving_date` date DEFAULT NULL,
  `loom_no` varchar(50) DEFAULT NULL,
  `loom_rpm` decimal(10,2) DEFAULT NULL,
  `buyer` varchar(50) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `po_number` varchar(30) DEFAULT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `account_holder` varchar(30) DEFAULT NULL,
  `bulk_fabric_delivery_date` date DEFAULT NULL,
  `customer_ref` varchar(50) DEFAULT NULL,
  `weave` varchar(30) DEFAULT NULL,
  `total_beam` int(8) DEFAULT NULL,
  `finish_type` varchar(50) DEFAULT NULL,
  `yarn_type` varchar(30) DEFAULT NULL,
  `po_issue_date` date DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `marketing_ref_tracking_no` varchar(50) DEFAULT NULL,
  `end_use` varchar(50) DEFAULT NULL,
  `order_type` varchar(50) DEFAULT NULL,
  `process_type` varchar(50) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `po_quantity_yds` decimal(10,2) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `lower_beam_crimp` decimal(10,2) DEFAULT NULL,
  `required_print_production_mtr` decimal(10,2) DEFAULT NULL,
  `required_greige_production_mtr` decimal(10,2) DEFAULT NULL,
  `required_loom_production_mtr` decimal(10,2) DEFAULT NULL,
  `required_warp_length_mtr` decimal(10,2) DEFAULT NULL,
  `cuttable_width_inch` decimal(10,2) DEFAULT NULL,
  `grey_width_inch` decimal(10,2) DEFAULT NULL,
  `beam_total_ends` int(11) DEFAULT NULL,
  `reed_count` int(11) DEFAULT NULL,
  `weaving_beam_set_no` varchar(50) DEFAULT NULL,
  `in_house_production_day` varchar(50) DEFAULT NULL,
  `outside_production_day` decimal(10,2) DEFAULT NULL,
  `beam_start_date` date DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `order_closing_reports`
--

CREATE TABLE `order_closing_reports` (
  `id` int(11) NOT NULL,
  `po_no` varchar(100) DEFAULT NULL,
  `buyer` varchar(255) DEFAULT NULL,
  `customer_ref` varchar(255) DEFAULT NULL,
  `weave` varchar(255) DEFAULT NULL,
  `order_type` enum('bulk','sample') DEFAULT NULL,
  `beneficiary_factory` varchar(255) DEFAULT NULL,
  `fabric_type` varchar(255) DEFAULT NULL,
  `po_issue_date` date DEFAULT NULL,
  `warp_consumption` decimal(10,2) DEFAULT 0.00,
  `fabric_price_per_yd` decimal(10,2) DEFAULT 0.00,
  `bulk_delivery_date` date DEFAULT NULL,
  `production_construction` varchar(255) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `po_quantity` decimal(10,2) DEFAULT 0.00,
  `dispo_quantity` decimal(10,2) DEFAULT 0.00,
  `adjust_quantity` decimal(10,2) DEFAULT 0.00,
  `finishing_loss` decimal(10,2) DEFAULT 0.00,
  `printing_allowance` decimal(10,2) DEFAULT 0.00,
  `weft_consumption` decimal(10,2) DEFAULT 0.00,
  `yarn_cost_per_yd` decimal(10,2) DEFAULT 0.00,
  `order_no` varchar(100) DEFAULT NULL,
  `account_holder` varchar(255) DEFAULT NULL,
  `loom_contraction` varchar(50) DEFAULT '0.00%',
  `beam_crimp` decimal(10,2) DEFAULT 0.00,
  `finish_width` decimal(10,2) DEFAULT 0.00,
  `grey_width` decimal(10,2) DEFAULT 0.00,
  `total_ends` int(11) DEFAULT 0,
  `document_upload` varchar(500) DEFAULT NULL,
  `total_consumption` decimal(10,2) DEFAULT 0.00,
  `material_cost` varchar(50) DEFAULT '0.00%',
  `required_warp_yarn` decimal(10,2) DEFAULT 0.00,
  `total_yarn_issue_warp` decimal(10,2) DEFAULT 0.00,
  `balance_warp` decimal(10,2) DEFAULT 0.00,
  `required_warp_length` decimal(10,2) DEFAULT 0.00,
  `prod_warp_length` decimal(10,2) DEFAULT 0.00,
  `balance_warp_length` decimal(10,2) DEFAULT 0.00,
  `completion_warp` decimal(10,2) DEFAULT 0.00,
  `dispo_warp` decimal(10,2) DEFAULT 0.00,
  `prod_yds_1` decimal(10,2) DEFAULT 0.00,
  `required_weft_yarn` decimal(10,2) DEFAULT 0.00,
  `total_yarn_issue_weft` decimal(10,2) DEFAULT 0.00,
  `balance_weft` decimal(10,2) DEFAULT 0.00,
  `required_sizing_length` decimal(10,2) DEFAULT 0.00,
  `prod_sizing_length` decimal(10,2) DEFAULT 0.00,
  `balance_sizing_length` decimal(10,2) DEFAULT 0.00,
  `completion_sizing` decimal(10,2) DEFAULT 0.00,
  `dispo_sizing` decimal(10,2) DEFAULT 0.00,
  `prod_yds_2` decimal(10,2) DEFAULT 0.00,
  `actual_crimp` varchar(50) DEFAULT '0.00%',
  `prod_floor_return` decimal(10,2) DEFAULT 0.00,
  `required_loom_production` decimal(10,2) DEFAULT 0.00,
  `prod_loom_production` decimal(10,2) DEFAULT 0.00,
  `balance_loom_production` decimal(10,2) DEFAULT 0.00,
  `completion_loom` decimal(10,2) DEFAULT 0.00,
  `dispo_loom` decimal(10,2) DEFAULT 0.00,
  `prod_yds_3` decimal(10,2) DEFAULT 0.00,
  `yarn_wastage` varchar(50) DEFAULT '0.00%',
  `stock_greige_fresh` decimal(10,2) DEFAULT 0.00,
  `required_greige_production` decimal(10,2) DEFAULT 0.00,
  `prod_greige_production` decimal(10,2) DEFAULT 0.00,
  `balance_greige_production` decimal(10,2) DEFAULT 0.00,
  `completion_greige` decimal(10,2) DEFAULT 0.00,
  `dispo_greige` decimal(10,2) DEFAULT 0.00,
  `prod_yds_4` decimal(10,2) DEFAULT 0.00,
  `fabric_rejection` varchar(50) DEFAULT '0.00%',
  `stock_greige_reject` decimal(10,2) DEFAULT 0.00,
  `delivery_yds` decimal(10,2) DEFAULT 0.00,
  `prod_delivery` decimal(10,2) DEFAULT 0.00,
  `balance_delivery` decimal(10,2) DEFAULT 0.00,
  `completion_delivery` decimal(10,2) DEFAULT 0.00,
  `dispo_delivery` decimal(10,2) DEFAULT 0.00,
  `prod_yds_5` decimal(10,2) DEFAULT 0.00,
  `buyer_colorway` varchar(50) DEFAULT 'white',
  `stock_greige_balance` decimal(10,2) DEFAULT 0.00,
  `document_status` enum('pending','scanned','completed') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `order_summary_stats`
-- (See below for the actual view)
--
CREATE TABLE `order_summary_stats` (
`id` int(11)
,`po_no` varchar(100)
,`order_no` varchar(100)
,`buyer` varchar(255)
,`dispo_quantity` decimal(10,2)
,`total_yarn_required` decimal(11,2)
,`total_yarn_issued` decimal(32,2)
,`total_production_yds` decimal(32,2)
,`completion_percentage` decimal(41,6)
,`document_status` enum('pending','scanned','completed')
,`created_at` timestamp
,`updated_at` timestamp
);

-- --------------------------------------------------------

--
-- Table structure for table `PO_form_data`
--

CREATE TABLE `PO_form_data` (
  `po_no` varchar(50) NOT NULL,
  `pre_costing_no` varchar(50) NOT NULL,
  `po_issue_date` date DEFAULT NULL,
  `po_revise_date` date DEFAULT NULL,
  `po_approval_date` date DEFAULT NULL,
  `order_no` varchar(50) DEFAULT NULL,
  `pi_no` varchar(50) DEFAULT NULL,
  `account_holder` text DEFAULT NULL,
  `buyer_name` varchar(50) DEFAULT NULL,
  `order_status` enum('pending','approved','cancelled') DEFAULT NULL,
  `buyer_style_ref` varchar(50) DEFAULT NULL,
  `po_quantity` int(11) DEFAULT NULL,
  `po_revised_no` varchar(50) DEFAULT NULL,
  `po_revised_reason` text DEFAULT NULL,
  `repeat_order_no` varchar(50) DEFAULT NULL,
  `garments_address` text DEFAULT NULL,
  `approval` enum('yes','no') DEFAULT NULL,
  `pi_date` date DEFAULT NULL,
  `price_per_yard` decimal(10,2) DEFAULT NULL,
  `upcharge_price_per_yard_tk` decimal(10,2) DEFAULT NULL,
  `price_per_yard_usd` decimal(10,2) DEFAULT NULL,
  `upcharge_price_per_yard_usd` decimal(10,2) DEFAULT NULL,
  `warp_count_1` int(11) DEFAULT NULL,
  `warp_ply_1` int(11) DEFAULT NULL,
  `warp_count_2` int(11) DEFAULT NULL,
  `warp_ply_2` int(11) DEFAULT NULL,
  `warp_count_3` int(11) DEFAULT NULL,
  `warp_ply_3` int(11) DEFAULT NULL,
  `weft_count_1` int(11) DEFAULT NULL,
  `weft_ply_1` int(11) DEFAULT NULL,
  `weft_count_2` int(11) DEFAULT NULL,
  `weft_ply_2` int(11) DEFAULT NULL,
  `weft_count_3` int(11) DEFAULT NULL,
  `weft_ply_3` int(11) DEFAULT NULL,
  `weave_type` varchar(50) DEFAULT NULL,
  `finish_type` varchar(50) DEFAULT NULL,
  `sticker_construction` varchar(50) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `sticker_composition` text DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `dispo_overall_width` decimal(10,2) DEFAULT NULL,
  `dispo_cuttable_width` decimal(10,2) DEFAULT NULL,
  `t_number` varchar(50) DEFAULT NULL,
  `strike_off_hl_number` varchar(50) DEFAULT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `print_method` text DEFAULT NULL,
  `process_type` text DEFAULT NULL,
  `fabric_type` text DEFAULT NULL,
  `yarn_type` text DEFAULT NULL,
  `order_type` text DEFAULT NULL,
  `pp_delivery_date` date DEFAULT NULL,
  `bulk_delivery_date` date DEFAULT NULL,
  `end_use` text DEFAULT NULL,
  `wash_type` text DEFAULT NULL,
  `light_source` text DEFAULT NULL,
  `warp_tensile_strength` varchar(10) DEFAULT NULL,
  `weft_tensile_strength` varchar(10) DEFAULT NULL,
  `pilling_grade` varchar(10) DEFAULT NULL,
  `rubbing_grade` varchar(10) DEFAULT NULL,
  `elongation` varchar(10) DEFAULT NULL,
  `growth` varchar(10) DEFAULT NULL,
  `recovery` varchar(10) DEFAULT NULL,
  `buyer_gsm_before_wash` varchar(10) DEFAULT NULL,
  `buyer_gsm_after_wash` varchar(10) DEFAULT NULL,
  `warp_shrinkage` varchar(10) DEFAULT NULL,
  `weft_shrinkage` varchar(10) DEFAULT NULL,
  `quality_parameter` varchar(50) DEFAULT NULL,
  `warp_tear_strength` varchar(10) DEFAULT NULL,
  `weft_tear_strength` varchar(10) DEFAULT NULL,
  `special_note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `precosting_sessions`
--

CREATE TABLE `precosting_sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) UNSIGNED NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `pre_costing_data`
--

CREATE TABLE `pre_costing_data` (
  `pre_costing_no` varchar(50) NOT NULL,
  `buyer` varchar(100) DEFAULT NULL,
  `construction` varchar(100) DEFAULT NULL,
  `epi` decimal(10,2) DEFAULT NULL,
  `ppi` decimal(10,2) DEFAULT NULL,
  `weave_type` varchar(50) DEFAULT NULL,
  `warp_count_1` decimal(10,2) DEFAULT NULL,
  `warp_ply_1` decimal(10,2) DEFAULT NULL,
  `warp_count_2` decimal(10,2) DEFAULT NULL,
  `warp_ply_2` decimal(10,2) DEFAULT NULL,
  `warp_count_3` decimal(10,2) DEFAULT NULL,
  `warp_ply_3` decimal(10,2) DEFAULT NULL,
  `weft_count_1` decimal(10,2) DEFAULT NULL,
  `weft_ply_1` decimal(10,2) DEFAULT NULL,
  `weft_count_2` decimal(10,2) DEFAULT NULL,
  `weft_ply_2` decimal(10,2) DEFAULT NULL,
  `weft_count_3` decimal(10,2) DEFAULT NULL,
  `weft_ply_3` decimal(10,2) DEFAULT NULL,
  `finish_width` decimal(10,2) DEFAULT NULL,
  `greige_width` decimal(10,2) DEFAULT NULL,
  `total_ends` decimal(10,2) DEFAULT NULL,
  `warp_crimp` decimal(10,2) DEFAULT NULL,
  `weft_crimp` decimal(10,2) DEFAULT NULL,
  `reed_space` decimal(10,2) DEFAULT NULL,
  `yd_allow` decimal(10,2) DEFAULT NULL,
  `warp_wast` decimal(10,2) DEFAULT NULL,
  `weft_wast` decimal(10,2) DEFAULT NULL,
  `finish_allow` decimal(10,2) DEFAULT NULL,
  `order_quantity` int(11) DEFAULT NULL,
  `pick_length` decimal(10,2) DEFAULT NULL,
  `weaving_rate` decimal(10,2) DEFAULT NULL,
  `dye_finish_rate` decimal(10,2) DEFAULT NULL,
  `commercial_cost` decimal(10,2) DEFAULT NULL,
  `profit` decimal(10,2) DEFAULT NULL,
  `dollar_rate_tk` decimal(10,2) DEFAULT NULL,
  `pre_costing_date` date DEFAULT NULL,
  `greige_req_quantity` decimal(12,2) DEFAULT NULL,
  `required_warp_yarn` decimal(12,2) DEFAULT NULL,
  `required_weft_yarn` decimal(12,2) DEFAULT NULL,
  `total_required_yarn` decimal(12,2) DEFAULT NULL,
  `warp_greige_consump` decimal(10,3) DEFAULT NULL,
  `weft_greige_consump` decimal(10,3) DEFAULT NULL,
  `total_greige_consump` decimal(10,3) DEFAULT NULL,
  `warp_finish_consump` decimal(10,3) DEFAULT NULL,
  `weft_finish_consump` decimal(10,3) DEFAULT NULL,
  `total_finish_consump` decimal(10,3) DEFAULT NULL,
  `total_greige_yarn_cost_per_yd` decimal(12,2) DEFAULT NULL,
  `warp_yarn_cost` decimal(12,2) DEFAULT NULL,
  `weft_yarn_cost` decimal(12,2) DEFAULT NULL,
  `greige_cost` decimal(12,2) DEFAULT NULL,
  `yarn_dyeing_cost` decimal(12,2) DEFAULT NULL,
  `total_yarn_cost` decimal(12,2) DEFAULT NULL,
  `weaving_cost` decimal(12,2) DEFAULT NULL,
  `break_even_cost` decimal(12,2) DEFAULT NULL,
  `sales_price` decimal(12,2) DEFAULT NULL,
  `upcharged_sales_price` decimal(12,2) DEFAULT NULL,
  `total_warp_cost` decimal(15,2) DEFAULT NULL,
  `total_weft_cost` decimal(15,2) DEFAULT NULL,
  `total_greige_cost` decimal(15,2) DEFAULT NULL,
  `total_dyeing_cost` decimal(15,2) DEFAULT NULL,
  `total_weaving_cost` decimal(15,2) DEFAULT NULL,
  `total_dye_finish_cost` decimal(15,2) DEFAULT NULL,
  `total_commercial_cost` decimal(15,2) DEFAULT NULL,
  `grand_total_break_even_cost` decimal(15,2) DEFAULT NULL,
  `net_break_even_cost_per_yd` decimal(12,2) DEFAULT NULL,
  `net_profit_per_yd` decimal(12,2) DEFAULT NULL,
  `grand_total_profit` decimal(15,2) DEFAULT NULL,
  `total_sales_value` decimal(15,2) DEFAULT NULL,
  `upcharged_net_profit_per_yd` decimal(12,2) DEFAULT NULL,
  `upcharged_grand_total_profit` decimal(15,2) DEFAULT NULL,
  `upcharged_total_sales_value` decimal(15,2) DEFAULT NULL,
  `total_pre_cost_tk` decimal(12,2) DEFAULT NULL,
  `total_pre_cost_usd` decimal(12,4) DEFAULT NULL,
  `total_upcharged_pre_cost_tk` decimal(12,2) DEFAULT NULL,
  `total_upcharged_pre_cost_usd` decimal(12,4) DEFAULT NULL,
  `total_greige_yarn_cost_usd` decimal(12,4) DEFAULT NULL,
  `greige_yarn_cost_per_yd_usd` decimal(12,4) DEFAULT NULL,
  `weaving_cost_usd` decimal(12,4) DEFAULT NULL,
  `break_even_cost_usd` decimal(12,4) DEFAULT NULL,
  `pick_rate_usd` decimal(12,4) DEFAULT NULL,
  `total_greige_cost_usd` decimal(15,4) DEFAULT NULL,
  `total_weaving_cost_usd` decimal(15,4) DEFAULT NULL,
  `net_break_even_cost_per_yd_usd` decimal(12,4) DEFAULT NULL,
  `upcharged_net_profit_per_yd_usd` decimal(12,4) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `production_timeline`
--

CREATE TABLE `production_timeline` (
  `id` int(11) NOT NULL,
  `order_report_id` int(11) NOT NULL,
  `yarn_received_date` date DEFAULT NULL,
  `yarn_count_received` varchar(50) DEFAULT NULL,
  `yarn_ply_received` varchar(50) DEFAULT NULL,
  `yarn_received_qty` decimal(10,2) DEFAULT 0.00,
  `yarn_issue_date` date DEFAULT NULL,
  `yarn_count_issue` varchar(50) DEFAULT NULL,
  `yarn_ply_issue` varchar(50) DEFAULT NULL,
  `yarn_issue_qty` decimal(10,2) DEFAULT 0.00,
  `warping_date` date DEFAULT NULL,
  `warping_qty_mtr` decimal(10,2) DEFAULT 0.00,
  `sizing_date` date DEFAULT NULL,
  `sizing_qty_mtr` decimal(10,2) DEFAULT 0.00,
  `loom_production_date` date DEFAULT NULL,
  `run_loom` int(11) DEFAULT 0,
  `loom_production_qty_yds` decimal(10,2) DEFAULT 0.00,
  `folding_production_date` date DEFAULT NULL,
  `folding_a_grade` decimal(10,2) DEFAULT 0.00,
  `folding_b_grade` decimal(10,2) DEFAULT 0.00,
  `folding_c_grade` decimal(10,2) DEFAULT 0.00,
  `folding_cut_pcs` decimal(10,2) DEFAULT 0.00,
  `total_folding` decimal(10,2) DEFAULT 0.00,
  `special_note` text DEFAULT NULL,
  `delivery_date` date DEFAULT NULL,
  `challan_no` varchar(100) DEFAULT NULL,
  `total_than_roll` int(11) DEFAULT 0,
  `delivery_a_grade` decimal(10,2) DEFAULT 0.00,
  `delivery_b_grade` decimal(10,2) DEFAULT 0.00,
  `total_delivered_qty` decimal(10,2) DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sessions`
--

CREATE TABLE `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) UNSIGNED NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sizing_breakdown`
--

CREATE TABLE `sizing_breakdown` (
  `id` int(11) NOT NULL,
  `sizing_form_id` int(11) NOT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `sizing_date` date DEFAULT NULL,
  `sizing_qty_mtr` decimal(10,2) DEFAULT NULL,
  `total_weavers_beam` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sizing_form`
--

CREATE TABLE `sizing_form` (
  `id` int(11) NOT NULL,
  `po_number` varchar(30) DEFAULT NULL,
  `dispo_number` varchar(30) DEFAULT NULL,
  `buyer` varchar(50) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `beam_total_ends` int(11) DEFAULT NULL,
  `warping_program_no` varchar(20) DEFAULT NULL,
  `warping_set_no` int(11) DEFAULT NULL,
  `warping_machine_type` varchar(50) DEFAULT NULL,
  `required_warp_length_mtr` decimal(15,2) DEFAULT NULL,
  `actual_warp_length_mtr` decimal(15,2) DEFAULT NULL,
  `warping_date` date DEFAULT NULL,
  `number_of_sections` int(11) DEFAULT NULL,
  `total_warp_beam` int(11) DEFAULT NULL,
  `sizing_date` date DEFAULT NULL,
  `sizing_set_no` int(11) DEFAULT 1,
  `total_size_beam` int(11) DEFAULT NULL,
  `required_sizing_length_mtr` decimal(10,2) DEFAULT NULL,
  `actual_sizing_length_mtr` decimal(10,2) DEFAULT NULL,
  `size_yarn_weight` decimal(10,2) DEFAULT NULL,
  `sizing_machine_no` varchar(20) DEFAULT NULL,
  `sizing_machine_speed_m_min` decimal(10,2) DEFAULT NULL,
  `water_volume` decimal(10,2) DEFAULT NULL,
  `final_volume` decimal(10,2) DEFAULT NULL,
  `consumed_volume` decimal(10,2) DEFAULT NULL,
  `total_used_chemicals_kgs` decimal(10,2) DEFAULT NULL,
  `total_value_of_used_chemicals_tk` decimal(10,2) DEFAULT NULL,
  `size_recipe_no` varchar(50) DEFAULT NULL,
  `size_material_type` varchar(50) DEFAULT NULL,
  `size_add_percent` decimal(10,2) DEFAULT NULL,
  `size_material_consumption_kg` decimal(10,2) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','user') NOT NULL DEFAULT 'user',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_privileges`
--

CREATE TABLE `user_privileges` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `sub_ui` varchar(100) NOT NULL,
  `module` varchar(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_import_manual_dispo_resolution_review`
-- (See below for the actual view)
--
CREATE TABLE `v_import_manual_dispo_resolution_review` (
`source_module` varchar(50)
,`source_dispo_number` varchar(150)
,`source_rows` int(11)
,`sample_buyer` varchar(150)
,`sample_construction` varchar(150)
,`sample_composition` text
,`resolved_dispo_number` varchar(150)
,`resolved_po_no` varchar(150)
,`resolved_pre_costing_no` varchar(150)
,`action_mode` enum('audit_only','relink_to_existing_master','create_approved_placeholder')
,`status` enum('pending','ready','applied','rejected')
,`notes` text
,`resolved_master_exists` varchar(3)
,`resolved_master_buyer` varchar(50)
,`resolved_master_construction` varchar(50)
,`resolved_master_composition` text
);

-- --------------------------------------------------------

--
-- Table structure for table `warping_breakdown`
--

CREATE TABLE `warping_breakdown` (
  `id` int(11) NOT NULL,
  `warping_form_id` int(11) NOT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `warping_date` date DEFAULT NULL,
  `warping_program_no` varchar(50) DEFAULT NULL,
  `warping_set` int(11) DEFAULT NULL,
  `total_beam_no` int(11) DEFAULT NULL,
  `warping_length_mtr` decimal(10,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warping_form`
--

CREATE TABLE `warping_form` (
  `id` int(11) NOT NULL,
  `machine_type` varchar(50) DEFAULT NULL,
  `warping_set` int(11) DEFAULT NULL,
  `warping_date` date DEFAULT NULL,
  `po_number` varchar(30) DEFAULT NULL,
  `dispo_number` varchar(50) DEFAULT NULL,
  `buyer` varchar(50) DEFAULT NULL,
  `production_construction` varchar(50) DEFAULT NULL,
  `beam_total_ends` int(11) DEFAULT NULL,
  `warping_program_no` varchar(50) DEFAULT NULL,
  `number_of_sections` int(11) DEFAULT NULL,
  `fabric_type` varchar(50) DEFAULT NULL,
  `dispo_quantity_yds` decimal(10,2) DEFAULT NULL,
  `required_warp_length_meter` decimal(10,2) DEFAULT NULL,
  `fabric_composition` text DEFAULT NULL,
  `actual_warp_length_mtr` decimal(10,2) DEFAULT NULL,
  `yarn_weight` decimal(10,2) DEFAULT NULL,
  `machine_no` varchar(30) DEFAULT NULL,
  `total_no_of_beam` int(11) DEFAULT NULL,
  `breaks_per_million` decimal(10,2) DEFAULT NULL,
  `machine_speed_meter_min` decimal(10,2) DEFAULT NULL,
  `leftover_yarn_kgs` decimal(10,2) DEFAULT NULL,
  `yarn_type` varchar(30) DEFAULT NULL,
  `process_type` varchar(30) DEFAULT NULL,
  `reed_width_inch` decimal(10,2) DEFAULT NULL,
  `flange_to_flange` decimal(10,2) DEFAULT NULL,
  `reed_count` int(11) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warp_broken_pattern`
--

CREATE TABLE `warp_broken_pattern` (
  `id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `sl_no` int(11) NOT NULL DEFAULT 1,
  `warp_color_name` varchar(50) DEFAULT NULL,
  `no_of_cones` int(11) DEFAULT NULL,
  `round_section_yarn` int(11) DEFAULT NULL,
  `total_fraction_ends` int(11) DEFAULT NULL,
  `section_1` int(11) DEFAULT NULL,
  `section_2` int(11) DEFAULT NULL,
  `section_3` int(11) DEFAULT NULL,
  `section_4` int(11) DEFAULT NULL,
  `section_5` int(11) DEFAULT NULL,
  `section_6` int(11) DEFAULT NULL,
  `section_7` int(11) DEFAULT NULL,
  `section_8` int(11) DEFAULT NULL,
  `total_required_ends` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warp_broken_section`
--

CREATE TABLE `warp_broken_section` (
  `id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `lower_beam_total_ends` int(11) DEFAULT NULL,
  `round_no_of_section` int(11) DEFAULT NULL,
  `fraction_section` decimal(10,2) DEFAULT NULL,
  `fraction_section_ends` int(11) DEFAULT NULL,
  `remaining_ends` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warp_details`
--

CREATE TABLE `warp_details` (
  `id` int(11) NOT NULL,
  `pre_costing_no` varchar(50) NOT NULL,
  `warp_count` decimal(10,2) DEFAULT NULL,
  `warp_ply` decimal(10,2) DEFAULT 1.00,
  `repeat_breakdown` decimal(10,2) DEFAULT NULL,
  `color_name` varchar(100) DEFAULT NULL,
  `denting` decimal(10,2) DEFAULT NULL,
  `rate_per_lbs` decimal(10,2) DEFAULT NULL,
  `dyeing_cost_per_kg` decimal(10,2) DEFAULT NULL,
  `repeat_ends_per_color` decimal(12,2) DEFAULT NULL,
  `pattern_total_ends` decimal(12,2) DEFAULT NULL,
  `dent_numbers_in_full_width` decimal(12,2) DEFAULT NULL,
  `greige_yarn_rate` decimal(10,1) DEFAULT NULL,
  `consumption` decimal(10,4) DEFAULT NULL,
  `yarn_cost` decimal(12,2) DEFAULT NULL,
  `color_cost` decimal(12,2) DEFAULT NULL,
  `warp_total_cost` decimal(12,2) DEFAULT NULL,
  `required_greige` decimal(12,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warp_yarn_details`
--

CREATE TABLE `warp_yarn_details` (
  `id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `sl_no` int(11) NOT NULL DEFAULT 1,
  `count` varchar(50) DEFAULT NULL,
  `warp_ply` int(11) DEFAULT NULL,
  `cal_count` varchar(50) DEFAULT NULL,
  `warp_color_name` varchar(100) DEFAULT NULL,
  `ld_number` varchar(100) DEFAULT NULL,
  `yarn_type` varchar(100) DEFAULT NULL,
  `yarn_per_repeat` int(11) DEFAULT NULL,
  `dyed_qty_kg` decimal(10,2) DEFAULT NULL,
  `grey_qty_kg` decimal(10,2) DEFAULT NULL,
  `no_of_cones` int(11) DEFAULT NULL,
  `cone_length` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `weft_details`
--

CREATE TABLE `weft_details` (
  `id` int(11) NOT NULL,
  `pre_costing_no` varchar(50) NOT NULL,
  `weft_count` decimal(10,2) DEFAULT NULL,
  `weft_ply` decimal(10,2) DEFAULT 1.00,
  `repeat_breakdown` decimal(10,2) DEFAULT NULL,
  `color_name` varchar(100) DEFAULT NULL,
  `pick_density` decimal(10,2) DEFAULT NULL,
  `rate_per_lbs` decimal(10,2) DEFAULT NULL,
  `dyeing_cost_per_kg` decimal(10,2) DEFAULT NULL,
  `repeat_picks_per_color` decimal(12,2) DEFAULT NULL,
  `pattern_total_picks` decimal(12,2) DEFAULT NULL,
  `greige_yarn_rate` decimal(10,1) DEFAULT NULL,
  `consumption` decimal(10,4) DEFAULT NULL,
  `yarn_cost` decimal(12,2) DEFAULT NULL,
  `color_cost` decimal(12,2) DEFAULT NULL,
  `weft_total_cost` decimal(12,2) DEFAULT NULL,
  `required_greige` decimal(12,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `weft_yarn_details`
--

CREATE TABLE `weft_yarn_details` (
  `id` int(11) NOT NULL,
  `dispo_number` varchar(50) NOT NULL,
  `sl_no` int(11) NOT NULL DEFAULT 1,
  `count` varchar(50) DEFAULT NULL,
  `weft_ply` int(11) DEFAULT NULL,
  `cal_count` varchar(50) DEFAULT NULL,
  `weft_color_name` varchar(100) DEFAULT NULL,
  `ld_number` varchar(100) DEFAULT NULL,
  `yarn_type` varchar(100) DEFAULT NULL,
  `yarn_per_repeat` int(11) DEFAULT NULL,
  `dyed_qty_kg` decimal(10,2) DEFAULT NULL,
  `grey_qty_kg` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `yarn_issue_details`
--

CREATE TABLE `yarn_issue_details` (
  `dispo_number` varchar(50) DEFAULT NULL,
  `id` int(11) NOT NULL,
  `yarn_issue_form_id` int(11) NOT NULL,
  `receive_date` date DEFAULT NULL,
  `receive_quantity` decimal(10,2) DEFAULT 0.00 COMMENT 'Received Quantity in Kgs',
  `issue_date` date DEFAULT NULL,
  `issued_quantity` decimal(10,2) DEFAULT 0.00 COMMENT 'Issued Quantity in Kgs',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Yarn Issue and Receive Breakdown Details';

-- --------------------------------------------------------

--
-- Table structure for table `yarn_issue_form`
--

CREATE TABLE `yarn_issue_form` (
  `id` int(11) NOT NULL,
  `yarn_count` varchar(50) DEFAULT NULL,
  `yarn_ply` int(11) DEFAULT NULL,
  `yarn_lot` varchar(50) DEFAULT NULL,
  `yarn_brand` varchar(50) DEFAULT NULL,
  `yarn_type` varchar(50) DEFAULT NULL,
  `yarn_composition` varchar(100) DEFAULT NULL,
  `lc_no` varchar(50) DEFAULT NULL,
  `lc_date` date DEFAULT NULL,
  `beneficiary_factory` text DEFAULT NULL,
  `pi_no` varchar(50) DEFAULT NULL,
  `received_against_po_no` varchar(50) DEFAULT NULL,
  `received_against_dispo_nos` varchar(50) DEFAULT NULL,
  `received_start_date` date DEFAULT NULL,
  `last_received_date` date DEFAULT NULL,
  `issue_date` date DEFAULT NULL,
  `pi_lc_rate` decimal(10,2) DEFAULT NULL COMMENT 'PI/LC Rate in USD',
  `dollar_rate` decimal(10,2) DEFAULT NULL COMMENT 'Dollar Rate in Taka',
  `rate_cost_sheet` decimal(10,2) DEFAULT NULL COMMENT 'Rate as per Cost Sheet in USD',
  `warp_yarn_price` decimal(10,2) DEFAULT NULL COMMENT 'Warp Yarn Price in Taka',
  `weft_yarn_price` decimal(10,2) DEFAULT NULL COMMENT 'Weft Yarn Price in Taka',
  `issued_to` varchar(50) DEFAULT NULL COMMENT 'Issued To / Delivery Place',
  `country_of_origin` text DEFAULT NULL,
  `import_local_source` varchar(100) DEFAULT NULL,
  `receive_challan_no` varchar(100) DEFAULT NULL,
  `issue_challan_no` varchar(100) DEFAULT NULL,
  `issue_type` enum('Production','Sample','Trial','Replacement','Return') DEFAULT NULL,
  `outside_issue_kg` decimal(10,2) DEFAULT 0.00,
  `total_warp_issue_kgs` decimal(10,2) DEFAULT 0.00,
  `total_weft_issue_kgs` decimal(10,2) DEFAULT 0.00,
  `total_received_kg` decimal(10,2) DEFAULT 0.00,
  `total_issued_kg` decimal(10,2) DEFAULT 0.00,
  `remaining_stock_kg` decimal(10,2) DEFAULT 0.00,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Main Yarn Issue Form Data';

-- --------------------------------------------------------

--
-- Table structure for table `yarn_received_details`
--

CREATE TABLE `yarn_received_details` (
  `dispo_number` varchar(50) DEFAULT NULL,
  `id` int(10) UNSIGNED NOT NULL,
  `yarn_receive_form_id` int(10) UNSIGNED NOT NULL,
  `received_date` date DEFAULT NULL,
  `quantity_kgs` decimal(12,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `yarn_receive_form`
--

CREATE TABLE `yarn_receive_form` (
  `id` int(10) UNSIGNED NOT NULL,
  `yarn_count` varchar(20) DEFAULT NULL,
  `yarn_ply` int(11) DEFAULT NULL,
  `yarn_type` varchar(30) DEFAULT NULL,
  `yarn_composition` varchar(50) DEFAULT NULL,
  `yarn_brand` varchar(50) DEFAULT NULL,
  `yarn_lot` varchar(50) DEFAULT NULL,
  `lc_date` date DEFAULT NULL,
  `lc_no` varchar(50) DEFAULT NULL,
  `pi_no` varchar(50) DEFAULT NULL,
  `lc_unit` varchar(50) DEFAULT NULL,
  `beneficiary_factory` text DEFAULT NULL,
  `country_of_origin` text DEFAULT NULL,
  `import_local_source` text DEFAULT NULL,
  `received_against_po_no` varchar(50) DEFAULT NULL,
  `received_against_dispo_nos` varchar(50) DEFAULT NULL,
  `dispo_nos_for_yarn_lot` text DEFAULT NULL,
  `received_start_date` date DEFAULT NULL,
  `last_received_date` date DEFAULT NULL,
  `pi_lc_rate` decimal(10,2) DEFAULT NULL,
  `dollar_rate` decimal(10,2) DEFAULT NULL,
  `rate_cost_sheet` decimal(10,2) DEFAULT NULL,
  `receipt_qty_kgs` decimal(12,2) DEFAULT NULL,
  `total_taka_bd` decimal(15,2) DEFAULT NULL,
  `challan_no` varchar(30) DEFAULT NULL,
  `floor_return_kg` decimal(10,2) DEFAULT NULL,
  `search_dispo` varchar(50) DEFAULT NULL,
  `total_received_against_gd` decimal(12,2) DEFAULT NULL,
  `special_notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `yarn_requirements_details`
--

CREATE TABLE `yarn_requirements_details` (
  `id` int(10) UNSIGNED NOT NULL,
  `yarn_receive_form_id` int(10) UNSIGNED NOT NULL,
  `warp_required_kgs` decimal(12,2) DEFAULT NULL,
  `weft_required_kgs` decimal(12,2) DEFAULT NULL,
  `dispo_no` varchar(50) DEFAULT NULL,
  `total_required_kgs` decimal(12,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `dispo_form_data`
--
ALTER TABLE `dispo_form_data`
  ADD PRIMARY KEY (`dispo_number`),
  ADD KEY `idx_po_no` (`po_no`),
  ADD KEY `idx_precosting_number` (`precosting_number`),
  ADD KEY `idx_buyer_name` (`buyer_name`),
  ADD KEY `idx_dispo_creating_date` (`dispo_creating_date`),
  ADD KEY `idx_order_status` (`order_status`(768)),
  ADD KEY `idx_dispo_dropdown_created_dispo` (`created_at`,`dispo_number`);

--
-- Indexes for table `dispo_plan_form`
--
ALTER TABLE `dispo_plan_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_no` (`dispo_no`),
  ADD KEY `idx_po_no` (`po_no`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_po_received_date` (`po_received_date`),
  ADD KEY `idx_bulk_fabric_delivery_date` (`bulk_fabric_delivery_date`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_dispo_plan_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `dyed_yarn_breakdown`
--
ALTER TABLE `dyed_yarn_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_dyed_yarn_breakdown_id` (`id`),
  ADD KEY `idx_dyed_yarn_id` (`dyed_yarn_id`),
  ADD KEY `idx_received_date` (`dyed_yarn_received_date`),
  ADD KEY `idx_color` (`dyed_yarn_received_color`);

--
-- Indexes for table `dyed_yarn_issue`
--
ALTER TABLE `dyed_yarn_issue`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_received_against_dispo_no` (`received_against_dispo_no`),
  ADD KEY `idx_received_against_po_no` (`received_against_po_no`),
  ADD KEY `idx_batch_no` (`batch_no`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_issue_date` (`issue_date`),
  ADD KEY `idx_issue_factory` (`issue_factory`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_dyed_issue_dropdown_created_id` (`created_at`,`id`),
  ADD KEY `idx_dyed_issue_dispo` (`received_against_dispo_no`),
  ADD KEY `idx_dyed_issue_po` (`received_against_po_no`);

--
-- Indexes for table `dyed_yarn_issue_breakdown`
--
ALTER TABLE `dyed_yarn_issue_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_dyed_yarn_issue_breakdown_id` (`id`),
  ADD KEY `idx_dyed_yarn_issue_id` (`dyed_yarn_issue_id`),
  ADD KEY `idx_dyed_yarn_issue_date` (`dyed_yarn_issue_date`);

--
-- Indexes for table `dyed_yarn_receive`
--
ALTER TABLE `dyed_yarn_receive`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_received_date` (`dyed_yarn_received_date`),
  ADD KEY `idx_po_no` (`received_against_po_no`),
  ADD KEY `idx_dispo_no` (`received_against_dispo_no`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_batch_no` (`batch_no`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_dyed_receive_dropdown_created_id` (`created_at`,`id`),
  ADD KEY `idx_dyed_receive_dispo` (`received_against_dispo_no`),
  ADD KEY `idx_dyed_receive_po` (`received_against_po_no`);

--
-- Indexes for table `finish_delivery_breakdown`
--
ALTER TABLE `finish_delivery_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_finish_delivery_breakdown_id` (`id`),
  ADD KEY `idx_finish_delivery_id` (`finish_delivery_id`),
  ADD KEY `idx_finish_receive_date` (`finish_receive_date`),
  ADD KEY `idx_finish_delivery_date` (`finish_delivery_date`);

--
-- Indexes for table `finish_delivery_form`
--
ALTER TABLE `finish_delivery_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_finish_delivery_date` (`finish_delivery_date`),
  ADD KEY `idx_challan_no` (`challan_no`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_finish_delivery_dropdown_created_id` (`created_at`,`id`),
  ADD KEY `idx_finish_delivery_created_id` (`created_at`,`id`);

--
-- Indexes for table `finish_receive_breakdown`
--
ALTER TABLE `finish_receive_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_finish_receive_breakdown_id` (`id`),
  ADD KEY `idx_finish_receive_id` (`finish_receive_id`);

--
-- Indexes for table `finish_receive_form`
--
ALTER TABLE `finish_receive_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_finish_receive_dropdown_created_id` (`created_at`,`id`),
  ADD KEY `idx_finish_receive_po_number` (`po_number`),
  ADD KEY `idx_finish_receive_dispo_number` (`dispo_number`),
  ADD KEY `idx_finish_receive_buyer` (`buyer`),
  ADD KEY `idx_finish_receive_challan_no` (`challan_no`);

--
-- Indexes for table `floor_position`
--
ALTER TABLE `floor_position`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_loom_no` (`loom_no`),
  ADD KEY `idx_beam_no` (`beam_no`),
  ADD KEY `idx_dispo_no` (`dispo_no`),
  ADD KEY `idx_weaving_beam_set_no` (`weaving_beam_set_no`),
  ADD KEY `idx_floor_dropdown_created_id` (`created_at`,`id`),
  ADD KEY `idx_floor_po_no` (`po_no`),
  ADD KEY `idx_floor_buyer` (`buyer`);

--
-- Indexes for table `folding_production_breakdown`
--
ALTER TABLE `folding_production_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_folding_production_breakdown_id` (`id`),
  ADD KEY `idx_folding_production_id` (`folding_production_id`),
  ADD KEY `idx_loom_production_date` (`loom_production_date`),
  ADD KEY `idx_folding_production_date` (`folding_production_date`);

--
-- Indexes for table `folding_production_form`
--
ALTER TABLE `folding_production_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_folding_production_date` (`folding_production_date`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_folding_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `greige_delivery_breakdown`
--
ALTER TABLE `greige_delivery_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_greige_delivery_breakdown_id` (`id`),
  ADD KEY `idx_greige_delivery_id` (`greige_delivery_id`);

--
-- Indexes for table `greige_delivery_form`
--
ALTER TABLE `greige_delivery_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_delivery_date` (`delivery_date`),
  ADD KEY `idx_challan_no` (`challan_no`),
  ADD KEY `idx_greige_delivery_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `import_manual_dispo_resolution`
--
ALTER TABLE `import_manual_dispo_resolution`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_manual_dispo_resolution` (`source_module`,`source_dispo_number`);

--
-- Indexes for table `import_placeholder_dispo_audit`
--
ALTER TABLE `import_placeholder_dispo_audit`
  ADD PRIMARY KEY (`dispo_number`);

--
-- Indexes for table `import_unmatched_dispo_audit`
--
ALTER TABLE `import_unmatched_dispo_audit`
  ADD PRIMARY KEY (`source_module`,`source_dispo_number`);

--
-- Indexes for table `loom_production_breakdown`
--
ALTER TABLE `loom_production_breakdown`
  ADD PRIMARY KEY (`dispo_number`,`id`),
  ADD UNIQUE KEY `uq_loom_production_breakdown_id` (`id`),
  ADD KEY `idx_loom_production_id` (`loom_production_id`),
  ADD KEY `idx_production_date` (`loom_production_date`);

--
-- Indexes for table `loom_production_form`
--
ALTER TABLE `loom_production_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_weaving_date` (`weaving_date`),
  ADD KEY `idx_loom_no` (`loom_no`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_loom_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `order_closing_reports`
--
ALTER TABLE `order_closing_reports`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_po_no` (`po_no`),
  ADD KEY `idx_order_no` (`order_no`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_dispo_quantity` (`dispo_quantity`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indexes for table `PO_form_data`
--
ALTER TABLE `PO_form_data`
  ADD PRIMARY KEY (`po_no`),
  ADD UNIQUE KEY `pre_costing_no_po_no` (`pre_costing_no`,`po_no`),
  ADD KEY `idx_pre_costing_no` (`pre_costing_no`),
  ADD KEY `idx_po_issue_date` (`po_issue_date`),
  ADD KEY `idx_buyer_name` (`buyer_name`),
  ADD KEY `idx_order_status` (`order_status`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_pi_no` (`pi_no`),
  ADD KEY `idx_po_dropdown_created_po` (`created_at`,`po_no`);

--
-- Indexes for table `precosting_sessions`
--
ALTER TABLE `precosting_sessions`
  ADD PRIMARY KEY (`session_id`);

--
-- Indexes for table `pre_costing_data`
--
ALTER TABLE `pre_costing_data`
  ADD PRIMARY KEY (`pre_costing_no`),
  ADD KEY `idx_buyer` (`buyer`),
  ADD KEY `idx_pre_costing_date` (`pre_costing_date`),
  ADD KEY `idx_construction` (`construction`),
  ADD KEY `idx_precosting_dropdown_created_no` (`created_at`,`pre_costing_no`);

--
-- Indexes for table `production_timeline`
--
ALTER TABLE `production_timeline`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_order_report_id` (`order_report_id`),
  ADD KEY `idx_yarn_received_date` (`yarn_received_date`),
  ADD KEY `idx_delivery_date` (`delivery_date`);

--
-- Indexes for table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`session_id`);

--
-- Indexes for table `sizing_breakdown`
--
ALTER TABLE `sizing_breakdown`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_sizing_breakdown_id` (`id`),
  ADD KEY `idx_sizing_form_id` (`sizing_form_id`);

--
-- Indexes for table `sizing_form`
--
ALTER TABLE `sizing_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_warping_program_no` (`warping_program_no`),
  ADD KEY `idx_sizing_date` (`sizing_date`),
  ADD KEY `idx_sizing_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `user_privileges`
--
ALTER TABLE `user_privileges`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_privileges_ibfk_1` (`user_id`);

--
-- Indexes for table `warping_breakdown`
--
ALTER TABLE `warping_breakdown`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_warping_breakdown_id` (`id`),
  ADD KEY `idx_warping_form_id` (`warping_form_id`);

--
-- Indexes for table `warping_form`
--
ALTER TABLE `warping_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_warping_date` (`warping_date`),
  ADD KEY `idx_po_number` (`po_number`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_warping_program_no` (`warping_program_no`),
  ADD KEY `idx_warping_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `warp_broken_pattern`
--
ALTER TABLE `warp_broken_pattern`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_warp_color_name` (`warp_color_name`);

--
-- Indexes for table `warp_broken_section`
--
ALTER TABLE `warp_broken_section`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_number` (`dispo_number`);

--
-- Indexes for table `warp_details`
--
ALTER TABLE `warp_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pre_costing_no` (`pre_costing_no`),
  ADD KEY `idx_color_name` (`color_name`);

--
-- Indexes for table `warp_yarn_details`
--
ALTER TABLE `warp_yarn_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_warp_color_name` (`warp_color_name`);

--
-- Indexes for table `weft_details`
--
ALTER TABLE `weft_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pre_costing_no` (`pre_costing_no`),
  ADD KEY `idx_color_name` (`color_name`);

--
-- Indexes for table `weft_yarn_details`
--
ALTER TABLE `weft_yarn_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_dispo_number` (`dispo_number`),
  ADD KEY `idx_weft_color_name` (`weft_color_name`);

--
-- Indexes for table `yarn_issue_details`
--
ALTER TABLE `yarn_issue_details`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_yarn_issue_details_id` (`id`),
  ADD KEY `idx_form_id` (`yarn_issue_form_id`),
  ADD KEY `idx_receive_date` (`receive_date`),
  ADD KEY `idx_issue_date` (`issue_date`),
  ADD KEY `idx_dispo_number` (`dispo_number`);

--
-- Indexes for table `yarn_issue_form`
--
ALTER TABLE `yarn_issue_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_yarn_lot` (`yarn_lot`),
  ADD KEY `idx_issue_challan_no` (`issue_challan_no`),
  ADD KEY `idx_po_no` (`received_against_po_no`),
  ADD KEY `idx_dispo_nos` (`received_against_dispo_nos`),
  ADD KEY `idx_issue_date` (`issue_date`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_yarn_issue_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `yarn_received_details`
--
ALTER TABLE `yarn_received_details`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_yarn_received_details_id` (`id`),
  ADD KEY `idx_yarn_receive_id` (`yarn_receive_form_id`),
  ADD KEY `idx_received_date` (`received_date`),
  ADD KEY `idx_dispo_number` (`dispo_number`);

--
-- Indexes for table `yarn_receive_form`
--
ALTER TABLE `yarn_receive_form`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_yarn_count` (`yarn_count`),
  ADD KEY `idx_yarn_lot` (`yarn_lot`),
  ADD KEY `idx_lc_no` (`lc_no`),
  ADD KEY `idx_yarn_brand` (`yarn_brand`),
  ADD KEY `idx_received_against_po_no` (`received_against_po_no`),
  ADD KEY `idx_received_against_dispo_nos` (`received_against_dispo_nos`),
  ADD KEY `idx_beneficiary_factory` (`beneficiary_factory`(768)),
  ADD KEY `idx_received_start_date` (`received_start_date`),
  ADD KEY `idx_yarn_receive_dropdown_created_id` (`created_at`,`id`);

--
-- Indexes for table `yarn_requirements_details`
--
ALTER TABLE `yarn_requirements_details`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_yarn_receive_id` (`yarn_receive_form_id`),
  ADD KEY `idx_dispo_no` (`dispo_no`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `dispo_plan_form`
--
ALTER TABLE `dispo_plan_form`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dyed_yarn_breakdown`
--
ALTER TABLE `dyed_yarn_breakdown`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dyed_yarn_issue`
--
ALTER TABLE `dyed_yarn_issue`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dyed_yarn_issue_breakdown`
--
ALTER TABLE `dyed_yarn_issue_breakdown`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `dyed_yarn_receive`
--
ALTER TABLE `dyed_yarn_receive`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `finish_delivery_breakdown`
--
ALTER TABLE `finish_delivery_breakdown`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `finish_delivery_form`
--
ALTER TABLE `finish_delivery_form`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `finish_receive_breakdown`
--
ALTER TABLE `finish_receive_breakdown`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `finish_receive_form`
--
ALTER TABLE `finish_receive_form`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `floor_position`
--
ALTER TABLE `floor_position`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `folding_production_breakdown`
--
ALTER TABLE `folding_production_breakdown`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `folding_production_form`
--
ALTER TABLE `folding_production_form`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `greige_delivery_breakdown`
--
ALTER TABLE `greige_delivery_breakdown`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `greige_delivery_form`
--
ALTER TABLE `greige_delivery_form`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `import_manual_dispo_resolution`
--
ALTER TABLE `import_manual_dispo_resolution`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `loom_production_breakdown`
--
ALTER TABLE `loom_production_breakdown`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `loom_production_form`
--
ALTER TABLE `loom_production_form`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `order_closing_reports`
--
ALTER TABLE `order_closing_reports`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `production_timeline`
--
ALTER TABLE `production_timeline`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sizing_breakdown`
--
ALTER TABLE `sizing_breakdown`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sizing_form`
--
ALTER TABLE `sizing_form`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_privileges`
--
ALTER TABLE `user_privileges`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warping_breakdown`
--
ALTER TABLE `warping_breakdown`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warping_form`
--
ALTER TABLE `warping_form`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warp_broken_pattern`
--
ALTER TABLE `warp_broken_pattern`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warp_broken_section`
--
ALTER TABLE `warp_broken_section`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warp_details`
--
ALTER TABLE `warp_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warp_yarn_details`
--
ALTER TABLE `warp_yarn_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `weft_details`
--
ALTER TABLE `weft_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `weft_yarn_details`
--
ALTER TABLE `weft_yarn_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `yarn_issue_details`
--
ALTER TABLE `yarn_issue_details`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `yarn_issue_form`
--
ALTER TABLE `yarn_issue_form`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `yarn_received_details`
--
ALTER TABLE `yarn_received_details`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `yarn_receive_form`
--
ALTER TABLE `yarn_receive_form`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `yarn_requirements_details`
--
ALTER TABLE `yarn_requirements_details`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

-- --------------------------------------------------------

--
-- Structure for view `order_summary_stats`
--
DROP TABLE IF EXISTS `order_summary_stats`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY INVOKER VIEW `order_summary_stats`  AS SELECT `ocr`.`id` AS `id`, `ocr`.`po_no` AS `po_no`, `ocr`.`order_no` AS `order_no`, `ocr`.`buyer` AS `buyer`, `ocr`.`dispo_quantity` AS `dispo_quantity`, `ocr`.`required_warp_yarn`+ `ocr`.`required_weft_yarn` AS `total_yarn_required`, (select sum(`pt`.`yarn_issue_qty`) from `production_timeline` `pt` where `pt`.`order_report_id` = `ocr`.`id`) AS `total_yarn_issued`, (select sum(`pt`.`loom_production_qty_yds`) from `production_timeline` `pt` where `pt`.`order_report_id` = `ocr`.`id`) AS `total_production_yds`, CASE WHEN `ocr`.`dispo_quantity` > 0 THEN (select sum(`pt`.`loom_production_qty_yds`) from `production_timeline` `pt` where `pt`.`order_report_id` = `ocr`.`id`) / `ocr`.`dispo_quantity` * 100 ELSE 0 END AS `completion_percentage`, `ocr`.`document_status` AS `document_status`, `ocr`.`created_at` AS `created_at`, `ocr`.`updated_at` AS `updated_at` FROM `order_closing_reports` AS `ocr` ;

-- --------------------------------------------------------

--
-- Structure for view `v_import_manual_dispo_resolution_review`
--
DROP TABLE IF EXISTS `v_import_manual_dispo_resolution_review`;

CREATE ALGORITHM=UNDEFINED DEFINER=`weavonpq`@`localhost` SQL SECURITY DEFINER VIEW `v_import_manual_dispo_resolution_review`  AS SELECT `a`.`source_module` AS `source_module`, `a`.`source_dispo_number` AS `source_dispo_number`, `a`.`source_rows` AS `source_rows`, `a`.`sample_buyer` AS `sample_buyer`, `a`.`sample_construction` AS `sample_construction`, `a`.`sample_composition` AS `sample_composition`, `r`.`resolved_dispo_number` AS `resolved_dispo_number`, `r`.`resolved_po_no` AS `resolved_po_no`, `r`.`resolved_pre_costing_no` AS `resolved_pre_costing_no`, `r`.`action_mode` AS `action_mode`, `r`.`status` AS `status`, `r`.`notes` AS `notes`, CASE WHEN `d`.`dispo_number` is not null THEN 'YES' ELSE 'NO' END AS `resolved_master_exists`, `d`.`buyer_name` AS `resolved_master_buyer`, `d`.`production_construction` AS `resolved_master_construction`, `d`.`fabric_composition` AS `resolved_master_composition` FROM ((`import_unmatched_dispo_audit` `a` left join `import_manual_dispo_resolution` `r` on(`r`.`source_module` collate utf8mb4_general_ci = `a`.`source_module` collate utf8mb4_general_ci and `r`.`source_dispo_number` collate utf8mb4_general_ci = `a`.`source_dispo_number` collate utf8mb4_general_ci)) left join `dispo_form_data` `d` on(trim(`d`.`dispo_number`) collate utf8mb4_general_ci = trim(`r`.`resolved_dispo_number`) collate utf8mb4_general_ci)) ;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `dispo_form_data`
--
ALTER TABLE `dispo_form_data`
  ADD CONSTRAINT `dispo_form_data_ibfk_1` FOREIGN KEY (`po_no`) REFERENCES `PO_form_data` (`po_no`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `dyed_yarn_breakdown`
--
ALTER TABLE `dyed_yarn_breakdown`
  ADD CONSTRAINT `fk_breakdown_dyed_yarn` FOREIGN KEY (`dyed_yarn_id`) REFERENCES `dyed_yarn_receive` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `dyed_yarn_issue_breakdown`
--
ALTER TABLE `dyed_yarn_issue_breakdown`
  ADD CONSTRAINT `dyed_yarn_issue_breakdown_ibfk_1` FOREIGN KEY (`dyed_yarn_issue_id`) REFERENCES `dyed_yarn_issue` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `finish_delivery_breakdown`
--
ALTER TABLE `finish_delivery_breakdown`
  ADD CONSTRAINT `fk_finish_delivery_breakdown` FOREIGN KEY (`finish_delivery_id`) REFERENCES `finish_delivery_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `folding_production_breakdown`
--
ALTER TABLE `folding_production_breakdown`
  ADD CONSTRAINT `fk_folding_production_breakdown` FOREIGN KEY (`folding_production_id`) REFERENCES `folding_production_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `greige_delivery_breakdown`
--
ALTER TABLE `greige_delivery_breakdown`
  ADD CONSTRAINT `greige_delivery_breakdown_ibfk_1` FOREIGN KEY (`greige_delivery_id`) REFERENCES `greige_delivery_form` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `loom_production_breakdown`
--
ALTER TABLE `loom_production_breakdown`
  ADD CONSTRAINT `fk_loom_production_breakdown` FOREIGN KEY (`loom_production_id`) REFERENCES `loom_production_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `PO_form_data`
--
ALTER TABLE `PO_form_data`
  ADD CONSTRAINT `PO_form_data_ibfk_1` FOREIGN KEY (`pre_costing_no`) REFERENCES `pre_costing_data` (`pre_costing_no`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `production_timeline`
--
ALTER TABLE `production_timeline`
  ADD CONSTRAINT `production_timeline_ibfk_1` FOREIGN KEY (`order_report_id`) REFERENCES `order_closing_reports` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sizing_breakdown`
--
ALTER TABLE `sizing_breakdown`
  ADD CONSTRAINT `sizing_breakdown_ibfk_1` FOREIGN KEY (`sizing_form_id`) REFERENCES `sizing_form` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `user_privileges`
--
ALTER TABLE `user_privileges`
  ADD CONSTRAINT `user_privileges_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `warping_breakdown`
--
ALTER TABLE `warping_breakdown`
  ADD CONSTRAINT `warping_breakdown_ibfk_1` FOREIGN KEY (`warping_form_id`) REFERENCES `warping_form` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `warp_broken_pattern`
--
ALTER TABLE `warp_broken_pattern`
  ADD CONSTRAINT `warp_broken_pattern_ibfk_1` FOREIGN KEY (`dispo_number`) REFERENCES `dispo_form_data` (`dispo_number`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `warp_broken_section`
--
ALTER TABLE `warp_broken_section`
  ADD CONSTRAINT `warp_broken_section_ibfk_1` FOREIGN KEY (`dispo_number`) REFERENCES `dispo_form_data` (`dispo_number`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `warp_details`
--
ALTER TABLE `warp_details`
  ADD CONSTRAINT `fk_warp_details_pre_costing` FOREIGN KEY (`pre_costing_no`) REFERENCES `pre_costing_data` (`pre_costing_no`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `warp_yarn_details`
--
ALTER TABLE `warp_yarn_details`
  ADD CONSTRAINT `warp_yarn_details_ibfk_1` FOREIGN KEY (`dispo_number`) REFERENCES `dispo_form_data` (`dispo_number`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `weft_details`
--
ALTER TABLE `weft_details`
  ADD CONSTRAINT `fk_weft_details_pre_costing` FOREIGN KEY (`pre_costing_no`) REFERENCES `pre_costing_data` (`pre_costing_no`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `weft_yarn_details`
--
ALTER TABLE `weft_yarn_details`
  ADD CONSTRAINT `weft_yarn_details_ibfk_1` FOREIGN KEY (`dispo_number`) REFERENCES `dispo_form_data` (`dispo_number`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `yarn_issue_details`
--
ALTER TABLE `yarn_issue_details`
  ADD CONSTRAINT `fk_yarn_issue_details_form` FOREIGN KEY (`yarn_issue_form_id`) REFERENCES `yarn_issue_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `yarn_received_details`
--
ALTER TABLE `yarn_received_details`
  ADD CONSTRAINT `fk_yarn_received_details` FOREIGN KEY (`yarn_receive_form_id`) REFERENCES `yarn_receive_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `yarn_requirements_details`
--
ALTER TABLE `yarn_requirements_details`
  ADD CONSTRAINT `fk_yarn_requirements_details` FOREIGN KEY (`yarn_receive_form_id`) REFERENCES `yarn_receive_form` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
