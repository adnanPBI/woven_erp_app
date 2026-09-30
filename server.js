const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const fs = require('fs');

// Hosting-provided variables take precedence; local Node and Bun use the same file.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: false });
for (const key of ['DB_NAME', 'DB_USER', 'SESSION_SECRET']) {
    if (!process.env[key]) throw new Error(`Missing required application setting: ${key}`);
}

// --- Configuration Constants ---
const GOOGLE_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;

// Initialize the Express app
const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// MySQL connection configuration
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
});

// Session store
const sessionStore = new MySQLStore({}, pool);

// FIXED: Enhanced CORS settings for proper session handling
app.use(cors({
    origin: (process.env.CORS_ORIGIN || 'https://weaving-erp.xyz,http://localhost:3000,http://127.0.0.1:3000').split(',').map(value => value.trim()),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    credentials: true,
    preflightContinue: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

// FIXED: Enhanced session configuration
app.use(session({
    key: process.env.SESSION_KEY || 'precosting_session',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.COOKIE_SECURE === undefined ? process.env.NODE_ENV === 'production' : process.env.COOKIE_SECURE === 'true',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.COOKIE_SAME_SITE || 'lax' // ADDED: This helps with session handling
    },
    rolling: true // ADDED: Refreshes session on each request
}));

require('./lib/http-boundaries').installApiGuard(app);

// FIXED: Enhanced session validation middleware
app.use((req, res, next) => {
    // Skip session check for login/register routes
    if (req.path === '/main/api/login' || req.path === '/main/api/register') {
        return next();
    }
    
    // Enhanced session logging for API routes
    if (process.env.NODE_ENV === 'development' && req.path.includes('/api/')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        console.log(`  Session ID: ${req.sessionID}`);
        console.log(`  Session exists: ${!!req.session}`);
        console.log(`  Has user: ${!!req.session?.user}`);
        console.log(`  Cookie: ${JSON.stringify(req.session?.cookie)}`);
        
        if (req.session?.user) {
            console.log(`  User: ${req.session.user.username}, Role: ${req.session.user.role}`);
        } else if (req.path.includes('/api/') && !req.path.includes('/debug/')) {
            console.log(`  WARNING: No user session for protected API route`);
        }
    }
    next();
});

// Serve static files with base path adjustment
console.log('Current directory:', __dirname);
require('./lib/http-boundaries').installPublicAssets(app, __dirname);
app.use('/main/mis_module', express.static(path.resolve(__dirname, 'mis_module')));
app.use('/main/orderinformation_module', express.static(path.resolve(__dirname, 'orderinformation_module')));
app.use('/main/orderinformation_module/precosting_app', express.static(path.resolve(__dirname, 'orderinformation_module/precosting_app')));
app.use('/main/orderinformation_module/poentry_app', express.static(path.resolve(__dirname, 'orderinformation_module/poentry_app')));
app.use('/main/orderinformation_module/dispocreate_app', express.static(path.resolve(__dirname, 'orderinformation_module/dispocreate_app')));
app.use('/main/yarn_module', express.static(path.resolve(__dirname, 'yarn_module')));
app.use('/main/preparatory_module', express.static(path.resolve(__dirname, 'preparatory_module')));
app.use('/main/loomproduction_module', express.static(path.resolve(__dirname, 'loomproduction_module')));
app.use('/main/greigefabric_module', express.static(path.resolve(__dirname, 'greigefabric_module')));
app.use('/main/finishfabric_module', express.static(path.resolve(__dirname, 'finishfabric_module')));
app.use('/main/reportgenerator_app', express.static(path.resolve(__dirname, 'reportgenerator_app')));
app.use('/main/sql_database', express.static(path.resolve(__dirname, 'sql_database')));

app.use((req, res, next) => {
    if (req.path.startsWith('/main/api/')) {
        return next(); // Skip static serving for API routes
    }
    next();
});

// Route handlers for the apps
app.get('/main/orderinformation_module/precosting_app', (req, res) => {
    console.log('Serving precosting app index.html from route');
    res.sendFile(path.resolve(__dirname, 'orderinformation_module/precosting_app/index.html'));
});

app.get('/main/orderinformation_module/poentry_app', (req, res) => {
    console.log('Serving poentry app index.html from route');
    res.sendFile(path.resolve(__dirname, 'orderinformation_module/poentry_app/index.html'));
});

app.get('/main/orderinformation_module/dispocreate_app', (req, res) => {
    console.log('Serving dispocreate app index.html from route');
    res.sendFile(path.resolve(__dirname, 'orderinformation_module/dispocreate_app/index.html'));
});

app.get('/main', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'main.html'));
});

// FIXED: Session restoration and debugging endpoint
app.get('/main/api/session/restore', (req, res) => {
    console.log('=== SESSION RESTORE REQUEST ===');
    console.log('Session ID:', req.sessionID);
    console.log('Session exists:', !!req.session);
    console.log('Session data:', req.session);
    console.log('Cookies:', req.headers.cookie);
    
    if (!req.session) {
        return res.status(401).json({ 
            error: 'No session found',
            sessionID: req.sessionID,
            cookies: req.headers.cookie
        });
    }
    
    if (!req.session.user) {
        return res.status(401).json({ 
            error: 'No user in session',
            sessionID: req.sessionID,
            sessionData: Object.keys(req.session)
        });
    }
    
    res.status(200).json({
        message: 'Session is valid',
        sessionID: req.sessionID,
        user: {
            username: req.session.user.username,
            role: req.session.user.role,
            loginTime: req.session.user.loginTime
        },
        sessionInfo: {
            cookie: req.session.cookie,
            maxAge: req.session.cookie.maxAge,
            expires: req.session.cookie.expires
        }
    });
});
// Test the database connection
pool.getConnection()
    .then(async (connection) => {
        try {
            const [[identity]] = await connection.query('SELECT DATABASE() AS database_name');
            console.log('Connected to MySQL database:', identity.database_name);
        } finally {
            connection.release();
        }
    })
    .catch((err) => {
        console.error('Error connecting to MySQL:', err.stack);
    });

// Session debugging endpoint
app.get('/main/api/debug/session-info', (req, res) => {
    try {
        res.json({
            sessionID: req.sessionID,
            hasSession: !!req.session,
            cookie: req.session ? {
                maxAge: req.session.cookie.maxAge,
                expires: req.session.cookie.expires,
                secure: req.session.cookie.secure,
                httpOnly: req.session.cookie.httpOnly,
                path: req.session.cookie.path
            } : null,
            user: req.session && req.session.user ? {
                id: req.session.user.id,
                username: req.session.user.username,
                role: req.session.user.role,
                privilegeCount: req.session.user.privileges ? Object.keys(req.session.user.privileges).length : 0
            } : null
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// Diagnostic route for file system information
app.get('/main/api/debug/file-check', (req, res) => {
    try {
        const basePath = path.resolve(__dirname, 'orderinformation_module/dispocreate_app');
        const indexPath = path.join(basePath, 'index.html');
        
        const info = {
            base_directory_exists: fs.existsSync(basePath),
            index_file_exists: fs.existsSync(indexPath),
            directory_contents: fs.existsSync(basePath) ? fs.readdirSync(basePath) : [],
            file_stats: fs.existsSync(indexPath) ? {
                size: fs.statSync(indexPath).size,
                permissions: fs.statSync(indexPath).mode.toString(8),
                is_file: fs.statSync(indexPath).isFile()
            } : null,
            node_env: process.env.NODE_ENV,
            current_dir: __dirname,
            file_path: indexPath
        };
        
        res.json(info);
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});


// =====================================================
// UNIVERSAL SERVER-SIDE DROPDOWN SEARCH - V6
// =====================================================
// Additive endpoint. It does not change legacy endpoint response shapes.
// Frontend usage: /main/api/dropdown-search?type=po&q=NDSD&limit=35&offset=0
// V6 status:
// - verified from phpMyAdmin EXPLAIN: prefix searches use the dropdown/created_at indexes with rows near LIMIT
// - contains fallback remains controlled: it only runs when prefix returns zero rows, unless a type explicitly opts in
// - per-type containsMinChars reduces full contains scans on large tables
// - still preserves all legacy endpoint response formats

const DROPDOWN_SEARCH_TYPES = Object.freeze({
    precosting: {
        table: 'pre_costing_data',
        valueExpr: 'pre_costing_no',
        selectSql: 'pre_costing_no, buyer, construction, created_at',
        searchFields: ['pre_costing_no', 'buyer', 'construction'],
        primarySearchFields: ['pre_costing_no'],
        orderSql: 'pre_costing_no DESC',
        dedupeKey: 'pre_costing_no',
        containsMinChars: 4
    },
    po: {
        table: 'PO_form_data',
        valueExpr: 'po_no',
        selectSql: 'po_no, buyer_name, order_no, created_at',
        searchFields: ['po_no', 'buyer_name', 'order_no'],
        primarySearchFields: ['po_no', 'order_no'],
        orderSql: 'po_issue_date DESC, created_at DESC, po_no DESC',
        dedupeKey: 'po_no',
        containsMinChars: 3
    },
    dispo: {
        table: 'dispo_form_data',
        valueExpr: 'dispo_number',
        selectSql: `
            dispo_number,
            po_no,
            buyer_name,
            development_id,
            DATE_FORMAT(dispo_creating_date, '%Y-%m-%d') AS dispo_date,
            created_at
        `,
        searchFields: ['dispo_number', 'po_no', 'buyer_name', 'development_id'],
        primarySearchFields: ['dispo_number', 'po_no'],
        orderSql: 'dispo_creating_date DESC, created_at DESC, dispo_number DESC',
        dedupeKey: 'dispo_number',
        containsMinChars: 3
    },
    dispo_for_order_followup: {
        table: 'dispo_form_data',
        valueExpr: 'dispo_number',
        selectSql: `
            dispo_number,
            po_no,
            buyer_name,
            development_id,
            finish_qty_yds AS dispo_quantity,
            created_at
        `,
        searchFields: ['dispo_number', 'po_no', 'buyer_name', 'development_id'],
        primarySearchFields: ['dispo_number', 'po_no'],
        orderSql: 'dispo_creating_date DESC, created_at DESC, dispo_number DESC',
        dedupeKey: 'dispo_number',
        containsMinChars: 3
    },
    yarn_issue_dispo: {
        table: 'dispo_form_data',
        valueExpr: 'dispo_number',
        selectSql: `
            dispo_number,
            po_no,
            buyer_name,
            development_id,
            DATE_FORMAT(dispo_creating_date, '%Y-%m-%d') AS dispo_date,
            created_at
        `,
        searchFields: ['dispo_number', 'po_no', 'buyer_name', 'development_id'],
        primarySearchFields: ['dispo_number', 'po_no'],
        orderSql: 'dispo_creating_date DESC, created_at DESC, dispo_number DESC',
        dedupeKey: 'dispo_number',
        containsMinChars: 3
    },
    yarn_details: {
        table: 'yarn_receive_form',
        valueExpr: 'id',
        selectSql: `
            id,
            CONCAT(
                yarn_count, '/', yarn_ply, ' | ',
                COALESCE(yarn_brand, 'N/A'), ' | ',
                COALESCE(yarn_lot, 'N/A'), ' | ',
                COALESCE(received_against_dispo_nos, 'N/A'), ' | ',
                COALESCE(yarn_composition, 'N/A'), ' | ',
                COALESCE(lc_unit, 'N/A'), ' | ',
                COALESCE(beneficiary_factory, 'N/A')
            ) AS yarn_detail,
            yarn_count, yarn_ply, yarn_brand, yarn_lot, received_against_dispo_nos,
            yarn_composition, lc_unit, beneficiary_factory, created_at
        `,
        searchFields: ['yarn_count', 'yarn_ply', 'yarn_brand', 'yarn_lot', 'received_against_dispo_nos', 'yarn_composition', 'lc_unit', 'beneficiary_factory'],
        primarySearchFields: ['yarn_lot', 'yarn_count', 'yarn_brand'],
        extraWhere: 'yarn_count IS NOT NULL AND yarn_brand IS NOT NULL',
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 3
    },
    posted_lcs: {
        table: 'yarn_receive_form',
        valueExpr: 'lc_no',
        selectSql: 'DISTINCT lc_no',
        searchFields: ['lc_no'],
        primarySearchFields: ['lc_no'],
        extraWhere: "lc_no IS NOT NULL AND lc_no != ''",
        orderSql: 'lc_no DESC',
        dedupeKey: 'lc_no',
        containsMinChars: 2
    },
    yarn_lots: {
        table: 'yarn_receive_form',
        valueExpr: 'yarn_lot',
        selectSql: `
            id,
            yarn_lot,
            CONCAT(
                COALESCE(yarn_lot, 'N/A'), ' | ',
                yarn_count, '/', yarn_ply, ' | ',
                COALESCE(yarn_brand, 'N/A'), ' | ',
                COALESCE(received_against_po_no, 'N/A'), ' | ',
                COALESCE(received_against_dispo_nos, 'N/A'), ' | ',
                COALESCE(yarn_type, 'N/A'), ' | ',
                COALESCE(import_local_source, 'N/A')
            ) AS yarn_lot_detail,
            yarn_count, yarn_ply, received_against_po_no, received_against_dispo_nos,
            yarn_type, yarn_brand, yarn_composition, import_local_source, lc_unit, beneficiary_factory, created_at
        `,
        searchFields: ['yarn_lot', 'yarn_count', 'yarn_ply', 'yarn_brand', 'received_against_po_no', 'received_against_dispo_nos', 'yarn_type', 'import_local_source'],
        primarySearchFields: ['yarn_lot', 'received_against_po_no', 'received_against_dispo_nos'],
        extraWhere: "yarn_lot IS NOT NULL AND yarn_lot != ''",
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 3
    },
    yarn_issue_list: {
        table: 'yarn_issue_form',
        valueExpr: 'id',
        selectSql: `
            id, issue_challan_no, yarn_lot, yarn_count, yarn_ply, yarn_brand,
            received_against_dispo_nos, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
            issue_type, total_issued_kg, remaining_stock_kg, created_at
        `,
        searchFields: ['issue_challan_no', 'yarn_lot', 'yarn_count', 'yarn_ply', 'yarn_brand', 'received_against_dispo_nos', 'issue_type'],
        primarySearchFields: ['issue_challan_no', 'yarn_lot', 'received_against_dispo_nos'],
        extraWhere: "issue_challan_no IS NOT NULL AND issue_challan_no != ''",
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    dyed_yarn_receive_records: {
        table: 'dyed_yarn_receive',
        valueExpr: 'id',
        selectSql: '*',
        searchFields: ['id', 'received_against_dispo_no', 'received_against_po_no', 'buyer', 'yarn_count', 'number_of_ply', 'yarn_shade_category', 'batch_no', 'challan_no'],
        primarySearchFields: ['received_against_dispo_no', 'received_against_po_no', 'batch_no', 'challan_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    dyed_yarn_issue_records: {
        table: 'dyed_yarn_issue',
        valueExpr: 'id',
        selectSql: '*',
        searchFields: ['id', 'received_against_dispo_no', 'received_against_po_no', 'buyer', 'yarn_count', 'number_of_ply', 'yarn_shade_category', 'batch_no', 'challan_no'],
        primarySearchFields: ['received_against_dispo_no', 'received_against_po_no', 'batch_no', 'challan_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    warping_records: {
        table: 'warping_form',
        valueExpr: 'id',
        selectSql: 'id, warping_date, po_number, dispo_number, warping_program_no, buyer, machine_type, warping_set, machine_no, created_at',
        searchFields: ['id', 'warping_program_no', 'po_number', 'dispo_number', 'buyer', 'machine_type', 'warping_set', 'machine_no'],
        primarySearchFields: ['warping_program_no', 'po_number', 'dispo_number'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    sizing_records: {
        table: 'sizing_form',
        valueExpr: 'id',
        selectSql: 'id, sizing_date, po_number, dispo_number, warping_program_no, warping_set_no, warping_date, warping_machine_type, buyer, sizing_machine_no, total_size_beam, created_at',
        searchFields: ['id', 'po_number', 'dispo_number', 'warping_program_no', 'warping_set_no', 'buyer', 'sizing_machine_no'],
        primarySearchFields: ['po_number', 'dispo_number', 'warping_program_no', 'warping_set_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    loom_production_records: {
        table: 'loom_production_form',
        valueExpr: 'id',
        selectSql: 'id, loom_no, weaving_date, po_number, dispo_number, buyer, marketing_ref_tracking_no, production_construction, yarn_type, process_type, created_at',
        searchFields: ['id', 'loom_no', 'po_number', 'dispo_number', 'buyer', 'marketing_ref_tracking_no', 'production_construction', 'yarn_type', 'process_type'],
        primarySearchFields: ['po_number', 'dispo_number', 'loom_no', 'marketing_ref_tracking_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    greige_delivery_records: {
        table: 'greige_delivery_form',
        valueExpr: 'id',
        selectSql: "id, po_number, dispo_number, buyer, production_construction, DATE_FORMAT(delivery_date, '%Y-%m-%d') AS delivery_date, challan_no, customer_ref, greige_fabric_price_per_yds, created_at",
        searchFields: ['id', 'po_number', 'dispo_number', 'buyer', 'production_construction', 'challan_no', 'customer_ref'],
        primarySearchFields: ['po_number', 'dispo_number', 'challan_no', 'customer_ref'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    folding_production_records: {
        table: 'folding_production_form',
        valueExpr: 'id',
        selectSql: "id, po_number, dispo_number, buyer, production_construction, DATE_FORMAT(folding_production_date, '%Y-%m-%d') AS folding_production_date, a_grade_mtr, b_grade_mtr, greige_fabric_price_per_yds, created_at",
        searchFields: ['id', 'po_number', 'dispo_number', 'buyer', 'production_construction'],
        primarySearchFields: ['po_number', 'dispo_number'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    finish_delivery_records: {
        table: 'finish_delivery_form',
        valueExpr: 'id',
        selectSql: "id, po_number, dispo_number, buyer, production_construction, challan_no, DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') AS finish_delivery_date, delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds, created_at",
        searchFields: ['id', 'po_number', 'dispo_number', 'buyer', 'production_construction', 'challan_no'],
        primarySearchFields: ['po_number', 'dispo_number', 'challan_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    finish_receive_records: {
        table: 'finish_receive_form',
        valueExpr: 'id',
        selectSql: "id, po_number, dispo_number, buyer, production_construction, challan_no, DATE_FORMAT(finish_receive_date, '%Y-%m-%d') AS finish_receive_date, receive_qty_a_grade, receive_qty_b_grade, receive_qty_c_grade, receive_qty_reject, created_at",
        searchFields: ['id', 'po_number', 'dispo_number', 'buyer', 'production_construction', 'challan_no'],
        primarySearchFields: ['po_number', 'dispo_number', 'challan_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    floor_position_records: {
        table: 'floor_position',
        valueExpr: 'id',
        selectSql: "id, loom_no, beam_no, beam_length_in_yds, weaving_beam_set_no, DATE_FORMAT(beam_start_date, '%Y-%m-%d') AS beam_start_date, beam_start_time, loom_status, buyer, po_no, dispo_no, construction, created_at",
        searchFields: ['id', 'loom_no', 'beam_no', 'weaving_beam_set_no', 'loom_status', 'buyer', 'po_no', 'dispo_no', 'construction'],
        primarySearchFields: ['loom_no', 'beam_no', 'weaving_beam_set_no', 'po_no', 'dispo_no'],
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    },
    dispo_plan_records: {
        table: 'dispo_plan_form',
        valueExpr: 'id',
        selectSql: "id, dispo_no, po_no, buyer, production_construction, DATE_FORMAT(po_received_date, '%Y-%m-%d') AS po_received_date, created_at",
        searchFields: ['id', 'dispo_no', 'po_no', 'buyer', 'production_construction'],
        primarySearchFields: ['dispo_no', 'po_no'],
        extraWhere: "dispo_no IS NOT NULL AND dispo_no != ''",
        orderSql: 'created_at DESC, id DESC',
        dedupeKey: 'id',
        containsMinChars: 4
    }
});

function clampDropdownLimit(value, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(n, 100));
}

function cleanDropdownSearchText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

// V7.2: strict server-side safety filter for legacy blank/default-only yarn rows.
// Business rule confirmed from ERP Dispo form:
// - Warp rows count only when yarn_per_repeat, dyed_qty_kg, grey_qty_kg, no_of_cones, and cone_length are all filled with positive numeric values.
// - Weft rows count only when yarn_per_repeat, dyed_qty_kg, and grey_qty_kg are all filled with positive numeric values.
// Count, cal_count, color, LD number, yarn type, and default ply are descriptive fields only; they must not make a row real by themselves.
function toPositiveYarnNumber(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const lowered = text.toLowerCase();
    if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return null;
    const cleaned = text.replace(/,/g, '').replace(/%/g, '').replace(/"/g, '').replace(/[$৳£€]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function hasPositiveYarnNumber(row, key) {
    return toPositiveYarnNumber(row && row[key]) !== null;
}

function isMeaningfulWarpYarnRow(row) {
    if (!row) return false;
    return ['yarn_per_repeat', 'dyed_qty_kg', 'grey_qty_kg', 'no_of_cones', 'cone_length']
        .every(key => hasPositiveYarnNumber(row, key));
}

function isMeaningfulWeftYarnRow(row) {
    if (!row) return false;
    return ['yarn_per_repeat', 'dyed_qty_kg', 'grey_qty_kg']
        .every(key => hasPositiveYarnNumber(row, key));
}

function filterWarpYarnRows(rows) {
    return Array.isArray(rows) ? rows.filter(isMeaningfulWarpYarnRow) : [];
}

function filterWeftYarnRows(rows) {
    return Array.isArray(rows) ? rows.filter(isMeaningfulWeftYarnRow) : [];
}

function dropdownFieldLikeSql(field) {
    // Numeric id fields need CAST for search input; normal varchar/text fields should not be CASTed,
    // otherwise MySQL cannot use prefix indexes.
    if (field === 'id' || /_id$/.test(field)) return `CAST(${field} AS CHAR) LIKE ?`;
    return `${field} LIKE ?`;
}

function buildDropdownWhere(config, q, mode) {
    const params = [];
    const where = [];

    if (config.valueExpr && !String(config.valueExpr).includes('(') && config.valueExpr !== 'id') {
        where.push(`${config.valueExpr} IS NOT NULL`);
        where.push(`TRIM(${config.valueExpr}) != ''`);
    }
    if (config.extraWhere) where.push(`(${config.extraWhere})`);

    if (q) {
        const fields = mode === 'prefix'
            ? (config.primarySearchFields && config.primarySearchFields.length ? config.primarySearchFields : (config.searchFields || [config.valueExpr]))
            : (config.searchFields || [config.valueExpr]);
        const pattern = mode === 'prefix' ? `${q}%` : `%${q}%`;
        const searchSql = fields
            .filter(Boolean)
            .map(field => dropdownFieldLikeSql(field))
            .join(' OR ');
        if (searchSql) {
            where.push(`(${searchSql})`);
            fields.forEach(() => params.push(pattern));
        }
    }

    return {
        whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
        params
    };
}

function getDropdownRowKey(row, config) {
    const key = config.dedupeKey || config.valueExpr || 'id';
    const value = row?.[key] ?? row?.[config.valueExpr] ?? row?.id;
    return String(value ?? '');
}

async function runDropdownQuery(connection, config, q, mode, limit, offset) {
    const { whereSql, params } = buildDropdownWhere(config, q, mode);
    const sql = `
        SELECT ${config.selectSql}
        FROM ${config.table}
        ${whereSql}
        ORDER BY ${config.orderSql}
        LIMIT ? OFFSET ?
    `;
    const [rows] = await connection.query(sql, [...params, limit, offset]);
    return rows;
}

app.get('/main/api/dropdown-search', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const type = String(req.query.type || '').trim();
    const config = DROPDOWN_SEARCH_TYPES[type];
    if (!config) {
        return res.status(400).json({
            error: 'Unsupported dropdown search type',
            type,
            supported_types: Object.keys(DROPDOWN_SEARCH_TYPES)
        });
    }

    const q = cleanDropdownSearchText(req.query.q || '');
    const limit = clampDropdownLimit(req.query.limit, 35);
    const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
    const requestedMode = String(req.query.mode || '').trim().toLowerCase();
    const containsMinChars = Number.isFinite(Number(config.containsMinChars))
        ? Number(config.containsMinChars)
        : 4;
    const allowContains = requestedMode === 'contains'
        ? q.length >= Math.min(containsMinChars, 3)
        : requestedMode !== 'prefix' && q.length >= containsMinChars;
    const fillContainsWhenPrefixPartial = config.fillContainsWhenPrefixPartial === true;
    const effectiveLimit = limit + 1;

    let connection;
    try {
        connection = await pool.getConnection();

        let rows = [];
        let search_mode = 'latest';

        if (!q) {
            rows = await runDropdownQuery(connection, config, '', 'latest', effectiveLimit, offset);
        } else {
            // First pass: index-friendly prefix search.
            rows = await runDropdownQuery(connection, config, q, 'prefix', effectiveLimit, offset);
            search_mode = 'prefix';

            // Second pass: controlled contains search only when prefix did not fill the dropdown.
            // This preserves suffix/partial-code searches like "60489" while keeping normal code-prefix
            // searches such as "NDSD", "STPL", "AUTO" fast.
            if (allowContains && offset === 0 && (rows.length === 0 || (fillContainsWhenPrefixPartial && rows.length < effectiveLimit))) {
                const seen = new Set(rows.map(row => getDropdownRowKey(row, config)));
                const fallbackRows = await runDropdownQuery(connection, config, q, 'contains', effectiveLimit, 0);
                for (const row of fallbackRows) {
                    const key = getDropdownRowKey(row, config);
                    if (!seen.has(key)) {
                        rows.push(row);
                        seen.add(key);
                    }
                    if (rows.length >= effectiveLimit) break;
                }
                search_mode = 'prefix+contains_fallback';
            }
        }

        const hasMore = rows.length > limit;
        const trimmedRows = hasMore ? rows.slice(0, limit) : rows;
        const items = trimmedRows.map(row => ({
            type,
            id: row.id ?? row[config.valueExpr],
            value: row[config.valueExpr] ?? row.id ?? '',
            label: row[config.valueExpr] ?? row.id ?? '',
            raw: row
        }));

        res.json({
            success: true,
            type,
            q,
            search_mode,
            limit,
            offset,
            contains_min_chars: containsMinChars,
            contains_fallback_allowed: allowContains,
            count: items.length,
            has_more: hasMore,
            items
        });
    } catch (error) {
        console.error('Dropdown search failed:', { type, q, error: error.message });
        res.status(500).json({
            success: false,
            error: 'Failed to search dropdown records',
            type,
            details: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// API endpoint to check table structure
app.get('/main/api/debug/check-tables', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [tables] = await connection.query("SHOW TABLES LIKE 'user_privileges'");
        const tableExists = tables.length > 0;
        
        let columnsInfo = [];
        let recordCount = 0;
        let sampleRecords = [];
        
        if (tableExists) {
            const [columns] = await connection.query("SHOW COLUMNS FROM user_privileges");
            columnsInfo = columns;
            
            const [countResult] = await connection.query("SELECT COUNT(*) as count FROM user_privileges");
            recordCount = countResult[0].count;
            
            if (recordCount > 0) {
                const [records] = await connection.query("SELECT * FROM user_privileges LIMIT 5");
                sampleRecords = records;
            }
        }
        
        const [userTables] = await connection.query("SHOW TABLES LIKE 'users'");
        const userTableExists = userTables.length > 0;
        
        let userColumnsInfo = [];
        let userCount = 0;
        
        if (userTableExists) {
            const [columns] = await connection.query("SHOW COLUMNS FROM users");
            userColumnsInfo = columns;
            
            const [countResult] = await connection.query("SELECT COUNT(*) as count FROM users");
            userCount = countResult[0].count;
        }
        
        res.json({
            user_privileges: {
                exists: tableExists,
                columns: columnsInfo,
                recordCount: recordCount,
                sampleRecords: sampleRecords
            },
            users: {
                exists: userTableExists,
                columns: userColumnsInfo,
                recordCount: userCount
            }
        });
    } catch (error) {
        console.error('Error checking tables:', error);
        res.status(500).json({
            error: 'Failed to check tables',
            message: error.message,
            stack: error.stack
        });
    } finally {
        if (connection) connection.release();
    }
});

// Debug endpoint to check PO and Dispo table data
app.get('/main/api/debug/po-dispo-table-check', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Check PO_form_data table
        const [poTables] = await connection.query("SHOW TABLES LIKE 'PO_form_data'");
        const poTableExists = poTables.length > 0;
        
        let poColumns = [], poTotalRecords = 0, poSampleRecords = [], poNullCheck = [];
        if (poTableExists) {
            const [columns] = await connection.query("SHOW COLUMNS FROM PO_form_data");
            poColumns = columns;
            
            const [countResult] = await connection.query("SELECT COUNT(*) as count FROM PO_form_data");
            poTotalRecords = countResult[0].count;
            
            const [sample] = await connection.query(`
                SELECT po_no, po_issue_date, pre_costing_no, buyer_name 
                FROM PO_form_data 
                WHERE po_no IS NOT NULL AND po_no != ''
                LIMIT 5
            `);
            poSampleRecords = sample;
            
            const [nullResult] = await connection.query(`
                SELECT COUNT(*) as null_count 
                FROM PO_form_data 
                WHERE po_no IS NULL OR po_no = '' OR TRIM(po_no) = ''
            `);
            poNullCheck = nullResult[0].null_count;
        }
        
        // Check dispo_form_data table
        const [dispoTables] = await connection.query("SHOW TABLES LIKE 'dispo_form_data'");
        const dispoTableExists = dispoTables.length > 0;
        
        let dispoColumns = [], dispoTotalRecords = 0, dispoSampleRecords = [], dispoNullCheck = [];
        if (dispoTableExists) {
            const [columns] = await connection.query("SHOW COLUMNS FROM dispo_form_data");
            dispoColumns = columns;
            
            const [countResult] = await connection.query("SELECT COUNT(*) as count FROM dispo_form_data");
            dispoTotalRecords = countResult[0].count;
            
            const [sample] = await connection.query(`
                SELECT dispo_number, po_no, dispo_creating_date, buyer_name 
                FROM dispo_form_data 
                WHERE dispo_number IS NOT NULL AND dispo_number != ''
                LIMIT 5
            `);
            dispoSampleRecords = sample;
            
            const [nullResult] = await connection.query(`
                SELECT COUNT(*) as null_count 
                FROM dispo_form_data 
                WHERE dispo_number IS NULL OR dispo_number = '' OR TRIM(dispo_number) = ''
            `);
            dispoNullCheck = nullResult[0].null_count;
        }
        
        res.json({
            po_form_data: {
                tableExists: poTableExists,
                columns: poColumns.map(col => ({ name: col.Field, type: col.Type })),
                totalRecords: poTotalRecords,
                recordsWithNullPoNo: poNullCheck,
                sampleRecords: poSampleRecords
            },
            dispo_form_data: {
                tableExists: dispoTableExists,
                columns: dispoColumns.map(col => ({ name: col.Field, type: col.Type })),
                totalRecords: dispoTotalRecords,
                recordsWithNullDispoNo: dispoNullCheck,
                sampleRecords: dispoSampleRecords
            },
            message: 'PO and Dispo table diagnostic information'
        });
    } catch (error) {
        console.error('Error checking PO and Dispo tables:', error);
        res.status(500).json({ 
            error: 'Failed to check PO and Dispo tables', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Diagnostic endpoint to check paths
app.get('/main/api/diagnostics/check-path', (req, res) => {
    const paths = {
        'current_dir': __dirname,
        'poentry_path': path.resolve(__dirname, 'orderinformation_module/poentry_app'),
        'poentry_index_exists': fs.existsSync(path.resolve(__dirname, 'orderinformation_module/poentry_app/index.html')),
        'dispocreate_path': path.resolve(__dirname, 'orderinformation_module/dispocreate_app'),
        'dispocreate_index_exists': fs.existsSync(path.resolve(__dirname, 'orderinformation_module/dispocreate_app/index.html')),
        'relative_path': './orderinformation_module/dispocreate_app/index.html',
        'absolute_path': path.resolve(__dirname, 'orderinformation_module/dispocreate_app/index.html')
    };
    
    res.status(200).json(paths);
});

// Enhanced logging function
function enhancedLog(tag, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${tag}] ${message}`);
    if (data) {
        console.log(`[${timestamp}] [${tag}] Data:`, typeof data === 'object' ? JSON.stringify(data) : data);
    }
}

// Login API
app.post('/main/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        console.log('Login attempt for username:', username);
        
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) {
            console.log('Login failed: username not found');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = users[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            console.log('Login failed: password mismatch');
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const [privileges] = await pool.query(
            'SELECT sub_ui, module FROM user_privileges WHERE user_id = ?',
            [user.id]
        );
        
        console.log(`Found ${privileges.length} privileges for user ${username}`);

        const privilegeMap = {};
        if (Array.isArray(privileges)) {
            privileges.forEach(priv => {
                if (priv && priv.module && priv.sub_ui) {
                    const module = priv.module.toLowerCase();
                    const subUi = priv.sub_ui.toLowerCase();
                    privilegeMap[`${module}_${subUi}`] = true;
                    if (subUi.includes('_form')) {
                        const appVersion = subUi.replace('_form', '_app');
                        privilegeMap[`${module}_${appVersion}`] = true;
                    }
                    else if (subUi.includes('_app')) {
                        const formVersion = subUi.replace('_app', '_form');
                        privilegeMap[`${module}_${formVersion}`] = true;
                    }
                }
            });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            privileges: privilegeMap,
            loginTime: new Date().toISOString()
        };

        req.session.save(err => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            
            console.log('Login successful for user:', username);
            res.status(200).json({
                message: 'Login successful',
                user: {
                    username: user.username,
                    role: user.role,
                    privileges: req.session.user.privileges,
                },
            });
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Failed to login', details: error.message });
    }
});

// Registration API
app.post('/main/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [existingUsers] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, 'user']
        );

        res.status(200).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ error: 'Failed to register', details: error.message });
    }
});

// Logout API
app.post('/main/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.status(200).json({ message: 'Logout successful' });
    });
});

// Get current user API
app.get('/main/api/current-user', (req, res) => {
    console.log('Session user:', req.session.user);
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    res.status(200).json({
        user: {
            username: req.session.user.username,
            role: req.session.user.role,
            privileges: req.session.user.privileges,
        },
    });
});

// Get active users count API
app.get('/main/api/active-users', (req, res) => {
    try {
        sessionStore.all((err, sessions) => {
            if (err) {
                console.error('Error getting sessions:', err);
                return res.status(500).json({ error: 'Failed to get active users' });
            }
            
            const activeUsers = new Map();
            if (sessions) {
                const currentTime = new Date().getTime();
                Object.values(sessions).forEach(session => {
                    if (!session || !session.user || !session.user.id) {
                        return;
                    }
                    if (session.loggedOut === true) {
                        return;
                    }
                    if (session.cookie && session.cookie.expires) {
                        const expiryTime = new Date(session.cookie.expires).getTime();
                        if (expiryTime < currentTime) {
                            return;
                        }
                    }
                    activeUsers.set(session.user.id, {
                        username: session.user.username,
                        role: session.user.role
                    });
                });
            }
            
            const usersArray = Array.from(activeUsers.entries()).map(([id, data]) => ({
                id,
                username: data.username,
                role: data.role
            }));
            
            res.status(200).json({ 
                count: activeUsers.size,
                users: usersArray 
            });
        });
    } catch (error) {
        console.error('Error in active-users endpoint:', error);
        res.status(500).json({ error: 'Failed to get active users', details: error.message });
    }
});

// Get all users (for admin)
app.get('/main/api/users', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    try {
        const [users] = await pool.query('SELECT id, username FROM users WHERE role = "user"');
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users', details: error.message });
    }
});

// Get user privileges (for admin)
app.get('/main/api/user-privileges/:userId', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    try {
        console.log('Fetching privileges for user ID:', req.params.userId);
        
        const [privileges] = await pool.query(
            'SELECT id, sub_ui, module FROM user_privileges WHERE user_id = ?',
            [req.params.userId]
        );
        
        console.log('Raw privileges from database:', JSON.stringify(privileges));
        
        if (!privileges || privileges.length === 0) {
            console.log('No privileges found for user ID:', req.params.userId);
            return res.status(200).json([]);
        }
        
        const formattedPrivileges = privileges
            .filter(priv => priv && priv.sub_ui && priv.module)
            .map(priv => {
                let subUi = priv.sub_ui;
                if (subUi.includes('module_')) {
                    subUi = subUi.replace('module_', '');
                }
                return {
                    id: priv.id,
                    sub_ui: subUi.toLowerCase().trim(),
                    module: priv.module.toLowerCase().trim() + '_module'
                };
            });
        
        console.log('Formatted privileges being sent:', formattedPrivileges);
        
        res.status(200).json(formattedPrivileges);
    } catch (error) {
        console.error('Error fetching privileges:', error);
        res.status(500).json({ error: 'Failed to fetch privileges', details: error.message });
    }
});

// Update user privileges (for admin)
app.post('/main/api/update-privileges', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    const { userId, privileges } = req.body;
    console.log('Update privileges request received:', { userId, privilegesCount: privileges ? privileges.length : 0 });
    
    let connection;
    try {
        if (!userId) {
            throw new Error('Missing userId parameter');
        }
        
        if (!privileges || !Array.isArray(privileges)) {
            throw new Error('Privileges must be an array');
        }
        
        connection = await pool.getConnection();
        await connection.beginTransaction();

        console.log(`Deleting existing privileges for userId: ${userId}`);
        await connection.query('DELETE FROM user_privileges WHERE user_id = ?', [userId]);
        
        if (privileges.length > 0) {
            console.log(`Inserting ${privileges.length} new privileges for userId: ${userId}`);
            for (const priv of privileges) {
                if (!priv || typeof priv !== 'object') {
                    console.warn('Skipping invalid privilege object:', priv);
                    continue;
                }
                
                const subUi = priv.sub_ui ? priv.sub_ui.toString().toLowerCase().trim() : null;
                const module = priv.module ? priv.module.toString().toLowerCase().trim() : null;
                
                if (!subUi || !module) {
                    console.warn('Skipping privilege with missing sub_ui or module:', priv);
                    continue;
                }
                
                console.log(`Inserting privilege: user_id=${userId}, module=${module}, sub_ui=${subUi}`);
                await connection.query(
                    'INSERT INTO user_privileges (user_id, sub_ui, module) VALUES (?, ?, ?)',
                    [userId, subUi, module]
                );
            }
        } else {
            console.log(`No new privileges to insert for userId: ${userId}`);
        }

        await connection.commit();
        console.log(`Privileges updated successfully for userId: ${userId}`);
        
        res.status(200).json({ 
            message: 'Privileges updated successfully',
            updated: true,
            count: privileges.length
        });
    } catch (error) {
        console.error('Error in update-privileges:', error);
        if (connection) {
            try {
                await connection.rollback();
                console.log('Transaction rolled back due to error');
            } catch (rollbackError) {
                console.error('Error during rollback:', rollbackError);
            }
        }
        res.status(500).json({ 
            error: 'Failed to update privileges', 
            message: error.message,
            details: error.stack
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// PRECOSTING FORM API ENDPOINTS
// =====================================================

// Fetch Pre-Costing Numbers
app.get('/main/api/precosting/pre-costing-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        const [rows] = await pool.query('SELECT pre_costing_no FROM pre_costing_data WHERE pre_costing_no IS NOT NULL AND pre_costing_no != "" ORDER BY pre_costing_no');
        res.status(200).json(rows.map(row => ({ pre_costing_no: row.pre_costing_no })));
    } catch (error) {
        console.error('Error fetching pre-costing numbers:', error);
        res.status(500).json({ error: 'Failed to fetch pre-costing numbers', details: error.message });
    }
});

// Search Pre-Costing Data
app.get('/main/api/precosting/search/:preCostingNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { preCostingNo } = req.params;
    const decodedPreCostingNo = decodeURIComponent(preCostingNo).replace(/%2F/g, '/').trim();
    try {
        const [preCostingResult] = await pool.query(
            'SELECT * FROM pre_costing_data WHERE LOWER(TRIM(pre_costing_no)) = LOWER(TRIM(?))',
            [decodedPreCostingNo]
        );

        if (preCostingResult.length === 0) {
            return res.status(404).json({ error: 'No data found for the selected Pre-costing No.' });
        }

        const [warpDetailsResult] = await pool.query(
            'SELECT * FROM warp_details WHERE LOWER(TRIM(pre_costing_no)) = LOWER(TRIM(?))',
            [decodedPreCostingNo]
        );

        const [weftDetailsResult] = await pool.query(
            'SELECT * FROM weft_details WHERE LOWER(TRIM(pre_costing_no)) = LOWER(TRIM(?))',
            [decodedPreCostingNo]
        );

        // Derive fabric_composition from warp and weft details
        let fabricComposition = '';
        if (warpDetailsResult.length > 0 || weftDetailsResult.length > 0) {
            const warpComp = warpDetailsResult.map(d => `${d.color_name} (${d.warp_count})`).join(', ');
            const weftComp = weftDetailsResult.map(d => `${d.color_name} (${d.weft_count})`).join(', ');
            fabricComposition = [warpComp, weftComp].filter(Boolean).join(' / ');
        }

        res.status(200).json({
            preCostingData: {
                ...preCostingResult[0],
                fabric_composition: fabricComposition || preCostingResult[0].construction || ''
            },
            warpDetails: warpDetailsResult,
            weftDetails: weftDetailsResult
        });
    } catch (error) {
        console.error('Error searching pre-costing data:', error);
        res.status(500).json({ error: 'Failed to search pre-costing data', details: error.message });
    }
});

// Generate Next Pre-Costing Number - FIXED
app.get('/main/api/precosting/next-pre-costing-no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        // Query for the Pre/costing/No:XX format used in database
        const [rows] = await pool.query(
            `SELECT pre_costing_no FROM pre_costing_data 
             WHERE pre_costing_no LIKE 'Pre/costing/No:%' 
             ORDER BY CAST(SUBSTRING_INDEX(pre_costing_no, ':', -1) AS UNSIGNED) DESC 
             LIMIT 1`
        );

        let nextNumber = 1;
        if (rows.length > 0) {
            const lastPreCostingNo = rows[0].pre_costing_no;
            // Extract the numeric part from Pre/costing/No:XX format
            const match = lastPreCostingNo.match(/Pre\/costing\/No:(\d+)/);
            if (match) {
                nextNumber = parseInt(match[1], 10) + 1;
            }
        }

        // Format with leading zero if needed
        const formattedNumber = nextNumber < 10 ? `0${nextNumber}` : nextNumber.toString();
        const nextPreCostingNo = `Pre/costing/No:${formattedNumber}`;
        
        console.log('Generated next pre-costing number:', nextPreCostingNo);
        res.status(200).json({ pre_costing_no: nextPreCostingNo });
    } catch (error) {
        console.error('Error generating next pre-costing number:', error);
        res.status(500).json({ error: 'Failed to generate next pre-costing number', details: error.message });
    }
});



// Existing Pre-Costing APIs
app.post('/main/api/precosting/save', async (req, res) => {
    const { preCostingData, warpDetails, weftDetails, operation } = req.body;
    
    // Only check for the absolutely essential field
    if (!preCostingData.pre_costing_no) {
        return res.status(400).json({ error: 'Pre-costing number is required' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // CORRECTED: Insert query matching EXACT database structure
        const insertPreCostingQuery = `
            INSERT INTO pre_costing_data (
                pre_costing_no, buyer, construction, finish_width, total_ends, warp_crimp, yd_allow, warp_wast, weft_wast, finish_allow,
                weaving_rate, dye_finish_rate, commercial_cost, profit, greige_req_quantity, required_warp_yarn, required_weft_yarn,
                total_required_yarn, warp_greige_consump, weft_greige_consump, total_greige_consump, warp_finish_consump, weft_finish_consump,
                total_finish_consump, total_greige_yarn_cost_per_yd, warp_yarn_cost, weft_yarn_cost, greige_cost, yarn_dyeing_cost,
                total_yarn_cost, weaving_cost, break_even_cost, sales_price, upcharged_sales_price, total_warp_cost, total_weft_cost,
                total_greige_cost, total_dyeing_cost, total_weaving_cost, total_dye_finish_cost, total_commercial_cost, grand_total_break_even_cost,
                net_break_even_cost_per_yd, net_profit_per_yd, grand_total_profit, total_sales_value, upcharged_net_profit_per_yd,
                upcharged_grand_total_profit, upcharged_total_sales_value, total_pre_cost_tk, total_pre_cost_usd, total_upcharged_pre_cost_tk,
                total_upcharged_pre_cost_usd, total_greige_yarn_cost_usd, greige_yarn_cost_per_yd_usd, weaving_cost_usd, break_even_cost_usd,
                pick_rate_usd, total_greige_cost_usd, total_weaving_cost_usd, net_break_even_cost_per_yd_usd, upcharged_net_profit_per_yd_usd,
                epi, ppi, weave_type, greige_width, weft_crimp, order_quantity, pick_length, dollar_rate_tk, pre_costing_date,
                warp_count_1, warp_ply_1, warp_count_2, warp_ply_2, warp_count_3, warp_ply_3,
                weft_count_1, weft_ply_1, weft_count_2, weft_ply_2, weft_count_3, weft_ply_3
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            ) ON DUPLICATE KEY UPDATE
                buyer = VALUES(buyer),
                construction = VALUES(construction),
                finish_width = VALUES(finish_width),
                total_ends = VALUES(total_ends),
                warp_crimp = VALUES(warp_crimp),
                yd_allow = VALUES(yd_allow),
                warp_wast = VALUES(warp_wast),
                weft_wast = VALUES(weft_wast),
                finish_allow = VALUES(finish_allow),
                weaving_rate = VALUES(weaving_rate),
                dye_finish_rate = VALUES(dye_finish_rate),
                commercial_cost = VALUES(commercial_cost),
                profit = VALUES(profit),
                greige_req_quantity = VALUES(greige_req_quantity),
                required_warp_yarn = VALUES(required_warp_yarn),
                required_weft_yarn = VALUES(required_weft_yarn),
                total_required_yarn = VALUES(total_required_yarn),
                warp_greige_consump = VALUES(warp_greige_consump),
                weft_greige_consump = VALUES(weft_greige_consump),
                total_greige_consump = VALUES(total_greige_consump),
                warp_finish_consump = VALUES(warp_finish_consump),
                weft_finish_consump = VALUES(weft_finish_consump),
                total_finish_consump = VALUES(total_finish_consump),
                total_greige_yarn_cost_per_yd = VALUES(total_greige_yarn_cost_per_yd),
                warp_yarn_cost = VALUES(warp_yarn_cost),
                weft_yarn_cost = VALUES(weft_yarn_cost),
                greige_cost = VALUES(greige_cost),
                yarn_dyeing_cost = VALUES(yarn_dyeing_cost),
                total_yarn_cost = VALUES(total_yarn_cost),
                weaving_cost = VALUES(weaving_cost),
                break_even_cost = VALUES(break_even_cost),
                sales_price = VALUES(sales_price),
                upcharged_sales_price = VALUES(upcharged_sales_price),
                total_warp_cost = VALUES(total_warp_cost),
                total_weft_cost = VALUES(total_weft_cost),
                total_greige_cost = VALUES(total_greige_cost),
                total_dyeing_cost = VALUES(total_dyeing_cost),
                total_weaving_cost = VALUES(total_weaving_cost),
                total_dye_finish_cost = VALUES(total_dye_finish_cost),
                total_commercial_cost = VALUES(total_commercial_cost),
                grand_total_break_even_cost = VALUES(grand_total_break_even_cost),
                net_break_even_cost_per_yd = VALUES(net_break_even_cost_per_yd),
                net_profit_per_yd = VALUES(net_profit_per_yd),
                grand_total_profit = VALUES(grand_total_profit),
                total_sales_value = VALUES(total_sales_value),
                upcharged_net_profit_per_yd = VALUES(upcharged_net_profit_per_yd),
                upcharged_grand_total_profit = VALUES(upcharged_grand_total_profit),
                upcharged_total_sales_value = VALUES(upcharged_total_sales_value),
                total_pre_cost_tk = VALUES(total_pre_cost_tk),
                total_pre_cost_usd = VALUES(total_pre_cost_usd),
                total_upcharged_pre_cost_tk = VALUES(total_upcharged_pre_cost_tk),
                total_upcharged_pre_cost_usd = VALUES(total_upcharged_pre_cost_usd),
                total_greige_yarn_cost_usd = VALUES(total_greige_yarn_cost_usd),
                greige_yarn_cost_per_yd_usd = VALUES(greige_yarn_cost_per_yd_usd),
                weaving_cost_usd = VALUES(weaving_cost_usd),
                break_even_cost_usd = VALUES(break_even_cost_usd),
                pick_rate_usd = VALUES(pick_rate_usd),
                total_greige_cost_usd = VALUES(total_greige_cost_usd),
                total_weaving_cost_usd = VALUES(total_weaving_cost_usd),
                net_break_even_cost_per_yd_usd = VALUES(net_break_even_cost_per_yd_usd),
                upcharged_net_profit_per_yd_usd = VALUES(upcharged_net_profit_per_yd_usd),
                epi = VALUES(epi),
                ppi = VALUES(ppi),
                weave_type = VALUES(weave_type),
                greige_width = VALUES(greige_width),
                weft_crimp = VALUES(weft_crimp),
                order_quantity = VALUES(order_quantity),
                pick_length = VALUES(pick_length),
                dollar_rate_tk = VALUES(dollar_rate_tk),
                pre_costing_date = VALUES(pre_costing_date),
                warp_count_1 = VALUES(warp_count_1),
                warp_ply_1 = VALUES(warp_ply_1),
                warp_count_2 = VALUES(warp_count_2),
                warp_ply_2 = VALUES(warp_ply_2),
                warp_count_3 = VALUES(warp_count_3),
                warp_ply_3 = VALUES(warp_ply_3),
                weft_count_1 = VALUES(weft_count_1),
                weft_ply_1 = VALUES(weft_ply_1),
                weft_count_2 = VALUES(weft_count_2),
                weft_ply_2 = VALUES(weft_ply_2),
                weft_count_3 = VALUES(weft_count_3),
                weft_ply_3 = VALUES(weft_ply_3)
        `;

        // CORRECTED: Values array matching the exact database column order (83 values)
        const preCostingValues = [
            // Columns 1-50: Basic data
            preCostingData.pre_costing_no,                    // 1
            preCostingData.buyer || '',                       // 2
            preCostingData.construction || '',                // 3
            preCostingData.finish_width || 0,                 // 4
            preCostingData.total_ends || 0,                   // 5
            preCostingData.warp_crimp || 0,                   // 6
            preCostingData.yd_allow || 0,                     // 7
            preCostingData.warp_wast || 0,                    // 8
            preCostingData.weft_wast || 0,                    // 9
            preCostingData.finish_allow || 0,                 // 10
            preCostingData.weaving_rate || 0,                 // 11
            preCostingData.dye_finish_rate || 0,              // 12
            preCostingData.commercial_cost || 0,              // 13
            preCostingData.profit || 0,                       // 14
            preCostingData.greige_req_quantity || 0,          // 15
            preCostingData.required_warp_yarn || 0,           // 16
            preCostingData.required_weft_yarn || 0,           // 17
            preCostingData.total_required_yarn || 0,          // 18
            preCostingData.warp_greige_consump || 0,          // 19
            preCostingData.weft_greige_consump || 0,          // 20
            preCostingData.total_greige_consump || 0,         // 21
            preCostingData.warp_finish_consump || 0,          // 22
            preCostingData.weft_finish_consump || 0,          // 23
            preCostingData.total_finish_consump || 0,         // 24
            preCostingData.total_greige_yarn_cost_per_yd || 0, // 25
            preCostingData.warp_yarn_cost || 0,               // 26
            preCostingData.weft_yarn_cost || 0,               // 27
            preCostingData.greige_cost || 0,                  // 28
            preCostingData.yarn_dyeing_cost || 0,             // 29
            preCostingData.total_yarn_cost || 0,              // 30
            preCostingData.weaving_cost || 0,                 // 31
            preCostingData.break_even_cost || 0,              // 32
            preCostingData.sales_price || 0,                  // 33
            preCostingData.upcharged_sales_price || 0,        // 34
            preCostingData.total_warp_cost || 0,              // 35
            preCostingData.total_weft_cost || 0,              // 36
            preCostingData.total_greige_cost || 0,            // 37
            preCostingData.total_dyeing_cost || 0,            // 38
            preCostingData.total_weaving_cost || 0,           // 39
            preCostingData.total_dye_finish_cost || 0,        // 40
            preCostingData.total_commercial_cost || 0,        // 41
            preCostingData.grand_total_break_even_cost || 0,  // 42
            preCostingData.net_break_even_cost_per_yd || 0,   // 43
            preCostingData.net_profit_per_yd || 0,            // 44
            preCostingData.grand_total_profit || 0,           // 45
            preCostingData.total_sales_value || 0,            // 46
            preCostingData.upcharged_net_profit_per_yd || 0,  // 47
            preCostingData.upcharged_grand_total_profit || 0, // 48
            preCostingData.upcharged_total_sales_value || 0,  // 49
            preCostingData.total_pre_cost_tk || 0,            // 50
            
            // Columns 51-53: Original USD fields
            preCostingData.total_pre_cost_usd || 0,           // 51
            preCostingData.total_upcharged_pre_cost_tk || 0,  // 52
            preCostingData.total_upcharged_pre_cost_usd || 0, // 53
            
            // Columns 54-62: New USD fields
            preCostingData.total_greige_yarn_cost_usd || 0,   // 54
            preCostingData.greige_yarn_cost_per_yd_usd || 0,  // 55
            preCostingData.weaving_cost_usd || 0,             // 56
            preCostingData.break_even_cost_usd || 0,          // 57
            preCostingData.pick_rate_usd || 0,                // 58
            preCostingData.total_greige_cost_usd || 0,        // 59
            preCostingData.total_weaving_cost_usd || 0,       // 60
            preCostingData.net_break_even_cost_per_yd_usd || 0, // 61
            preCostingData.upcharged_net_profit_per_yd_usd || 0, // 62
            
            // Columns 63-71: Technical fields
            preCostingData.epi || 0,                          // 63
            preCostingData.ppi || 0,                          // 64
            preCostingData.weave_type || '',                  // 65
            preCostingData.greige_width || 0,                 // 66
            preCostingData.weft_crimp || 0,                   // 67
            preCostingData.order_quantity || 0,               // 68
            preCostingData.pick_length || 0,                  // 69
            preCostingData.dollar_rate_tk || 0,               // 70
            preCostingData.pre_costing_date || new Date().toISOString().split('T')[0], // 71
            
            // Columns 72-83: Ply fields
            preCostingData.warp_count_1 || null,             // 72
            preCostingData.warp_ply_1 || null,               // 73
            preCostingData.warp_count_2 || null,             // 74
            preCostingData.warp_ply_2 || null,               // 75
            preCostingData.warp_count_3 || null,             // 76
            preCostingData.warp_ply_3 || null,               // 77
            preCostingData.weft_count_1 || null,             // 78
            preCostingData.weft_ply_1 || null,               // 79
            preCostingData.weft_count_2 || null,             // 80
            preCostingData.weft_ply_2 || null,               // 81
            preCostingData.weft_count_3 || null,             // 82
            preCostingData.weft_ply_3 || null                // 83
        ];

        console.log('Values array length:', preCostingValues.length);

        await connection.query(insertPreCostingQuery, preCostingValues);

        // Handle warp details
        await connection.query('DELETE FROM warp_details WHERE pre_costing_no = ?', [preCostingData.pre_costing_no]);
        for (const detail of warpDetails) {
            await connection.query(
                `INSERT INTO warp_details (
                    pre_costing_no, warp_count, warp_ply, repeat_breakdown, color_name, denting, rate_per_lbs, dyeing_cost_per_kg,
                    repeat_ends_per_color, pattern_total_ends, dent_numbers_in_full_width, greige_yarn_rate, consumption,
                    yarn_cost, color_cost, warp_total_cost, required_greige
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    detail.pre_costing_no, detail.warp_count, detail.warp_ply || 1, detail.repeat_breakdown, detail.color_name, detail.denting,
                    detail.rate_per_lbs, detail.dyeing_cost_per_kg, detail.repeat_ends_per_color, detail.pattern_total_ends,
                    detail.dent_numbers_in_full_width, detail.greige_yarn_rate, detail.consumption, detail.yarn_cost,
                    detail.color_cost, detail.warp_total_cost, detail.required_greige
                ]
            );
        }

        // Handle weft details
        await connection.query('DELETE FROM weft_details WHERE pre_costing_no = ?', [preCostingData.pre_costing_no]);
        for (const detail of weftDetails) {
            await connection.query(
                `INSERT INTO weft_details (
                    pre_costing_no, weft_count, weft_ply, repeat_breakdown, color_name, pick_density, rate_per_lbs, dyeing_cost_per_kg,
                    repeat_picks_per_color, pattern_total_picks, greige_yarn_rate, consumption, yarn_cost, color_cost,
                    weft_total_cost, required_greige
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    detail.pre_costing_no, detail.weft_count, detail.weft_ply || 1, detail.repeat_breakdown, detail.color_name, detail.pick_density,
                    detail.rate_per_lbs, detail.dyeing_cost_per_kg, detail.repeat_picks_per_color, detail.pattern_total_picks,
                    detail.greige_yarn_rate, detail.consumption, detail.yarn_cost, detail.color_cost, detail.weft_total_cost,
                    detail.required_greige
                ]
            );
        }

        await connection.commit();
        res.status(200).json({ message: `Data ${operation === 'update' ? 'updated' : 'saved'} successfully to MySQL!` });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving to MySQL:', error);
        res.status(500).json({ error: 'Failed to save data to MySQL', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// PO ENTRY FORM API ENDPOINTS
// =====================================================

// Delete PO by PO No (Updated for consistent error handling and logging)
app.delete('/main/api/po/delete/:poNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const poNo = decodeURIComponent(req.params.poNo).trim();
    enhancedLog('PO_DELETE_REQUEST', 'Attempting to delete PO with po_no', poNo);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [result] = await connection.query(
            'DELETE FROM PO_form_data WHERE po_no = ?',
            [poNo]
        );

        if (result.affectedRows === 0) {
            throw new Error(`No PO found with PO number: ${poNo}`);
        }

        await connection.commit();
        enhancedLog('PO_DELETE', 'Successfully deleted PO', { po_no: poNo });
        res.status(200).json({ message: `PO ${poNo} deleted successfully!` });
    } catch (error) {
        if (connection) await connection.rollback();
        enhancedLog('PO_DELETE_ERROR', 'Failed to delete PO', { 
            error: error.message,
            stack: error.stack,
            po_no: poNo 
        });
        // Check if the error is due to no PO found, then send 404, otherwise 500
        if (error.message.includes('No PO found')) {
            res.status(404).json({ 
                error: 'PO not found', 
                details: error.message 
            });
        } else {
            res.status(500).json({ 
                error: 'Failed to delete PO', 
                details: error.message,
                stack: error.stack 
            });
        }
    } finally {
        if (connection) connection.release();
    }
});

// Fetch PO Numbers
app.get('/main/api/po/po-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    try {
        const [rows] = await pool.query('SELECT po_no FROM PO_form_data WHERE po_no IS NOT NULL AND po_no != "" ORDER BY po_no');
        res.status(200).json(rows.map(row => ({ po_no: row.po_no })));
    } catch (error) {
        console.error('Error fetching PO numbers:', error);
        res.status(500).json({ error: 'Failed to fetch PO numbers', details: error.message });
    }
});

// Search PO by Pre-Costing No
app.get('/main/api/po/search/:preCostingNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { preCostingNo } = req.params;
    const decodedPreCostingNo = decodeURIComponent(preCostingNo).replace(/%2F/g, '/').trim();
    try {
        const [poResult] = await pool.query(
            'SELECT * FROM PO_form_data WHERE LOWER(TRIM(pre_costing_no)) = LOWER(TRIM(?))',
            [decodedPreCostingNo]
        );

        if (poResult.length === 0) {
            return res.status(404).json({ error: 'No PO data found for the selected Pre-costing No.' });
        }

        res.status(200).json(poResult[0]);
    } catch (error) {
        console.error('Error searching PO data:', error);
        res.status(500).json({ error: 'Failed to search PO data', details: error.message });
    }
});

// Search PO by PO No - CORRECTED to also fetch dispo-related fields
app.get('/main/api/po/search-by-po-no/:poNo', async (req, res) => {
  if (!req.session.user) {
    enhancedLog('PO_SEARCH_ERROR', 'Unauthorized access', { poNo: req.params.poNo });
    return res.status(401).json({ error: 'Not logged in' });
  }

  const poNo = req.params.poNo;
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Fetch PO data from PO_form_data
    const [rows] = await connection.query(
      `SELECT 
        po_no, pre_costing_no, po_issue_date, po_revise_date, po_approval_date,
        order_no, pi_no, account_holder, buyer_name, order_status, buyer_style_ref,
        po_quantity, po_revised_no, po_revised_reason, repeat_order_no, garments_address,
        approval, pi_date, price_per_yard, upcharge_price_per_yard_tk, price_per_yard_usd,
        upcharge_price_per_yard_usd, weave_type, finish_type, sticker_construction,
        production_construction, sticker_composition, fabric_composition, dispo_overall_width,
        dispo_cuttable_width, t_number, strike_off_hl_number, dispo_number, print_method,
        process_type, fabric_type, yarn_type, order_type, pp_delivery_date, bulk_delivery_date,
        end_use, wash_type, light_source, warp_tensile_strength, weft_tensile_strength,
        pilling_grade, rubbing_grade, elongation, growth, recovery, buyer_gsm_before_wash,
        buyer_gsm_after_wash, warp_shrinkage, weft_shrinkage, quality_parameter,
        warp_tear_strength, weft_tear_strength, special_note, created_at,
        warp_count_1, warp_ply_1, warp_count_2, warp_ply_2, warp_count_3, warp_ply_3,
        weft_count_1, weft_ply_1, weft_count_2, weft_ply_2, weft_count_3, weft_ply_3
       FROM PO_form_data WHERE po_no = ?`,
      [poNo]
    );

    if (rows.length === 0) {
      enhancedLog('PO_SEARCH_NOT_FOUND', 'No PO data found', { poNo });
      return res.status(404).json({ error: 'No PO data found for this PO No.' });
    }

    // CORRECTED: Also check dispo_form_data for dispo-related fields
    const [dispoRows] = await connection.query(
      `SELECT development_id, handloom_number, dispo_number 
       FROM dispo_form_data 
       WHERE po_no = ? 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [poNo]
    );

    // If dispo exists for this PO, merge dispo-related fields into the response
    if (dispoRows.length > 0) {
      const dispoData = dispoRows[0];
      
      // Update fields only if they have values in dispo_form_data
      // t_number maps to development_id (NF Number)
      if (dispoData.development_id) {
        rows[0].t_number = dispoData.development_id;
      }
      
      // strike_off_hl_number maps to handloom_number (SO/HL Number)
      if (dispoData.handloom_number) {
        rows[0].strike_off_hl_number = dispoData.handloom_number;
      }
      
      // dispo_number
      if (dispoData.dispo_number) {
        rows[0].dispo_number = dispoData.dispo_number;
      }
      
      enhancedLog('PO_SEARCH_DISPO_MERGED', 'Merged dispo data into PO response', { 
        poNo, 
        development_id: dispoData.development_id,
        handloom_number: dispoData.handloom_number,
        dispo_number: dispoData.dispo_number
      });
    }

    enhancedLog('PO_SEARCH_SUCCESS', 'Successfully fetched PO data', { poNo });
    res.status(200).json(rows[0]);
  } catch (error) {
    enhancedLog('PO_SEARCH_ERROR', 'Failed to fetch PO data', {
      poNo,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Failed to fetch PO data',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});




// FINAL CORRECTED Save PO data endpoint 
app.post('/main/api/po/save', async (req, res) => {
  if (!req.session.user) {
    enhancedLog('PO_SAVE_ERROR', 'Unauthorized access', {});
    return res.status(401).json({ error: 'Not logged in' });
  }

  const formData = req.body;
  enhancedLog('PO_SAVE_REQUEST', 'Received PO save request', { formData });

  // Validate required fields
  const requiredFields = ['pre_costing_no', 'po_no'];
  for (const field of requiredFields) {
    if (!formData[field] || formData[field].trim() === '') {
      enhancedLog('PO_SAVE_ERROR', `Missing required field: ${field}`, { formData });
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  // Map form data to database fields with CORRECTED data types
  const data = {
    po_no: formData.po_no ? formData.po_no.trim() : null,
    pre_costing_no: formData.pre_costing_no ? formData.pre_costing_no.trim() : null,
    po_issue_date: formData.po_issue_date || null,
    po_revise_date: formData.po_revise_date || null,
    po_approval_date: formData.po_approval_date || null,
    order_no: formData.order_no ? formData.order_no.trim() : null,
    pi_no: formData.pi_no ? formData.pi_no.trim() : null,
    account_holder: formData.account_holder ? formData.account_holder.trim() : null,
    buyer_name: formData.buyer_name ? formData.buyer_name.trim() : null,
    order_status: formData.order_status ? formData.order_status.trim() : null,
    buyer_style_ref: formData.buyer_style_ref ? formData.buyer_style_ref.trim() : null,
    po_quantity: formData.po_quantity && !isNaN(parseInt(formData.po_quantity, 10)) ? parseInt(formData.po_quantity, 10) : null,
    po_revised_no: formData.po_revised_no ? formData.po_revised_no.trim() : null,
    po_revised_reason: formData.po_revised_reason ? formData.po_revised_reason.trim() : null,
    repeat_order_no: formData.repeat_order_no ? formData.repeat_order_no.trim() : null,
    garments_address: formData.garments_address ? formData.garments_address.trim() : null,
    approval: formData.approval ? formData.approval.trim() : null,
    pi_date: formData.pi_date || null,
    price_per_yard: formData.price_per_yard && !isNaN(parseFloat(formData.price_per_yard)) ? parseFloat(formData.price_per_yard) : null,
    upcharge_price_per_yard_tk: formData.upcharge_price_per_yard_tk && !isNaN(parseFloat(formData.upcharge_price_per_yard_tk)) ? parseFloat(formData.upcharge_price_per_yard_tk) : null,
    price_per_yard_usd: formData.price_per_yard_usd && !isNaN(parseFloat(formData.price_per_yard_usd)) ? parseFloat(formData.price_per_yard_usd) : null,
    upcharge_price_per_yard_usd: formData.upcharge_price_per_yard_usd && !isNaN(parseFloat(formData.upcharge_price_per_yard_usd)) ? parseFloat(formData.upcharge_price_per_yard_usd) : null,
    weave_type: formData.weave_type ? formData.weave_type.trim() : null,
    finish_type: formData.finish_type ? formData.finish_type.trim() : null,
    sticker_construction: formData.sticker_construction ? formData.sticker_construction.trim() : null,
    production_construction: formData.production_construction ? formData.production_construction.trim() : null,
    sticker_composition: formData.sticker_composition ? formData.sticker_composition.trim() : null,
    fabric_composition: formData.fabric_composition ? formData.fabric_composition.trim() : null,
    dispo_overall_width: formData.dispo_overall_width ? formData.dispo_overall_width.trim() : null,
    dispo_cuttable_width: formData.dispo_cuttable_width ? formData.dispo_cuttable_width.trim() : null,
    t_number: formData.t_number ? formData.t_number.trim() : null,
    strike_off_hl_number: formData.strike_off_hl_number ? formData.strike_off_hl_number.trim() : null,
    dispo_number: formData.dispo_number ? formData.dispo_number.trim() : null,
    print_method: formData.print_method ? formData.print_method.trim() : null,
    process_type: formData.process_type ? formData.process_type.trim() : null,
    fabric_type: formData.fabric_type ? formData.fabric_type.trim() : null,
    yarn_type: formData.yarn_type ? formData.yarn_type.trim() : null,
    order_type: formData.order_type ? formData.order_type.trim() : null,
    pp_delivery_date: formData.pp_delivery_date || null,
    bulk_delivery_date: formData.bulk_delivery_date || null,
    end_use: formData.end_use ? formData.end_use.trim() : null,
    wash_type: formData.wash_type ? formData.wash_type.trim() : null,
    light_source: formData.light_source ? formData.light_source.trim() : null,
    warp_tensile_strength: formData.warp_tensile_strength ? formData.warp_tensile_strength.trim() : null,
    weft_tensile_strength: formData.weft_tensile_strength ? formData.weft_tensile_strength.trim() : null,
    pilling_grade: formData.pilling_grade ? formData.pilling_grade.trim() : null,
    rubbing_grade: formData.rubbing_grade ? formData.rubbing_grade.trim() : null,
    elongation: formData.elongation ? formData.elongation.trim() : null,
    growth: formData.growth ? formData.growth.trim() : null,
    recovery: formData.recovery ? formData.recovery.trim() : null,
    buyer_gsm_before_wash: formData.buyer_gsm_before_wash ? formData.buyer_gsm_before_wash.trim() : null,
    buyer_gsm_after_wash: formData.buyer_gsm_after_wash ? formData.buyer_gsm_after_wash.trim() : null,
    warp_shrinkage: formData.warp_shrinkage ? formData.warp_shrinkage.trim() : null,
    weft_shrinkage: formData.weft_shrinkage ? formData.weft_shrinkage.trim() : null,
    quality_parameter: formData.quality_parameter ? formData.quality_parameter.trim() : null,
    warp_tear_strength: formData.warp_tear_strength ? formData.warp_tear_strength.trim() : null,
    weft_tear_strength: formData.weft_tear_strength ? formData.weft_tear_strength.trim() : null,
    special_note: formData.special_note ? formData.special_note.trim() : null,
    warp_count_1: formData.warp_count_1 ? formData.warp_count_1.trim() : null,
    warp_ply_1: formData.warp_ply_1 && !isNaN(parseInt(formData.warp_ply_1, 10)) ? parseInt(formData.warp_ply_1, 10) : null,
    warp_count_2: formData.warp_count_2 ? formData.warp_count_2.trim() : null,
    warp_ply_2: formData.warp_ply_2 && !isNaN(parseInt(formData.warp_ply_2, 10)) ? parseInt(formData.warp_ply_2, 10) : null,
    warp_count_3: formData.warp_count_3 ? formData.warp_count_3.trim() : null,
    warp_ply_3: formData.warp_ply_3 && !isNaN(parseInt(formData.warp_ply_3, 10)) ? parseInt(formData.warp_ply_3, 10) : null,
    weft_count_1: formData.weft_count_1 ? formData.weft_count_1.trim() : null,
    weft_ply_1: formData.weft_ply_1 && !isNaN(parseInt(formData.weft_ply_1, 10)) ? parseInt(formData.weft_ply_1, 10) : null,
    weft_count_2: formData.weft_count_2 ? formData.weft_count_2.trim() : null,
    weft_ply_2: formData.weft_ply_2 && !isNaN(parseInt(formData.weft_ply_2, 10)) ? parseInt(formData.weft_ply_2, 10) : null,
    weft_count_3: formData.weft_count_3 ? formData.weft_count_3.trim() : null,
    weft_ply_3: formData.weft_ply_3 && !isNaN(parseInt(formData.weft_ply_3, 10)) ? parseInt(formData.weft_ply_3, 10) : null
  };

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Validate pre_costing_no exists in pre_costing_data
    const [preCostingCheck] = await connection.query(
      'SELECT COUNT(*) as count FROM pre_costing_data WHERE pre_costing_no = ?',
      [data.pre_costing_no]
    );
    if (preCostingCheck[0].count === 0) {
      enhancedLog('PO_SAVE_ERROR', 'Pre Costing No does not exist', { pre_costing_no: data.pre_costing_no });
      await connection.rollback();
      return res.status(400).json({ error: 'Pre Costing No does not exist in pre_costing_data' });
    }

    // FIXED: Exclude created_at entirely - MySQL will handle it automatically with default value
    const insertQuery = `
      INSERT INTO PO_form_data (
        po_no, pre_costing_no, po_issue_date, po_revise_date, po_approval_date,
        order_no, pi_no, account_holder, buyer_name, order_status, buyer_style_ref,
        po_quantity, po_revised_no, po_revised_reason, repeat_order_no, garments_address,
        approval, pi_date, price_per_yard, upcharge_price_per_yard_tk, price_per_yard_usd,
        upcharge_price_per_yard_usd, weave_type, finish_type, sticker_construction,
        production_construction, sticker_composition, fabric_composition, dispo_overall_width,
        dispo_cuttable_width, t_number, strike_off_hl_number, dispo_number, print_method,
        process_type, fabric_type, yarn_type, order_type, pp_delivery_date, bulk_delivery_date,
        end_use, wash_type, light_source, warp_tensile_strength, weft_tensile_strength,
        pilling_grade, rubbing_grade, elongation, growth, recovery, buyer_gsm_before_wash,
        buyer_gsm_after_wash, warp_shrinkage, weft_shrinkage, quality_parameter,
        warp_tear_strength, weft_tear_strength, special_note,
        warp_count_1, warp_ply_1, warp_count_2, warp_ply_2, warp_count_3, warp_ply_3,
        weft_count_1, weft_ply_1, weft_count_2, weft_ply_2, weft_count_3, weft_ply_3
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON DUPLICATE KEY UPDATE
        pre_costing_no = VALUES(pre_costing_no),
        po_issue_date = VALUES(po_issue_date),
        po_revise_date = VALUES(po_revise_date),
        po_approval_date = VALUES(po_approval_date),
        order_no = VALUES(order_no),
        pi_no = VALUES(pi_no),
        account_holder = VALUES(account_holder),
        buyer_name = VALUES(buyer_name),
        order_status = VALUES(order_status),
        buyer_style_ref = VALUES(buyer_style_ref),
        po_quantity = VALUES(po_quantity),
        po_revised_no = VALUES(po_revised_no),
        po_revised_reason = VALUES(po_revised_reason),
        repeat_order_no = VALUES(repeat_order_no),
        garments_address = VALUES(garments_address),
        approval = VALUES(approval),
        pi_date = VALUES(pi_date),
        price_per_yard = VALUES(price_per_yard),
        upcharge_price_per_yard_tk = VALUES(upcharge_price_per_yard_tk),
        price_per_yard_usd = VALUES(price_per_yard_usd),
        upcharge_price_per_yard_usd = VALUES(upcharge_price_per_yard_usd),
        weave_type = VALUES(weave_type),
        finish_type = VALUES(finish_type),
        sticker_construction = VALUES(sticker_construction),
        production_construction = VALUES(production_construction),
        sticker_composition = VALUES(sticker_composition),
        fabric_composition = VALUES(fabric_composition),
        dispo_overall_width = VALUES(dispo_overall_width),
        dispo_cuttable_width = VALUES(dispo_cuttable_width),
        t_number = VALUES(t_number),
        strike_off_hl_number = VALUES(strike_off_hl_number),
        dispo_number = VALUES(dispo_number),
        print_method = VALUES(print_method),
        process_type = VALUES(process_type),
        fabric_type = VALUES(fabric_type),
        yarn_type = VALUES(yarn_type),
        order_type = VALUES(order_type),
        pp_delivery_date = VALUES(pp_delivery_date),
        bulk_delivery_date = VALUES(bulk_delivery_date),
        end_use = VALUES(end_use),
        wash_type = VALUES(wash_type),
        light_source = VALUES(light_source),
        warp_tensile_strength = VALUES(warp_tensile_strength),
        weft_tensile_strength = VALUES(weft_tensile_strength),
        pilling_grade = VALUES(pilling_grade),
        rubbing_grade = VALUES(rubbing_grade),
        elongation = VALUES(elongation),
        growth = VALUES(growth),
        recovery = VALUES(recovery),
        buyer_gsm_before_wash = VALUES(buyer_gsm_before_wash),
        buyer_gsm_after_wash = VALUES(buyer_gsm_after_wash),
        warp_shrinkage = VALUES(warp_shrinkage),
        weft_shrinkage = VALUES(weft_shrinkage),
        quality_parameter = VALUES(quality_parameter),
        warp_tear_strength = VALUES(warp_tear_strength),
        weft_tear_strength = VALUES(weft_tear_strength),
        special_note = VALUES(special_note),
        warp_count_1 = VALUES(warp_count_1),
        warp_ply_1 = VALUES(warp_ply_1),
        warp_count_2 = VALUES(warp_count_2),
        warp_ply_2 = VALUES(warp_ply_2),
        warp_count_3 = VALUES(warp_count_3),
        warp_ply_3 = VALUES(warp_ply_3),
        weft_count_1 = VALUES(weft_count_1),
        weft_ply_1 = VALUES(weft_ply_1),
        weft_count_2 = VALUES(weft_count_2),
        weft_ply_2 = VALUES(weft_ply_2),
        weft_count_3 = VALUES(weft_count_3),
        weft_ply_3 = VALUES(weft_ply_3)
    `;
    
    // FIXED: 70 values for 70 columns (excluding created_at which has default value)
    const values = [
      data.po_no, data.pre_costing_no, data.po_issue_date, data.po_revise_date, data.po_approval_date,
      data.order_no, data.pi_no, data.account_holder, data.buyer_name, data.order_status,
      data.buyer_style_ref, data.po_quantity, data.po_revised_no, data.po_revised_reason,
      data.repeat_order_no, data.garments_address, data.approval, data.pi_date,
      data.price_per_yard, data.upcharge_price_per_yard_tk, data.price_per_yard_usd,
      data.upcharge_price_per_yard_usd, data.weave_type, data.finish_type,
      data.sticker_construction, data.production_construction, data.sticker_composition,
      data.fabric_composition, data.dispo_overall_width, data.dispo_cuttable_width,
      data.t_number, data.strike_off_hl_number, data.dispo_number, data.print_method,
      data.process_type, data.fabric_type, data.yarn_type, data.order_type,
      data.pp_delivery_date, data.bulk_delivery_date, data.end_use, data.wash_type,
      data.light_source, data.warp_tensile_strength, data.weft_tensile_strength,
      data.pilling_grade, data.rubbing_grade, data.elongation, data.growth, data.recovery,
      data.buyer_gsm_before_wash, data.buyer_gsm_after_wash, data.warp_shrinkage,
      data.weft_shrinkage, data.quality_parameter, data.warp_tear_strength,
      data.weft_tear_strength, data.special_note,
      data.warp_count_1, data.warp_ply_1, data.warp_count_2, data.warp_ply_2,
      data.warp_count_3, data.warp_ply_3, data.weft_count_1, data.weft_ply_1,
      data.weft_count_2, data.weft_ply_2, data.weft_count_3, data.weft_ply_3
    ];

    // Enhanced debugging logs
    console.log('=== PO SAVE DEBUG INFO ===');
    console.log('Total columns in INSERT (excluding created_at):', 70);
    console.log('Values array length:', values.length);
    console.log('Values array:', values.map((v, i) => `${i+1}: ${v === null ? 'NULL' : v}`));
    console.log('=== END DEBUG INFO ===');
    
    enhancedLog('PO_SAVE_QUERY', 'Executing PO save query', {
      valuesCount: values.length,
      po_no: data.po_no,
      pre_costing_no: data.pre_costing_no
    });

    try {
      const [result] = await connection.query(insertQuery, values);
      await connection.commit();
      enhancedLog('PO_SAVE_SUCCESS', 'Successfully saved PO form data', {
        pre_costing_no: data.pre_costing_no,
        po_no: data.po_no,
        affectedRows: result.affectedRows
      });
      res.status(200).json({ message: 'PO data saved successfully to MySQL!' });
    } catch (queryError) {
      enhancedLog('PO_SAVE_QUERY_ERROR', 'Failed to execute PO save query', {
        error: queryError.message,
        sqlMessage: queryError.sqlMessage,
        sqlState: queryError.sqlState,
        errno: queryError.errno,
        po_no: data.po_no,
        pre_costing_no: data.pre_costing_no
      });
      await connection.rollback();
      throw queryError;
    }
  } catch (error) {
    if (connection) await connection.rollback();
    enhancedLog('PO_SAVE_ERROR', 'Failed to save PO form data', {
      error: error.message,
      sqlMessage: error.sqlMessage || 'N/A',
      sqlState: error.sqlState || 'N/A',
      errno: error.errno || 'N/A',
      formData: { po_no: data.po_no, pre_costing_no: data.pre_costing_no },
      stack: error.stack
    });
    res.status(500).json({
      error: 'Failed to save PO data to MySQL',
      details: error.message,
      sqlMessage: error.sqlMessage || 'N/A',
      sqlState: error.sqlState || 'N/A',
      errno: error.errno || 'N/A',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// API endpoint to get PO numbers with dates - Enhanced with all required fields
app.get('/main/api/po/po-numbers-with-dates', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                po_no, 
                pre_costing_no,
                DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                pi_no,
                buyer_name,
                po_quantity,
                price_per_yard,
                upcharge_price_per_yard_tk,
                price_per_yard_usd,
                upcharge_price_per_yard_usd,
                sticker_construction,
                production_construction,
                sticker_composition,
                fabric_composition,
                warp_count_1,
                warp_ply_1,
                warp_count_2,
                warp_ply_2,
                warp_count_3,
                warp_ply_3,
                weft_count_1,
                weft_ply_1,
                weft_count_2,
                weft_ply_2,
                weft_count_3,
                weft_ply_3,
                order_status,
                created_at
            FROM PO_form_data 
            WHERE po_no IS NOT NULL 
            AND po_no != ''
            AND TRIM(po_no) != ''
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(po_issue_date) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(po_issue_date) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(po_issue_date) <= DATE(?)';
            params.push(endDate);
        }
        
        query += ' ORDER BY po_issue_date DESC, po_no DESC';
        
        console.log('Executing enhanced query:', query, 'with params:', params);
        
        const [rows] = await connection.query(query, params);
        
        console.log(`Found ${rows.length} PO records with enhanced data`);
        
        const formattedRows = rows.map(row => ({
            po_no: row.po_no || 'N/A',
            pre_costing_no: row.pre_costing_no || 'N/A',
            po_issue_date: row.po_issue_date || null,
            pi_no: row.pi_no || 'N/A',
            buyer_name: row.buyer_name || 'N/A',
            po_quantity: row.po_quantity || 'N/A',
            price_per_yard: row.price_per_yard || 0,
            upcharge_price_per_yard_tk: row.upcharge_price_per_yard_tk || 0,
            price_per_yard_usd: row.price_per_yard_usd || 0,
            upcharge_price_per_yard_usd: row.upcharge_price_per_yard_usd || 0,
            sticker_construction: row.sticker_construction || 'N/A',
            production_construction: row.production_construction || 'N/A',
            sticker_composition: row.sticker_composition || 'N/A',
            fabric_composition: row.fabric_composition || 'N/A',
            warp_count_1: row.warp_count_1 || 'N/A',
            warp_ply_1: row.warp_ply_1 || 'N/A',
            warp_count_2: row.warp_count_2 || 'N/A',
            warp_ply_2: row.warp_ply_2 || 'N/A',
            warp_count_3: row.warp_count_3 || 'N/A',
            warp_ply_3: row.warp_ply_3 || 'N/A',
            weft_count_1: row.weft_count_1 || 'N/A',
            weft_ply_1: row.weft_ply_1 || 'N/A',
            weft_count_2: row.weft_count_2 || 'N/A',
            weft_ply_2: row.weft_ply_2 || 'N/A',
            weft_count_3: row.weft_count_3 || 'N/A',
            weft_ply_3: row.weft_ply_3 || 'N/A',
            order_status: row.order_status || 'N/A',
            created_at: row.created_at || null
        }));
        
        res.json(formattedRows);
    } catch (error) {
        console.error('Error fetching enhanced PO data:', error);
        res.status(500).json({ 
            error: 'Failed to fetch PO numbers with enhanced data', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        if (connection) connection.release();
    }
});

 // API endpoint to export PO numbers as CSV - Enhanced with all fields
app.get('/main/api/po/export-csv', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                po_no, pre_costing_no, DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                po_revise_date, po_approval_date, order_no, pi_no, account_holder, buyer_name,
                order_status, buyer_style_ref, po_quantity, po_revised_no, po_revised_reason,
                repeat_order_no, garments_address, approval, pi_date, price_per_yard,
                upcharge_price_per_yard_tk, price_per_yard_usd, upcharge_price_per_yard_usd,
                weave_type, finish_type, sticker_construction, production_construction,
                sticker_composition, fabric_composition, warp_count_1, warp_ply_1, warp_count_2,
                warp_ply_2, warp_count_3, warp_ply_3, weft_count_1, weft_ply_1, weft_count_2,
                weft_ply_2, weft_count_3, weft_ply_3, dispo_overall_width, dispo_cuttable_width,
                t_number, strike_off_hl_number, dispo_number, print_method, process_type,
                fabric_type, yarn_type, order_type, pp_delivery_date, bulk_delivery_date,
                end_use, wash_type, light_source, warp_tensile_strength, weft_tensile_strength,
                pilling_grade, rubbing_grade, elongation, growth, recovery, buyer_gsm_before_wash,
                buyer_gsm_after_wash, warp_shrinkage, weft_shrinkage, quality_parameter,
                warp_tear_strength, weft_tear_strength, special_note, created_at
            FROM PO_form_data 
            WHERE po_no IS NOT NULL 
            AND po_no != ''
            AND TRIM(po_no) != ''
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(po_issue_date) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(po_issue_date) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(po_issue_date) <= DATE(?)';
            params.push(endDate);
        }
        
        query += ' ORDER BY po_issue_date DESC, po_no DESC';
        
        const [rows] = await connection.query(query, params);
        
        const csvHeader = [
            'PO No', 'Pre Costing No', 'PO Issue Date', 'PO Revise Date', 'PO Approval Date',
            'Order No', 'PI No', 'Account Holder', 'Buyer Name', 'Order Status',
            'Buyer Style/Ref', 'PO Quantity', 'PO Revised No', 'PO Revised Reason',
            'Repeat Order No', 'Garments Address', 'Approved', 'PI Date', 'Price/Yds TK',
            'Upcharge Price/Yds TK', 'Price/Yds USD', 'Upcharge Price/Yds USD', 'Weave Type',
            'Finish Type', 'Sticker Construction', 'Production Construction', 'Sticker Composition',
            'Fabric Composition', 'Warp Count 1', 'Warp Ply 1', 'Warp Count 2', 'Warp Ply 2',
            'Warp Count 3', 'Warp Ply 3', 'Weft Count 1', 'Weft Ply 1', 'Weft Count 2',
            'Weft Ply 2', 'Weft Count 3', 'Weft Ply 3', 'Dispo Overall Width',
            'Dispo Cuttable Width', 'Dispo Reference', 'Strike Off/HL Ref', 'Dispo Number',
            'Print Method', 'Process Type', 'Fabric Type', 'Yarn Type', 'Order Type',
            'PP Delivery Date', 'Bulk Delivery Date', 'End Use', 'Wash Type', 'Light Source',
            'Warp Tensile Force', 'Weft Tensile Force', 'Pilling Grade', 'Rubbing Grade',
            'Elongation%', 'Growth%', 'Recovery%', 'Buyer GSM (B/W)', 'Buyer GSM (A/W)',
            'Warp Shrinkage%', 'Weft Shrinkage%', 'Quality Parameters', 'Warp Tear Force',
            'Weft Tear Force', 'Special Note', 'Created At'
        ].join(',');

        const csvRows = rows.map(row => [
            `"${(row.po_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.pre_costing_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.po_issue_date || 'N/A'}"`,
            `"${row.po_revise_date || 'N/A'}"`,
            `"${row.po_approval_date || 'N/A'}"`,
            `"${(row.order_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.pi_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.account_holder || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_name || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.order_status || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_style_ref || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.po_quantity || 'N/A'}"`,
            `"${(row.po_revised_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.po_revised_reason || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.repeat_order_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.garments_address || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.approval || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.pi_date || 'N/A'}"`,
            `"${row.price_per_yard || '0'}"`,
            `"${row.upcharge_price_per_yard_tk || '0'}"`,
            `"${row.price_per_yard_usd || '0'}"`,
            `"${row.upcharge_price_per_yard_usd || '0'}"`,
            `"${(row.weave_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.finish_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.sticker_construction || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.production_construction || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.sticker_composition || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.fabric_composition || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_count_1 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_ply_1 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_count_2 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_ply_2 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_count_3 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_ply_3 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_count_1 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_ply_1 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_count_2 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_ply_2 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_count_3 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_ply_3 || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.dispo_overall_width || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.dispo_cuttable_width || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.t_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.strike_off_hl_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.dispo_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.print_method || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.process_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.fabric_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.yarn_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.order_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.pp_delivery_date || 'N/A'}"`,
            `"${row.bulk_delivery_date || 'N/A'}"`,
            `"${(row.end_use || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.wash_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.light_source || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_tensile_strength || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_tensile_strength || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.pilling_grade || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.rubbing_grade || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.elongation || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.growth || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.recovery || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_gsm_before_wash || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_gsm_after_wash || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_shrinkage || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_shrinkage || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.quality_parameter || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.warp_tear_strength || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weft_tear_strength || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.special_note || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.created_at || 'N/A'}"`
        ].join(','));

        const csv = [csvHeader, ...csvRows].join('\n');
        
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `saved_po_numbers_${startDate || 'all'}_${endDate || 'all'}_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
        
        res.send(csv);
    } catch (error) {
        console.error('Error exporting enhanced PO CSV:', error);
        res.status(500).json({ 
            error: 'Failed to export PO numbers as CSV', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// DISPO CREATE FORM API ENDPOINTS
// =====================================================

// FINAL CORRECTED Enhanced Dispo save data to MySQL - UPDATED with new fields (114 columns)
app.post('/main/api/dispo/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { dispoData, warpYarnDetails, weftYarnDetails, warpBrokenSection, warpBrokenPattern } = req.body;
    console.log('Incoming dispo formData:', dispoData);

    const requiredFields = ['dispo_number', 'po_no'];
    for (const field of requiredFields) {
        if (!dispoData[field] || dispoData[field].trim() === '') {
            return res.status(400).json({ error: `Missing required field: ${field}` });
        }
    }

    // CORRECTED Enhanced data mapping - MATCHES database schema exactly (114 fields excluding created_at)
    const data = {
        dispo_number: dispoData.dispo_number ? dispoData.dispo_number.trim() : null,
        po_no: dispoData.po_no ? dispoData.po_no.trim() : null,
        po_issue_date: dispoData.po_issue_date || null,
        po_revise_date: dispoData.po_revise_date || null,
        po_approval_date: dispoData.po_approval_date || null,
        dispo_creating_date: dispoData.dispo_creating_date || null,
        order_no: dispoData.order_no || null,
        precosting_number: dispoData.precosting_number || null,
        pi_no: dispoData.pi_no || null,
        account_holder: dispoData.account_holder || null,
        buyer_name: dispoData.buyer_name || null,
        buyer_color_reference: dispoData.buyer_color_reference ? dispoData.buyer_color_reference.trim() : null,
        order_status: dispoData.order_status && ['pending', 'approved', 'cancelled'].includes(dispoData.order_status) ? dispoData.order_status : null,
        buyer_style_ref: dispoData.buyer_style_ref || null,
        development_id: dispoData.development_id || null,
        handloom_number: dispoData.handloom_number || null,
        print_method: dispoData.print_method || null,
        process_type: dispoData.process_type || null,
        fabric_type: dispoData.fabric_type || null,
        yarn_type: dispoData.yarn_type || null,
        order_type: dispoData.order_type || null,
        pp_delivery_date: dispoData.pp_delivery_date || null,
        bulk_delivery_date: dispoData.bulk_delivery_date || null,
        garments_name: dispoData.garments_name ? dispoData.garments_name.trim() : null,
        end_use: dispoData.end_use || null,
        wash_type: dispoData.wash_type || null,
        light_source: dispoData.light_source || null,
        weave_type: dispoData.weave_type || null,
        sticker_construction: dispoData.sticker_construction || null,
        production_construction: dispoData.production_construction || null,
        sticker_composition: dispoData.sticker_composition || null,
        fabric_composition: dispoData.fabric_composition || null,
        
        // Numeric fields with proper conversion
        reed_count: dispoData.reed_count && !isNaN(parseInt(dispoData.reed_count)) ? parseInt(dispoData.reed_count) : null,
        ends_per_dent: dispoData.ends_per_dent && !isNaN(parseInt(dispoData.ends_per_dent)) ? parseInt(dispoData.ends_per_dent) : null,
        
        warp_count_1: dispoData.warp_count_1 || null,
        warp_ply_1: dispoData.warp_ply_1 && !isNaN(parseInt(dispoData.warp_ply_1)) ? parseInt(dispoData.warp_ply_1) : null,
        warp_count_2: dispoData.warp_count_2 || null,
        warp_ply_2: dispoData.warp_ply_2 && !isNaN(parseInt(dispoData.warp_ply_2)) ? parseInt(dispoData.warp_ply_2) : null,
        warp_count_3: dispoData.warp_count_3 || null,
        warp_ply_3: dispoData.warp_ply_3 && !isNaN(parseInt(dispoData.warp_ply_3)) ? parseInt(dispoData.warp_ply_3) : null,
        weft_count_1: dispoData.weft_count_1 || null,
        weft_ply_1: dispoData.weft_ply_1 && !isNaN(parseInt(dispoData.weft_ply_1)) ? parseInt(dispoData.weft_ply_1) : null,
        weft_count_2: dispoData.weft_count_2 || null,
        weft_ply_2: dispoData.weft_ply_2 && !isNaN(parseInt(dispoData.weft_ply_2)) ? parseInt(dispoData.weft_ply_2) : null,
        weft_count_3: dispoData.weft_count_3 || null,
        weft_ply_3: dispoData.weft_ply_3 && !isNaN(parseInt(dispoData.weft_ply_3)) ? parseInt(dispoData.weft_ply_3) : null,
        
        finish_epi: dispoData.finish_epi && !isNaN(parseInt(dispoData.finish_epi)) ? parseInt(dispoData.finish_epi) : null,
        finish_ppi: dispoData.finish_ppi && !isNaN(parseInt(dispoData.finish_ppi)) ? parseInt(dispoData.finish_ppi) : null,
        
        // Decimal fields
        calculation_width: dispoData.calculation_width && !isNaN(parseFloat(dispoData.calculation_width)) ? parseFloat(dispoData.calculation_width) : null,
        dispo_overall_width: dispoData.dispo_overall_width && !isNaN(parseFloat(dispoData.dispo_overall_width)) ? parseFloat(dispoData.dispo_overall_width) : null,
        dispo_cuttable_width: dispoData.dispo_cuttable_width && !isNaN(parseFloat(dispoData.dispo_cuttable_width)) ? parseFloat(dispoData.dispo_cuttable_width) : null,
        
        finish_type: dispoData.finish_type || null,
        
        selvedge_width: dispoData.selvedge_width && !isNaN(parseInt(dispoData.selvedge_width)) ? parseInt(dispoData.selvedge_width) : null,
        selvedge_ends_per_dent: dispoData.selvedge_ends_per_dent && !isNaN(parseInt(dispoData.selvedge_ends_per_dent)) ? parseInt(dispoData.selvedge_ends_per_dent) : null,
        
        po_qty_yds: dispoData.po_qty_yds && !isNaN(parseInt(dispoData.po_qty_yds)) ? parseInt(dispoData.po_qty_yds) : null,
        finish_qty_yds: dispoData.finish_qty_yds && !isNaN(parseInt(dispoData.finish_qty_yds)) ? parseInt(dispoData.finish_qty_yds) : null,
        adjust_qty_yds: dispoData.adjust_qty_yds && !isNaN(parseInt(dispoData.adjust_qty_yds)) ? parseInt(dispoData.adjust_qty_yds) : null,
        
        warp_yd_allowance: dispoData.warp_yd_allowance && !isNaN(parseFloat(dispoData.warp_yd_allowance)) ? parseFloat(dispoData.warp_yd_allowance) : null,
        weft_yd_allowance: dispoData.weft_yd_allowance && !isNaN(parseFloat(dispoData.weft_yd_allowance)) ? parseFloat(dispoData.weft_yd_allowance) : null,
        finishing_process_loss: dispoData.finishing_process_loss && !isNaN(parseFloat(dispoData.finishing_process_loss)) ? parseFloat(dispoData.finishing_process_loss) : null,
        print_allowance: dispoData.print_allowance && !isNaN(parseFloat(dispoData.print_allowance)) ? parseFloat(dispoData.print_allowance) : null,
        loom_contraction: dispoData.loom_contraction && !isNaN(parseFloat(dispoData.loom_contraction)) ? parseFloat(dispoData.loom_contraction) : null,
        weft_contraction: dispoData.weft_contraction && !isNaN(parseFloat(dispoData.weft_contraction)) ? parseFloat(dispoData.weft_contraction) : null,
        lower_beam_crimp: dispoData.lower_beam_crimp && !isNaN(parseFloat(dispoData.lower_beam_crimp)) ? parseFloat(dispoData.lower_beam_crimp) : null,
        reduce_pick: dispoData.reduce_pick && !isNaN(parseFloat(dispoData.reduce_pick)) ? parseFloat(dispoData.reduce_pick) : null,
        pick_length_inch: dispoData.pick_length_inch && !isNaN(parseFloat(dispoData.pick_length_inch)) ? parseFloat(dispoData.pick_length_inch) : null,
        
        creel_repeat: dispoData.creel_repeat && !isNaN(parseInt(dispoData.creel_repeat)) ? parseInt(dispoData.creel_repeat) : null,
        extra_cone_length: dispoData.extra_cone_length && !isNaN(parseInt(dispoData.extra_cone_length)) ? parseInt(dispoData.extra_cone_length) : null,
        
        // Calculated fields
        grey_epi: dispoData.grey_epi && !isNaN(parseInt(dispoData.grey_epi)) ? parseInt(dispoData.grey_epi) : null,
        grey_ppi: dispoData.grey_ppi && !isNaN(parseInt(dispoData.grey_ppi)) ? parseInt(dispoData.grey_ppi) : null,
        beam_total_ends: dispoData.beam_total_ends && !isNaN(parseInt(dispoData.beam_total_ends)) ? parseInt(dispoData.beam_total_ends) : null,
        body_ends: dispoData.body_ends && !isNaN(parseInt(dispoData.body_ends)) ? parseInt(dispoData.body_ends) : null,
        
        actual_section: dispoData.actual_section && !isNaN(parseFloat(dispoData.actual_section)) ? parseFloat(dispoData.actual_section) : null,
        calculated_section: dispoData.calculated_section && !isNaN(parseFloat(dispoData.calculated_section)) ? parseFloat(dispoData.calculated_section) : null,
        finish_length_mtr: dispoData.finish_length_mtr && !isNaN(parseFloat(dispoData.finish_length_mtr)) ? parseFloat(dispoData.finish_length_mtr) : null,
        print_qty_mtr: dispoData.print_qty_mtr && !isNaN(parseFloat(dispoData.print_qty_mtr)) ? parseFloat(dispoData.print_qty_mtr) : null,
        grey_qty_mtr: dispoData.grey_qty_mtr && !isNaN(parseFloat(dispoData.grey_qty_mtr)) ? parseFloat(dispoData.grey_qty_mtr) : null,
        loom_production_mtr: dispoData.loom_production_mtr && !isNaN(parseFloat(dispoData.loom_production_mtr)) ? parseFloat(dispoData.loom_production_mtr) : null,
        warp_beam_length: dispoData.warp_beam_length && !isNaN(parseFloat(dispoData.warp_beam_length)) ? parseFloat(dispoData.warp_beam_length) : null,
        reed_space_inch: dispoData.reed_space_inch && !isNaN(parseFloat(dispoData.reed_space_inch)) ? parseFloat(dispoData.reed_space_inch) : null,
        grey_width_inch: dispoData.grey_width_inch && !isNaN(parseFloat(dispoData.grey_width_inch)) ? parseFloat(dispoData.grey_width_inch) : null,
        
        warp_consumption_yds: dispoData.warp_consumption_yds && !isNaN(parseFloat(dispoData.warp_consumption_yds)) ? parseFloat(dispoData.warp_consumption_yds) : null,
        weft_consumption_yds: dispoData.weft_consumption_yds && !isNaN(parseFloat(dispoData.weft_consumption_yds)) ? parseFloat(dispoData.weft_consumption_yds) : null,
        total_consumption_yds: dispoData.total_consumption_yds && !isNaN(parseFloat(dispoData.total_consumption_yds)) ? parseFloat(dispoData.total_consumption_yds) : null,
        
        warp_cover_factor: dispoData.warp_cover_factor && !isNaN(parseFloat(dispoData.warp_cover_factor)) ? parseFloat(dispoData.warp_cover_factor) : null,
        weft_cover_factor: dispoData.weft_cover_factor && !isNaN(parseFloat(dispoData.weft_cover_factor)) ? parseFloat(dispoData.weft_cover_factor) : null,
        total_cover_factor: dispoData.total_cover_factor && !isNaN(parseFloat(dispoData.total_cover_factor)) ? parseFloat(dispoData.total_cover_factor) : null,
        
        calculated_gsm_regular: dispoData.calculated_gsm_regular && !isNaN(parseFloat(dispoData.calculated_gsm_regular)) ? parseFloat(dispoData.calculated_gsm_regular) : null,
        calculated_gsm_lycra: dispoData.calculated_gsm_lycra && !isNaN(parseFloat(dispoData.calculated_gsm_lycra)) ? parseFloat(dispoData.calculated_gsm_lycra) : null,
        
        // CORRECTED: Selvedge fields according to updated schema
        left_selvedge_ends: dispoData.left_selvedge_ends && !isNaN(parseInt(dispoData.left_selvedge_ends)) ? parseInt(dispoData.left_selvedge_ends) : null,
        right_selvedge_ends: dispoData.right_selvedge_ends && !isNaN(parseInt(dispoData.right_selvedge_ends)) ? parseInt(dispoData.right_selvedge_ends) : null,
        selvedge_dents_per_side: dispoData.selvedge_dents_per_side && !isNaN(parseInt(dispoData.selvedge_dents_per_side)) ? parseInt(dispoData.selvedge_dents_per_side) : null,
        left_selvedge_spec: dispoData.left_selvedge_spec || null,
        right_selvedge_spec: dispoData.right_selvedge_spec || null,
        
        // Quality parameters
        warp_tear_strength: dispoData.warp_tear_strength && !isNaN(parseInt(dispoData.warp_tear_strength)) ? parseInt(dispoData.warp_tear_strength) : null,
        weft_tear_strength: dispoData.weft_tear_strength && !isNaN(parseInt(dispoData.weft_tear_strength)) ? parseInt(dispoData.weft_tear_strength) : null,
        warp_tensile_strength: dispoData.warp_tensile_strength && !isNaN(parseInt(dispoData.warp_tensile_strength)) ? parseInt(dispoData.warp_tensile_strength) : null,
        weft_tensile_strength: dispoData.weft_tensile_strength && !isNaN(parseInt(dispoData.weft_tensile_strength)) ? parseInt(dispoData.weft_tensile_strength) : null,
        pilling_grade: dispoData.pilling_grade && !isNaN(parseInt(dispoData.pilling_grade)) ? parseInt(dispoData.pilling_grade) : null,
        rubbing_grade: dispoData.rubbing_grade && !isNaN(parseInt(dispoData.rubbing_grade)) ? parseInt(dispoData.rubbing_grade) : null,
        elongation: dispoData.elongation && !isNaN(parseInt(dispoData.elongation)) ? parseInt(dispoData.elongation) : null,
        growth: dispoData.growth && !isNaN(parseInt(dispoData.growth)) ? parseInt(dispoData.growth) : null,
        recovery: dispoData.recovery && !isNaN(parseInt(dispoData.recovery)) ? parseInt(dispoData.recovery) : null,
        buyer_gsm_bw: dispoData.buyer_gsm_bw && !isNaN(parseFloat(dispoData.buyer_gsm_bw)) ? parseFloat(dispoData.buyer_gsm_bw) : null,
        buyer_gsm_aw: dispoData.buyer_gsm_aw && !isNaN(parseFloat(dispoData.buyer_gsm_aw)) ? parseFloat(dispoData.buyer_gsm_aw) : null,
        warp_shrinkage: dispoData.warp_shrinkage && !isNaN(parseFloat(dispoData.warp_shrinkage)) ? parseFloat(dispoData.warp_shrinkage) : null,
        weft_shrinkage: dispoData.weft_shrinkage && !isNaN(parseFloat(dispoData.weft_shrinkage)) ? parseFloat(dispoData.weft_shrinkage) : null,
        quality_parameter: dispoData.quality_parameter || null,
        additional_remarks: dispoData.additional_remarks || null,
        
        // Precosting fields
        pc_regular_price_usd: dispoData.pc_regular_price_usd && !isNaN(parseFloat(dispoData.pc_regular_price_usd)) ? parseFloat(dispoData.pc_regular_price_usd) : null,
        pc_upcharge_price_usd: dispoData.pc_upcharge_price_usd && !isNaN(parseFloat(dispoData.pc_upcharge_price_usd)) ? parseFloat(dispoData.pc_upcharge_price_usd) : null,
        pc_total_consumption: dispoData.pc_total_consumption && !isNaN(parseFloat(dispoData.pc_total_consumption)) ? parseFloat(dispoData.pc_total_consumption) : null,
        pc_raw_yarn_cost_usd: dispoData.pc_raw_yarn_cost_usd && !isNaN(parseFloat(dispoData.pc_raw_yarn_cost_usd)) ? parseFloat(dispoData.pc_raw_yarn_cost_usd) : null,
        pc_pick_rate_usd: dispoData.pc_pick_rate_usd && !isNaN(parseFloat(dispoData.pc_pick_rate_usd)) ? parseFloat(dispoData.pc_pick_rate_usd) : null
    };

    console.log('Mapped dispo data for database:', data);

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Validate po_no exists
        const [poCheck] = await connection.query(
            'SELECT COUNT(*) as count FROM PO_form_data WHERE po_no = ?',
            [data.po_no]
        );
        if (poCheck[0].count === 0) {
            throw new Error('PO Number does not exist in PO_form_data');
        }

        // Check if dispo already exists
        const [existingDispo] = await connection.query(
            'SELECT COUNT(*) as count FROM dispo_form_data WHERE dispo_number = ?',
            [data.dispo_number]
        );
        const isUpdate = existingDispo[0].count > 0;

        // CORRECTED INSERT query - MATCHES database schema exactly (114 columns excluding created_at)
        const insertDispoQuery = `
            INSERT INTO dispo_form_data (
                dispo_number, po_no, po_issue_date, po_revise_date, po_approval_date, dispo_creating_date, order_no,
                precosting_number, pi_no, account_holder, buyer_name, buyer_color_reference, order_status, buyer_style_ref, 
                development_id, handloom_number, print_method, process_type, fabric_type, yarn_type, order_type, 
                pp_delivery_date, bulk_delivery_date, garments_name, end_use, wash_type, light_source, weave_type, 
                sticker_construction, production_construction, sticker_composition, fabric_composition, reed_count, 
                ends_per_dent, warp_count_1, warp_ply_1, warp_count_2, warp_ply_2, warp_count_3, warp_ply_3, 
                weft_count_1, weft_ply_1, weft_count_2, weft_ply_2, weft_count_3, weft_ply_3, finish_epi, finish_ppi,
                calculation_width, dispo_overall_width, dispo_cuttable_width, finish_type, selvedge_width,
                selvedge_ends_per_dent, po_qty_yds, finish_qty_yds, adjust_qty_yds, warp_yd_allowance,
                weft_yd_allowance, finishing_process_loss, print_allowance, loom_contraction, weft_contraction,
                lower_beam_crimp, reduce_pick, pick_length_inch, creel_repeat, extra_cone_length,
                grey_epi, grey_ppi, beam_total_ends, body_ends, actual_section, calculated_section,
                finish_length_mtr, print_qty_mtr, grey_qty_mtr, loom_production_mtr, warp_beam_length,
                reed_space_inch, grey_width_inch, warp_consumption_yds, weft_consumption_yds, total_consumption_yds,
                warp_cover_factor, weft_cover_factor, total_cover_factor, calculated_gsm_regular, calculated_gsm_lycra,
                left_selvedge_ends, right_selvedge_ends, selvedge_dents_per_side, 
                left_selvedge_spec, right_selvedge_spec,
                warp_tear_strength, weft_tear_strength, warp_tensile_strength, weft_tensile_strength, pilling_grade,
                rubbing_grade, elongation, growth, recovery, buyer_gsm_bw, buyer_gsm_aw, warp_shrinkage,
                weft_shrinkage, quality_parameter, additional_remarks, pc_regular_price_usd, pc_upcharge_price_usd,
                pc_total_consumption, pc_raw_yarn_cost_usd, pc_pick_rate_usd
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            ON DUPLICATE KEY UPDATE
                po_no = VALUES(po_no),
                po_issue_date = VALUES(po_issue_date),
                po_revise_date = VALUES(po_revise_date),
                po_approval_date = VALUES(po_approval_date),
                dispo_creating_date = VALUES(dispo_creating_date),
                order_no = VALUES(order_no),
                precosting_number = VALUES(precosting_number),
                pi_no = VALUES(pi_no),
                account_holder = VALUES(account_holder),
                buyer_name = VALUES(buyer_name),
                buyer_color_reference = VALUES(buyer_color_reference),
                order_status = VALUES(order_status),
                buyer_style_ref = VALUES(buyer_style_ref),
                development_id = VALUES(development_id),
                handloom_number = VALUES(handloom_number),
                print_method = VALUES(print_method),
                process_type = VALUES(process_type),
                fabric_type = VALUES(fabric_type),
                yarn_type = VALUES(yarn_type),
                order_type = VALUES(order_type),
                pp_delivery_date = VALUES(pp_delivery_date),
                bulk_delivery_date = VALUES(bulk_delivery_date),
                garments_name = VALUES(garments_name),
                end_use = VALUES(end_use),
                wash_type = VALUES(wash_type),
                light_source = VALUES(light_source),
                weave_type = VALUES(weave_type),
                sticker_construction = VALUES(sticker_construction),
                production_construction = VALUES(production_construction),
                sticker_composition = VALUES(sticker_composition),
                fabric_composition = VALUES(fabric_composition),
                reed_count = VALUES(reed_count),
                ends_per_dent = VALUES(ends_per_dent),
                warp_count_1 = VALUES(warp_count_1),
                warp_ply_1 = VALUES(warp_ply_1),
                warp_count_2 = VALUES(warp_count_2),
                warp_ply_2 = VALUES(warp_ply_2),
                warp_count_3 = VALUES(warp_count_3),
                warp_ply_3 = VALUES(warp_ply_3),
                weft_count_1 = VALUES(weft_count_1),
                weft_ply_1 = VALUES(weft_ply_1),
                weft_count_2 = VALUES(weft_count_2),
                weft_ply_2 = VALUES(weft_ply_2),
                weft_count_3 = VALUES(weft_count_3),
                weft_ply_3 = VALUES(weft_ply_3),
                finish_epi = VALUES(finish_epi),
                finish_ppi = VALUES(finish_ppi),
                calculation_width = VALUES(calculation_width),
                dispo_overall_width = VALUES(dispo_overall_width),
                dispo_cuttable_width = VALUES(dispo_cuttable_width),
                finish_type = VALUES(finish_type),
                selvedge_width = VALUES(selvedge_width),
                selvedge_ends_per_dent = VALUES(selvedge_ends_per_dent),
                po_qty_yds = VALUES(po_qty_yds),
                finish_qty_yds = VALUES(finish_qty_yds),
                adjust_qty_yds = VALUES(adjust_qty_yds),
                warp_yd_allowance = VALUES(warp_yd_allowance),
                weft_yd_allowance = VALUES(weft_yd_allowance),
                finishing_process_loss = VALUES(finishing_process_loss),
                print_allowance = VALUES(print_allowance),
                loom_contraction = VALUES(loom_contraction),
                weft_contraction = VALUES(weft_contraction),
                lower_beam_crimp = VALUES(lower_beam_crimp),
                reduce_pick = VALUES(reduce_pick),
                pick_length_inch = VALUES(pick_length_inch),
                creel_repeat = VALUES(creel_repeat),
                extra_cone_length = VALUES(extra_cone_length),
                grey_epi = VALUES(grey_epi),
                grey_ppi = VALUES(grey_ppi),
                beam_total_ends = VALUES(beam_total_ends),
                body_ends = VALUES(body_ends),
                actual_section = VALUES(actual_section),
                calculated_section = VALUES(calculated_section),
                finish_length_mtr = VALUES(finish_length_mtr),
                print_qty_mtr = VALUES(print_qty_mtr),
                grey_qty_mtr = VALUES(grey_qty_mtr),
                loom_production_mtr = VALUES(loom_production_mtr),
                warp_beam_length = VALUES(warp_beam_length),
                reed_space_inch = VALUES(reed_space_inch),
                grey_width_inch = VALUES(grey_width_inch),
                warp_consumption_yds = VALUES(warp_consumption_yds),
                weft_consumption_yds = VALUES(weft_consumption_yds),
                total_consumption_yds = VALUES(total_consumption_yds),
                warp_cover_factor = VALUES(warp_cover_factor),
                weft_cover_factor = VALUES(weft_cover_factor),
                total_cover_factor = VALUES(total_cover_factor),
                calculated_gsm_regular = VALUES(calculated_gsm_regular),
                calculated_gsm_lycra = VALUES(calculated_gsm_lycra),
                left_selvedge_ends = VALUES(left_selvedge_ends),
                right_selvedge_ends = VALUES(right_selvedge_ends),
                selvedge_dents_per_side = VALUES(selvedge_dents_per_side),
                left_selvedge_spec = VALUES(left_selvedge_spec),
                right_selvedge_spec = VALUES(right_selvedge_spec),
                warp_tear_strength = VALUES(warp_tear_strength),
                weft_tear_strength = VALUES(weft_tear_strength),
                warp_tensile_strength = VALUES(warp_tensile_strength),
                weft_tensile_strength = VALUES(weft_tensile_strength),
                pilling_grade = VALUES(pilling_grade),
                rubbing_grade = VALUES(rubbing_grade),
                elongation = VALUES(elongation),
                growth = VALUES(growth),
                recovery = VALUES(recovery),
                buyer_gsm_bw = VALUES(buyer_gsm_bw),
                buyer_gsm_aw = VALUES(buyer_gsm_aw),
                warp_shrinkage = VALUES(warp_shrinkage),
                weft_shrinkage = VALUES(weft_shrinkage),
                quality_parameter = VALUES(quality_parameter),
                additional_remarks = VALUES(additional_remarks),
                pc_regular_price_usd = VALUES(pc_regular_price_usd),
                pc_upcharge_price_usd = VALUES(pc_upcharge_price_usd),
                pc_total_consumption = VALUES(pc_total_consumption),
                pc_raw_yarn_cost_usd = VALUES(pc_raw_yarn_cost_usd),
                pc_pick_rate_usd = VALUES(pc_pick_rate_usd)
        `;

        // CORRECTED values array (114 values - matches database schema exactly)
        const dispoValues = [
            data.dispo_number, data.po_no, data.po_issue_date, data.po_revise_date, data.po_approval_date,
            data.dispo_creating_date, data.order_no, data.precosting_number, data.pi_no, data.account_holder,
            data.buyer_name, data.buyer_color_reference, data.order_status, data.buyer_style_ref, 
            data.development_id, data.handloom_number, data.print_method, data.process_type, data.fabric_type, 
            data.yarn_type, data.order_type, data.pp_delivery_date, data.bulk_delivery_date, data.garments_name,
            data.end_use, data.wash_type, data.light_source, data.weave_type, data.sticker_construction, 
            data.production_construction, data.sticker_composition, data.fabric_composition, data.reed_count, 
            data.ends_per_dent, data.warp_count_1, data.warp_ply_1, data.warp_count_2, data.warp_ply_2, 
            data.warp_count_3, data.warp_ply_3, data.weft_count_1, data.weft_ply_1, data.weft_count_2, 
            data.weft_ply_2, data.weft_count_3, data.weft_ply_3, data.finish_epi, data.finish_ppi, 
            data.calculation_width, data.dispo_overall_width, data.dispo_cuttable_width, data.finish_type, 
            data.selvedge_width, data.selvedge_ends_per_dent, data.po_qty_yds, data.finish_qty_yds, 
            data.adjust_qty_yds, data.warp_yd_allowance, data.weft_yd_allowance, data.finishing_process_loss, 
            data.print_allowance, data.loom_contraction, data.weft_contraction, data.lower_beam_crimp, 
            data.reduce_pick, data.pick_length_inch, data.creel_repeat, data.extra_cone_length, 
            data.grey_epi, data.grey_ppi, data.beam_total_ends, data.body_ends, data.actual_section, 
            data.calculated_section, data.finish_length_mtr, data.print_qty_mtr, data.grey_qty_mtr, 
            data.loom_production_mtr, data.warp_beam_length, data.reed_space_inch, data.grey_width_inch, 
            data.warp_consumption_yds, data.weft_consumption_yds, data.total_consumption_yds, 
            data.warp_cover_factor, data.weft_cover_factor, data.total_cover_factor, 
            data.calculated_gsm_regular, data.calculated_gsm_lycra, data.left_selvedge_ends, 
            data.right_selvedge_ends, data.selvedge_dents_per_side, data.left_selvedge_spec, 
            data.right_selvedge_spec, data.warp_tear_strength, data.weft_tear_strength, 
            data.warp_tensile_strength, data.weft_tensile_strength, data.pilling_grade, data.rubbing_grade, 
            data.elongation, data.growth, data.recovery, data.buyer_gsm_bw, data.buyer_gsm_aw, 
            data.warp_shrinkage, data.weft_shrinkage, data.quality_parameter, data.additional_remarks, 
            data.pc_regular_price_usd, data.pc_upcharge_price_usd, data.pc_total_consumption, 
            data.pc_raw_yarn_cost_usd, data.pc_pick_rate_usd
        ];

        console.log('=== FINAL CORRECTED DISPO SAVE DEBUG INFO (114 COLUMNS) ===');
        console.log('Total columns in INSERT (excluding created_at):', 114);
        console.log('Values array length:', dispoValues.length);
        console.log('Is Update:', isUpdate);
        console.log('=== END DEBUG INFO ===');

        await connection.query(insertDispoQuery, dispoValues);

        // Enhanced warp_yarn_details handling with corrected schema
        await connection.query('DELETE FROM warp_yarn_details WHERE dispo_number = ?', [data.dispo_number]);
        for (const detail of filterWarpYarnRows(warpYarnDetails || [])) {
            await connection.query(
                `INSERT INTO warp_yarn_details (
                    dispo_number, sl_no, count, cal_count, warp_color_name, ld_number, yarn_per_repeat,
                    yarn_type, dyed_qty_kg, grey_qty_kg, no_of_cones, cone_length, warp_ply
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    data.dispo_number,
                    detail.sl_no || null,
                    detail.count && !isNaN(parseInt(detail.count)) ? parseInt(detail.count) : null,
                    detail.cal_count || null,
                    detail.warp_color_name || null,
                    detail.ld_number || null,
                    detail.yarn_per_repeat && !isNaN(parseInt(detail.yarn_per_repeat)) ? parseInt(detail.yarn_per_repeat) : null,
                    detail.yarn_type || null,
                    detail.dyed_qty_kg && !isNaN(parseFloat(detail.dyed_qty_kg)) ? parseFloat(detail.dyed_qty_kg) : null,
                    detail.grey_qty_kg && !isNaN(parseFloat(detail.grey_qty_kg)) ? parseFloat(detail.grey_qty_kg) : null,
                    detail.no_of_cones && !isNaN(parseInt(detail.no_of_cones)) ? parseInt(detail.no_of_cones) : null,
                    detail.cone_length && !isNaN(parseInt(detail.cone_length)) ? parseInt(detail.cone_length) : null,
                    detail.warp_ply && !isNaN(parseInt(detail.warp_ply)) ? parseInt(detail.warp_ply) : null
                ]
            );
        }

        // Enhanced weft_yarn_details handling with corrected schema
        await connection.query('DELETE FROM weft_yarn_details WHERE dispo_number = ?', [data.dispo_number]);
        for (const detail of filterWeftYarnRows(weftYarnDetails || [])) {
            await connection.query(
                `INSERT INTO weft_yarn_details (
                    dispo_number, sl_no, count, cal_count, weft_color_name, ld_number, yarn_per_repeat,
                    yarn_type, dyed_qty_kg, grey_qty_kg, weft_ply
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    data.dispo_number,
                    detail.sl_no || null,
                    detail.count && !isNaN(parseInt(detail.count)) ? parseInt(detail.count) : null,
                    detail.cal_count || null,
                    detail.weft_color_name || null,
                    detail.ld_number || null,
                    detail.yarn_per_repeat && !isNaN(parseInt(detail.yarn_per_repeat)) ? parseInt(detail.yarn_per_repeat) : null,
                    detail.yarn_type || null,
                    detail.dyed_qty_kg && !isNaN(parseFloat(detail.dyed_qty_kg)) ? parseFloat(detail.dyed_qty_kg) : null,
                    detail.grey_qty_kg && !isNaN(parseFloat(detail.grey_qty_kg)) ? parseFloat(detail.grey_qty_kg) : null,
                    detail.weft_ply && !isNaN(parseInt(detail.weft_ply)) ? parseInt(detail.weft_ply) : null
                ]
            );
        }

        // Enhanced warp_broken_section handling
        await connection.query('DELETE FROM warp_broken_section WHERE dispo_number = ?', [data.dispo_number]);
        for (const section of warpBrokenSection || []) {
            await connection.query(
                `INSERT INTO warp_broken_section (
                    dispo_number, lower_beam_total_ends, round_no_of_section, fraction_section, 
                    fraction_section_ends, remaining_ends
                ) VALUES (?, ?, ?, ?, ?, ?)
                `,
                [
                    data.dispo_number,
                    section.lower_beam_total_ends || null,
                    section.round_no_of_section || null,
                    section.fraction_section || null,
                    section.fraction_section_ends || null,
                    section.remaining_ends || null
                ]
            );
        }

        // Enhanced warp_broken_pattern handling
        await connection.query('DELETE FROM warp_broken_pattern WHERE dispo_number = ?', [data.dispo_number]);
        for (const pattern of warpBrokenPattern || []) {
            await connection.query(
                `INSERT INTO warp_broken_pattern (
                    dispo_number, warp_color_name, no_of_cones, round_section_yarn, total_fraction_ends,
                    section_1, section_2, section_3, section_4, section_5, section_6, section_7, section_8,
                    total_required_ends
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    data.dispo_number,
                    pattern.warp_color_name || null,
                    pattern.no_of_cones || null,
                    pattern.round_section_yarn || null,
                    pattern.total_fraction_ends || null,
                    pattern.section_1 || null,
                    pattern.section_2 || null,
                    pattern.section_3 || null,
                    pattern.section_4 || null,
                    pattern.section_5 || null,
                    pattern.section_6 || null,
                    pattern.section_7 || null,
                    pattern.section_8 || null,
                    pattern.total_required_ends || null
                ]
            );
        }

        await connection.commit();
        console.log('DISPO_SAVE', 'Successfully saved dispo form data with 114 columns', { 
            dispo_number: data.dispo_number, 
            po_no: data.po_no,
            isUpdate: isUpdate,
            warpRows: warpYarnDetails?.length || 0,
            weftRows: weftYarnDetails?.length || 0
        });
        res.status(200).json({ 
            message: `Dispo data ${isUpdate ? 'updated' : 'created'} successfully with 114 columns!` 
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('DISPO_SAVE_ERROR', 'Failed to save dispo form data', { 
            error: error.message,
            stack: error.stack,
            dispoNumber: data?.dispo_number,
            poNumber: data?.po_no
        });
        res.status(500).json({ 
            error: 'Failed to save corrected dispo data to MySQL', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        if (connection) connection.release();
    }
});

// Enhanced fetch dispo data with proper field mapping
app.get('/main/api/dispo/fetch/:dispo_number', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { dispo_number } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [dispoData] = await connection.query(
            'SELECT * FROM dispo_form_data WHERE dispo_number = ?',
            [dispo_number]
        );

        if (dispoData.length === 0) {
            return res.status(404).json({ error: 'Dispo data not found' });
        }

        const [warpYarnDetails] = await connection.query(
            'SELECT * FROM warp_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
            [dispo_number]
        );

        const [weftYarnDetails] = await connection.query(
            'SELECT * FROM weft_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
            [dispo_number]
        );

        const [warpBrokenSection] = await connection.query(
            'SELECT * FROM warp_broken_section WHERE dispo_number = ?',
            [dispo_number]
        );

        const [warpBrokenPattern] = await connection.query(
            'SELECT * FROM warp_broken_pattern WHERE dispo_number = ?',
            [dispo_number]
        );

        console.log('DISPO_FETCH', 'Successfully fetched dispo data', { 
            dispo_number,
            warpRows: warpYarnDetails.length,
            weftRows: weftYarnDetails.length
        });

        res.status(200).json({
            dispoData: dispoData[0],
            warpYarnDetails: filterWarpYarnRows(warpYarnDetails),
            weftYarnDetails: filterWeftYarnRows(weftYarnDetails),
            warpBrokenSection,
            warpBrokenPattern
        });
    } catch (error) {
        console.log('DISPO_FETCH_ERROR', 'Failed to fetch dispo data', { 
            dispo_number, 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to fetch dispo data', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Fetch dispo data by PO number (for populating new dispo from PO)
app.get('/main/api/dispo/fetch-po-for-dispo/:po_no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { po_no } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch PO data with enhanced field mapping
        const [poData] = await connection.query(
            'SELECT * FROM PO_form_data WHERE po_no = ?',
            [po_no]
        );

        if (poData.length === 0) {
            console.log('DISPO_FETCH_PO_NOT_FOUND', 'PO not found for dispo population', { po_no });
            return res.status(404).json({ error: 'PO not found' });
        }

        const po = poData[0];
        
        // Fetch related precosting data using pre_costing_no from PO
        let preCostingData = null;
        if (po.pre_costing_no) {
            const [preCostingResult] = await connection.query(
                'SELECT * FROM pre_costing_data WHERE pre_costing_no = ?',
                [po.pre_costing_no]
            );
            if (preCostingResult.length > 0) {
                preCostingData = preCostingResult[0];
            }
        }

        // Enhanced mapping of PO fields to dispo field names with proper type conversion
        const mappedDispoData = {
            // Basic PO Information
            po_no: po.po_no,
            po_issue_date: po.po_issue_date,
            po_revise_date: po.po_revise_date,
            po_approval_date: po.po_approval_date,
            order_no: po.order_no,
            precosting_number: po.pre_costing_no,
            pi_no: po.pi_no,
            account_holder: po.account_holder,
            buyer_name: po.buyer_name,
            buyer_color_reference: po.buyer_color_reference || null,
            order_status: po.order_status,
            buyer_style_ref: po.buyer_style_ref,
            
            // Enhanced field mapping
            development_id: po.t_number, // NF Number maps to t_number
            handloom_number: po.strike_off_hl_number, // SO/HL Number
            print_method: po.print_method,
            process_type: po.process_type,
            fabric_type: po.fabric_type,
            yarn_type: po.yarn_type,
            order_type: po.order_type,
            pp_delivery_date: po.pp_delivery_date,
            bulk_delivery_date: po.bulk_delivery_date,
            garments_name: po.garments_name || null,
            end_use: po.end_use,
            wash_type: po.wash_type,
            light_source: po.light_source,
            
            // Fabric Details with proper type conversion
            warp_count_1: po.warp_count_1,
            warp_ply_1: po.warp_ply_1 && !isNaN(parseInt(po.warp_ply_1)) ? parseInt(po.warp_ply_1) : 1,
            warp_count_2: po.warp_count_2,
            warp_ply_2: po.warp_ply_2 && !isNaN(parseInt(po.warp_ply_2)) ? parseInt(po.warp_ply_2) : null,
            warp_count_3: po.warp_count_3,
            warp_ply_3: po.warp_ply_3 && !isNaN(parseInt(po.warp_ply_3)) ? parseInt(po.warp_ply_3) : null,
            weft_count_1: po.weft_count_1,
            weft_ply_1: po.weft_ply_1 && !isNaN(parseInt(po.weft_ply_1)) ? parseInt(po.weft_ply_1) : 1,
            weft_count_2: po.weft_count_2,
            weft_ply_2: po.weft_ply_2 && !isNaN(parseInt(po.weft_ply_2)) ? parseInt(po.weft_ply_2) : null,
            weft_count_3: po.weft_count_3,
            weft_ply_3: po.weft_ply_3 && !isNaN(parseInt(po.weft_ply_3)) ? parseInt(po.weft_ply_3) : null,
            
            weave_type: po.weave_type,
            finish_type: po.finish_type,
            sticker_construction: po.sticker_construction,
            production_construction: po.production_construction,
            sticker_composition: po.sticker_composition,
            fabric_composition: po.fabric_composition,
            
            // Width specifications
            dispo_overall_width: po.dispo_overall_width && !isNaN(parseFloat(po.dispo_overall_width)) ? parseFloat(po.dispo_overall_width) : null,
            dispo_cuttable_width: po.dispo_cuttable_width && !isNaN(parseFloat(po.dispo_cuttable_width)) ? parseFloat(po.dispo_cuttable_width) : null,
            calculation_width: po.calculation_width && !isNaN(parseFloat(po.calculation_width)) ? parseFloat(po.calculation_width) : null,
            
            // EPI/PPI
            finish_epi: po.finish_epi && !isNaN(parseInt(po.finish_epi)) ? parseInt(po.finish_epi) : null,
            finish_ppi: po.finish_ppi && !isNaN(parseInt(po.finish_ppi)) ? parseInt(po.finish_ppi) : null,
            
            // Reed specifications
            reed_count: po.reed_count && !isNaN(parseInt(po.reed_count)) ? parseInt(po.reed_count) : null,
            ends_per_dent: po.ends_per_dent && !isNaN(parseInt(po.ends_per_dent)) ? parseInt(po.ends_per_dent) : null,
            
            // Selvedge specifications
            selvedge_width: po.selvedge_width && !isNaN(parseInt(po.selvedge_width)) ? parseInt(po.selvedge_width) : null,
            selvedge_ends_per_dent: po.selvedge_ends_per_dent && !isNaN(parseInt(po.selvedge_ends_per_dent)) ? parseInt(po.selvedge_ends_per_dent) : null,
            
            // Quantities
            po_qty_yds: po.po_quantity && !isNaN(parseInt(po.po_quantity)) ? parseInt(po.po_quantity) : null,
            finish_qty_yds: po.finish_qty_yds && !isNaN(parseInt(po.finish_qty_yds)) ? parseInt(po.finish_qty_yds) : null,
            
            // Quality parameters from PO
            warp_tear_strength: po.warp_tear_strength && !isNaN(parseInt(po.warp_tear_strength)) ? parseInt(po.warp_tear_strength) : null,
            weft_tear_strength: po.weft_tear_strength && !isNaN(parseInt(po.weft_tear_strength)) ? parseInt(po.weft_tear_strength) : null,
            warp_tensile_strength: po.warp_tensile_strength && !isNaN(parseInt(po.warp_tensile_strength)) ? parseInt(po.warp_tensile_strength) : null,
            weft_tensile_strength: po.weft_tensile_strength && !isNaN(parseInt(po.weft_tensile_strength)) ? parseInt(po.weft_tensile_strength) : null,
            pilling_grade: po.pilling_grade && !isNaN(parseInt(po.pilling_grade)) ? parseInt(po.pilling_grade) : null,
            rubbing_grade: po.rubbing_grade && !isNaN(parseInt(po.rubbing_grade)) ? parseInt(po.rubbing_grade) : null,
            elongation: po.elongation && !isNaN(parseInt(po.elongation)) ? parseInt(po.elongation) : null,
            growth: po.growth && !isNaN(parseInt(po.growth)) ? parseInt(po.growth) : null,
            recovery: po.recovery && !isNaN(parseInt(po.recovery)) ? parseInt(po.recovery) : null,
            buyer_gsm_bw: po.buyer_gsm_before_wash && !isNaN(parseFloat(po.buyer_gsm_before_wash)) ? parseFloat(po.buyer_gsm_before_wash) : null,
            buyer_gsm_aw: po.buyer_gsm_after_wash && !isNaN(parseFloat(po.buyer_gsm_after_wash)) ? parseFloat(po.buyer_gsm_after_wash) : null,
            warp_shrinkage: po.warp_shrinkage && !isNaN(parseFloat(po.warp_shrinkage)) ? parseFloat(po.warp_shrinkage) : null,
            weft_shrinkage: po.weft_shrinkage && !isNaN(parseFloat(po.weft_shrinkage)) ? parseFloat(po.weft_shrinkage) : null,
            quality_parameter: po.quality_parameter || 'As Per Buyer Instruction'
        };

        // Add enhanced precosting data if available
if (preCostingData) {
    mappedDispoData.pc_regular_price_usd = preCostingData.total_pre_cost_usd && !isNaN(parseFloat(preCostingData.total_pre_cost_usd)) ? parseFloat(preCostingData.total_pre_cost_usd) : null;
    mappedDispoData.pc_upcharge_price_usd = preCostingData.total_upcharged_pre_cost_usd && !isNaN(parseFloat(preCostingData.total_upcharged_pre_cost_usd)) ? parseFloat(preCostingData.total_upcharged_pre_cost_usd) : null;
    mappedDispoData.pc_total_consumption = preCostingData.total_greige_consump && !isNaN(parseFloat(preCostingData.total_greige_consump)) ? parseFloat(preCostingData.total_greige_consump) : null;
    
    // FIXED: Calculate required values from precosting data
    const breakEvenCost = parseFloat(preCostingData.break_even_cost) || 0;
    const dyeingFinishingRate = parseFloat(preCostingData.dye_finish_rate) || 0;
    const finishAllow = parseFloat(preCostingData.finish_allow) || 0;
    const dollarRateTk = parseFloat(preCostingData.dollar_rate_tk) || 1;
    
    // Field names from precosting database
    const totalGreigeCostTaka = parseFloat(preCostingData.greige_cost) || 0;
    const weavingCostTaka = parseFloat(preCostingData.weaving_cost) || 0;
    
    // FIXED: P/C Raw Yarn Cost (USD) - Calculate greigeYarnCostPerYd and divide by dollar rate
    const greigeYarnCostPerYd = breakEvenCost ? (breakEvenCost - dyeingFinishingRate) / (1 + (finishAllow / 100)) : 0;
    mappedDispoData.pc_raw_yarn_cost_usd = dollarRateTk > 0 ? parseFloat((greigeYarnCostPerYd / dollarRateTk).toFixed(2)) : null;
    
    // FIXED: P/C Pick Rate (USD) - Use the STORED pick_rate_usd value directly (this worked before!)
    mappedDispoData.pc_pick_rate_usd = preCostingData.pick_rate_usd && !isNaN(parseFloat(preCostingData.pick_rate_usd)) ? parseFloat(preCostingData.pick_rate_usd) : null;
    
    // NEW: Total Greige Yarn Cost/yd (USD)
    mappedDispoData.total_greige_yarn_cost_usd = (totalGreigeCostTaka && dollarRateTk > 0) ? parseFloat((totalGreigeCostTaka / dollarRateTk).toFixed(2)) : null;
    
    // NEW: Weaving Cost of Fabric/yd (USD)
    mappedDispoData.weaving_cost_usd = (weavingCostTaka && dollarRateTk > 0) ? parseFloat((weavingCostTaka / dollarRateTk).toFixed(2)) : null;
    
    // NEW: Material/Overhead Cost (USD) = Weaving Cost/yd (USD) - Total Greige Yarn Cost/yd (USD)
    const materialOverheadCostUsd = (mappedDispoData.weaving_cost_usd && mappedDispoData.total_greige_yarn_cost_usd) 
        ? parseFloat((mappedDispoData.weaving_cost_usd - mappedDispoData.total_greige_yarn_cost_usd).toFixed(2)) 
        : null;
    mappedDispoData.material_overhead_cost_usd = materialOverheadCostUsd;
    
    // NEW: Material/Overhead Cost% = Material/Overhead Cost (USD) * 100 / Weaving Cost/yd (USD)
    mappedDispoData.material_overhead_cost_percent = (materialOverheadCostUsd && mappedDispoData.weaving_cost_usd && mappedDispoData.weaving_cost_usd > 0) 
        ? parseFloat((materialOverheadCostUsd * 100 / mappedDispoData.weaving_cost_usd).toFixed(2)) 
        : null;
}

        console.log('DISPO_FETCH_PO_SUCCESS', 'Successfully fetched PO data for dispo population', { 
            po_no, 
            hasPrecosting: !!preCostingData,
            pre_costing_no: po.pre_costing_no,
            mappedFields: Object.keys(mappedDispoData).length,
            pc_raw_yarn_cost_usd: mappedDispoData.pc_raw_yarn_cost_usd,
            pc_pick_rate_usd: mappedDispoData.pc_pick_rate_usd
        });

        res.status(200).json({
            success: true,
            dispoData: mappedDispoData,
            // Return empty arrays for related tables since this is for new dispo creation
            warpYarnDetails: [],
            weftYarnDetails: [],
            warpBrokenSection: [],
            warpBrokenPattern: [],
            sourceInfo: {
                po_no: po_no,
                pre_costing_no: po.pre_costing_no,
                hasPrecosting: !!preCostingData,
                mappedFieldsCount: Object.keys(mappedDispoData).length
            }
        });
    } catch (error) {
        console.log('DISPO_FETCH_PO_ERROR', 'Failed to fetch PO data for dispo population', { 
            po_no, 
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            error: 'Failed to fetch PO data for dispo population', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Keep the original fetch-by-po endpoint for fetching existing dispo data
app.get('/main/api/dispo/fetch-by-po/:po_no', async (req, res) => {
    if (!req.session.user) {
        console.log('DISPO_FETCH_BY_PO_AUTH_ERROR', 'Unauthorized access attempt');
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { po_no } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [dispoData] = await connection.query(
            'SELECT * FROM dispo_form_data WHERE po_no = ? ORDER BY created_at DESC',
            [po_no]
        );

        if (dispoData.length === 0) {
            console.log('DISPO_FETCH_BY_PO_NOT_FOUND', 'No existing dispo data found for this PO number', { po_no });
            return res.status(404).json({ error: 'No existing dispo data found for this PO number' });
        }

        const result = await Promise.all(dispoData.map(async (dispo) => {
            const [warpYarnDetails] = await connection.query(
                'SELECT * FROM warp_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
                [dispo.dispo_number]
            );
            const [weftYarnDetails] = await connection.query(
                'SELECT * FROM weft_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
                [dispo.dispo_number]
            );
            const [warpBrokenSection] = await connection.query(
                'SELECT * FROM warp_broken_section WHERE dispo_number = ?',
                [dispo.dispo_number]
            );
            const [warpBrokenPattern] = await connection.query(
                'SELECT * FROM warp_broken_pattern WHERE dispo_number = ?',
                [dispo.dispo_number]
            );

            return {
                dispoData: dispo,
                warpYarnDetails: filterWarpYarnRows(warpYarnDetails),
                weftYarnDetails: filterWeftYarnRows(weftYarnDetails),
                warpBrokenSection,
                warpBrokenPattern
            };
        }));

        console.log('DISPO_FETCH_BY_PO_SUCCESS', 'Successfully fetched existing dispo data by PO', { 
            po_no, 
            count: result.length 
        });
        res.status(200).json(result);
    } catch (error) {
        console.log('DISPO_FETCH_BY_PO_ERROR', 'Failed to fetch existing dispo data by PO', { 
            po_no, 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to fetch existing dispo data by PO', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Delete dispo data
app.delete('/main/api/dispo/delete/:dispo_number', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { dispo_number } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if dispo exists before deletion
        const [existingDispo] = await connection.query(
            'SELECT COUNT(*) as count FROM dispo_form_data WHERE dispo_number = ?',
            [dispo_number]
        );

        if (existingDispo[0].count === 0) {
            return res.status(404).json({ error: 'Dispo not found' });
        }

        // Enhanced cascade delete with proper order
        await connection.query('DELETE FROM warp_yarn_details WHERE dispo_number = ?', [dispo_number]);
        await connection.query('DELETE FROM weft_yarn_details WHERE dispo_number = ?', [dispo_number]);
        await connection.query('DELETE FROM warp_broken_section WHERE dispo_number = ?', [dispo_number]);
        await connection.query('DELETE FROM warp_broken_pattern WHERE dispo_number = ?', [dispo_number]);
        await connection.query('DELETE FROM dispo_form_data WHERE dispo_number = ?', [dispo_number]);

        await connection.commit();
        console.log('DISPO_DELETE', 'Successfully deleted dispo data with all related tables', { dispo_number });
        res.status(200).json({ 
            message: 'Dispo data and all related information deleted successfully',
            deleted_dispo: dispo_number
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.log('DISPO_DELETE_ERROR', 'Failed to delete dispo data', { 
            dispo_number, 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to delete dispo data', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Export dispo data to JSON
app.get('/main/api/dispo/export', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [dispoData] = await connection.query(
            'SELECT * FROM dispo_form_data ORDER BY created_at DESC'
        );
        
        const result = await Promise.all(dispoData.map(async (dispo) => {
            const [warpYarnDetails] = await connection.query(
                'SELECT * FROM warp_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
                [dispo.dispo_number]
            );
            const [weftYarnDetails] = await connection.query(
                'SELECT * FROM weft_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
                [dispo.dispo_number]
            );
            const [warpBrokenSection] = await connection.query(
                'SELECT * FROM warp_broken_section WHERE dispo_number = ?',
                [dispo.dispo_number]
            );
            const [warpBrokenPattern] = await connection.query(
                'SELECT * FROM warp_broken_pattern WHERE dispo_number = ?',
                [dispo.dispo_number]
            );

            return {
                dispoData: dispo,
                warpYarnDetails: filterWarpYarnRows(warpYarnDetails),
                weftYarnDetails: filterWeftYarnRows(weftYarnDetails),
                warpBrokenSection,
                warpBrokenPattern,
                exportTimestamp: new Date().toISOString()
            };
        }));

        const exportData = {
            exportInfo: {
                timestamp: new Date().toISOString(),
                totalRecords: result.length,
                exportedBy: req.session.user.username || 'Unknown',
                version: '2.0-enhanced-114-columns'
            },
            dispoRecords: result
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=enhanced_dispo_data_export.json');
        
        console.log('DISPO_EXPORT', 'Successfully exported dispo data', { 
            recordCount: result.length,
            exportedBy: req.session.user.username
        });
        
        res.status(200).json(exportData);
    } catch (error) {
        console.log('DISPO_EXPORT_ERROR', 'Failed to export dispo data', { 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to export dispo data', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// API endpoint to get dispo numbers with dates and detailed data
app.get('/main/api/dispo/dispo-numbers-with-dates', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                d.precosting_number,
                d.po_no,
                d.buyer_name,
                d.buyer_color_reference,
                d.development_id,
                d.dispo_number,
                d.garments_name,
                d.weave_type,
                d.production_construction,
                d.fabric_composition,
                d.finish_type,
                d.po_qty_yds,
                d.finish_qty_yds,
                d.adjust_qty_yds,
                d.warp_consumption_yds,
                d.weft_consumption_yds,
                SUM(w.dyed_qty_kg) as total_warp_dyed_qty,
                SUM(w.grey_qty_kg) as total_warp_grey_qty,
                SUM(wf.dyed_qty_kg) as total_weft_dyed_qty,
                SUM(wf.grey_qty_kg) as total_weft_grey_qty,
                d.created_at
            FROM dispo_form_data d
            LEFT JOIN warp_yarn_details w ON d.dispo_number = w.dispo_number
            LEFT JOIN weft_yarn_details wf ON d.dispo_number = wf.dispo_number
            WHERE d.dispo_number IS NOT NULL 
            AND d.dispo_number != ''
            AND TRIM(d.dispo_number) != ''
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(d.dispo_creating_date) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(d.dispo_creating_date) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(d.dispo_creating_date) <= DATE(?)';
            params.push(endDate);
        }
        
        query += ' GROUP BY d.dispo_number ORDER BY d.created_at DESC';
        
        console.log('Executing dispo query:', query, 'with params:', params);
        
        const [rows] = await connection.query(query, params);
        
        console.log(`Found ${rows.length} dispo records with detailed data`);
        
        res.json(rows);
    } catch (error) {
        console.error('Error fetching detailed dispo data:', error);
        res.status(500).json({ 
            error: 'Failed to fetch dispo numbers with detailed data', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        if (connection) connection.release();
    }
});

// API endpoint to export dispo data as CSV
app.get('/main/api/dispo/export-csv', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                d.*,
                SUM(w.dyed_qty_kg) as total_warp_dyed_qty,
                SUM(w.grey_qty_kg) as total_warp_grey_qty,
                SUM(wf.dyed_qty_kg) as total_weft_dyed_qty,
                SUM(wf.grey_qty_kg) as total_weft_grey_qty
            FROM dispo_form_data d
            LEFT JOIN warp_yarn_details w ON d.dispo_number = w.dispo_number
            LEFT JOIN weft_yarn_details wf ON d.dispo_number = wf.dispo_number
            WHERE d.dispo_number IS NOT NULL 
            AND d.dispo_number != ''
            AND TRIM(d.dispo_number) != ''
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(d.dispo_creating_date) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(d.dispo_creating_date) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(d.dispo_creating_date) <= DATE(?)';
            params.push(endDate);
        }
        
        query += ' GROUP BY d.dispo_number ORDER BY d.created_at DESC';
        
        const [rows] = await connection.query(query, params);
        
        const csvHeader = [
            'Precosting Number', 'PO No', 'Buyer Name', 'Buyer Color Reference', 'NF Number', 
            'Dispo Number', 'Garments Name', 'Weave Type', 'Production Construction', 
            'Fabric Composition', 'Finish Type', 'PO Qty (Yds)', 'Finish Qty (Yds)', 
            'Adjust Qty (Yds)', 'Warp Consumption kg/Yd', 'Weft Consumption kg/Yd',
            'Warp Dyed Qty (KG)', 'Warp Grey Qty (KG)', 'Weft Dyed Qty (KG)', 
            'Weft Grey Qty (KG)', 'Created At'
        ].join(',');

        const csvRows = rows.map(row => [
            `"${(row.precosting_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.po_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_name || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_color_reference || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.development_id || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.dispo_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.garments_name || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.weave_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.production_construction || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.fabric_composition || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.finish_type || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${row.po_qty_yds || 'N/A'}"`,
            `"${row.finish_qty_yds || 'N/A'}"`,
            `"${row.adjust_qty_yds || 'N/A'}"`,
            `"${row.warp_consumption_yds ? parseFloat(row.warp_consumption_yds).toFixed(4) : 'N/A'}"`,
            `"${row.weft_consumption_yds ? parseFloat(row.weft_consumption_yds).toFixed(4) : 'N/A'}"`,
            `"${row.total_warp_dyed_qty ? parseFloat(row.total_warp_dyed_qty).toFixed(2) : 'N/A'}"`,
            `"${row.total_warp_grey_qty ? parseFloat(row.total_warp_grey_qty).toFixed(2) : 'N/A'}"`,
            `"${row.total_weft_dyed_qty ? parseFloat(row.total_weft_dyed_qty).toFixed(2) : 'N/A'}"`,
            `"${row.total_weft_grey_qty ? parseFloat(row.total_weft_grey_qty).toFixed(2) : 'N/A'}"`,
            `"${row.created_at || 'N/A'}"`
        ].join(','));

        const csv = [csvHeader, ...csvRows].join('\n');
        
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `saved_dispo_records_${startDate || 'all'}_${endDate || 'all'}_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
        
        res.send(csv);
    } catch (error) {
        console.error('Error exporting dispo CSV:', error);
        res.status(500).json({ 
            error: 'Failed to export dispo data as CSV', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Enhanced fetch all dispo numbers for dropdown with metadata
app.get('/main/api/dispo/numbers', async (req, res) => {
    if (!req.session.user) {
        console.log('DISPO_NUMBERS_AUTH_ERROR', 'Unauthorized access attempt');
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT dispo_number, po_no, buyer_name, created_at 
            FROM dispo_form_data 
            WHERE dispo_number IS NOT NULL AND dispo_number != "" 
            ORDER BY created_at DESC
        `);
        
        console.log('DISPO_NUMBERS_SUCCESS', 'Fetched dispo numbers with metadata', { 
            count: rows.length 
        });
        
        // Return just the dispo numbers for dropdown compatibility
        res.status(200).json(rows.map(row => row.dispo_number));
    } catch (error) {
        console.log('DISPO_NUMBERS_ERROR', 'Failed to fetch dispo numbers', { 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to fetch dispo numbers', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Enhanced fetch all PO numbers for search po dropdown with metadata
app.get('/main/api/po/numbers', async (req, res) => {
    if (!req.session.user) {
        console.log('PO_NUMBERS_AUTH_ERROR', 'Unauthorized access attempt');
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT po_no, buyer_name, order_no, created_at 
            FROM PO_form_data 
            WHERE po_no IS NOT NULL AND po_no != "" 
            ORDER BY created_at DESC
        `);
        
        console.log('PO_NUMBERS_SUCCESS', 'Fetched PO numbers with metadata', { 
            count: rows.length 
        });
        
        // Return just the PO numbers for dropdown compatibility
        res.status(200).json(rows.map(row => row.po_no));
    } catch (error) {
        console.log('PO_NUMBERS_ERROR', 'Failed to fetch PO numbers', { 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to fetch PO numbers', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// Enhanced dispo statistics endpoint
app.get('/main/api/dispo/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        
        const [totalDispos] = await connection.query('SELECT COUNT(*) as count FROM dispo_form_data');
        const [recentDispos] = await connection.query(
            'SELECT COUNT(*) as count FROM dispo_form_data WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
        );
        const [avgConsumption] = await connection.query(
            'SELECT AVG(total_consumption_yds) as avg_consumption FROM dispo_form_data WHERE total_consumption_yds IS NOT NULL'
        );
        const [topBuyers] = await connection.query(`
            SELECT buyer_name, COUNT(*) as dispo_count 
            FROM dispo_form_data 
            WHERE buyer_name IS NOT NULL 
            GROUP BY buyer_name 
            ORDER BY dispo_count DESC 
            LIMIT 5
        `);

        const statistics = {
            totalDispos: totalDispos[0].count,
            recentDispos: recentDispos[0].count,
            averageConsumption: parseFloat(avgConsumption[0].avg_consumption || 0).toFixed(4),
            topBuyers: topBuyers,
            lastUpdated: new Date().toISOString()
        };

        console.log('DISPO_STATISTICS', 'Generated dispo statistics', statistics);
        res.status(200).json(statistics);
    } catch (error) {
        console.log('DISPO_STATISTICS_ERROR', 'Failed to generate dispo statistics', { 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to generate dispo statistics', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// GREIGE YARN RECEIVE FORM API ENDPOINTS
// Routes: /main/api/yarn/...
// =====================================================

app.get('/main/api/yarn/yarn-details', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT DISTINCT 
                CONCAT(
                    yarn_count, '/', yarn_ply, ' | ',
                    COALESCE(yarn_brand, 'N/A'), ' | ',
                    COALESCE(yarn_lot, 'N/A'), ' | ',
                    COALESCE(received_against_dispo_nos, 'N/A'), ' | ',
                    COALESCE(yarn_composition, 'N/A'), ' | ',
                    COALESCE(lc_unit, 'N/A'), ' | ',
                    COALESCE(beneficiary_factory, 'N/A')
                ) as yarn_detail,
                yarn_count, yarn_ply, yarn_brand, yarn_lot, received_against_dispo_nos,
                yarn_composition, lc_unit, beneficiary_factory, id
            FROM yarn_receive_form 
            WHERE yarn_count IS NOT NULL AND yarn_brand IS NOT NULL 
            ORDER BY created_at DESC
        `);
        res.status(200).json(rows.map(row => ({
            display: row.yarn_detail,
            data: {
                id: row.id,
                yarn_count: row.yarn_count,
                yarn_ply: row.yarn_ply,
                yarn_brand: row.yarn_brand,
                yarn_lot: row.yarn_lot,
                received_against_dispo_nos: row.received_against_dispo_nos,
                yarn_composition: row.yarn_composition,
                lc_unit: row.lc_unit,
                beneficiary_factory: row.beneficiary_factory
            }
        })));
    } catch (error) {
        console.error('Error fetching yarn details:', error);
        res.status(500).json({ error: 'Failed to fetch yarn details', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/posted-lcs', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT DISTINCT lc_no 
            FROM yarn_receive_form 
            WHERE lc_no IS NOT NULL AND lc_no != '' 
            ORDER BY created_at DESC
        `);
        res.status(200).json(rows.map(row => row.lc_no));
    } catch (error) {
        console.error('Error fetching posted LCs:', error);
        res.status(500).json({ error: 'Failed to fetch posted LCs', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// FIX: /main/api/yarn/fetch-by-id/:id
// Now returns yarn_received_details with the correct column
// aliases so the issue form can map received_date/quantity_kgs
// into its breakdown table.
// -------------------------------------------------------
app.get('/main/api/yarn/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();

        const [mainData] = await connection.query(
            'SELECT * FROM yarn_receive_form WHERE id = ?', [id]
        );
        if (mainData.length === 0)
            return res.status(404).json({ error: 'No data found for this ID' });

        const formId  = mainData[0].id;
        const yarnLot = mainData[0].yarn_lot;

        // FIX: select received_date and quantity_kgs explicitly so
        // the client can rely on consistent field names regardless of
        // which endpoint fetched the record.
        const [receivedDetails] = await connection.query(
            `SELECT id, yarn_receive_form_id, dispo_number,
                    received_date, quantity_kgs, created_at
             FROM yarn_received_details
             WHERE yarn_receive_form_id = ?
             ORDER BY id`,
            [formId]
        );

        const [requirementsDetails] = await connection.query(
            `SELECT * FROM yarn_requirements_details
             WHERE yarn_receive_form_id = ?
             ORDER BY id`,
            [formId]
        );

        // Aggregate all dispo numbers linked to this yarn lot
        const allDispoNumbers = new Set();
        if (yarnLot && yarnLot.trim() !== '') {
            const [d1] = await connection.query(`
                SELECT DISTINCT received_against_dispo_nos
                FROM yarn_receive_form
                WHERE yarn_lot = ?
                  AND received_against_dispo_nos IS NOT NULL
                  AND received_against_dispo_nos != ''
            `, [yarnLot]);
            d1.forEach(r => {
                r.received_against_dispo_nos.split(',')
                    .map(s => s.trim()).filter(s => s && s !== 'N/A')
                    .forEach(s => allDispoNumbers.add(s));
            });

            const [d2] = await connection.query(`
                SELECT DISTINCT req.dispo_no
                FROM yarn_requirements_details req
                JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
                WHERE y.yarn_lot = ?
                  AND req.dispo_no IS NOT NULL AND req.dispo_no != ''
            `, [yarnLot]);
            d2.forEach(r => { if (r.dispo_no && r.dispo_no !== 'N/A') allDispoNumbers.add(r.dispo_no.trim()); });

            const [d3] = await connection.query(`
                SELECT DISTINCT search_dispo
                FROM yarn_receive_form
                WHERE yarn_lot = ?
                  AND search_dispo IS NOT NULL AND search_dispo != ''
            `, [yarnLot]);
            d3.forEach(r => { if (r.search_dispo && r.search_dispo !== 'N/A') allDispoNumbers.add(r.search_dispo.trim()); });
        }

        const relatedDispoNumbers = Array.from(allDispoNumbers).filter(Boolean).sort();

        res.status(200).json({
            ...mainData[0],
            yarn_received_details:    receivedDetails,      // ← used by issue form breakdown
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers:    relatedDispoNumbers
        });
    } catch (error) {
        console.error('Error fetching data by ID:', error);
        res.status(500).json({ error: 'Failed to fetch data by ID', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/yarn-lots', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT DISTINCT 
                CONCAT(
                    COALESCE(yarn_lot, 'N/A'), ' | ',
                    yarn_count, '/', yarn_ply, ' | ',
                    COALESCE(yarn_brand, 'N/A'), ' | ',
                    COALESCE(received_against_po_no, 'N/A'), ' | ',
                    COALESCE(received_against_dispo_nos, 'N/A'), ' | ',
                    COALESCE(yarn_type, 'N/A'), ' | ',
                    COALESCE(import_local_source, 'N/A')
                ) as yarn_lot_detail,
                id, yarn_lot, yarn_count, yarn_ply, received_against_po_no,
                received_against_dispo_nos, yarn_type, yarn_brand, yarn_composition,
                import_local_source, lc_unit, beneficiary_factory
            FROM yarn_receive_form 
            WHERE yarn_lot IS NOT NULL AND yarn_lot != '' 
            ORDER BY created_at DESC
        `);
        res.status(200).json(rows.map(row => ({
            display:  row.yarn_lot_detail,
            yarn_lot: row.yarn_lot,
            data: {
                id:                         row.id,
                yarn_lot:                   row.yarn_lot,
                yarn_count:                 row.yarn_count,
                yarn_ply:                   row.yarn_ply,
                received_against_po_no:     row.received_against_po_no,
                received_against_dispo_nos: row.received_against_dispo_nos,
                yarn_type:                  row.yarn_type,
                yarn_brand:                 row.yarn_brand,
                yarn_composition:           row.yarn_composition,
                import_local_source:        row.import_local_source,
                lc_unit:                    row.lc_unit,
                beneficiary_factory:        row.beneficiary_factory
            }
        })));
    } catch (error) {
        console.error('Error fetching yarn lots:', error);
        res.status(500).json({ error: 'Failed to fetch yarn lots', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/fetch-by-detail/:recordId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { recordId } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [mainData] = await connection.query(
            'SELECT * FROM yarn_receive_form WHERE id = ? ORDER BY created_at DESC LIMIT 1',
            [recordId]
        );
        if (mainData.length === 0)
            return res.status(404).json({ error: 'No data found for this record' });

        const formId  = mainData[0].id;
        const yarnLot = mainData[0].yarn_lot;

        const [receivedDetails] = await connection.query(
            `SELECT id, yarn_receive_form_id, dispo_number,
                    received_date, quantity_kgs, created_at
             FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id`,
            [formId]
        );
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );

        const allDispoNumbers = new Set();
        if (yarnLot && yarnLot.trim() !== '') {
            const [d1] = await connection.query(`
                SELECT DISTINCT received_against_dispo_nos FROM yarn_receive_form
                WHERE yarn_lot = ? AND received_against_dispo_nos IS NOT NULL AND received_against_dispo_nos != ''
            `, [yarnLot]);
            d1.forEach(r => {
                r.received_against_dispo_nos.split(',').map(s => s.trim())
                    .filter(s => s && s !== 'N/A').forEach(s => allDispoNumbers.add(s));
            });
            const [d2] = await connection.query(`
                SELECT DISTINCT req.dispo_no FROM yarn_requirements_details req
                JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
                WHERE y.yarn_lot = ? AND req.dispo_no IS NOT NULL AND req.dispo_no != ''
            `, [yarnLot]);
            d2.forEach(r => { if (r.dispo_no && r.dispo_no !== 'N/A') allDispoNumbers.add(r.dispo_no.trim()); });
            const [d3] = await connection.query(`
                SELECT DISTINCT search_dispo FROM yarn_receive_form
                WHERE yarn_lot = ? AND search_dispo IS NOT NULL AND search_dispo != ''
            `, [yarnLot]);
            d3.forEach(r => { if (r.search_dispo && r.search_dispo !== 'N/A') allDispoNumbers.add(r.search_dispo.trim()); });
        }

        res.status(200).json({
            ...mainData[0],
            yarn_received_details:    receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers:    Array.from(allDispoNumbers).filter(Boolean).sort()
        });
    } catch (error) {
        console.error('Error fetching data by detail:', error);
        res.status(500).json({ error: 'Failed to fetch data by detail', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/fetch-by-lc/:lcNumber', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { lcNumber } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [mainData] = await connection.query(
            'SELECT * FROM yarn_receive_form WHERE lc_no = ? ORDER BY created_at DESC LIMIT 1',
            [lcNumber]
        );
        if (mainData.length === 0)
            return res.status(404).json({ error: 'No data found for this LC number' });

        const formId  = mainData[0].id;
        const yarnLot = mainData[0].yarn_lot;

        const [receivedDetails] = await connection.query(
            `SELECT id, yarn_receive_form_id, dispo_number,
                    received_date, quantity_kgs, created_at
             FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id`,
            [formId]
        );
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );

        const allDispoNumbers = new Set();
        if (yarnLot && yarnLot.trim() !== '') {
            const [d1] = await connection.query(`
                SELECT DISTINCT received_against_dispo_nos FROM yarn_receive_form
                WHERE yarn_lot = ? AND received_against_dispo_nos IS NOT NULL AND received_against_dispo_nos != ''
            `, [yarnLot]);
            d1.forEach(r => {
                r.received_against_dispo_nos.split(',').map(s => s.trim())
                    .filter(s => s && s !== 'N/A').forEach(s => allDispoNumbers.add(s));
            });
            const [d2] = await connection.query(`
                SELECT DISTINCT req.dispo_no FROM yarn_requirements_details req
                JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
                WHERE y.yarn_lot = ? AND req.dispo_no IS NOT NULL AND req.dispo_no != ''
            `, [yarnLot]);
            d2.forEach(r => { if (r.dispo_no && r.dispo_no !== 'N/A') allDispoNumbers.add(r.dispo_no.trim()); });
            const [d3] = await connection.query(`
                SELECT DISTINCT search_dispo FROM yarn_receive_form
                WHERE yarn_lot = ? AND search_dispo IS NOT NULL AND search_dispo != ''
            `, [yarnLot]);
            d3.forEach(r => { if (r.search_dispo && r.search_dispo !== 'N/A') allDispoNumbers.add(r.search_dispo.trim()); });
        }

        res.status(200).json({
            ...mainData[0],
            yarn_received_details:    receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers:    Array.from(allDispoNumbers).filter(Boolean).sort()
        });
    } catch (error) {
        console.error('Error fetching data by LC:', error);
        res.status(500).json({ error: 'Failed to fetch data by LC', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/fetch-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { yarnLot } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [mainData] = await connection.query(
            'SELECT * FROM yarn_receive_form WHERE yarn_lot = ? ORDER BY created_at DESC LIMIT 1',
            [yarnLot]
        );
        if (mainData.length === 0)
            return res.status(404).json({ error: 'No data found for this yarn lot' });

        const formId = mainData[0].id;
        const [receivedDetails] = await connection.query(
            `SELECT id, yarn_receive_form_id, dispo_number,
                    received_date, quantity_kgs, created_at
             FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id`,
            [formId]
        );
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        res.status(200).json({
            ...mainData[0],
            yarn_received_details:    receivedDetails,
            yarn_requirements_details: requirementsDetails
        });
    } catch (error) {
        console.error('Error fetching data by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch data by yarn lot', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.put('/main/api/yarn/update/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { id } = req.params;
    const { formData, yarnReceivedDetails, yarnRequirementsDetails } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        await connection.query(`
            UPDATE yarn_receive_form SET
                yarn_count = ?, yarn_ply = ?, lc_no = ?, lc_date = ?, beneficiary_factory = ?,
                received_against_po_no = ?, received_against_dispo_nos = ?, pi_no = ?,
                received_start_date = ?, yarn_type = ?, yarn_composition = ?, last_received_date = ?,
                yarn_brand = ?, yarn_lot = ?, pi_lc_rate = ?, dollar_rate = ?, rate_cost_sheet = ?,
                country_of_origin = ?, import_local_source = ?, receipt_qty_kgs = ?,
                total_taka_bd = ?, lc_unit = ?, challan_no = ?, special_notes = ?,
                search_dispo = ?, total_received_against_gd = ?, dispo_nos_for_yarn_lot = ?
            WHERE id = ?
        `, [
            formData.yarn_count, formData.yarn_ply, formData.lc_no, formData.lc_date,
            formData.beneficiary_factory, formData.received_against_po_no, formData.received_against_dispo_nos,
            formData.pi_no, formData.received_start_date, formData.yarn_type, formData.yarn_composition,
            formData.last_received_date, formData.yarn_brand, formData.yarn_lot, formData.pi_lc_rate,
            formData.dollar_rate, formData.rate_cost_sheet, formData.country_of_origin, formData.import_local_source,
            formData.receipt_qty_kgs, formData.total_taka_bd, formData.lc_unit, formData.challan_no,
            formData.special_notes, formData.search_dispo, formData.total_received_against_gd,
            formData.dispo_nos_for_yarn_lot, id
        ]);

        await connection.query('DELETE FROM yarn_received_details WHERE yarn_receive_form_id = ?', [id]);
        if (yarnReceivedDetails?.length > 0) {
            for (const detail of yarnReceivedDetails) {
                // FIX: correct column order — dispo_number gets the dispo value,
                // yarn_receive_form_id gets the form ID
                await connection.query(`
                    INSERT INTO yarn_received_details
                        (yarn_receive_form_id, dispo_number, received_date, quantity_kgs)
                    VALUES (?, ?, ?, ?)
                `, [id, detail.dispo_number || null, detail.received_date, detail.quantity_kgs]);
            }
        }

        await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [id]);
        if (yarnRequirementsDetails?.length > 0) {
            for (const detail of yarnRequirementsDetails) {
                await connection.query(`
                    INSERT INTO yarn_requirements_details
                        (yarn_receive_form_id, warp_required_kgs, weft_required_kgs, dispo_no, total_required_kgs)
                    VALUES (?, ?, ?, ?, ?)
                `, [id, detail.warp_required_kgs, detail.weft_required_kgs, detail.dispo_no, detail.total_required_kgs]);
            }
        }

        await connection.commit();
        res.status(200).json({ message: 'Yarn receive data updated successfully!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating yarn receive data:', error);
        res.status(500).json({ error: 'Failed to update yarn receive data', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.post('/main/api/yarn/save', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { formData, yarnReceivedDetails, yarnRequirementsDetails } = req.body;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [existingRecord] = await connection.query(`
            SELECT id FROM yarn_receive_form
            WHERE yarn_count = ? AND yarn_brand = ? AND yarn_lot = ?
            ORDER BY created_at DESC LIMIT 1
        `, [formData.yarn_count, formData.yarn_brand, formData.yarn_lot]);

        let formId;
        let isUpdate = false;

        if (existingRecord.length > 0) {
            formId   = existingRecord[0].id;
            isUpdate = true;
            await connection.query(`
                UPDATE yarn_receive_form SET
                    yarn_ply = ?, lc_no = ?, lc_date = ?, beneficiary_factory = ?,
                    received_against_po_no = ?, received_against_dispo_nos = ?, pi_no = ?,
                    received_start_date = ?, yarn_type = ?, yarn_composition = ?,
                    last_received_date = ?, pi_lc_rate = ?, dollar_rate = ?, rate_cost_sheet = ?,
                    country_of_origin = ?, import_local_source = ?, receipt_qty_kgs = ?,
                    total_taka_bd = ?, lc_unit = ?, challan_no = ?, special_notes = ?,
                    search_dispo = ?, total_received_against_gd = ?, dispo_nos_for_yarn_lot = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                formData.yarn_ply, formData.lc_no, formData.lc_date, formData.beneficiary_factory,
                formData.received_against_po_no, formData.received_against_dispo_nos, formData.pi_no,
                formData.received_start_date, formData.yarn_type, formData.yarn_composition,
                formData.last_received_date, formData.pi_lc_rate, formData.dollar_rate, formData.rate_cost_sheet,
                formData.country_of_origin, formData.import_local_source, formData.receipt_qty_kgs,
                formData.total_taka_bd, formData.lc_unit, formData.challan_no, formData.special_notes,
                formData.search_dispo, formData.total_received_against_gd, formData.dispo_nos_for_yarn_lot,
                formId
            ]);
            await connection.query('DELETE FROM yarn_received_details WHERE yarn_receive_form_id = ?',    [formId]);
            await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [formId]);
        } else {
            const [result] = await connection.query(`
                INSERT INTO yarn_receive_form (
                    yarn_count, yarn_ply, lc_no, lc_date, beneficiary_factory,
                    received_against_po_no, received_against_dispo_nos, pi_no,
                    received_start_date, yarn_type, yarn_composition, last_received_date,
                    yarn_brand, yarn_lot, pi_lc_rate, dollar_rate, rate_cost_sheet,
                    country_of_origin, import_local_source, receipt_qty_kgs, total_taka_bd,
                    lc_unit, challan_no, special_notes, search_dispo,
                    total_received_against_gd, dispo_nos_for_yarn_lot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                formData.yarn_count, formData.yarn_ply, formData.lc_no, formData.lc_date,
                formData.beneficiary_factory, formData.received_against_po_no, formData.received_against_dispo_nos,
                formData.pi_no, formData.received_start_date, formData.yarn_type, formData.yarn_composition,
                formData.last_received_date, formData.yarn_brand, formData.yarn_lot, formData.pi_lc_rate,
                formData.dollar_rate, formData.rate_cost_sheet, formData.country_of_origin, formData.import_local_source,
                formData.receipt_qty_kgs, formData.total_taka_bd, formData.lc_unit, formData.challan_no,
                formData.special_notes, formData.search_dispo, formData.total_received_against_gd,
                formData.dispo_nos_for_yarn_lot
            ]);
            formId = result.insertId;
        }

        if (yarnReceivedDetails?.length > 0) {
            for (const detail of yarnReceivedDetails) {
                // FIX: correct column order
                await connection.query(`
                    INSERT INTO yarn_received_details
                        (yarn_receive_form_id, dispo_number, received_date, quantity_kgs)
                    VALUES (?, ?, ?, ?)
                `, [formId, detail.dispo_number || null, detail.received_date, detail.quantity_kgs]);
            }
        }

        if (yarnRequirementsDetails?.length > 0) {
            for (const detail of yarnRequirementsDetails) {
                await connection.query(`
                    INSERT INTO yarn_requirements_details
                        (yarn_receive_form_id, warp_required_kgs, weft_required_kgs, dispo_no, total_required_kgs)
                    VALUES (?, ?, ?, ?, ?)
                `, [formId, detail.warp_required_kgs, detail.weft_required_kgs, detail.dispo_no, detail.total_required_kgs]);
            }
        }

        await connection.commit();
        res.status(200).json({
            message: isUpdate ? 'Yarn receive data updated successfully!' : 'Yarn receive data saved successfully!',
            id: formId,
            isUpdate
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving yarn receive data:', error);
        res.status(500).json({ error: 'Failed to save yarn receive data', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/saved-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { startDate, endDate } = req.query;
    let connection;
    try {
        connection = await pool.getConnection();
        let query = `
            SELECT 
                y.id, y.yarn_count, y.yarn_ply, y.lc_no, y.yarn_brand, y.yarn_lot,
                y.beneficiary_factory, y.receipt_qty_kgs, y.total_taka_bd,
                y.dollar_rate, y.created_at,
                COUNT(DISTINCT r.id)   as received_entries,
                COUNT(DISTINCT req.id) as requirement_entries,
                SUM(r.quantity_kgs)          as total_received_qty,
                SUM(req.total_required_kgs)  as total_required_qty
            FROM yarn_receive_form y
            LEFT JOIN yarn_received_details r    ON y.id = r.yarn_receive_form_id
            LEFT JOIN yarn_requirements_details req ON y.id = req.yarn_receive_form_id
            WHERE 1=1
        `;
        const params = [];
        if (startDate && endDate) { query += ' AND DATE(y.created_at) BETWEEN DATE(?) AND DATE(?)'; params.push(startDate, endDate); }
        else if (startDate)       { query += ' AND DATE(y.created_at) >= DATE(?)'; params.push(startDate); }
        else if (endDate)         { query += ' AND DATE(y.created_at) <= DATE(?)'; params.push(endDate); }
        query += ' GROUP BY y.id ORDER BY y.created_at DESC';

        const [rows] = await connection.query(query, params);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching saved yarn records:', error);
        res.status(500).json({ error: 'Failed to fetch saved yarn records', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/export-excel', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { startDate, endDate } = req.query;
    let connection;
    try {
        connection = await pool.getConnection();
        let query = `
            SELECT y.*,
                GROUP_CONCAT(DISTINCT CONCAT(r.received_date, ':', r.quantity_kgs) SEPARATOR ';') as received_details,
                GROUP_CONCAT(DISTINCT CONCAT(req.warp_required_kgs, ':', req.weft_required_kgs, ':', req.dispo_no, ':', req.total_required_kgs) SEPARATOR ';') as requirement_details
            FROM yarn_receive_form y
            LEFT JOIN yarn_received_details r    ON y.id = r.yarn_receive_form_id
            LEFT JOIN yarn_requirements_details req ON y.id = req.yarn_receive_form_id
            WHERE 1=1
        `;
        const params = [];
        if (startDate && endDate) { query += ' AND DATE(y.created_at) BETWEEN DATE(?) AND DATE(?)'; params.push(startDate, endDate); }
        else if (startDate)       { query += ' AND DATE(y.created_at) >= DATE(?)'; params.push(startDate); }
        else if (endDate)         { query += ' AND DATE(y.created_at) <= DATE(?)'; params.push(endDate); }
        query += ' GROUP BY y.id ORDER BY y.created_at DESC';

        const [rows] = await connection.query(query, params);
        const csvHeader = [
            'ID','Yarn Count','Yarn Ply','LC No','LC Date','Beneficiary Factory',
            'Received Against PO No','Received Against Dispo Nos','PI No','Received Start Date',
            'Yarn Type','Yarn Composition','Last Received Date','Yarn Brand','Yarn Lot',
            'PI/LC Rate','Dollar Rate','Rate Cost Sheet','Country of Origin','Import/Local Source',
            'Receipt Qty (Kgs)','Total Taka (BD)','LC Unit','Challan No','Special Notes',
            'Search Dispo','Total Received Against GD','Created At'
        ].join(',');
        const csvRows = rows.map(row => [
            row.id, row.yarn_count, row.yarn_ply, row.lc_no, row.lc_date, row.beneficiary_factory,
            row.received_against_po_no, row.received_against_dispo_nos, row.pi_no, row.received_start_date,
            row.yarn_type, row.yarn_composition, row.last_received_date, row.yarn_brand, row.yarn_lot,
            row.pi_lc_rate, row.dollar_rate, row.rate_cost_sheet, row.country_of_origin, row.import_local_source,
            row.receipt_qty_kgs, row.total_taka_bd, row.lc_unit, row.challan_no, row.special_notes,
            row.search_dispo, row.total_received_against_gd, row.created_at
        ].map(f => `"${(f||'').toString().replace(/"/g,'""')}"`).join(','));
        const timestamp = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="yarn_receive_records_${timestamp}.csv"`);
        res.send([csvHeader, ...csvRows].join('\n'));
    } catch (error) {
        console.error('Error exporting yarn records:', error);
        res.status(500).json({ error: 'Failed to export yarn records', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.delete('/main/api/yarn/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.query('DELETE FROM yarn_received_details    WHERE yarn_receive_form_id = ?', [id]);
        await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [id]);
        const [result] = await connection.query('DELETE FROM yarn_receive_form WHERE id = ?', [id]);
        if (result.affectedRows === 0) throw new Error('No record found with this ID');
        await connection.commit();
        res.status(200).json({ message: 'Yarn record deleted successfully!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting yarn record:', error);
        res.status(500).json({ error: 'Failed to delete yarn record', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/total-received-by-dispo/:dispoNo', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { dispoNo } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        // FIX: query yarn_received_details directly using dispo_number column
        // (previously queried yarn_requirements_details which gives required, not received)
        const [fromDetails] = await connection.query(`
            SELECT COALESCE(SUM(rd.quantity_kgs), 0) as total_from_details
            FROM yarn_received_details rd
            WHERE rd.dispo_number = ?
        `, [dispoNo]);

        // Also check via the parent form's received_against_dispo_nos link
        const [fromForm] = await connection.query(`
            SELECT COALESCE(SUM(rd.quantity_kgs), 0) as total_from_form
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.received_against_dispo_nos LIKE ?
        `, [`%${dispoNo}%`]);

        const totalFromDetails = parseFloat(fromDetails[0]?.total_from_details || 0);
        const totalFromForm    = parseFloat(fromForm[0]?.total_from_form       || 0);
        const totalReceived    = Math.max(totalFromDetails, totalFromForm);

        res.status(200).json({
            total_received: totalReceived,
            dispo_no: dispoNo,
            breakdown: { from_dispo_number_col: totalFromDetails, from_form_link: totalFromForm }
        });
    } catch (error) {
        console.error('Error fetching total received by dispo:', error);
        res.status(500).json({ error: 'Failed to fetch total received', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/dispo-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { yarnLot } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        const [dispoFromRequirements] = await connection.query(`
            SELECT DISTINCT req.dispo_no
            FROM yarn_requirements_details req
            JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
            WHERE y.yarn_lot = ? AND req.dispo_no IS NOT NULL AND req.dispo_no != ''
        `, [yarnLot]);
        const [dispoFromReceived] = await connection.query(`
            SELECT DISTINCT received_against_dispo_nos
            FROM yarn_receive_form
            WHERE yarn_lot = ? AND received_against_dispo_nos IS NOT NULL AND received_against_dispo_nos != ''
        `, [yarnLot]);
        const allDispos = new Set();
        dispoFromRequirements.forEach(r => { if (r.dispo_no) allDispos.add(r.dispo_no.trim()); });
        dispoFromReceived.forEach(r => {
            if (r.received_against_dispo_nos) {
                r.received_against_dispo_nos.split(',').forEach(d => { const t = d.trim(); if (t) allDispos.add(t); });
            }
        });
        const uniqueDispos = Array.from(allDispos).sort();
        res.status(200).json({ dispo_numbers: uniqueDispos, yarn_lot: yarnLot, count: uniqueDispos.length });
    } catch (error) {
        console.error('Error fetching dispo numbers by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch dispo numbers', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// GREIGE YARN ISSUE FORM API ENDPOINTS
// Routes: /main/api/yarn-issue/... and shared routes
//         /main/api/dispo/...  /main/api/po/...
// =====================================================

app.get('/main/api/yarn-issue/dispo-numbers', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT DISTINCT
                dispo_number, po_no, buyer_name, development_id,
                DATE_FORMAT(dispo_creating_date, '%Y-%m-%d') as dispo_date
            FROM dispo_form_data
            WHERE dispo_number IS NOT NULL AND dispo_number != ''
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
            LIMIT 200
        `);
        res.json(records.map(r => ({
            dispo_no: r.dispo_number,
            display:  `${r.dispo_number} | PO: ${r.po_no || 'N/A'} | Buyer: ${r.buyer_name || 'N/A'} | NF: ${r.development_id || 'N/A'}`,
            data: { dispo_number: r.dispo_number, po_no: r.po_no, buyer_name: r.buyer_name, development_id: r.development_id, dispo_date: r.dispo_date }
        })));
    } catch (error) {
        console.error('Error fetching dispo numbers:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dispo numbers', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/dispo/numbers', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT DISTINCT dispo_number
            FROM dispo_form_data
            WHERE dispo_number IS NOT NULL AND dispo_number != ''
            ORDER BY dispo_number DESC
            LIMIT 200
        `);
        res.json(rows.map(d => d.dispo_number));
    } catch (error) {
        console.error('Error fetching dispo numbers:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dispo numbers', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/dispo/fetch-yarn-details/:dispo_no', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNo = req.params.dispo_no;
        const [warpDetails] = await connection.query(
            'SELECT * FROM warp_yarn_details WHERE dispo_number = ? ORDER BY sl_no', [dispoNo]
        );
        const [weftDetails] = await connection.query(
            'SELECT * FROM weft_yarn_details WHERE dispo_number = ? ORDER BY sl_no', [dispoNo]
        );
        res.json({ success: true, warpDetails, weftDetails, dispo_no: dispoNo });
    } catch (error) {
        console.error('Error fetching yarn details:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch yarn details', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/po/numbers', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        let poNumbers = [];
        try {
            const [rows] = await connection.query(`
                SELECT DISTINCT purchase_order_no FROM dispo_form_data
                WHERE purchase_order_no IS NOT NULL AND purchase_order_no != ''
                ORDER BY purchase_order_no DESC LIMIT 100
            `);
            poNumbers = rows.map(r => r.purchase_order_no);
        } catch(e) { console.log('dispo_form_data PO fetch failed:', e.message); }

        if (poNumbers.length === 0) {
            try {
                const [rows] = await connection.query(`
                    SELECT DISTINCT received_against_po_no as purchase_order_no
                    FROM greige_yarn_receive
                    WHERE received_against_po_no IS NOT NULL AND received_against_po_no != ''
                    ORDER BY received_against_po_no DESC LIMIT 100
                `);
                poNumbers = rows.map(r => r.purchase_order_no);
            } catch(e) { console.log('greige_yarn_receive PO fetch failed:', e.message); }
        }
        res.json(poNumbers);
    } catch (error) {
        console.error('Error fetching PO numbers:', error);
        res.json([]);
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// FIX: /main/api/yarn-issue/yarn-lots
// Now queries yarn_receive_form (NOT yarn_issue_form) so
// the returned record IDs belong to the RECEIVE form and
// fetchYarnLotForIssue() can call /main/api/yarn/fetch-by-id
// to get yarn_received_details for breakdown pre-population.
// -------------------------------------------------------
app.get('/main/api/yarn-issue/yarn-lots', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT DISTINCT
                id, yarn_lot, yarn_count, yarn_ply, yarn_brand,
                received_against_po_no, received_against_dispo_nos,
                yarn_type, import_local_source,
                DATE_FORMAT(last_received_date, '%Y-%m-%d') as last_received_date
            FROM yarn_receive_form
            WHERE yarn_lot IS NOT NULL AND yarn_lot != ''
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json(records.map(r => ({
            yarn_lot: r.yarn_lot,
            display:  `Lot: ${r.yarn_lot} | Count: ${r.yarn_count || 'N/A'}/${r.yarn_ply || 'N/A'} | Brand: ${r.yarn_brand || 'N/A'} | Last Rcvd: ${r.last_received_date || 'N/A'}`,
            data: r   // ← id here is a yarn_receive_form id, used by fetchYarnLotForIssue
        })));
    } catch (error) {
        console.error('Error fetching yarn lots:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch yarn lots', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/totals-by-lot/:yarn_lot', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const yarnLot = req.params.yarn_lot;

        // FIX: sum from yarn_received_details joined to yarn_receive_form
        // (the old code queried greige_yarn_receive which may not exist)
        const [receivedResults] = await connection.query(`
            SELECT COALESCE(SUM(rd.quantity_kgs), 0) as total_received
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.yarn_lot = ?
        `, [yarnLot]);

        const [issuedResults] = await connection.query(`
            SELECT COALESCE(SUM(total_issued_kg), 0) as total_issued
            FROM yarn_issue_form WHERE yarn_lot = ?
        `, [yarnLot]);

        res.json({
            total_received: receivedResults[0]?.total_received || 0,
            total_issued:   issuedResults[0]?.total_issued     || 0
        });
    } catch (error) {
        console.error('Error fetching totals by lot:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch totals', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn/total-received-by-po/:po_no', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        // FIX: query yarn_received_details joined to yarn_receive_form
        const [results] = await connection.query(`
            SELECT COALESCE(SUM(rd.quantity_kgs), 0) as total_received
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.received_against_po_no = ?
        `, [req.params.po_no]);
        res.json({ total_received: results[0]?.total_received || 0 });
    } catch (error) {
        console.error('Error fetching total received by PO:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch total received', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/total-issued-by-po/:po_no', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [results] = await connection.query(`
            SELECT COALESCE(SUM(total_issued_kg), 0) as total_issued
            FROM yarn_issue_form WHERE received_against_po_no = ?
        `, [req.params.po_no]);
        res.json({ total_issued: results[0]?.total_issued || 0 });
    } catch (error) {
        console.error('Error fetching total issued by PO:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch total issued', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/total-issued-by-dispo/:dispo_no', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [results] = await connection.query(`
            SELECT COALESCE(SUM(total_issued_kg), 0) as total_issued
            FROM yarn_issue_form WHERE received_against_dispo_nos = ?
        `, [req.params.dispo_no]);
        res.json({ total_issued: results[0]?.total_issued || 0 });
    } catch (error) {
        console.error('Error fetching total issued by dispo:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch total issued', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/next-issue-no', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [results] = await connection.query(`
            SELECT issue_challan_no FROM yarn_issue_form
            WHERE issue_challan_no IS NOT NULL
              AND issue_challan_no REGEXP '^GYI-[0-9]+$'
            ORDER BY CAST(SUBSTRING(issue_challan_no, 5) AS UNSIGNED) DESC
            LIMIT 1
        `);
        let nextNumber = 1;
        if (results.length > 0 && results[0].issue_challan_no) {
            const last = parseInt(results[0].issue_challan_no.split('-')[1]);
            if (!isNaN(last)) nextNumber = last + 1;
        }
        res.json({ issue_no: `GYI-${String(nextNumber).padStart(4, '0')}` });
    } catch (error) {
        console.error('Error generating next issue number:', error);
        res.json({ issue_no: `GYI-${String(Date.now()).slice(-4)}` });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// NEW: GET /main/api/yarn-issue/issue-list
// Returns all saved issue records formatted for the
// "Search Issue Detail" dropdown.
// Source: yarn_issue_form only (never yarn_receive_form).
// -------------------------------------------------------
app.get('/main/api/yarn-issue/issue-list', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT
                id,
                issue_challan_no,
                yarn_lot,
                yarn_count,
                yarn_ply,
                yarn_brand,
                received_against_dispo_nos,
                DATE_FORMAT(issue_date, '%Y-%m-%d') as issue_date,
                issue_type,
                total_issued_kg,
                remaining_stock_kg
            FROM yarn_issue_form
            WHERE issue_challan_no IS NOT NULL AND issue_challan_no != ''
            ORDER BY created_at DESC
            LIMIT 200
        `);
        res.json(records.map(r => ({
            id:               r.id,
            issue_challan_no: r.issue_challan_no,
            display: `${r.issue_challan_no} | Lot: ${r.yarn_lot || 'N/A'} | ${r.yarn_count || ''}/${r.yarn_ply || ''} ${r.yarn_brand || ''} | Dispo: ${r.received_against_dispo_nos || 'N/A'} | Date: ${r.issue_date || 'N/A'} | Issued: ${r.total_issued_kg || 0} Kgs`
        })));
    } catch (error) {
        console.error('Error fetching issue list:', error);
        res.status(500).json({ error: 'Failed to fetch issue list', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// EXISTING: GET /main/api/yarn-issue/find-by-lot/:yarnLot
// Kept for any internal use but no longer called by the
// dropdown flow. Search Yarn Lot → receive form only.
// Search Issue Detail → issue form only.
// -------------------------------------------------------
app.get('/main/api/yarn-issue/find-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.execute(
            `SELECT * FROM yarn_issue_form
             WHERE yarn_lot = ?
             ORDER BY created_at DESC LIMIT 1`,
            [req.params.yarnLot]
        );
        if (records.length === 0)
            return res.status(404).json({ found: false });

        const issueId = records[0].id;
        const [issueDetails] = await connection.execute(
            'SELECT * FROM yarn_issue_details WHERE yarn_issue_form_id = ? ORDER BY id',
            [issueId]
        );
        res.json({ ...records[0], issue_details: issueDetails });
    } catch (error) {
        console.error('Error in find-by-lot:', error);
        res.status(500).json({ error: 'Failed to find issue record by lot', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [mainRecords] = await connection.execute(
            'SELECT * FROM yarn_issue_form WHERE id = ?', [req.params.id]
        );
        if (mainRecords.length === 0)
            return res.status(404).json({ success: false, message: 'Yarn issue record not found' });

        const [issueDetails] = await connection.execute(
            'SELECT * FROM yarn_issue_details WHERE yarn_issue_form_id = ? ORDER BY id',
            [req.params.id]
        );
        res.json({ ...mainRecords[0], issue_details: issueDetails });
    } catch (error) {
        console.error('Error fetching yarn issue record:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch yarn issue record', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// FIX: /main/api/yarn-issue/save  &  /update/:id
// yarn_issue_details INSERT had column order swapped:
//   WRONG:  (dispo_number, yarn_issue_form_id, ...)  VALUES (yarnIssueId, detail.receive_date, ...)
//   RIGHT:  (yarn_issue_form_id, dispo_number, ...)  VALUES (yarnIssueId, detail.dispo_number, ...)
// -------------------------------------------------------
// -------------------------------------------------------
// Helper: compute authoritative total_received_kg
// from yarn_received_details joined to yarn_receive_form.
// Uses TRIM() on yarn_lot to avoid whitespace mismatches.
// -------------------------------------------------------
async function computeTotalReceivedKg(connection, yarnLot) {
    if (!yarnLot || !yarnLot.trim()) return 0;
    const [rows] = await connection.execute(`
        SELECT COALESCE(SUM(rd.quantity_kgs), 0) AS total
        FROM yarn_received_details rd
        JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
        WHERE TRIM(yrf.yarn_lot) = ?
    `, [yarnLot.trim()]);
    return parseFloat(rows[0]?.total || 0);
}

// -------------------------------------------------------
// POST /main/api/yarn-issue/save
// -------------------------------------------------------
app.post('/main/api/yarn-issue/save', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, issueDetails } = req.body;
        const n = v => (v === '' || v === undefined) ? null : v;

        // Server-side recompute total_received_kg from yarn_received_details
        const serverTotalReceived = await computeTotalReceivedKg(connection, formData.yarn_lot);
        const totalReceivedKg  = serverTotalReceived > 0
            ? serverTotalReceived
            : (parseFloat(formData.total_received_kg) || 0);
        const totalIssuedKg    = parseFloat(formData.total_issued_kg) || 0;
        // remaining = received - issued (stock on hand; negative = over-issued)
        const remainingStockKg = totalReceivedKg - totalIssuedKg;

        const [result] = await connection.execute(`
            INSERT INTO yarn_issue_form (
                yarn_count, yarn_ply, lc_no, lc_date, beneficiary_factory,
                received_against_po_no, received_against_dispo_nos, pi_no,
                received_start_date, last_received_date, yarn_lot, yarn_brand,
                yarn_type, yarn_composition, pi_lc_rate, dollar_rate, rate_cost_sheet,
                issued_to, country_of_origin, import_local_source, receive_challan_no,
                issue_challan_no, issue_date, issue_type, outside_issue_kg,
                total_warp_issue_kgs, total_weft_issue_kgs, warp_yarn_price,
                weft_yarn_price, total_received_kg, total_issued_kg,
                remaining_stock_kg, remarks, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
        `, [
            n(formData.yarn_count),                 n(formData.yarn_ply),
            n(formData.lc_no),                      n(formData.lc_date),
            n(formData.beneficiary_factory),         n(formData.received_against_po_no),
            n(formData.received_against_dispo_nos),  n(formData.pi_no),
            n(formData.received_start_date),         n(formData.last_received_date),
            n(formData.yarn_lot),                    n(formData.yarn_brand),
            n(formData.yarn_type),                   n(formData.yarn_composition),
            n(formData.pi_lc_rate)       || 0,       n(formData.dollar_rate)       || 120,
            n(formData.rate_cost_sheet)  || 0,       n(formData.issued_to),
            n(formData.country_of_origin),           n(formData.import_local_source),
            n(formData.receive_challan_no),          n(formData.issue_challan_no),
            n(formData.issue_date),                  n(formData.issue_type),
            n(formData.outside_issue_kg)     || 0,
            n(formData.total_warp_issue_kgs) || 0,
            n(formData.total_weft_issue_kgs) || 0,
            n(formData.warp_yarn_price)      || 0,
            n(formData.weft_yarn_price)      || 0,
            totalReceivedKg,
            totalIssuedKg,
            remainingStockKg,
            n(formData.remarks)
        ]);

        const yarnIssueId = result.insertId;

        if (issueDetails?.length > 0) {
            const valid = issueDetails.filter(d =>
                d.receive_date || d.receive_quantity || d.issue_date || d.issued_quantity
            );
            if (valid.length > 0) {
                const values = valid.map(d => [
                    yarnIssueId,
                    n(d.dispo_number),
                    n(d.receive_date),
                    parseFloat(d.receive_quantity) || 0,
                    n(d.issue_date),
                    parseFloat(d.issued_quantity)  || 0
                ]);
                await connection.query(`
                    INSERT INTO yarn_issue_details
                        (yarn_issue_form_id, dispo_number, receive_date,
                         receive_quantity, issue_date, issued_quantity)
                    VALUES ?
                `, [values]);
            }
        }

        await connection.commit();
        res.json({
            success: true,
            message: 'Yarn issue record saved successfully',
            id: yarnIssueId,
            total_received_kg:  totalReceivedKg,
            remaining_stock_kg: remainingStockKg
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving yarn issue record:', error);
        res.status(500).json({ success: false, message: 'Failed to save yarn issue record', error: error.message, details: error.sqlMessage || error.toString() });
    } finally {
        if (connection) connection.release();
    }
});

// -------------------------------------------------------
// PUT /main/api/yarn-issue/update/:id
// -------------------------------------------------------
app.put('/main/api/yarn-issue/update/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const yarnIssueId = req.params.id;
        const { formData, issueDetails } = req.body;
        const n = v => (v === '' || v === undefined) ? null : v;

        // Server-side recompute total_received_kg
        const serverTotalReceived = await computeTotalReceivedKg(connection, formData.yarn_lot);
        const totalReceivedKg  = serverTotalReceived > 0
            ? serverTotalReceived
            : (parseFloat(formData.total_received_kg) || 0);
        const totalIssuedKg    = parseFloat(formData.total_issued_kg) || 0;
        // remaining = received - issued (stock on hand)
        const remainingStockKg = totalReceivedKg - totalIssuedKg;

        await connection.execute(`
            UPDATE yarn_issue_form SET
                yarn_count = ?, yarn_ply = ?, lc_no = ?, lc_date = ?,
                beneficiary_factory = ?, received_against_po_no = ?,
                received_against_dispo_nos = ?, pi_no = ?,
                received_start_date = ?, last_received_date = ?,
                yarn_lot = ?, yarn_brand = ?, yarn_type = ?,
                yarn_composition = ?, pi_lc_rate = ?, dollar_rate = ?,
                rate_cost_sheet = ?, issued_to = ?, country_of_origin = ?,
                import_local_source = ?, receive_challan_no = ?,
                issue_challan_no = ?, issue_date = ?, issue_type = ?,
                outside_issue_kg = ?, total_warp_issue_kgs = ?,
                total_weft_issue_kgs = ?, warp_yarn_price = ?,
                weft_yarn_price = ?, total_received_kg = ?,
                total_issued_kg = ?, remaining_stock_kg = ?,
                remarks = ?, updated_at = NOW()
            WHERE id = ?
        `, [
            n(formData.yarn_count),                 n(formData.yarn_ply),
            n(formData.lc_no),                      n(formData.lc_date),
            n(formData.beneficiary_factory),         n(formData.received_against_po_no),
            n(formData.received_against_dispo_nos),  n(formData.pi_no),
            n(formData.received_start_date),         n(formData.last_received_date),
            n(formData.yarn_lot),                    n(formData.yarn_brand),
            n(formData.yarn_type),                   n(formData.yarn_composition),
            n(formData.pi_lc_rate)       || 0,       n(formData.dollar_rate)       || 120,
            n(formData.rate_cost_sheet)  || 0,       n(formData.issued_to),
            n(formData.country_of_origin),           n(formData.import_local_source),
            n(formData.receive_challan_no),          n(formData.issue_challan_no),
            n(formData.issue_date),                  n(formData.issue_type),
            n(formData.outside_issue_kg)     || 0,
            n(formData.total_warp_issue_kgs) || 0,
            n(formData.total_weft_issue_kgs) || 0,
            n(formData.warp_yarn_price)      || 0,
            n(formData.weft_yarn_price)      || 0,
            totalReceivedKg,
            totalIssuedKg,
            remainingStockKg,
            n(formData.remarks),
            yarnIssueId
        ]);

        await connection.execute(
            'DELETE FROM yarn_issue_details WHERE yarn_issue_form_id = ?', [yarnIssueId]
        );

        if (issueDetails?.length > 0) {
            const valid = issueDetails.filter(d =>
                d.receive_date || d.receive_quantity || d.issue_date || d.issued_quantity
            );
            if (valid.length > 0) {
                const values = valid.map(d => [
                    yarnIssueId,
                    n(d.dispo_number),
                    n(d.receive_date),
                    parseFloat(d.receive_quantity) || 0,
                    n(d.issue_date),
                    parseFloat(d.issued_quantity)  || 0
                ]);
                await connection.query(`
                    INSERT INTO yarn_issue_details
                        (yarn_issue_form_id, dispo_number, receive_date,
                         receive_quantity, issue_date, issued_quantity)
                    VALUES ?
                `, [values]);
            }
        }

        await connection.commit();
        res.json({
            success: true,
            message: 'Yarn issue record updated successfully',
            id: yarnIssueId,
            total_received_kg:  totalReceivedKg,
            remaining_stock_kg: remainingStockKg
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating yarn issue record:', error);
        res.status(500).json({ success: false, message: 'Failed to update yarn issue record', error: error.message, details: error.sqlMessage || error.toString() });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/saved-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT yif.*,
                (SELECT COUNT(*) FROM yarn_issue_details WHERE yarn_issue_form_id = yif.id) as issue_entries
            FROM yarn_issue_form yif
            ORDER BY yif.created_at DESC
        `);
        res.json(records);
    } catch (error) {
        console.error('Error fetching saved yarn issue records:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch saved records', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.delete('/main/api/yarn-issue/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        await connection.execute('DELETE FROM yarn_issue_details WHERE yarn_issue_form_id = ?', [req.params.id]);
        await connection.execute('DELETE FROM yarn_issue_form WHERE id = ?',                    [req.params.id]);
        await connection.commit();
        res.json({ success: true, message: 'Yarn issue record deleted successfully' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting yarn issue record:', error);
        res.status(500).json({ success: false, message: 'Failed to delete yarn issue record', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/yarn-issue/export-excel', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT yif.*,
                SUM(yid.receive_quantity) as total_received_breakdown,
                SUM(yid.issued_quantity)  as total_issued_breakdown
            FROM yarn_issue_form yif
            LEFT JOIN yarn_issue_details yid ON yif.id = yid.yarn_issue_form_id
            GROUP BY yif.id
            ORDER BY yif.created_at DESC
        `);
        const csvHeader = 'ID,Yarn Lot,Yarn Count,Yarn Ply,PO No,Dispo No,LC No,LC Date,Beneficiary,PI No,Yarn Brand,Yarn Type,Composition,PI/LC Rate (USD),Dollar Rate,Rate Cost Sheet (USD),Issued To,Country,Import/Local,Receive Challan,Issue Challan,Issue Date,Issue Type,Outside Issue (kgs),Warp Issue (kgs),Weft Issue (kgs),Warp Price (Tk),Weft Price (Tk),Total Received (kgs),Total Issued (kgs),Remaining (kgs),Remarks,Created At\n';
        const csvRows = records.map(r => [
            r.id, r.yarn_lot, r.yarn_count, r.yarn_ply,
            r.received_against_po_no, r.received_against_dispo_nos,
            r.lc_no, r.lc_date, r.beneficiary_factory, r.pi_no,
            r.yarn_brand, r.yarn_type, r.yarn_composition,
            r.pi_lc_rate, r.dollar_rate, r.rate_cost_sheet,
            r.issued_to, r.country_of_origin, r.import_local_source,
            r.receive_challan_no, r.issue_challan_no, r.issue_date, r.issue_type,
            r.outside_issue_kg, r.total_warp_issue_kgs, r.total_weft_issue_kgs,
            r.warp_yarn_price, r.weft_yarn_price,
            r.total_received_kg, r.total_issued_kg, r.remaining_stock_kg,
            (r.remarks || '').replace(/,/g, ';'), r.created_at
        ].join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="yarn_issue_records_${Date.now()}.csv"`);
        res.send(csvHeader + csvRows);
    } catch (error) {
        console.error('Error exporting yarn issue records:', error);
        res.status(500).json({ success: false, message: 'Failed to export records', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// RAW YARN STOCK REPORT API ENDPOINTS
// =====================================================

/**
 * Get all unique yarn lots from existing receive and issue forms
 */
app.get('/main/api/yarn-stock-report/yarn-lots', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get unique yarn lots with their details from yarn_receive_form
        const [lots] = await connection.query(`
            SELECT DISTINCT
                yarn_lot,
                yarn_brand,
                yarn_type,
                yarn_composition,
                yarn_count,
                yarn_ply
            FROM yarn_receive_form 
            WHERE yarn_lot IS NOT NULL AND yarn_lot != ''
            GROUP BY yarn_lot
            ORDER BY yarn_lot
        `);
        
        // Format the data for dropdown display
        const formattedLots = lots.map(lot => ({
            yarn_lot: lot.yarn_lot,
            yarn_brand: lot.yarn_brand || 'N/A',
            yarn_type: lot.yarn_type || 'N/A',
            yarn_composition: lot.yarn_composition || 'N/A',
            yarn_count: lot.yarn_count || 'N/A',
            yarn_ply: lot.yarn_ply || 'N/A',
            display: `${lot.yarn_lot} | ${lot.yarn_brand || 'N/A'} | ${lot.yarn_type || 'N/A'} | ${lot.yarn_composition || 'N/A'}`
        }));
        
        res.status(200).json(formattedLots);
        
    } catch (error) {
        console.error('Error fetching yarn lots:', error);
        res.status(500).json({ 
            error: 'Failed to fetch yarn lots', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});


/**
 * V6: Server-side searchable yarn lot list for Raw Yarn Stock.
 * Keeps the old /yarn-lots endpoint unchanged, but avoids loading all lots into the browser.
 */
app.get('/main/api/yarn-stock-report/yarn-lots-search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const q = cleanDropdownSearchText(req.query.q || '');
    const limit = clampDropdownLimit(req.query.limit, 35);
    const pattern = q ? (q.length >= 3 ? `%${q}%` : `${q}%`) : null;
    const params = [];
    let whereSql = `WHERE yarn_lot IS NOT NULL AND TRIM(yarn_lot) != ''`;

    if (q) {
        whereSql += `
            AND (
                yarn_lot LIKE ?
                OR yarn_brand LIKE ?
                OR yarn_type LIKE ?
                OR yarn_composition LIKE ?
                OR yarn_count LIKE ?
                OR received_against_po_no LIKE ?
                OR received_against_dispo_nos LIKE ?
            )
        `;
        params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [lots] = await connection.query(`
            SELECT
                yarn_lot,
                MAX(yarn_brand) AS yarn_brand,
                MAX(yarn_type) AS yarn_type,
                MAX(yarn_composition) AS yarn_composition,
                MAX(yarn_count) AS yarn_count,
                MAX(yarn_ply) AS yarn_ply,
                MAX(created_at) AS last_created_at
            FROM yarn_receive_form
            ${whereSql}
            GROUP BY yarn_lot
            ORDER BY last_created_at DESC, yarn_lot DESC
            LIMIT ?
        `, [...params, limit]);

        const formattedLots = lots.map(lot => ({
            yarn_lot: lot.yarn_lot,
            yarn_brand: lot.yarn_brand || 'N/A',
            yarn_type: lot.yarn_type || 'N/A',
            yarn_composition: lot.yarn_composition || 'N/A',
            yarn_count: lot.yarn_count || 'N/A',
            yarn_ply: lot.yarn_ply || 'N/A',
            display: `${lot.yarn_lot} | ${lot.yarn_brand || 'N/A'} | ${lot.yarn_type || 'N/A'} | ${lot.yarn_composition || 'N/A'}`
        }));

        res.status(200).json(formattedLots);
    } catch (error) {
        console.error('Error searching yarn lots:', error);
        res.status(500).json({
            error: 'Failed to search yarn lots',
            details: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * Get comprehensive stock report for a specific yarn lot
 * Aggregates data from yarn_receive_form and yarn_issue_form
 */
app.get('/main/api/yarn-stock-report/by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // ========================================
        // 1. Get Yarn Details from receive form
        // ========================================
        const [yarnDetails] = await connection.query(`
            SELECT 
                yarn_count,
                yarn_ply,
                yarn_brand,
                yarn_type,
                yarn_composition,
                lc_no,
                beneficiary_factory,
                country_of_origin,
                import_local_source
            FROM yarn_receive_form
            WHERE yarn_lot = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [yarnLot]);
        
        if (yarnDetails.length === 0) {
            return res.status(404).json({ 
                error: 'No data found for this yarn lot' 
            });
        }
        
        // ========================================
        // 2. Get All Receive Transactions
        // ========================================
        const [receiveRecords] = await connection.query(`
            SELECT 
                id,
                received_start_date,
                last_received_date,
                received_against_po_no,
                received_against_dispo_nos,
                challan_no,
                pi_no,
                receipt_qty_kgs,
                created_at
            FROM yarn_receive_form
            WHERE yarn_lot = ?
            ORDER BY COALESCE(received_start_date, created_at)
        `, [yarnLot]);
        
        // Get receive details if they exist
        const [receiveDetails] = await connection.query(`
            SELECT 
                yarn_receive_form_id,
                received_date,
                quantity_kgs
            FROM yarn_received_details
            WHERE yarn_receive_form_id IN (
                SELECT id FROM yarn_receive_form WHERE yarn_lot = ?
            )
            ORDER BY received_date
        `, [yarnLot]);
        
        // ========================================
        // 3. Get All Issue Transactions
        // ========================================
        const [issueRecords] = await connection.query(`
            SELECT 
                id,
                issue_date,
                issue_type,
                issued_to,
                issue_challan_no,
                total_issued_kg,
                remarks,
                created_at
            FROM yarn_issue_form
            WHERE yarn_lot = ?
            ORDER BY COALESCE(issue_date, created_at)
        `, [yarnLot]);
        
        // Get issue details if they exist
        const [issueDetails] = await connection.query(`
            SELECT 
                yarn_issue_form_id,
                issue_date,
                issued_quantity
            FROM yarn_issue_details
            WHERE yarn_issue_form_id IN (
                SELECT id FROM yarn_issue_form WHERE yarn_lot = ?
            )
            ORDER BY issue_date
        `, [yarnLot]);
        
        // ========================================
        // 4. Calculate Summary Statistics
        // ========================================
        
        // Total Received from main form
        const [receivedSumMain] = await connection.query(`
            SELECT COALESCE(SUM(receipt_qty_kgs), 0) as total
            FROM yarn_receive_form
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        // Total Received from details
        const [receivedSumDetails] = await connection.query(`
            SELECT COALESCE(SUM(d.quantity_kgs), 0) as total
            FROM yarn_received_details d
            JOIN yarn_receive_form r ON d.yarn_receive_form_id = r.id
            WHERE r.yarn_lot = ?
        `, [yarnLot]);
        
        // Total Issued from main form
        const [issuedSumMain] = await connection.query(`
            SELECT COALESCE(SUM(total_issued_kg), 0) as total
            FROM yarn_issue_form
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        // Total Issued from details
        const [issuedSumDetails] = await connection.query(`
            SELECT COALESCE(SUM(d.issued_quantity), 0) as total
            FROM yarn_issue_details d
            JOIN yarn_issue_form i ON d.yarn_issue_form_id = i.id
            WHERE i.yarn_lot = ?
        `, [yarnLot]);
        
        const totalReceivedMain = parseFloat(receivedSumMain[0]?.total || 0);
        const totalReceivedDetails = parseFloat(receivedSumDetails[0]?.total || 0);
        const totalReceived = Math.max(totalReceivedMain, totalReceivedDetails);
        
        const totalIssuedMain = parseFloat(issuedSumMain[0]?.total || 0);
        const totalIssuedDetails = parseFloat(issuedSumDetails[0]?.total || 0);
        const totalIssued = Math.max(totalIssuedMain, totalIssuedDetails);
        
        const closingBalance = totalReceived - totalIssued;
        
        // ========================================
        // 5. Get Date Information
        // ========================================
        
        // First receive date
        const [firstReceive] = await connection.query(`
            SELECT MIN(COALESCE(received_start_date, created_at)) as first_date
            FROM yarn_receive_form
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        // Check details for earlier date
        const [firstReceiveDetail] = await connection.query(`
            SELECT MIN(d.received_date) as first_date
            FROM yarn_received_details d
            JOIN yarn_receive_form r ON d.yarn_receive_form_id = r.id
            WHERE r.yarn_lot = ?
        `, [yarnLot]);
        
        const firstDateMain = firstReceive[0]?.first_date;
        const firstDateDetail = firstReceiveDetail[0]?.first_date;
        let firstDate = firstDateMain;
        
        if (firstDateDetail && (!firstDateMain || new Date(firstDateDetail) < new Date(firstDateMain))) {
            firstDate = firstDateDetail;
        }
        
        // Calculate ageing
        let ageingDays = 0;
        if (firstDate) {
            const today = new Date();
            const firstDateObj = new Date(firstDate);
            const diffTime = Math.abs(today - firstDateObj);
            ageingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        
        // Last receive date
        const [lastReceive] = await connection.query(`
            SELECT MAX(COALESCE(last_received_date, received_start_date, created_at)) as last_date
            FROM yarn_receive_form
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        const [lastReceiveDetail] = await connection.query(`
            SELECT MAX(d.received_date) as last_date
            FROM yarn_received_details d
            JOIN yarn_receive_form r ON d.yarn_receive_form_id = r.id
            WHERE r.yarn_lot = ?
        `, [yarnLot]);
        
        const lastDateMain = lastReceive[0]?.last_date;
        const lastDateDetail = lastReceiveDetail[0]?.last_date;
        let lastReceiveDate = lastDateMain;
        
        if (lastDateDetail && (!lastDateMain || new Date(lastDateDetail) > new Date(lastDateMain))) {
            lastReceiveDate = lastDateDetail;
        }
        
        // Last issue date
        const [lastIssue] = await connection.query(`
            SELECT MAX(COALESCE(issue_date, created_at)) as last_date
            FROM yarn_issue_form
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        const [lastIssueDetail] = await connection.query(`
            SELECT MAX(d.issue_date) as last_date
            FROM yarn_issue_details d
            JOIN yarn_issue_form i ON d.yarn_issue_form_id = i.id
            WHERE i.yarn_lot = ?
        `, [yarnLot]);
        
        const lastIssueDateMain = lastIssue[0]?.last_date;
        const lastIssueDateDetail = lastIssueDetail[0]?.last_date;
        let lastIssueDate = lastIssueDateMain;
        
        if (lastIssueDateDetail && (!lastIssueDateMain || new Date(lastIssueDateDetail) > new Date(lastIssueDateMain))) {
            lastIssueDate = lastIssueDateDetail;
        }
        
        // ========================================
        // 6. Process Transactions for Display
        // ========================================
        
        const processedReceiveTransactions = [];
        
        // Map details to their parent records
        const receiveDetailsMap = {};
        receiveDetails.forEach(detail => {
            if (!receiveDetailsMap[detail.yarn_receive_form_id]) {
                receiveDetailsMap[detail.yarn_receive_form_id] = [];
            }
            receiveDetailsMap[detail.yarn_receive_form_id].push(detail);
        });
        
        // Process each receive record
        receiveRecords.forEach(record => {
            const details = receiveDetailsMap[record.id] || [];
            
            if (details.length > 0) {
                // Has breakdown - use details
                details.forEach(detail => {
                    processedReceiveTransactions.push({
                        date: detail.received_date,
                        po_number: record.received_against_po_no,
                        dispo_number: record.received_against_dispo_nos,
                        challan_no: record.challan_no,
                        pi_no: record.pi_no,
                        quantity: parseFloat(detail.quantity_kgs || 0)
                    });
                });
            } else {
                // No breakdown - use main record
                processedReceiveTransactions.push({
                    date: record.received_start_date || record.created_at,
                    po_number: record.received_against_po_no,
                    dispo_number: record.received_against_dispo_nos,
                    challan_no: record.challan_no,
                    pi_no: record.pi_no,
                    quantity: parseFloat(record.receipt_qty_kgs || 0)
                });
            }
        });
        
        // Sort by date
        processedReceiveTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Process issue transactions
        const processedIssueTransactions = [];
        
        // Map details to their parent records
        const issueDetailsMap = {};
        issueDetails.forEach(detail => {
            if (!issueDetailsMap[detail.yarn_issue_form_id]) {
                issueDetailsMap[detail.yarn_issue_form_id] = [];
            }
            issueDetailsMap[detail.yarn_issue_form_id].push(detail);
        });
        
        // Process each issue record
        issueRecords.forEach(record => {
            const details = issueDetailsMap[record.id] || [];
            
            if (details.length > 0) {
                // Has breakdown - use details
                details.forEach(detail => {
                    processedIssueTransactions.push({
                        date: detail.issue_date,
                        issue_type: record.issue_type,
                        issued_to: record.issued_to,
                        challan_no: record.issue_challan_no,
                        remarks: record.remarks,
                        quantity: parseFloat(detail.issued_quantity || 0)
                    });
                });
            } else {
                // No breakdown - use main record
                processedIssueTransactions.push({
                    date: record.issue_date || record.created_at,
                    issue_type: record.issue_type,
                    issued_to: record.issued_to,
                    challan_no: record.issue_challan_no,
                    remarks: record.remarks,
                    quantity: parseFloat(record.total_issued_kg || 0)
                });
            }
        });
        
        // Sort by date
        processedIssueTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // ========================================
        // 7. Build Response
        // ========================================
        const response = {
            yarn_lot: yarnLot,
            yarn_details: yarnDetails[0],
            summary: {
                total_received: totalReceived,
                total_issued: totalIssued,
                closing_balance: closingBalance,
                ageing_days: ageingDays,
                first_receive_date: firstDate,
                last_receive_date: lastReceiveDate,
                last_issue_date: lastIssueDate,
                receive_transaction_count: processedReceiveTransactions.length,
                issue_transaction_count: processedIssueTransactions.length
            },
            receive_transactions: processedReceiveTransactions,
            issue_transactions: processedIssueTransactions
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('❌ Error generating stock report:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to generate stock report', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});


// =======================================
// DYED YARN RECEIVE FORM - API ENDPOINTS 
// =======================================

// ========== FETCH DYED YARN RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/dyed-yarn/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                received_against_dispo_no,
                yarn_count,
                number_of_ply,
                yarn_shade_category,
                batch_no,
                DATE_FORMAT(dyed_yarn_received_date, '%Y-%m-%d') as dyed_yarn_received_date
            FROM dyed_yarn_receive 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching dyed yarn records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dyed yarn records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH PO NUMBERS ==========
app.get('/main/api/po/numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        let poNumbers = [];
        
        // Try dispo_form_data first
        try {
            const [rows1] = await connection.query(`
                SELECT DISTINCT purchase_order_no 
                FROM dispo_form_data 
                WHERE purchase_order_no IS NOT NULL AND purchase_order_no != ''
                ORDER BY purchase_order_no DESC
                LIMIT 100
            `);
            poNumbers = rows1.map(r => r.purchase_order_no);
        } catch (e) {
            console.log('dispo_form_data not available:', e.message);
        }
        
        // If no results, try dyed_yarn_receive table
        if (poNumbers.length === 0) {
            try {
                const [rows2] = await connection.query(`
                    SELECT DISTINCT received_against_po_no as purchase_order_no
                    FROM dyed_yarn_receive 
                    WHERE received_against_po_no IS NOT NULL AND received_against_po_no != ''
                    ORDER BY received_against_po_no DESC
                    LIMIT 100
                `);
                poNumbers = rows2.map(r => r.purchase_order_no);
            } catch (e) {
                console.log('dyed_yarn_receive not available:', e.message);
            }
        }
        
        res.json(poNumbers);
        
    } catch (error) {
        console.error('Error fetching PO numbers:', error);
        res.json([]);
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH ALL DISPO NUMBERS FOR DROPDOWN ==========
app.get('/main/api/dyed-yarn/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [dispoNumbers] = await connection.query(`
            SELECT DISTINCT dispo_number 
            FROM dispo_form_data 
            WHERE dispo_number IS NOT NULL AND dispo_number != ''
            ORDER BY dispo_number DESC
        `);
        
        res.json(dispoNumbers.map(d => d.dispo_number));
        
    } catch (error) {
        console.error('Error fetching dispo numbers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH WARP & WEFT YARN DETAILS BY DISPO NUMBER ==========
app.get('/main/api/dyed-yarn/fetch-yarn-details/:dispo_no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNo = req.params.dispo_no;
        
        // Fetch warp yarn details
        const [warpDetails] = await connection.query(
            `SELECT * FROM warp_yarn_details 
             WHERE dispo_number = ? 
             ORDER BY sl_no`,
            [dispoNo]
        );
        
        // Fetch weft yarn details
        const [weftDetails] = await connection.query(
            `SELECT * FROM weft_yarn_details 
             WHERE dispo_number = ? 
             ORDER BY sl_no`,
            [dispoNo]
        );
        
        res.json({
            success: true,
            warpDetails: warpDetails,
            weftDetails: weftDetails,
            dispo_no: dispoNo
        });
        
    } catch (error) {
        console.error('Error fetching yarn details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch yarn details',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE DYED YARN RECORD (SIMPLIFIED - NO WARP/WEFT DETAILS TABLES) ==========
app.post('/main/api/dyed-yarn/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main dyed yarn record
        const [result] = await connection.execute(
            `INSERT INTO dyed_yarn_receive (
                dyed_yarn_received_date, received_against_po_no, received_against_dispo_no,
                buyer, batch_no, yarn_count, number_of_ply, yarn_shade_category,
                challan_no, dyed_yarn_received_for_warp, dyed_yarn_received_for_weft,
                yarn_dyeing_price, greige_yarn_price, dollar_rate, total_dyed_yarn_price,
                special_notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.dyed_yarn_received_date),
                nullIfEmpty(formData.received_against_po_no),
                nullIfEmpty(formData.received_against_dispo_no),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.batch_no),
                nullIfEmpty(formData.yarn_count),
                nullIfEmpty(formData.number_of_ply),
                nullIfEmpty(formData.yarn_shade_category),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.dyed_yarn_received_for_warp) || 0,
                nullIfEmpty(formData.dyed_yarn_received_for_weft) || 0,
                nullIfEmpty(formData.yarn_dyeing_price) || 0,
                nullIfEmpty(formData.greige_yarn_price) || 0,
                nullIfEmpty(formData.dollar_rate) || 120,
                nullIfEmpty(formData.total_dyed_yarn_price) || 0,
                nullIfEmpty(formData.special_notes)
            ]
        );

        const dyedYarnId = result.insertId;

        // Insert breakdown details (only if not empty)
        if (breakdownDetails && breakdownDetails.length > 0) {
            const validBreakdownDetails = breakdownDetails.filter(detail => 
                detail.dyed_yarn_received_date || detail.dyed_yarn_received_color || detail.dyed_yarn_received_qty
            );
            
            if (validBreakdownDetails.length > 0) {
                const breakdownValues = validBreakdownDetails.map(detail => [
                    nullIfEmpty(formData.received_against_dispo_no),
                    dyedYarnId,
                    nullIfEmpty(detail.dyed_yarn_received_date),
                    nullIfEmpty(detail.dyed_yarn_received_color),
                    parseFloat(detail.dyed_yarn_received_qty) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_breakdown (
                        dispo_number, dyed_yarn_id, dyed_yarn_received_date, 
                        dyed_yarn_received_color, dyed_yarn_received_qty
                    ) VALUES ?`,
                    [breakdownValues]
                );
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Dyed yarn record saved successfully',
            id: dyedYarnId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving dyed yarn record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save dyed yarn record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE DYED YARN RECORD (SIMPLIFIED) ==========
app.put('/main/api/dyed-yarn/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const dyedYarnId = req.params.id;
        const { formData, breakdownDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main dyed yarn record
        await connection.execute(
            `UPDATE dyed_yarn_receive SET
                dyed_yarn_received_date = ?, received_against_po_no = ?, 
                received_against_dispo_no = ?, buyer = ?, batch_no = ?,
                yarn_count = ?, number_of_ply = ?, yarn_shade_category = ?,
                challan_no = ?, dyed_yarn_received_for_warp = ?,
                dyed_yarn_received_for_weft = ?, yarn_dyeing_price = ?,
                greige_yarn_price = ?, dollar_rate = ?, total_dyed_yarn_price = ?,
                special_notes = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.dyed_yarn_received_date),
                nullIfEmpty(formData.received_against_po_no),
                nullIfEmpty(formData.received_against_dispo_no),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.batch_no),
                nullIfEmpty(formData.yarn_count),
                nullIfEmpty(formData.number_of_ply),
                nullIfEmpty(formData.yarn_shade_category),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.dyed_yarn_received_for_warp) || 0,
                nullIfEmpty(formData.dyed_yarn_received_for_weft) || 0,
                nullIfEmpty(formData.yarn_dyeing_price) || 0,
                nullIfEmpty(formData.greige_yarn_price) || 0,
                nullIfEmpty(formData.dollar_rate) || 120,
                nullIfEmpty(formData.total_dyed_yarn_price) || 0,
                nullIfEmpty(formData.special_notes),
                dyedYarnId
            ]
        );

        // Delete existing breakdown details
        await connection.execute(
            'DELETE FROM dyed_yarn_breakdown WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        // Insert updated breakdown details (only if not empty)
        if (breakdownDetails && breakdownDetails.length > 0) {
            const validBreakdownDetails = breakdownDetails.filter(detail => 
                detail.dyed_yarn_received_date || detail.dyed_yarn_received_color || detail.dyed_yarn_received_qty
            );
            
            if (validBreakdownDetails.length > 0) {
                const breakdownValues = validBreakdownDetails.map(detail => [
                    nullIfEmpty(formData.received_against_dispo_no),
                    dyedYarnId,
                    nullIfEmpty(detail.dyed_yarn_received_date),
                    nullIfEmpty(detail.dyed_yarn_received_color),
                    parseFloat(detail.dyed_yarn_received_qty) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_breakdown (
                        dispo_number, dyed_yarn_id, dyed_yarn_received_date, 
                        dyed_yarn_received_color, dyed_yarn_received_qty
                    ) VALUES ?`,
                    [breakdownValues]
                );
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Dyed yarn record updated successfully',
            id: dyedYarnId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating dyed yarn record:',
		error);
        res.status(500).json({
            success: false,
            message: 'Failed to update dyed yarn record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});


// ========== FIX A: REPLACE /main/api/dyed-yarn/fetch-by-id/:id ==========
// Problem: breakdown dates were returned as raw MySQL Date objects,
// not formatted strings — so input[type="date"] showed blank.

app.get('/main/api/dyed-yarn/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const dyedYarnId = req.params.id;

        // Get main record — format the main date field too
        const [mainRecords] = await connection.execute(
            `SELECT *,
                DATE_FORMAT(dyed_yarn_received_date, '%Y-%m-%d') AS dyed_yarn_received_date
             FROM dyed_yarn_receive
             WHERE id = ?`,
            [dyedYarnId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dyed yarn record not found'
            });
        }

        const mainRecord = mainRecords[0];

        // Get breakdown details — DATE_FORMAT ensures JS receives a plain string
        const [breakdownDetails] = await connection.execute(
            `SELECT
                DATE_FORMAT(dyed_yarn_received_date, '%Y-%m-%d') AS dyed_yarn_received_date,
                dyed_yarn_received_color,
                dyed_yarn_received_qty
             FROM dyed_yarn_breakdown
             WHERE dyed_yarn_id = ?
             ORDER BY id ASC`,
            [dyedYarnId]
        );

        res.json({
            ...mainRecord,
            breakdown_details: breakdownDetails
        });

    } catch (error) {
        console.error('Error fetching dyed yarn record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dyed yarn record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED RECORDS ==========
app.get('/main/api/dyed-yarn/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                dyr.*,
                (SELECT COUNT(*) FROM dyed_yarn_breakdown WHERE dyed_yarn_id = dyr.id) as breakdown_entries
             FROM dyed_yarn_receive dyr
             ORDER BY dyr.created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE DYED YARN RECORD ==========
app.delete('/main/api/dyed-yarn/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const dyedYarnId = req.params.id;

        // Delete related breakdown records
        await connection.execute(
            'DELETE FROM dyed_yarn_breakdown WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        // Delete main record
        await connection.execute(
            'DELETE FROM dyed_yarn_receive WHERE id = ?',
            [dyedYarnId]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Dyed yarn record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting dyed yarn record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete dyed yarn record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT TO EXCEL/CSV ==========
app.get('/main/api/dyed-yarn/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                dyr.*,
                GROUP_CONCAT(DISTINCT dyb.dyed_yarn_received_color SEPARATOR ', ') as colors,
                SUM(dyb.dyed_yarn_received_qty) as total_qty_received
             FROM dyed_yarn_receive dyr
             LEFT JOIN dyed_yarn_breakdown dyb ON dyr.id = dyb.dyed_yarn_id
             GROUP BY dyr.id
             ORDER BY dyr.created_at DESC`
        );

        // Create CSV content
        const csvHeader = 'ID,Received Date,PO No,Dispo No,Buyer,Batch No,Yarn Count,Number of Ply,Shade Category,Challan No,Warp Received (kgs),Weft Received (kgs),Dyeing Price (Taka),Greige Price (USD),Dollar Rate,Total Price (Taka),Colors,Total Qty,Special Notes,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.dyed_yarn_received_date || '',
                record.received_against_po_no || '',
                record.received_against_dispo_no || '',
                record.buyer || '',
                record.batch_no || '',
                record.yarn_count || '',
                record.number_of_ply || '',
                record.yarn_shade_category || '',
                record.challan_no || '',
                record.dyed_yarn_received_for_warp || '',
                record.dyed_yarn_received_for_weft || '',
                record.yarn_dyeing_price || '',
                record.greige_yarn_price || '',
                record.dollar_rate || '',
                record.total_dyed_yarn_price || '',
                record.colors || '',
                record.total_qty_received || '',
                (record.special_notes || '').replace(/,/g, ';'),
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="dyed_yarn_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});


// =====================================================
// DYED YARN ISSUE FORM - API ENDPOINTS
// =====================================================

// ========== FETCH DYED YARN ISSUE RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/dyed-yarn-issue/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                received_against_dispo_no,
                yarn_count,
                number_of_ply,
                yarn_shade_category,
                batch_no,
                DATE_FORMAT(issue_date, '%Y-%m-%d') as issue_date
            FROM dyed_yarn_issue 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching dyed yarn issue records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dyed yarn issue records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE DYED YARN ISSUE RECORD ==========
app.post('/main/api/dyed-yarn-issue/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownDetails } = req.body;

        console.log('Received formData:', formData);
        console.log('Received breakdownDetails:', breakdownDetails);

        // Helper function to convert empty strings and undefined to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        // Insert main dyed yarn issue record
        const [result] = await connection.execute(
            `INSERT INTO dyed_yarn_issue (
                yarn_count, number_of_ply, buyer, received_against_po_no, 
                received_against_dispo_no, yarn_shade_category, batch_no, challan_no,
                total_dyed_warp_yarn_issue, total_dyed_weft_yarn_issue, remarks,
                dyed_warp_yarn_price, dyed_weft_yarn_price, greige_yarn_price,
                yarn_dyeing_price, dollar_rate, total_dyed_yarn_price,
                total_issue_quantity, remaining_issue_yarn_quantity,
                issue_date, issue_factory, issue_type,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.yarn_count),
                nullIfEmpty(formData.number_of_ply),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.received_against_po_no),
                nullIfEmpty(formData.received_against_dispo_no),
                nullIfEmpty(formData.yarn_shade_category),
                nullIfEmpty(formData.batch_no),
                nullIfEmpty(formData.challan_no),
                parseFloat(formData.total_dyed_warp_yarn_issue) || 0,
                parseFloat(formData.total_dyed_weft_yarn_issue) || 0,
                nullIfEmpty(formData.remarks),
                parseFloat(formData.dyed_warp_yarn_price) || 0,
                parseFloat(formData.dyed_weft_yarn_price) || 0,
                parseFloat(formData.greige_yarn_price) || 0,
                parseFloat(formData.yarn_dyeing_price) || 0,
                parseFloat(formData.dollar_rate) || 120,
                parseFloat(formData.total_dyed_yarn_price) || 0,
                parseFloat(formData.total_issue_quantity) || 0,
                parseFloat(formData.remaining_issue_yarn_quantity) || 0,
                nullIfEmpty(formData.issue_date),
                nullIfEmpty(formData.issue_factory),
                nullIfEmpty(formData.issue_type)
            ]
        );

        const dyedYarnIssueId = result.insertId;
        console.log('Inserted main record with ID:', dyedYarnIssueId);

        // Insert breakdown details
        if (breakdownDetails && breakdownDetails.length > 0) {
            const breakdownValues = breakdownDetails.map(detail => [
                nullIfEmpty(formData.received_against_dispo_no),
                dyedYarnIssueId,
                nullIfEmpty(detail.dyed_yarn_received_date),
                nullIfEmpty(detail.dyed_yarn_received_color),
                parseFloat(detail.dyed_yarn_received_qty) || 0,
                nullIfEmpty(detail.dyed_yarn_issue_date),
                nullIfEmpty(detail.dyed_yarn_issue_color),
                parseFloat(detail.dyed_yarn_issue_qty) || 0
            ]);

            await connection.query(
                `INSERT INTO dyed_yarn_issue_breakdown (
                    dispo_number, dyed_yarn_issue_id, dyed_yarn_received_date, 
                    dyed_yarn_received_color, dyed_yarn_received_qty,
                    dyed_yarn_issue_date, dyed_yarn_issue_color, dyed_yarn_issue_qty
                ) VALUES ?`,
                [breakdownValues]
            );
            
            console.log('Inserted', breakdownValues.length, 'breakdown records');
        }

        await connection.commit();
        console.log('Transaction committed successfully');

        res.json({
            success: true,
            message: 'Dyed yarn issue record saved successfully',
            id: dyedYarnIssueId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving dyed yarn issue record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save dyed yarn issue record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE DYED YARN ISSUE RECORD ==========
app.put('/main/api/dyed-yarn-issue/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const dyedYarnIssueId = req.params.id;
        const { formData, breakdownDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        // Update main dyed yarn issue record
        await connection.execute(
            `UPDATE dyed_yarn_issue SET
                yarn_count = ?, number_of_ply = ?, buyer = ?, 
                received_against_po_no = ?, received_against_dispo_no = ?,
                yarn_shade_category = ?, batch_no = ?, challan_no = ?,
                total_dyed_warp_yarn_issue = ?, total_dyed_weft_yarn_issue = ?,
                remarks = ?, dyed_warp_yarn_price = ?, dyed_weft_yarn_price = ?,
                greige_yarn_price = ?, yarn_dyeing_price = ?, dollar_rate = ?,
                total_dyed_yarn_price = ?, total_issue_quantity = ?,
                remaining_issue_yarn_quantity = ?, issue_date = ?,
                issue_factory = ?, issue_type = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.yarn_count),
                nullIfEmpty(formData.number_of_ply),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.received_against_po_no),
                nullIfEmpty(formData.received_against_dispo_no),
                nullIfEmpty(formData.yarn_shade_category),
                nullIfEmpty(formData.batch_no),
                nullIfEmpty(formData.challan_no),
                parseFloat(formData.total_dyed_warp_yarn_issue) || 0,
                parseFloat(formData.total_dyed_weft_yarn_issue) || 0,
                nullIfEmpty(formData.remarks),
                parseFloat(formData.dyed_warp_yarn_price) || 0,
                parseFloat(formData.dyed_weft_yarn_price) || 0,
                parseFloat(formData.greige_yarn_price) || 0,
                parseFloat(formData.yarn_dyeing_price) || 0,
                parseFloat(formData.dollar_rate) || 120,
                parseFloat(formData.total_dyed_yarn_price) || 0,
                parseFloat(formData.total_issue_quantity) || 0,
                parseFloat(formData.remaining_issue_yarn_quantity) || 0,
                nullIfEmpty(formData.issue_date),
                nullIfEmpty(formData.issue_factory),
                nullIfEmpty(formData.issue_type),
                dyedYarnIssueId
            ]
        );

        // Delete existing breakdown details
        await connection.execute(
            'DELETE FROM dyed_yarn_issue_breakdown WHERE dyed_yarn_issue_id = ?',
            [dyedYarnIssueId]
        );

        // Insert updated breakdown details
        if (breakdownDetails && breakdownDetails.length > 0) {
            const breakdownValues = breakdownDetails.map(detail => [
                nullIfEmpty(formData.received_against_dispo_no),
                dyedYarnIssueId,
                nullIfEmpty(detail.dyed_yarn_received_date),
                nullIfEmpty(detail.dyed_yarn_received_color),
                parseFloat(detail.dyed_yarn_received_qty) || 0,
                nullIfEmpty(detail.dyed_yarn_issue_date),
                nullIfEmpty(detail.dyed_yarn_issue_color),
                parseFloat(detail.dyed_yarn_issue_qty) || 0
            ]);

            await connection.query(
                `INSERT INTO dyed_yarn_issue_breakdown (
                    dispo_number, dyed_yarn_issue_id, dyed_yarn_received_date, 
                    dyed_yarn_received_color, dyed_yarn_received_qty,
                    dyed_yarn_issue_date, dyed_yarn_issue_color, dyed_yarn_issue_qty
                ) VALUES ?`,
                [breakdownValues]
            );
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Dyed yarn issue record updated successfully',
            id: dyedYarnIssueId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating dyed yarn issue record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update dyed yarn issue record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FIX 1: ADD THIS NEW ENDPOINT TO server.js ==========
// Place this alongside the other dyed-yarn-issue endpoints

// Fetches receive breakdown rows for a given dispo number
// so the Issue form can pre-populate its received date/color/qty columns
app.get('/main/api/dyed-yarn-issue/fetch-receive-breakdown/:dispo_no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNo = req.params.dispo_no;

        const [rows] = await connection.execute(
            `SELECT
                DATE_FORMAT(dyb.dyed_yarn_received_date, '%Y-%m-%d') AS dyed_yarn_received_date,
                dyb.dyed_yarn_received_color,
                dyb.dyed_yarn_received_qty
             FROM dyed_yarn_breakdown dyb
             JOIN dyed_yarn_receive dyr ON dyb.dyed_yarn_id = dyr.id
             WHERE dyr.received_against_dispo_no = ?
             ORDER BY dyb.id ASC`,
            [dispoNo]
        );

        res.json({
            success: true,
            receiveBreakdown: rows,
            dispo_no: dispoNo
        });

    } catch (error) {
        console.error('Error fetching receive breakdown for issue form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch receive breakdown',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FIX B: REPLACE /main/api/dyed-yarn-issue/fetch-by-id/:id ==========
// Problem: when a saved Issue record is loaded via "Search Dispo Yarn Issue",
// the breakdown received columns (date/color/qty) were sourced only from
// dyed_yarn_issue_breakdown — which may have been saved with blank received
// fields if the Fix 1-3 wasn't applied at the time of saving.
//
// Solution: JOIN dyed_yarn_breakdown (from the Receive form) using the
// dispo number so the received columns are always pulled from the real
// receive data, while issue columns come from dyed_yarn_issue_breakdown.
//
// Strategy:
//   - LEFT JOIN dyed_yarn_breakdown (receive side) by dispo number
//   - LEFT JOIN dyed_yarn_issue_breakdown (issue side) by dyed_yarn_issue_id
//   - COALESCE so receive columns prefer live receive data, fall back to
//     whatever was stored in issue_breakdown at save time.

app.get('/main/api/dyed-yarn-issue/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const dyedYarnIssueId = req.params.id;

        // --- 1. Get main issue record ---
        const [mainRecords] = await connection.execute(
            `SELECT *,
                DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date
             FROM dyed_yarn_issue
             WHERE id = ?`,
            [dyedYarnIssueId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dyed yarn issue record not found'
            });
        }

        const mainRecord = mainRecords[0];
        const dispoNo = mainRecord.received_against_dispo_no;

        // --- 2. Fetch live receive breakdown rows for this dispo (source of truth) ---
        let receiveRows = [];
        if (dispoNo) {
            const [rbRows] = await connection.execute(
                `SELECT
                    DATE_FORMAT(dyb.dyed_yarn_received_date, '%Y-%m-%d') AS dyed_yarn_received_date,
                    dyb.dyed_yarn_received_color,
                    dyb.dyed_yarn_received_qty
                 FROM dyed_yarn_breakdown dyb
                 JOIN dyed_yarn_receive dyr ON dyb.dyed_yarn_id = dyr.id
                 WHERE dyr.received_against_dispo_no = ?
                 ORDER BY dyb.id ASC`,
                [dispoNo]
            );
            receiveRows = rbRows;
        }

        // --- 3. Fetch saved issue breakdown rows ---
        const [issueBreakdownRows] = await connection.execute(
            `SELECT
                DATE_FORMAT(dyed_yarn_received_date, '%Y-%m-%d') AS dyed_yarn_received_date,
                dyed_yarn_received_color,
                dyed_yarn_received_qty,
                DATE_FORMAT(dyed_yarn_issue_date, '%Y-%m-%d')    AS dyed_yarn_issue_date,
                dyed_yarn_issue_color,
                dyed_yarn_issue_qty
             FROM dyed_yarn_issue_breakdown
             WHERE dyed_yarn_issue_id = ?
             ORDER BY id ASC`,
            [dyedYarnIssueId]
        );

        // --- 4. Merge: use receive rows as the base; overlay saved issue columns ---
        // If receive rows exist, they are authoritative for the received side.
        // Match by row index (same order as saved).
        const maxRows = Math.max(receiveRows.length, issueBreakdownRows.length);
        const mergedBreakdown = [];

        for (let i = 0; i < maxRows; i++) {
            const recv  = receiveRows[i]       || {};
            const issue = issueBreakdownRows[i] || {};

            mergedBreakdown.push({
                // Received columns: prefer live receive data, fall back to saved issue breakdown
                dyed_yarn_received_date:  recv.dyed_yarn_received_date  || issue.dyed_yarn_received_date  || null,
                dyed_yarn_received_color: recv.dyed_yarn_received_color || issue.dyed_yarn_received_color || '',
                dyed_yarn_received_qty:   recv.dyed_yarn_received_qty   ?? issue.dyed_yarn_received_qty   ?? 0,
                // Issue columns: always from saved issue breakdown
                dyed_yarn_issue_date:     issue.dyed_yarn_issue_date  || null,
                dyed_yarn_issue_color:    issue.dyed_yarn_issue_color || '',
                dyed_yarn_issue_qty:      issue.dyed_yarn_issue_qty   ?? 0
            });
        }

        res.json({
            ...mainRecord,
            breakdown_details: mergedBreakdown
        });

    } catch (error) {
        console.error('Error fetching dyed yarn issue record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dyed yarn issue record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED DYED YARN ISSUE RECORDS ==========
app.get('/main/api/dyed-yarn-issue/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                dyi.*,
                (SELECT COUNT(*) FROM dyed_yarn_issue_breakdown WHERE dyed_yarn_issue_id = dyi.id) as breakdown_entries
             FROM dyed_yarn_issue dyi
             ORDER BY dyi.created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved dyed yarn issue records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved dyed yarn issue records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE DYED YARN ISSUE RECORD ==========
app.delete('/main/api/dyed-yarn-issue/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const dyedYarnIssueId = req.params.id;

        // Delete related breakdown records
        await connection.execute(
            'DELETE FROM dyed_yarn_issue_breakdown WHERE dyed_yarn_issue_id = ?',
            [dyedYarnIssueId]
        );

        // Delete main record
        await connection.execute(
            'DELETE FROM dyed_yarn_issue WHERE id = ?',
            [dyedYarnIssueId]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Dyed yarn issue record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting dyed yarn issue record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete dyed yarn issue record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT DYED YARN ISSUE TO CSV ==========
app.get('/main/api/dyed-yarn-issue/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                dyi.*,
                GROUP_CONCAT(DISTINCT dyib.dyed_yarn_issue_color SEPARATOR ', ') as issue_colors,
                SUM(dyib.dyed_yarn_issue_qty) as total_qty_issued
             FROM dyed_yarn_issue dyi
             LEFT JOIN dyed_yarn_issue_breakdown dyib ON dyi.id = dyib.dyed_yarn_issue_id
             GROUP BY dyi.id
             ORDER BY dyi.created_at DESC`
        );

        // Create CSV content
        const csvHeader = 'ID,Issue Date,PO No,Dispo No,Buyer,Batch No,Yarn Count,Number of Ply,Shade Category,Challan No,Warp Issue (kgs),Weft Issue (kgs),Warp Price (Taka),Weft Price (Taka),Greige Price (USD),Dyeing Price (Taka),Dollar Rate,Total Price (Taka),Total Issue Qty (kgs),Remaining Qty (kgs),Issue Factory,Issue Type,Issue Colors,Total Issued,Remarks,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.issue_date || '',
                record.received_against_po_no || '',
                record.received_against_dispo_no || '',
                record.buyer || '',
                record.batch_no || '',
                record.yarn_count || '',
                record.number_of_ply || '',
                record.yarn_shade_category || '',
                record.challan_no || '',
                record.total_dyed_warp_yarn_issue || '',
                record.total_dyed_weft_yarn_issue || '',
                record.dyed_warp_yarn_price || '',
                record.dyed_weft_yarn_price || '',
                record.greige_yarn_price || '',
                record.yarn_dyeing_price || '',
                record.dollar_rate || '',
                record.total_dyed_yarn_price || '',
                record.total_issue_quantity || '',
                record.remaining_issue_yarn_quantity || '',
                record.issue_factory || '',
                record.issue_type || '',
                (record.issue_colors || '').replace(/,/g, ';'),
                record.total_qty_issued || '',
                (record.remarks || '').replace(/,/g, ';'),
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="dyed_yarn_issue_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting dyed yarn issue records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export dyed yarn issue records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});


// =====================================================
// DYED YARN STOCK REPORT API ENDPOINTS
// =====================================================

/**
 * Get all unique dyed yarn lots from existing receive and issue forms
 */
app.get('/main/api/dyed-yarn-stock-report/yarn-lots', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get unique yarn lots with their details from dyed_yarn_receive
        const [lots] = await connection.query(`
            SELECT DISTINCT
                batch_no as yarn_lot,
                buyer,
                yarn_count,
                number_of_ply,
                yarn_shade_category,
                received_against_dispo_no
            FROM dyed_yarn_receive 
            WHERE batch_no IS NOT NULL AND batch_no != ''
            GROUP BY batch_no
            ORDER BY batch_no DESC
        `);
        
        // Format the data for dropdown display
        const formattedLots = lots.map(lot => ({
            yarn_lot: lot.yarn_lot,
            buyer: lot.buyer || 'N/A',
            yarn_count: lot.yarn_count || 'N/A',
            number_of_ply: lot.number_of_ply || 'N/A',
            yarn_shade_category: lot.yarn_shade_category || 'N/A',
            received_against_dispo_no: lot.received_against_dispo_no || 'N/A',
            display: `${lot.yarn_lot} | ${lot.buyer || 'N/A'} | ${lot.yarn_count || 'N/A'}/${lot.number_of_ply || 'N/A'} | ${lot.yarn_shade_category || 'N/A'}`
        }));
        
        res.status(200).json(formattedLots);
        
    } catch (error) {
        console.error('Error fetching dyed yarn lots:', error);
        res.status(500).json({ 
            error: 'Failed to fetch dyed yarn lots', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * Get comprehensive stock report for a specific dyed yarn batch/lot
 * Aggregates data from dyed_yarn_receive and dyed_yarn_issue
 */
app.get('/main/api/dyed-yarn-stock-report/by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // ========================================
        // 1. Get Dyed Yarn Details from receive form
        // ========================================
        const [yarnDetails] = await connection.query(`
            SELECT 
                yarn_count,
                number_of_ply,
                buyer,
                yarn_shade_category,
                received_against_po_no,
                received_against_dispo_no,
                challan_no,
                yarn_dyeing_price,
                greige_yarn_price,
                dollar_rate,
                total_dyed_yarn_price
            FROM dyed_yarn_receive
            WHERE batch_no = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [yarnLot]);
        
        if (yarnDetails.length === 0) {
            return res.status(404).json({ 
                error: 'No data found for this dyed yarn batch/lot' 
            });
        }
        
        // ========================================
        // 2. Get All Receive Transactions
        // ========================================
        const [receiveRecords] = await connection.query(`
            SELECT 
                id,
                dyed_yarn_received_date,
                received_against_po_no,
                received_against_dispo_no,
                challan_no,
                dyed_yarn_received_for_warp,
                dyed_yarn_received_for_weft,
                created_at
            FROM dyed_yarn_receive
            WHERE batch_no = ?
            ORDER BY COALESCE(dyed_yarn_received_date, created_at)
        `, [yarnLot]);
        
        // Get receive breakdown details if they exist
        const [receiveDetails] = await connection.query(`
            SELECT 
                dyed_yarn_id,
                dyed_yarn_received_date,
                dyed_yarn_received_color,
                dyed_yarn_received_qty
            FROM dyed_yarn_breakdown
            WHERE dyed_yarn_id IN (
                SELECT id FROM dyed_yarn_receive WHERE batch_no = ?
            )
            ORDER BY dyed_yarn_received_date
        `, [yarnLot]);
        
        // ========================================
        // 3. Get All Issue Transactions
        // ========================================
        const [issueRecords] = await connection.query(`
            SELECT 
                id,
                issue_date,
                issue_type,
                issue_factory,
                challan_no,
                total_dyed_warp_yarn_issue,
                total_dyed_weft_yarn_issue,
                remarks,
                created_at
            FROM dyed_yarn_issue
            WHERE batch_no = ?
            ORDER BY COALESCE(issue_date, created_at)
        `, [yarnLot]);
        
        // Get issue breakdown details if they exist
        const [issueDetails] = await connection.query(`
            SELECT 
                dyed_yarn_issue_id,
                dyed_yarn_issue_date,
                dyed_yarn_issue_color,
                dyed_yarn_issue_qty
            FROM dyed_yarn_issue_breakdown
            WHERE dyed_yarn_issue_id IN (
                SELECT id FROM dyed_yarn_issue WHERE batch_no = ?
            )
            ORDER BY dyed_yarn_issue_date
        `, [yarnLot]);
        
        // ========================================
        // 4. Calculate Summary Statistics
        // ========================================
        
        // Total Received from main form (warp + weft)
        const [receivedSumMain] = await connection.query(`
            SELECT 
                COALESCE(SUM(dyed_yarn_received_for_warp), 0) as total_warp,
                COALESCE(SUM(dyed_yarn_received_for_weft), 0) as total_weft
            FROM dyed_yarn_receive
            WHERE batch_no = ?
        `, [yarnLot]);
        
        // Total Received from breakdown details
        const [receivedSumDetails] = await connection.query(`
            SELECT COALESCE(SUM(d.dyed_yarn_received_qty), 0) as total
            FROM dyed_yarn_breakdown d
            JOIN dyed_yarn_receive r ON d.dyed_yarn_id = r.id
            WHERE r.batch_no = ?
        `, [yarnLot]);
        
        // Total Issued from main form (warp + weft)
        const [issuedSumMain] = await connection.query(`
            SELECT 
                COALESCE(SUM(total_dyed_warp_yarn_issue), 0) as total_warp,
                COALESCE(SUM(total_dyed_weft_yarn_issue), 0) as total_weft
            FROM dyed_yarn_issue
            WHERE batch_no = ?
        `, [yarnLot]);
        
        // Total Issued from breakdown details
        const [issuedSumDetails] = await connection.query(`
            SELECT COALESCE(SUM(d.dyed_yarn_issue_qty), 0) as total
            FROM dyed_yarn_issue_breakdown d
            JOIN dyed_yarn_issue i ON d.dyed_yarn_issue_id = i.id
            WHERE i.batch_no = ?
        `, [yarnLot]);
        
        const totalReceivedWarpMain = parseFloat(receivedSumMain[0]?.total_warp || 0);
        const totalReceivedWeftMain = parseFloat(receivedSumMain[0]?.total_weft || 0);
        const totalReceivedMain = totalReceivedWarpMain + totalReceivedWeftMain;
        const totalReceivedDetails = parseFloat(receivedSumDetails[0]?.total || 0);
        const totalReceived = Math.max(totalReceivedMain, totalReceivedDetails);
        
        const totalIssuedWarpMain = parseFloat(issuedSumMain[0]?.total_warp || 0);
        const totalIssuedWeftMain = parseFloat(issuedSumMain[0]?.total_weft || 0);
        const totalIssuedMain = totalIssuedWarpMain + totalIssuedWeftMain;
        const totalIssuedDetails = parseFloat(issuedSumDetails[0]?.total || 0);
        const totalIssued = Math.max(totalIssuedMain, totalIssuedDetails);
        
        const closingBalance = totalReceived - totalIssued;
        
        // ========================================
        // 5. Get Date Information
        // ========================================
        
        // First receive date
        const [firstReceive] = await connection.query(`
            SELECT MIN(COALESCE(dyed_yarn_received_date, created_at)) as first_date
            FROM dyed_yarn_receive
            WHERE batch_no = ?
        `, [yarnLot]);
        
        // Check breakdown details for earlier date
        const [firstReceiveDetail] = await connection.query(`
            SELECT MIN(d.dyed_yarn_received_date) as first_date
            FROM dyed_yarn_breakdown d
            JOIN dyed_yarn_receive r ON d.dyed_yarn_id = r.id
            WHERE r.batch_no = ?
        `, [yarnLot]);
        
        const firstDateMain = firstReceive[0]?.first_date;
        const firstDateDetail = firstReceiveDetail[0]?.first_date;
        let firstDate = firstDateMain;
        
        if (firstDateDetail && (!firstDateMain || new Date(firstDateDetail) < new Date(firstDateMain))) {
            firstDate = firstDateDetail;
        }
        
        // Calculate ageing
        let ageingDays = 0;
        if (firstDate) {
            const today = new Date();
            const firstDateObj = new Date(firstDate);
            const diffTime = Math.abs(today - firstDateObj);
            ageingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        
        // Last receive date
        const [lastReceive] = await connection.query(`
            SELECT MAX(COALESCE(dyed_yarn_received_date, created_at)) as last_date
            FROM dyed_yarn_receive
            WHERE batch_no = ?
        `, [yarnLot]);
        
        const [lastReceiveDetail] = await connection.query(`
            SELECT MAX(d.dyed_yarn_received_date) as last_date
            FROM dyed_yarn_breakdown d
            JOIN dyed_yarn_receive r ON d.dyed_yarn_id = r.id
            WHERE r.batch_no = ?
        `, [yarnLot]);
        
        const lastDateMain = lastReceive[0]?.last_date;
        const lastDateDetail = lastReceiveDetail[0]?.last_date;
        let lastReceiveDate = lastDateMain;
        
        if (lastDateDetail && (!lastDateMain || new Date(lastDateDetail) > new Date(lastDateMain))) {
            lastReceiveDate = lastDateDetail;
        }
        
        // Last issue date
        const [lastIssue] = await connection.query(`
            SELECT MAX(COALESCE(issue_date, created_at)) as last_date
            FROM dyed_yarn_issue
            WHERE batch_no = ?
        `, [yarnLot]);
        
        const [lastIssueDetail] = await connection.query(`
            SELECT MAX(d.dyed_yarn_issue_date) as last_date
            FROM dyed_yarn_issue_breakdown d
            JOIN dyed_yarn_issue i ON d.dyed_yarn_issue_id = i.id
            WHERE i.batch_no = ?
        `, [yarnLot]);
        
        const lastIssueDateMain = lastIssue[0]?.last_date;
        const lastIssueDateDetail = lastIssueDetail[0]?.last_date;
        let lastIssueDate = lastIssueDateMain;
        
        if (lastIssueDateDetail && (!lastIssueDateMain || new Date(lastIssueDateDetail) > new Date(lastIssueDateMain))) {
            lastIssueDate = lastIssueDateDetail;
        }
        
        // ========================================
        // 6. Process Transactions for Display
        // ========================================
        
        const processedReceiveTransactions = [];
        
        // Map breakdown details to their parent records
        const receiveDetailsMap = {};
        receiveDetails.forEach(detail => {
            if (!receiveDetailsMap[detail.dyed_yarn_id]) {
                receiveDetailsMap[detail.dyed_yarn_id] = [];
            }
            receiveDetailsMap[detail.dyed_yarn_id].push(detail);
        });
        
        // Process each receive record
        receiveRecords.forEach(record => {
            const details = receiveDetailsMap[record.id] || [];
            
            if (details.length > 0) {
                // Has breakdown - use details
                details.forEach(detail => {
                    processedReceiveTransactions.push({
                        date: detail.dyed_yarn_received_date,
                        po_number: record.received_against_po_no,
                        dispo_number: record.received_against_dispo_no,
                        challan_no: record.challan_no,
                        color: detail.dyed_yarn_received_color,
                        quantity: parseFloat(detail.dyed_yarn_received_qty || 0),
                        type: 'Breakdown'
                    });
                });
            } else {
                // No breakdown - use main record (warp + weft)
                const totalQty = parseFloat(record.dyed_yarn_received_for_warp || 0) + 
                                parseFloat(record.dyed_yarn_received_for_weft || 0);
                
                if (totalQty > 0) {
                    processedReceiveTransactions.push({
                        date: record.dyed_yarn_received_date || record.created_at,
                        po_number: record.received_against_po_no,
                        dispo_number: record.received_against_dispo_no,
                        challan_no: record.challan_no,
                        color: 'N/A',
                        quantity: totalQty,
                        type: 'Main Record'
                    });
                }
            }
        });
        
        // Sort by date
        processedReceiveTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Process issue transactions
        const processedIssueTransactions = [];
        
        // Map breakdown details to their parent records
        const issueDetailsMap = {};
        issueDetails.forEach(detail => {
            if (!issueDetailsMap[detail.dyed_yarn_issue_id]) {
                issueDetailsMap[detail.dyed_yarn_issue_id] = [];
            }
            issueDetailsMap[detail.dyed_yarn_issue_id].push(detail);
        });
        
        // Process each issue record
        issueRecords.forEach(record => {
            const details = issueDetailsMap[record.id] || [];
            
            if (details.length > 0) {
                // Has breakdown - use details
                details.forEach(detail => {
                    processedIssueTransactions.push({
                        date: detail.dyed_yarn_issue_date,
                        issue_type: record.issue_type,
                        issue_factory: record.issue_factory,
                        challan_no: record.challan_no,
                        color: detail.dyed_yarn_issue_color,
                        remarks: record.remarks,
                        quantity: parseFloat(detail.dyed_yarn_issue_qty || 0),
                        type: 'Breakdown'
                    });
                });
            } else {
                // No breakdown - use main record (warp + weft)
                const totalQty = parseFloat(record.total_dyed_warp_yarn_issue || 0) + 
                                parseFloat(record.total_dyed_weft_yarn_issue || 0);
                
                if (totalQty > 0) {
                    processedIssueTransactions.push({
                        date: record.issue_date || record.created_at,
                        issue_type: record.issue_type,
                        issue_factory: record.issue_factory,
                        challan_no: record.challan_no,
                        color: 'N/A',
                        remarks: record.remarks,
                        quantity: totalQty,
                        type: 'Main Record'
                    });
                }
            }
        });
        
        // Sort by date
        processedIssueTransactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // ========================================
        // 7. Build Response
        // ========================================
        const response = {
            yarn_lot: yarnLot,
            yarn_details: yarnDetails[0],
            summary: {
                total_received: totalReceived,
                total_received_warp: totalReceivedWarpMain,
                total_received_weft: totalReceivedWeftMain,
                total_issued: totalIssued,
                total_issued_warp: totalIssuedWarpMain,
                total_issued_weft: totalIssuedWeftMain,
                closing_balance: closingBalance,
                ageing_days: ageingDays,
                first_receive_date: firstDate,
                last_receive_date: lastReceiveDate,
                last_issue_date: lastIssueDate,
                receive_transaction_count: processedReceiveTransactions.length,
                issue_transaction_count: processedIssueTransactions.length
            },
            receive_transactions: processedReceiveTransactions,
            issue_transactions: processedIssueTransactions
        };
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('❌ Error generating dyed yarn stock report:', error);
        console.error('Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to generate dyed yarn stock report', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});



// =====================================================
// WARPING ENDPOINTS
// =====================================================

app.get('/main/api/warping/search-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(`
            SELECT id, warping_date, po_number, dispo_number,
                   warping_program_no, buyer, machine_type, warping_set, machine_no
            FROM warping_form ORDER BY created_at DESC LIMIT 100`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch warping records', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/warping/fetch-dispo-info/:dispoNumber', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const dispoNumber = decodeURIComponent(req.params.dispoNumber);
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.execute(
            `SELECT po_no, buyer_name, production_construction, beam_total_ends,
                    actual_section, fabric_type, po_qty_yds, warp_beam_length,
                    fabric_composition, loom_production_mtr, yarn_type,
                    process_type, reed_space_inch, reed_count
             FROM dispo_form_data WHERE dispo_number = ? LIMIT 1`,
            [dispoNumber]
        );
        if (!rows.length)
            return res.status(404).json({ success: false, message: `No dispo found: ${dispoNumber}` });
        res.json({ success: true, dispoInfo: rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch dispo info', error: e.message });
    } finally { if (conn) conn.release(); }
});

// ── SAVE ─────────────────────────────────────────────────────────────────────
app.post('/main/api/warping/save', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const { formData: f, breakdownDetails } = req.body;

        const [result] = await conn.execute(
            `INSERT INTO warping_form (
                machine_type, warping_set, warping_date, po_number, dispo_number,
                buyer, production_construction, beam_total_ends, warping_program_no,
                number_of_sections, fabric_type, dispo_quantity_yds, required_warp_length_meter,
                fabric_composition, actual_warp_length_mtr, yarn_weight, machine_no,
                total_no_of_beam, breaks_per_million, machine_speed_meter_min,
                leftover_yarn_kgs, yarn_type, process_type, reed_width_inch,
                flange_to_flange, reed_count, remarks, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
            [
                nullIfEmpty(f.machine_type) || 'Direct',
                nullIfEmpty(f.warping_set)  || 1,
                nullIfEmpty(f.warping_date),
                nullIfEmpty(f.po_number),
                nullIfEmpty(f.dispo_number),
                nullIfEmpty(f.buyer),
                nullIfEmpty(f.production_construction),
                nullIfEmpty(f.beam_total_ends),
                nullIfEmpty(f.warping_program_no),
                nullIfEmpty(f.number_of_sections),
                nullIfEmpty(f.fabric_type),
                nullIfEmpty(f.dispo_quantity_yds),
                nullIfEmpty(f.required_warp_length_meter),
                nullIfEmpty(f.fabric_composition),
                nullIfEmpty(f.actual_warp_length_mtr),
                nullIfEmpty(f.yarn_weight),
                nullIfEmpty(f.machine_no),
                nullIfEmpty(f.total_no_of_beam),
                nullIfEmpty(f.breaks_per_million),
                nullIfEmpty(f.machine_speed_meter_min),
                nullIfEmpty(f.leftover_yarn_kgs),
                nullIfEmpty(f.yarn_type),
                nullIfEmpty(f.process_type),
                nullIfEmpty(f.reed_width_inch),
                nullIfEmpty(f.flange_to_flange),
                nullIfEmpty(f.reed_count),
                nullIfEmpty(f.remarks)
            ]
        );
        const warpingFormId = result.insertId;

        // FIX: use per-row dispo_number from breakdown payload; fall back to main form
        if (breakdownDetails?.length) {
            const valid = breakdownDetails.filter(d =>
                d.warping_date || d.warping_program_no || d.warping_set || d.total_beam_no || d.warping_length_mtr
            );
            if (valid.length) {
                await conn.query(
                    `INSERT INTO warping_breakdown
                        (dispo_number, warping_form_id, warping_date, warping_program_no,
                         warping_set, total_beam_no, warping_length_mtr)
                     VALUES ?`,
                    [valid.map(d => [
                        nullIfEmpty(d.dispo_number) || nullIfEmpty(f.dispo_number),
                        warpingFormId,
                        nullIfEmpty(d.warping_date),
                        nullIfEmpty(d.warping_program_no),
                        parseInt(d.warping_set)        || null,
                        parseInt(d.total_beam_no)      || null,
                        parseFloat(d.warping_length_mtr) || null
                    ])]
                );
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Warping record saved successfully', id: warpingFormId });
    } catch (e) {
        if (conn) await conn.rollback();
        console.error('Error saving warping record:', e);
        res.status(500).json({ success: false, message: 'Failed to save warping record', error: e.message, details: e.sqlMessage });
    } finally { if (conn) conn.release(); }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
app.put('/main/api/warping/update/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const id = req.params.id;
        const { formData: f, breakdownDetails } = req.body;

        await conn.execute(
            `UPDATE warping_form SET
                machine_type=?, warping_set=?, warping_date=?, po_number=?, dispo_number=?,
                buyer=?, production_construction=?, beam_total_ends=?, warping_program_no=?,
                number_of_sections=?, fabric_type=?, dispo_quantity_yds=?, required_warp_length_meter=?,
                fabric_composition=?, actual_warp_length_mtr=?, yarn_weight=?, machine_no=?,
                total_no_of_beam=?, breaks_per_million=?, machine_speed_meter_min=?,
                leftover_yarn_kgs=?, yarn_type=?, process_type=?, reed_width_inch=?,
                flange_to_flange=?, reed_count=?, remarks=?, updated_at=NOW()
             WHERE id=?`,
            [
                nullIfEmpty(f.machine_type) || 'Direct',
                nullIfEmpty(f.warping_set)  || 1,
                nullIfEmpty(f.warping_date),
                nullIfEmpty(f.po_number),
                nullIfEmpty(f.dispo_number),
                nullIfEmpty(f.buyer),
                nullIfEmpty(f.production_construction),
                nullIfEmpty(f.beam_total_ends),
                nullIfEmpty(f.warping_program_no),
                nullIfEmpty(f.number_of_sections),
                nullIfEmpty(f.fabric_type),
                nullIfEmpty(f.dispo_quantity_yds),
                nullIfEmpty(f.required_warp_length_meter),
                nullIfEmpty(f.fabric_composition),
                nullIfEmpty(f.actual_warp_length_mtr),
                nullIfEmpty(f.yarn_weight),
                nullIfEmpty(f.machine_no),
                nullIfEmpty(f.total_no_of_beam),
                nullIfEmpty(f.breaks_per_million),
                nullIfEmpty(f.machine_speed_meter_min),
                nullIfEmpty(f.leftover_yarn_kgs),
                nullIfEmpty(f.yarn_type),
                nullIfEmpty(f.process_type),
                nullIfEmpty(f.reed_width_inch),
                nullIfEmpty(f.flange_to_flange),
                nullIfEmpty(f.reed_count),
                nullIfEmpty(f.remarks),
                id
            ]
        );

        await conn.execute('DELETE FROM warping_breakdown WHERE warping_form_id = ?', [id]);

        // FIX: same per-row dispo logic as save
        if (breakdownDetails?.length) {
            const valid = breakdownDetails.filter(d =>
                d.warping_date || d.warping_program_no || d.warping_set || d.total_beam_no || d.warping_length_mtr
            );
            if (valid.length) {
                await conn.query(
                    `INSERT INTO warping_breakdown
                        (dispo_number, warping_form_id, warping_date, warping_program_no,
                         warping_set, total_beam_no, warping_length_mtr)
                     VALUES ?`,
                    [valid.map(d => [
                        nullIfEmpty(d.dispo_number) || nullIfEmpty(f.dispo_number),
                        id,
                        nullIfEmpty(d.warping_date),
                        nullIfEmpty(d.warping_program_no),
                        parseInt(d.warping_set)          || null,
                        parseInt(d.total_beam_no)        || null,
                        parseFloat(d.warping_length_mtr) || null
                    ])]
                );
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Warping record updated successfully', id });
    } catch (e) {
        if (conn) await conn.rollback();
        res.status(500).json({ success: false, message: 'Failed to update warping record', error: e.message, details: e.sqlMessage });
    } finally { if (conn) conn.release(); }
});

// ── FETCH BY ID ───────────────────────────────────────────────────────────────
app.get('/main/api/warping/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [main] = await conn.execute(
            `SELECT id, machine_type, warping_set, warping_date, po_number, dispo_number,
                    buyer, production_construction, beam_total_ends, warping_program_no,
                    number_of_sections, fabric_type, dispo_quantity_yds, required_warp_length_meter,
                    fabric_composition, actual_warp_length_mtr, yarn_weight, machine_no,
                    total_no_of_beam, breaks_per_million, machine_speed_meter_min,
                    leftover_yarn_kgs, yarn_type, process_type, reed_width_inch,
                    flange_to_flange, reed_count, remarks, created_at, updated_at
             FROM warping_form WHERE id = ?`,
            [req.params.id]
        );
        if (!main.length) return res.status(404).json({ success: false, message: 'Warping record not found' });

        // FIX: return dispo_number per breakdown row so the front-end can restore it
        const [breakdown] = await conn.execute(
            `SELECT id, warping_form_id, dispo_number,
                    DATE_FORMAT(warping_date,'%Y-%m-%d') AS warping_date,
                    warping_program_no, warping_set, total_beam_no, warping_length_mtr
             FROM warping_breakdown WHERE warping_form_id = ? ORDER BY id`,
            [req.params.id]
        );
        res.json({ ...main[0], breakdown_details: breakdown });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch warping record', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/warping/saved-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT wf.*,
                    (SELECT COUNT(*) FROM warping_breakdown WHERE warping_form_id = wf.id) as breakdown_entries
             FROM warping_form wf ORDER BY wf.created_at DESC`
        );
        res.json(rows);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch saved warping records', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.delete('/main/api/warping/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.execute('DELETE FROM warping_breakdown WHERE warping_form_id = ?', [req.params.id]);
        const [result] = await conn.execute('DELETE FROM warping_form WHERE id = ?', [req.params.id]);
        if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Warping record not found' }); }
        await conn.commit();
        res.json({ success: true, message: 'Warping record deleted successfully' });
    } catch (e) {
        if (conn) await conn.rollback();
        res.status(500).json({ success: false, message: 'Failed to delete warping record', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/warping/export-excel', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT wf.*,
                    GROUP_CONCAT(DISTINCT wb.warping_program_no SEPARATOR ', ') AS breakdown_programs,
                    SUM(wb.total_beam_no)       AS total_breakdown_beams,
                    SUM(wb.warping_length_mtr)  AS total_breakdown_length
             FROM warping_form wf
             LEFT JOIN warping_breakdown wb ON wf.id = wb.warping_form_id
             GROUP BY wf.id ORDER BY wf.created_at DESC`
        );
        const header = 'ID,Machine Type,Set,Warping Date,PO Number,Dispo Number,Buyer,Production Construction,Beam Total Ends,Warping Program No,Number of Sections,Fabric Type,Dispo Quantity (Yds),Required Warp Length (Meter),Fabric Composition,Actual Warp Length (Mtr),Yarn Weight,Machine No,Total No of Beam,Breaks per Million,Machine Speed (Meter/Min),Leftover Yarn (kgs),Yarn Type,Process Type,Reed Width (Inch),Flange To Flange,Reed Count,Remarks,Breakdown Programs,Total Breakdown Beams,Total Breakdown Length,Created At\n';
        const csv = rows.map(r => [
            r.id, r.machine_type||'', r.warping_set||'', r.warping_date||'', r.po_number||'',
            r.dispo_number||'', r.buyer||'', r.production_construction||'', r.beam_total_ends||'',
            r.warping_program_no||'', r.number_of_sections||'', r.fabric_type||'',
            r.dispo_quantity_yds||'', r.required_warp_length_meter||'',
            (r.fabric_composition||'').replace(/,/g,';'), r.actual_warp_length_mtr||'',
            r.yarn_weight||'', r.machine_no||'', r.total_no_of_beam||'',
            r.breaks_per_million||'', r.machine_speed_meter_min||'', r.leftover_yarn_kgs||'',
            r.yarn_type||'', r.process_type||'', r.reed_width_inch||'', r.flange_to_flange||'',
            r.reed_count||'', (r.remarks||'').replace(/,/g,';'),
            r.breakdown_programs||'', r.total_breakdown_beams||'', r.total_breakdown_length||'',
            r.created_at
        ].join(',')).join('\n');
        res.setHeader('Content-Type','text/csv');
        res.setHeader('Content-Disposition',`attachment; filename="warping_records_${Date.now()}.csv"`);
        res.send(header + csv);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to export warping records', error: e.message });
    } finally { if (conn) conn.release(); }
});

// =====================================================
// SIZING ENDPOINTS
// =====================================================

app.get('/main/api/sizing/search-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(`
            SELECT id, sizing_date, po_number, dispo_number, warping_program_no,
                   warping_set_no, warping_date, warping_machine_type, buyer,
                   sizing_machine_no, total_size_beam
            FROM sizing_form ORDER BY created_at DESC LIMIT 100`);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch sizing records', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/sizing/fetch-dispo-info/:dispoNumber', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const dispoNumber = decodeURIComponent(req.params.dispoNumber);
    let conn;
    try {
        conn = await pool.getConnection();
        const [dispoRows] = await conn.execute(
            `SELECT po_no, buyer_name, production_construction, beam_total_ends, actual_section
             FROM dispo_form_data WHERE dispo_number = ? LIMIT 1`,
            [dispoNumber]
        );
        if (!dispoRows.length)
            return res.status(404).json({ success: false, message: `No dispo found: ${dispoNumber}` });

        const [warpRows] = await conn.execute(
            `SELECT warping_program_no, warping_set, machine_type,
                    required_warp_length_meter, actual_warp_length_mtr,
                    warping_date, total_no_of_beam
             FROM warping_form WHERE dispo_number = ? ORDER BY created_at DESC LIMIT 1`,
            [dispoNumber]
        );
        res.json({ success: true, dispoInfo: dispoRows[0], warpingInfo: warpRows[0] || null });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch dispo info for sizing', error: e.message });
    } finally { if (conn) conn.release(); }
});

// ── SAVE ─────────────────────────────────────────────────────────────────────
app.post('/main/api/sizing/save', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const { formData: f, breakdownDetails } = req.body;

        const [result] = await conn.execute(
            `INSERT INTO sizing_form (
                po_number, dispo_number, buyer, production_construction, beam_total_ends,
                warping_program_no, warping_set_no, warping_machine_type, required_warp_length_mtr,
                actual_warp_length_mtr, warping_date, number_of_sections, total_warp_beam,
                sizing_date, sizing_set_no, total_size_beam, required_sizing_length_mtr,
                actual_sizing_length_mtr, size_yarn_weight, sizing_machine_no,
                sizing_machine_speed_m_min, water_volume, final_volume, consumed_volume,
                total_used_chemicals_kgs, total_value_of_used_chemicals_tk, size_recipe_no,
                size_material_type, size_add_percent, size_material_consumption_kg, remarks,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
            [
                nullIfEmpty(f.po_number),
                nullIfEmpty(f.dispo_number),
                nullIfEmpty(f.buyer),
                nullIfEmpty(f.production_construction),
                nullIfEmpty(f.beam_total_ends),
                nullIfEmpty(f.warping_program_no),
                nullIfEmpty(f.warping_set_no),
                nullIfEmpty(f.warping_machine_type) || 'Direct',
                nullIfEmpty(f.required_warp_length_mtr),
                nullIfEmpty(f.actual_warp_length_mtr),
                nullIfEmpty(f.warping_date),
                nullIfEmpty(f.number_of_sections),
                nullIfEmpty(f.total_warp_beam),
                nullIfEmpty(f.sizing_date),
                nullIfEmpty(f.sizing_set_no) || 1,
                nullIfEmpty(f.total_size_beam),
                nullIfEmpty(f.required_sizing_length_mtr),
                nullIfEmpty(f.actual_sizing_length_mtr),
                nullIfEmpty(f.size_yarn_weight),
                nullIfEmpty(f.sizing_machine_no),
                nullIfEmpty(f.sizing_machine_speed_m_min),
                nullIfEmpty(f.water_volume),
                nullIfEmpty(f.final_volume),
                nullIfEmpty(f.consumed_volume),
                nullIfEmpty(f.total_used_chemicals_kgs),
                nullIfEmpty(f.total_value_of_used_chemicals_tk),
                nullIfEmpty(f.size_recipe_no),
                nullIfEmpty(f.size_material_type),
                nullIfEmpty(f.size_add_percent),
                nullIfEmpty(f.size_material_consumption_kg),
                nullIfEmpty(f.remarks)
            ]
        );
        const sizingFormId = result.insertId;

        // FIX: use per-row dispo_number from breakdown payload
        if (breakdownDetails?.length) {
            const valid = breakdownDetails.filter(d => d.sizing_date || d.sizing_qty_mtr || d.total_weavers_beam);
            if (valid.length) {
                await conn.query(
                    `INSERT INTO sizing_breakdown
                        (dispo_number, sizing_form_id, sizing_date, sizing_qty_mtr, total_weavers_beam)
                     VALUES ?`,
                    [valid.map(d => [
                        nullIfEmpty(d.dispo_number) || nullIfEmpty(f.dispo_number),
                        sizingFormId,
                        nullIfEmpty(d.sizing_date),
                        parseFloat(d.sizing_qty_mtr)    || null,
                        parseInt(d.total_weavers_beam)  || null
                    ])]
                );
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Sizing record saved successfully', id: sizingFormId });
    } catch (e) {
        if (conn) await conn.rollback();
        res.status(500).json({ success: false, message: 'Failed to save sizing record', error: e.message, details: e.sqlMessage });
    } finally { if (conn) conn.release(); }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
app.put('/main/api/sizing/update/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const id = req.params.id;
        const { formData: f, breakdownDetails } = req.body;

        await conn.execute(
            `UPDATE sizing_form SET
                po_number=?, dispo_number=?, buyer=?, production_construction=?,
                beam_total_ends=?, warping_program_no=?, warping_set_no=?,
                warping_machine_type=?, required_warp_length_mtr=?, actual_warp_length_mtr=?,
                warping_date=?, number_of_sections=?, total_warp_beam=?,
                sizing_date=?, sizing_set_no=?, total_size_beam=?,
                required_sizing_length_mtr=?, actual_sizing_length_mtr=?,
                size_yarn_weight=?, sizing_machine_no=?, sizing_machine_speed_m_min=?,
                water_volume=?, final_volume=?, consumed_volume=?,
                total_used_chemicals_kgs=?, total_value_of_used_chemicals_tk=?,
                size_recipe_no=?, size_material_type=?, size_add_percent=?,
                size_material_consumption_kg=?, remarks=?, updated_at=NOW()
             WHERE id=?`,
            [
                nullIfEmpty(f.po_number),
                nullIfEmpty(f.dispo_number),
                nullIfEmpty(f.buyer),
                nullIfEmpty(f.production_construction),
                nullIfEmpty(f.beam_total_ends),
                nullIfEmpty(f.warping_program_no),
                nullIfEmpty(f.warping_set_no),
                nullIfEmpty(f.warping_machine_type) || 'Direct',
                nullIfEmpty(f.required_warp_length_mtr),
                nullIfEmpty(f.actual_warp_length_mtr),
                nullIfEmpty(f.warping_date),
                nullIfEmpty(f.number_of_sections),
                nullIfEmpty(f.total_warp_beam),
                nullIfEmpty(f.sizing_date),
                nullIfEmpty(f.sizing_set_no) || 1,
                nullIfEmpty(f.total_size_beam),
                nullIfEmpty(f.required_sizing_length_mtr),
                nullIfEmpty(f.actual_sizing_length_mtr),
                nullIfEmpty(f.size_yarn_weight),
                nullIfEmpty(f.sizing_machine_no),
                nullIfEmpty(f.sizing_machine_speed_m_min),
                nullIfEmpty(f.water_volume),
                nullIfEmpty(f.final_volume),
                nullIfEmpty(f.consumed_volume),
                nullIfEmpty(f.total_used_chemicals_kgs),
                nullIfEmpty(f.total_value_of_used_chemicals_tk),
                nullIfEmpty(f.size_recipe_no),
                nullIfEmpty(f.size_material_type),
                nullIfEmpty(f.size_add_percent),
                nullIfEmpty(f.size_material_consumption_kg),
                nullIfEmpty(f.remarks),
                id
            ]
        );

        await conn.execute('DELETE FROM sizing_breakdown WHERE sizing_form_id = ?', [id]);

        // FIX: same per-row dispo logic
        if (breakdownDetails?.length) {
            const valid = breakdownDetails.filter(d => d.sizing_date || d.sizing_qty_mtr || d.total_weavers_beam);
            if (valid.length) {
                await conn.query(
                    `INSERT INTO sizing_breakdown
                        (dispo_number, sizing_form_id, sizing_date, sizing_qty_mtr, total_weavers_beam)
                     VALUES ?`,
                    [valid.map(d => [
                        nullIfEmpty(d.dispo_number) || nullIfEmpty(f.dispo_number),
                        id,
                        nullIfEmpty(d.sizing_date),
                        parseFloat(d.sizing_qty_mtr)   || null,
                        parseInt(d.total_weavers_beam) || null
                    ])]
                );
            }
        }

        await conn.commit();
        res.json({ success: true, message: 'Sizing record updated successfully', id });
    } catch (e) {
        if (conn) await conn.rollback();
        res.status(500).json({ success: false, message: 'Failed to update sizing record', error: e.message, details: e.sqlMessage });
    } finally { if (conn) conn.release(); }
});

// ── FETCH BY ID ───────────────────────────────────────────────────────────────
app.get('/main/api/sizing/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [main] = await conn.execute('SELECT * FROM sizing_form WHERE id = ?', [req.params.id]);
        if (!main.length) return res.status(404).json({ success: false, message: 'Sizing record not found' });

        // FIX: return dispo_number per breakdown row
        const [breakdown] = await conn.execute(
            `SELECT id, sizing_form_id, dispo_number,
                    DATE_FORMAT(sizing_date,'%Y-%m-%d') AS sizing_date,
                    sizing_qty_mtr, total_weavers_beam
             FROM sizing_breakdown WHERE sizing_form_id = ? ORDER BY id`,
            [req.params.id]
        );
        res.json({ ...main[0], breakdown_details: breakdown });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch sizing record', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/sizing/saved-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT sf.*,
                    (SELECT COUNT(*) FROM sizing_breakdown WHERE sizing_form_id = sf.id) as breakdown_entries
             FROM sizing_form sf ORDER BY sf.created_at DESC`
        );
        res.json(rows);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to fetch saved sizing records', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.delete('/main/api/sizing/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.execute('DELETE FROM sizing_breakdown WHERE sizing_form_id = ?', [req.params.id]);
        const [result] = await conn.execute('DELETE FROM sizing_form WHERE id = ?', [req.params.id]);
        if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Sizing record not found' }); }
        await conn.commit();
        res.json({ success: true, message: 'Sizing record deleted successfully' });
    } catch (e) {
        if (conn) await conn.rollback();
        res.status(500).json({ success: false, message: 'Failed to delete sizing record', error: e.message });
    } finally { if (conn) conn.release(); }
});

app.get('/main/api/sizing/export-excel', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT sf.*,
                    GROUP_CONCAT(DISTINCT sb.sizing_date SEPARATOR ', ') AS breakdown_dates,
                    SUM(sb.sizing_qty_mtr)     AS total_breakdown_qty,
                    SUM(sb.total_weavers_beam) AS total_breakdown_beams
             FROM sizing_form sf
             LEFT JOIN sizing_breakdown sb ON sf.id = sb.sizing_form_id
             GROUP BY sf.id ORDER BY sf.created_at DESC`
        );
        const header = 'ID,PO Number,Dispo Number,Buyer,Production Construction,Beam Total Ends,Warping Program No,Warping Set No,Warping Machine Type,Required Warp Length (Mtr),Actual Warp Length (Mtr),Warping Date,Number of Sections,Total Warp Beam,Sizing Date,Sizing Set No,Total Size Beam,Required Sizing Length (Mtr),Actual Sizing Length (Mtr),Size Yarn Weight,Sizing Machine No,Sizing Machine Speed (M/Min),Water Volume,Final Volume,Consumed Volume,Total Used Chemicals (kgs),Total Value of Used Chemicals (TK),Size Recipe No,Size Material Type,Size Add (%),Size Material Consumption (kg),Remarks,Breakdown Dates,Total Breakdown Qty,Total Breakdown Beams,Created At\n';
        const csv = rows.map(r => [
            r.id, r.po_number||'', r.dispo_number||'', r.buyer||'',
            r.production_construction||'', r.beam_total_ends||'', r.warping_program_no||'',
            r.warping_set_no||'', r.warping_machine_type||'', r.required_warp_length_mtr||'',
            r.actual_warp_length_mtr||'', r.warping_date||'', r.number_of_sections||'',
            r.total_warp_beam||'', r.sizing_date||'', r.sizing_set_no||'',
            r.total_size_beam||'', r.required_sizing_length_mtr||'', r.actual_sizing_length_mtr||'',
            r.size_yarn_weight||'', r.sizing_machine_no||'', r.sizing_machine_speed_m_min||'',
            r.water_volume||'', r.final_volume||'', r.consumed_volume||'',
            r.total_used_chemicals_kgs||'', r.total_value_of_used_chemicals_tk||'',
            r.size_recipe_no||'', r.size_material_type||'', r.size_add_percent||'',
            r.size_material_consumption_kg||'',
            (r.remarks||'').replace(/,/g,';').replace(/\n/g,' '),
            r.breakdown_dates||'', r.total_breakdown_qty||'', r.total_breakdown_beams||'',
            r.created_at
        ].join(',')).join('\n');
        res.setHeader('Content-Type','text/csv');
        res.setHeader('Content-Disposition',`attachment; filename="sizing_records_${Date.now()}.csv"`);
        res.send(header + csv);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to export sizing records', error: e.message });
    } finally { if (conn) conn.release(); }
});

// =====================================================
// LOOM PRODUCTION DATA ENTRY FORM - API ENDPOINTS (ENHANCED)
// =====================================================

// ========== FETCH LOOM PRODUCTION RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/loom-production/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                loom_no,
                weaving_date,
                po_number,
                dispo_number,
                buyer,
                marketing_ref_tracking_no,
                production_construction,
                yarn_type,
                process_type
            FROM loom_production_form 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching loom production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE LOOM PRODUCTION RECORD WITH BREAKDOWN ==========
app.post('/main/api/loom-production/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main loom production form record
        const [result] = await connection.execute(
            `INSERT INTO loom_production_form (
                weaving_date, loom_no, loom_rpm, buyer, production_construction,
                po_number, dispo_number, account_holder, bulk_fabric_delivery_date,
                customer_ref, weave, finish_type, yarn_type, po_issue_date,
                po_received_date, marketing_ref_tracking_no, end_use, order_type,
                process_type, fabric_composition, po_quantity_yds, dispo_quantity_yds,
                lower_beam_crimp, required_print_production_mtr, required_greige_production_mtr,
                required_loom_production_mtr, required_warp_length_mtr, cuttable_width_inch,
                grey_width_inch, beam_total_ends, reed_count, weaving_beam_set_no,
                in_house_production_day, beam_start_date, remarks, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.weaving_date),
                nullIfEmpty(formData.loom_no),
                nullIfEmpty(formData.loom_rpm),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.customer_ref),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.po_issue_date),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.marketing_ref_tracking_no),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.lower_beam_crimp),
                nullIfEmpty(formData.required_print_production_mtr),
                nullIfEmpty(formData.required_greige_production_mtr),
                nullIfEmpty(formData.required_loom_production_mtr),
                nullIfEmpty(formData.required_warp_length_mtr),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.beam_total_ends),
                nullIfEmpty(formData.reed_count),
                nullIfEmpty(formData.weaving_beam_set_no),
                nullIfEmpty(formData.in_house_production_day),
                nullIfEmpty(formData.beam_start_date),
                nullIfEmpty(formData.remarks)
            ]
        );

        const loomProductionId = result.insertId;

        // Insert breakdown data if provided
        if (breakdownData && Array.isArray(breakdownData) && breakdownData.length > 0) {
            for (const breakdown of breakdownData) {
                if (breakdown.loom_production_date || breakdown.loom_production_quantity_yds) {
                    await connection.execute(
                        `INSERT INTO loom_production_breakdown (
                            dispo_number,
                            loom_production_id,
                            loom_production_date,
                            run_loom,
                            loom_production_quantity_yds,
                            created_at
                        ) VALUES (?, ?, ?, ?, ?, NOW())`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            loomProductionId,
                            nullIfEmpty(breakdown.loom_production_date),
                            nullIfEmpty(breakdown.run_loom),
                            nullIfEmpty(breakdown.loom_production_quantity_yds)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Loom production record saved successfully',
            id: loomProductionId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving loom production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save loom production record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE LOOM PRODUCTION RECORD WITH BREAKDOWN ==========
app.put('/main/api/loom-production/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const loomProductionId = req.params.id;
        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main loom production form record
        await connection.execute(
            `UPDATE loom_production_form SET
                weaving_date = ?, loom_no = ?, loom_rpm = ?, buyer = ?,
                production_construction = ?, po_number = ?, dispo_number = ?,
                account_holder = ?, bulk_fabric_delivery_date = ?, customer_ref = ?,
                weave = ?, finish_type = ?, yarn_type = ?, po_issue_date = ?,
                po_received_date = ?, marketing_ref_tracking_no = ?, end_use = ?,
                order_type = ?, process_type = ?, fabric_composition = ?,
                po_quantity_yds = ?, dispo_quantity_yds = ?, lower_beam_crimp = ?,
                required_print_production_mtr = ?, required_greige_production_mtr = ?,
                required_loom_production_mtr = ?, required_warp_length_mtr = ?,
                cuttable_width_inch = ?, grey_width_inch = ?, beam_total_ends = ?,
                reed_count = ?, weaving_beam_set_no = ?, in_house_production_day = ?,
                beam_start_date = ?, remarks = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.weaving_date),
                nullIfEmpty(formData.loom_no),
                nullIfEmpty(formData.loom_rpm),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.customer_ref),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.po_issue_date),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.marketing_ref_tracking_no),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.lower_beam_crimp),
                nullIfEmpty(formData.required_print_production_mtr),
                nullIfEmpty(formData.required_greige_production_mtr),
                nullIfEmpty(formData.required_loom_production_mtr),
                nullIfEmpty(formData.required_warp_length_mtr),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.beam_total_ends),
                nullIfEmpty(formData.reed_count),
                nullIfEmpty(formData.weaving_beam_set_no),
                nullIfEmpty(formData.in_house_production_day),
                nullIfEmpty(formData.beam_start_date),
                nullIfEmpty(formData.remarks),
                loomProductionId
            ]
        );

        // Delete existing breakdown data
        await connection.execute(
            'DELETE FROM loom_production_breakdown WHERE loom_production_id = ?',
            [loomProductionId]
        );

        // Insert new breakdown data if provided
        if (breakdownData && Array.isArray(breakdownData) && breakdownData.length > 0) {
            for (const breakdown of breakdownData) {
                if (breakdown.loom_production_date || breakdown.loom_production_quantity_yds) {
                    await connection.execute(
                        `INSERT INTO loom_production_breakdown (
                            dispo_number,
                            loom_production_id,
                            loom_production_date,
                            run_loom,
                            loom_production_quantity_yds,
                            created_at
                        ) VALUES (?, ?, ?, ?, ?, NOW())`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            loomProductionId,
                            nullIfEmpty(breakdown.loom_production_date),
                            nullIfEmpty(breakdown.run_loom),
                            nullIfEmpty(breakdown.loom_production_quantity_yds)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Loom production record updated successfully',
            id: loomProductionId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating loom production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update loom production record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH LOOM PRODUCTION RECORD BY ID WITH BREAKDOWN ==========
app.get('/main/api/loom-production/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const loomProductionId = req.params.id;

        // Get main record
        const [mainRecords] = await connection.execute(
            'SELECT * FROM loom_production_form WHERE id = ?',
            [loomProductionId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Loom production record not found'
            });
        }

        // Get breakdown records
        const [breakdownRecords] = await connection.execute(
            `SELECT 
                loom_production_date,
                run_loom,
                loom_production_quantity_yds
            FROM loom_production_breakdown 
            WHERE loom_production_id = ?
            ORDER BY loom_production_date ASC`,
            [loomProductionId]
        );

        const responseData = {
            ...mainRecords[0],
            breakdownData: breakdownRecords
        };

        res.json(responseData);

    } catch (error) {
        console.error('Error fetching loom production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loom production record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE LOOM PRODUCTION RECORD WITH BREAKDOWN ==========
app.delete('/main/api/loom-production/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const loomProductionId = req.params.id;

        // Delete breakdown records first (foreign key constraint)
        await connection.execute(
            'DELETE FROM loom_production_breakdown WHERE loom_production_id = ?',
            [loomProductionId]
        );

        // Delete main record
        const [result] = await connection.execute(
            'DELETE FROM loom_production_form WHERE id = ?',
            [loomProductionId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Loom production record not found'
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Loom production record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting loom production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete loom production record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED LOOM PRODUCTION RECORDS ==========
app.get('/main/api/loom-production/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                lpf.*,
                COUNT(lpb.id) as breakdown_count,
                SUM(lpb.loom_production_quantity_yds) as total_production_yds
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpf.id = lpb.loom_production_id
            GROUP BY lpf.id
            ORDER BY lpf.created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved loom production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT LOOM PRODUCTION RECORDS TO CSV ==========
app.get('/main/api/loom-production/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT * FROM loom_production_form ORDER BY created_at DESC`
        );

        // Create CSV header
        const csvHeader = 'ID,Weaving Date,Loom No,Loom RPM,Buyer,Production Construction,PO Number,Dispo Number,Account Holder,Bulk Fabric Delivery Date,Customer Ref,Weave,Finish Type,Yarn Type,PO Issue Date,PO Received Date,Marketing Ref/Tracking No,End Use,Order Type,Process Type,Fabric Composition,PO Quantity (Yds),Dispo Quantity (Yds),Lower Beam Crimp,Required Print Production (Mtr),Required Greige Production (Mtr),Required Loom Production (Mtr),Required Warp Length (Mtr),Cuttable Width (Inch),Grey Width (Inch),Beam Total Ends,Reed Count,Weaving Beam Set No,In House Production/Day,Beam Start Date,Remarks,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.weaving_date || '',
                record.loom_no || '',
                record.loom_rpm || '',
                record.buyer || '',
                record.production_construction || '',
                record.po_number || '',
                record.dispo_number || '',
                record.account_holder || '',
                record.bulk_fabric_delivery_date || '',
                record.customer_ref || '',
                record.weave || '',
                record.finish_type || '',
                record.yarn_type || '',
                record.po_issue_date || '',
                record.po_received_date || '',
                record.marketing_ref_tracking_no || '',
                record.end_use || '',
                record.order_type || '',
                record.process_type || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.lower_beam_crimp || '',
                record.required_print_production_mtr || '',
                record.required_greige_production_mtr || '',
                record.required_loom_production_mtr || '',
                record.required_warp_length_mtr || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.beam_total_ends || '',
                record.reed_count || '',
                record.weaving_beam_set_no || '',
                record.in_house_production_day || '',
                record.beam_start_date || '',
                (record.remarks || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="loom_production_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting loom production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH LOOM PRODUCTION STATISTICS ==========
app.get('/main/api/loom-production/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        // Total records
        const [totalRecords] = await connection.query(
            'SELECT COUNT(*) as total FROM loom_production_form'
        );

        // Total production from breakdown
        const [totalProduction] = await connection.query(
            'SELECT SUM(loom_production_quantity_yds) as total_yds FROM loom_production_breakdown'
        );

        // Recent records
        const [recentRecords] = await connection.query(
            `SELECT 
                lpf.id, lpf.loom_no, lpf.weaving_date, lpf.dispo_number,
                SUM(lpb.loom_production_quantity_yds) as total_production_yds
             FROM loom_production_form lpf
             LEFT JOIN loom_production_breakdown lpb ON lpf.id = lpb.loom_production_id
             GROUP BY lpf.id
             ORDER BY lpf.created_at DESC 
             LIMIT 10`
        );

        // Records by month (last 6 months)
        const [byMonth] = await connection.query(
            `SELECT 
                DATE_FORMAT(weaving_date, '%Y-%m') as month,
                COUNT(*) as count
             FROM loom_production_form 
             WHERE weaving_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
             GROUP BY DATE_FORMAT(weaving_date, '%Y-%m')
             ORDER BY month DESC`
        );

        res.json({
            success: true,
            statistics: {
                total_records: totalRecords[0].total,
                total_production_yds: totalProduction[0].total_yds || 0,
                recent_records: recentRecords,
                by_month: byMonth
            }
        });

    } catch (error) {
        console.error('Error fetching loom production statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loom production statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH LOOM PRODUCTION RECORDS WITH FILTERS ==========
app.post('/main/api/loom-production/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            loom_no,
            po_number,
            dispo_number,
            buyer,
            date_from,
            date_to
        } = req.body;

        let query = 'SELECT * FROM loom_production_form WHERE 1=1';
        const params = [];

        if (loom_no) {
            query += ' AND loom_no LIKE ?';
            params.push(`%${loom_no}%`);
        }

        if (po_number) {
            query += ' AND po_number LIKE ?';
            params.push(`%${po_number}%`);
        }

        if (dispo_number) {
            query += ' AND dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (date_from) {
            query += ' AND weaving_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND weaving_date <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching loom production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET LOOM PRODUCTION RECORDS BY DISPO NUMBER ==========
app.get('/main/api/loom-production/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = req.params.dispoNumber;

        const [records] = await connection.query(
            `SELECT * FROM loom_production_form
             WHERE dispo_number = ?
             ORDER BY weaving_date DESC`,
            [dispoNumber]
        );

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error fetching loom production records by dispo:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== BULK DELETE LOOM PRODUCTION RECORDS ==========
app.post('/main/api/loom-production/bulk-delete', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { record_ids } = req.body;

        if (!record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No record IDs provided'
            });
        }

        // Delete breakdown records first
        await connection.query(
            'DELETE FROM loom_production_breakdown WHERE loom_production_id IN (?)',
            [record_ids]
        );

        // Delete main records
        const [result] = await connection.query(
            'DELETE FROM loom_production_form WHERE id IN (?)',
            [record_ids]
        );

        await connection.commit();

        res.json({
            success: true,
            message: `Successfully deleted ${result.affectedRows} loom production records`,
            deleted_count: result.affectedRows
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error bulk deleting loom production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to bulk delete loom production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== ENHANCED: FETCH DISPO DATA FOR LOOM PRODUCTION (Main + Yarn Details) ==========
app.get('/main/api/dispo/fetch-for-loom-production/:dispo_number', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const { dispo_number } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch main dispo data
        const [dispoData] = await connection.query(
            'SELECT * FROM dispo_form_data WHERE dispo_number = ?',
            [dispo_number]
        );

        if (dispoData.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Dispo data not found' 
            });
        }

        const dispo = dispoData[0];

        // Fetch warp yarn details
        const [warpYarnDetails] = await connection.query(
            'SELECT * FROM warp_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
            [dispo_number]
        );

        // Fetch weft yarn details
        const [weftYarnDetails] = await connection.query(
            'SELECT * FROM weft_yarn_details WHERE dispo_number = ? ORDER BY sl_no',
            [dispo_number]
        );

        // Map dispo fields to loom production form fields
        const mappedDispoInfo = {
            // ✅ ADDED: PO Number mapping
            po_number: dispo.po_no || null,
            
            // Dispo Information Section fields
            po_issue_date: dispo.po_issue_date || null,
            po_received_date: dispo.po_approval_date || dispo.po_revise_date || null,
            bulk_fabric_delivery_date: dispo.bulk_delivery_date || null,
            account_holder: dispo.account_holder || null,
            marketing_ref_tracking_no: dispo.buyer_style_ref || null,
            finish_type: dispo.finish_type || null,
            end_use: dispo.end_use || null,
            order_type: dispo.order_type || null,
            yarn_type: dispo.yarn_type || null,
            process_type: dispo.process_type || null,
            
            // Buyer information
            buyer: dispo.buyer_name || null,
            customer_ref: dispo.buyer_style_ref || null,
            
            // Quantity mappings
            po_quantity_yds: dispo.po_qty_yds || null,
            dispo_quantity_yds: dispo.finish_qty_yds || null,
            
            // Production metrics
            required_print_production_mtr: dispo.print_qty_mtr || null,
            required_greige_production_mtr: dispo.grey_qty_mtr || null,
            required_loom_production_mtr: dispo.loom_production_mtr || null,
            required_warp_length_mtr: dispo.warp_beam_length || null,
            
            // Width and construction
            cuttable_width_inch: dispo.dispo_cuttable_width || null,
            grey_width_inch: dispo.grey_width_inch || null,
            beam_total_ends: dispo.beam_total_ends || null,
            reed_count: dispo.reed_count || null,
            
            // Additional fields
            lower_beam_crimp: dispo.lower_beam_crimp || null,
            fabric_composition: dispo.fabric_composition || null,
            production_construction: dispo.production_construction || null,
            weave: dispo.weave_type || null
        };

        console.log('DISPO_FETCH_FOR_LOOM', 'Successfully fetched dispo data for loom production', { 
            dispo_number,
            po_no: dispo.po_no,
            warpRows: warpYarnDetails.length,
            weftRows: weftYarnDetails.length,
            mappedFields: Object.keys(mappedDispoInfo).length
        });

        res.status(200).json({
            success: true,
            dispoInfo: mappedDispoInfo,
            warpDetails: warpYarnDetails,
            weftDetails: weftYarnDetails,
            sourceInfo: {
                dispo_number: dispo_number,
                po_no: dispo.po_no,
                buyer_name: dispo.buyer_name
            }
        });

    } catch (error) {
        console.error('DISPO_FETCH_FOR_LOOM_ERROR', 'Failed to fetch dispo data for loom production', { 
            dispo_number, 
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch dispo data for loom production', 
            details: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});




// =====================================================
// GREIGE DELIVERY ENTRY FORM - API ENDPOINTS
// =====================================================

// ========== FETCH GREIGE DELIVERY RECORDS FOR SEARCH DROPDOWN WITH ENHANCED FIELDS ==========
app.get('/main/api/greige-delivery/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                po_number,
                dispo_number,
                buyer,
                production_construction,
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no,
                customer_ref,
                greige_fabric_price_per_yds,
                created_at
            FROM greige_delivery_form 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching greige delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE GREIGE DELIVERY WITH BREAKDOWN DATA ==========
app.post('/main/api/greige-delivery/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main greige delivery form record
        const [result] = await connection.execute(
            `INSERT INTO greige_delivery_form (
                delivery_date, challan_no, total_no_of_than_roll, po_number,
                dispo_number, buyer, customer_ref, weave, po_received_date,
                bulk_fabric_delivery_date, account_holder, buyer_dispo,
                customer_ref_stl, weave_dispo, finish_type, production_construction,
                fabric_composition, greige_fabric_price_per_yds, delivery_quantity_a_grade,
                delivery_quantity_b_grade, delivery_quantity_c_grade, delivery_quantity_reject,
                end_use, order_type, yarn_type, process_type, production_construction_dispo,
                fabric_composition_dispo, po_quantity_yds, dispo_quantity_yds,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                cuttable_width_inch, grey_width_inch, total_ends, reed_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.delivery_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.greige_fabric_price_per_yds),
                nullIfEmpty(formData.delivery_quantity_a_grade),
                nullIfEmpty(formData.delivery_quantity_b_grade),
                nullIfEmpty(formData.delivery_quantity_c_grade),
                nullIfEmpty(formData.delivery_quantity_reject),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count)
            ]
        );

        const greigeDeliveryId = result.insertId;

        // Insert breakdown details
        if (breakdownDetails && Array.isArray(breakdownDetails)) {
            for (const detail of breakdownDetails) {
                await connection.execute(
                    `INSERT INTO greige_delivery_breakdown (
                        dispo_number, greige_delivery_id, greige_folding_date, greige_folding_qty_yds,
                        greige_delivery_date, greige_delivery_qty_yds, delivery_balance
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        nullIfEmpty(formData.dispo_number),
                        greigeDeliveryId,
                        nullIfEmpty(detail.greige_folding_date),
                        nullIfEmpty(detail.greige_folding_qty_yds),
                        nullIfEmpty(detail.greige_delivery_date),
                        nullIfEmpty(detail.greige_delivery_qty_yds),
                        nullIfEmpty(detail.delivery_balance)
                    ]
                );
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Greige delivery record saved successfully',
            id: greigeDeliveryId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving greige delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save greige delivery record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE GREIGE DELIVERY RECORD ==========
app.put('/main/api/greige-delivery/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const greigeDeliveryId = req.params.id;
        const { formData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main greige delivery form record
        await connection.execute(
            `UPDATE greige_delivery_form SET
                delivery_date = ?, challan_no = ?, total_no_of_than_roll = ?,
                po_number = ?, dispo_number = ?, buyer = ?, customer_ref = ?,
                weave = ?, po_received_date = ?, bulk_fabric_delivery_date = ?,
                account_holder = ?, buyer_dispo = ?, customer_ref_stl = ?,
                weave_dispo = ?, finish_type = ?, production_construction = ?,
                fabric_composition = ?, greige_fabric_price_per_yds = ?,
                delivery_quantity_a_grade = ?, delivery_quantity_b_grade = ?,
                delivery_quantity_c_grade = ?, delivery_quantity_reject = ?,
                end_use = ?, order_type = ?, yarn_type = ?, process_type = ?,
                production_construction_dispo = ?, fabric_composition_dispo = ?,
                po_quantity_yds = ?, dispo_quantity_yds = ?,
                required_print_production_meter = ?, required_greige_production_meter = ?,
                required_loom_production_meter = ?, required_warp_length_meter = ?,
                cuttable_width_inch = ?, grey_width_inch = ?, total_ends = ?,
                reed_count = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.delivery_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.greige_fabric_price_per_yds),
                nullIfEmpty(formData.delivery_quantity_a_grade),
                nullIfEmpty(formData.delivery_quantity_b_grade),
                nullIfEmpty(formData.delivery_quantity_c_grade),
                nullIfEmpty(formData.delivery_quantity_reject),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count),
                greigeDeliveryId
            ]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Greige delivery record updated successfully',
            id: greigeDeliveryId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating greige delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update greige delivery record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH GREIGE DELIVERY RECORD BY ID WITH BREAKDOWN ==========
app.get('/main/api/greige-delivery/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const greigeDeliveryId = req.params.id;

        // Get main record with formatted date (no timestamp)
        const [mainRecords] = await connection.execute(
            `SELECT 
                id, 
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no, total_no_of_than_roll, po_number, dispo_number,
                buyer, customer_ref, weave,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                account_holder, buyer_dispo, customer_ref_stl, weave_dispo,
                finish_type, production_construction, fabric_composition,
                greige_fabric_price_per_yds, delivery_quantity_a_grade,
                delivery_quantity_b_grade, delivery_quantity_c_grade,
                delivery_quantity_reject, end_use, order_type, yarn_type,
                process_type, production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            FROM greige_delivery_form 
            WHERE id = ?`,
            [greigeDeliveryId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Greige delivery record not found'
            });
        }

        // Get breakdown details with formatted dates
        const [breakdownDetails] = await connection.execute(
            `SELECT 
                id, greige_delivery_id,
                DATE_FORMAT(greige_folding_date, '%Y-%m-%d') as greige_folding_date,
                greige_folding_qty_yds,
                DATE_FORMAT(greige_delivery_date, '%Y-%m-%d') as greige_delivery_date,
                greige_delivery_qty_yds, delivery_balance
            FROM greige_delivery_breakdown 
            WHERE greige_delivery_id = ? 
            ORDER BY id`,
            [greigeDeliveryId]
        );

        res.json({
            ...mainRecords[0],
            breakdownDetails: breakdownDetails
        });

    } catch (error) {
        console.error('Error fetching greige delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DISPO DATA FOR GREIGE DELIVERY FORM (ENHANCED) ==========
app.get('/main/api/greige-delivery/fetch-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);

        // Fetch dispo main data with formatted dates
        const [dispoData] = await connection.query(
            `SELECT 
                dispo_number, po_no, buyer_name, buyer_style_ref, weave_type,
                production_construction, fabric_composition,
                DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                DATE_FORMAT(bulk_delivery_date, '%Y-%m-%d') as bulk_delivery_date,
                account_holder, finish_type, end_use, order_type, yarn_type,
                process_type, po_qty_yds, finish_qty_yds, print_qty_mtr,
                grey_qty_mtr, loom_production_mtr, warp_beam_length,
                dispo_cuttable_width, grey_width_inch, beam_total_ends, reed_count
            FROM dispo_form_data 
            WHERE dispo_number = ?`,
            [dispoNumber]
        );

        if (dispoData.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dispo not found'
            });
        }

        const dispo = dispoData[0];

        // Map dispo fields to greige delivery form fields
        const mappedData = {
            // Main form fields
            dispo_number: dispo.dispo_number,
            po_number: dispo.po_no,
            buyer: dispo.buyer_name,
            customer_ref: dispo.buyer_style_ref,
            weave: dispo.weave_type,
            production_construction: dispo.production_construction,
            fabric_composition: dispo.fabric_composition,
            
            // Dispo Information section
            po_received_date: dispo.po_issue_date,
            bulk_fabric_delivery_date: dispo.bulk_delivery_date,
            account_holder: dispo.account_holder,
            buyer_dispo: dispo.buyer_name,
            customer_ref_stl: dispo.buyer_style_ref,
            weave_dispo: dispo.weave_type,
            finish_type: dispo.finish_type,
            end_use: dispo.end_use,
            order_type: dispo.order_type,
            yarn_type: dispo.yarn_type,
            process_type: dispo.process_type,
            production_construction_dispo: dispo.production_construction,
            fabric_composition_dispo: dispo.fabric_composition,
            po_quantity_yds: dispo.po_qty_yds,
            dispo_quantity_yds: dispo.finish_qty_yds,
            required_print_production_meter: dispo.print_qty_mtr,
            required_greige_production_meter: dispo.grey_qty_mtr,
            required_loom_production_meter: dispo.loom_production_mtr,
            required_warp_length_meter: dispo.warp_beam_length,
            cuttable_width_inch: dispo.dispo_cuttable_width,
            grey_width_inch: dispo.grey_width_inch,
            total_ends: dispo.beam_total_ends,
            reed_count: dispo.reed_count
        };

        res.json({
            success: true,
            dispoData: mappedData
        });

    } catch (error) {
        console.error('Error fetching dispo data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo data',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE GREIGE DELIVERY RECORD ==========
app.delete('/main/api/greige-delivery/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const greigeDeliveryId = req.params.id;

        // Delete breakdown details first (foreign key constraint)
        await connection.execute(
            'DELETE FROM greige_delivery_breakdown WHERE greige_delivery_id = ?',
            [greigeDeliveryId]
        );

        // Delete main record
        const [result] = await connection.execute(
            'DELETE FROM greige_delivery_form WHERE id = ?',
            [greigeDeliveryId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Greige delivery record not found'
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Greige delivery record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting greige delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete greige delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED GREIGE DELIVERY RECORDS ==========
app.get('/main/api/greige-delivery/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no, total_no_of_than_roll, po_number, dispo_number,
                buyer, customer_ref, production_construction, greige_fabric_price_per_yds,
                created_at
            FROM greige_delivery_form 
            ORDER BY created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved greige delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved greige delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT GREIGE DELIVERY RECORDS TO CSV ==========
app.get('/main/api/greige-delivery/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no, total_no_of_than_roll, po_number, dispo_number,
                buyer, customer_ref, weave,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                account_holder, buyer_dispo, customer_ref_stl, weave_dispo,
                finish_type, production_construction, fabric_composition,
                greige_fabric_price_per_yds, delivery_quantity_a_grade,
                delivery_quantity_b_grade, delivery_quantity_c_grade,
                delivery_quantity_reject, end_use, order_type, yarn_type,
                process_type, production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM greige_delivery_form 
            ORDER BY created_at DESC`
        );

        // Create CSV header
        const csvHeader = 'ID,Delivery Date,Challan No,Total No of Than/Roll,PO Number,Dispo Number,Buyer,Customer Ref,Weave,PO Received Date,Bulk Fabric Delivery Date,Account Holder,Buyer (Dispo),Customer Ref/Stl,Weave (Dispo),Finish Type,Production Construction,Fabric Composition,Greige Fabric Price/Yds,Del. Qty A Grade,Del. Qty B Grade,Del. Qty C Grade,Del. Qty Reject,End Use,Order Type,Yarn Type,Process Type,Prod. Construction (Dispo),Fabric Comp. (Dispo),PO Quantity (Yds),Dispo Quantity (Yds),Req. Print Prod. (Mtr),Req. Greige Prod. (Mtr),Req. Loom Prod. (Mtr),Req. Warp Length (Mtr),Cuttable Width (Inch),Grey Width (Inch),Total Ends,Reed Count,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.delivery_date || '',
                record.challan_no || '',
                record.total_no_of_than_roll || '',
                record.po_number || '',
                record.dispo_number || '',
                record.buyer || '',
                record.customer_ref || '',
                record.weave || '',
                record.po_received_date || '',
                record.bulk_fabric_delivery_date || '',
                record.account_holder || '',
                record.buyer_dispo || '',
                record.customer_ref_stl || '',
                record.weave_dispo || '',
                record.finish_type || '',
                record.production_construction || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.greige_fabric_price_per_yds || '',
                record.delivery_quantity_a_grade || '',
                record.delivery_quantity_b_grade || '',
                record.delivery_quantity_c_grade || '',
                record.delivery_quantity_reject || '',
                record.end_use || '',
                record.order_type || '',
                record.yarn_type || '',
                record.process_type || '',
                record.production_construction_dispo || '',
                (record.fabric_composition_dispo || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.required_print_production_meter || '',
                record.required_greige_production_meter || '',
                record.required_loom_production_meter || '',
                record.required_warp_length_meter || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.total_ends || '',
                record.reed_count || '',
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="greige_delivery_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting greige delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export greige delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH GREIGE DELIVERY RECORDS WITH FILTERS ==========
app.post('/main/api/greige-delivery/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            challan_no,
            po_number,
            dispo_number,
            buyer,
            date_from,
            date_to
        } = req.body;

        let query = `SELECT 
            id, 
            DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
            challan_no, po_number, dispo_number, buyer, 
            production_construction, customer_ref
        FROM greige_delivery_form WHERE 1=1`;
        const params = [];

        if (challan_no) {
            query += ' AND challan_no LIKE ?';
            params.push(`%${challan_no}%`);
        }

        if (po_number) {
            query += ' AND po_number LIKE ?';
            params.push(`%${po_number}%`);
        }

        if (dispo_number) {
            query += ' AND dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (date_from) {
            query += ' AND delivery_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND delivery_date <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching greige delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search greige delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET GREIGE DELIVERY RECORDS BY DISPO NUMBER ==========
app.get('/main/api/greige-delivery/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);

        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no, po_number, dispo_number, buyer,
                production_construction, greige_fabric_price_per_yds
            FROM greige_delivery_form
            WHERE dispo_number = ?
            ORDER BY delivery_date DESC`,
            [dispoNumber]
        );

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error fetching greige delivery records by dispo:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige delivery records',
            error: error.message
        });
} finally {
    if (connection) connection.release();
}
});

// =====================================================
// FOLDING PRODUCTION DATA ENTRY FORM - API ENDPOINTS
// =====================================================

// ========== FETCH FOLDING PRODUCTION RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/folding-production/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                po_number,
                dispo_number,
                buyer,
                production_construction,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                a_grade_mtr,
                b_grade_mtr,
                greige_fabric_price_per_yds,
                created_at
            FROM folding_production_form 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching folding production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE FOLDING PRODUCTION WITH BREAKDOWN DATA ==========
app.post('/main/api/folding-production/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main folding production form record
        const [result] = await connection.execute(
            `INSERT INTO folding_production_form (
                folding_production_date, dispo_number, buyer, production_construction,
                fabric_composition, a_grade_mtr, b_grade_mtr, c_grade_mtr,
                reject_c_grade_mtr, greige_fabric_price_per_yds, po_received_date,
                bulk_fabric_delivery_date, po_number, account_holder, buyer_dispo,
                customer_ref_stl, weave, finish_type, end_use, order_type,
                yarn_type, process_type, production_construction_dispo,
                fabric_composition_dispo, po_quantity_yds, dispo_quantity_yds,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                cuttable_width_inch, grey_width_inch, total_ends, reed_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.folding_production_date),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.a_grade_mtr),
                nullIfEmpty(formData.b_grade_mtr),
                nullIfEmpty(formData.c_grade_mtr),
                nullIfEmpty(formData.reject_c_grade_mtr),
                nullIfEmpty(formData.greige_fabric_price_per_yds),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count)
            ]
        );

        const foldingProductionId = result.insertId;

        // Insert breakdown details
        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.loom_production_date || detail.loom_production_qty_yds || 
                    detail.folding_production_date || detail.folding_production_qty_yds) {
                    await connection.execute(
                        `INSERT INTO folding_production_breakdown (
                            dispo_number, folding_production_id, loom_production_date, loom_production_qty_yds,
                            folding_production_date, folding_production_qty_yds, folding_balance
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            foldingProductionId,
                            nullIfEmpty(detail.loom_production_date),
                            nullIfEmpty(detail.loom_production_qty_yds),
                            nullIfEmpty(detail.folding_production_date),
                            nullIfEmpty(detail.folding_production_qty_yds),
                            nullIfEmpty(detail.folding_balance)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Folding production record saved successfully',
            id: foldingProductionId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving folding production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save folding production record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE FOLDING PRODUCTION RECORD ==========
app.put('/main/api/folding-production/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const foldingProductionId = req.params.id;
        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main folding production form record
        await connection.execute(
            `UPDATE folding_production_form SET
                folding_production_date = ?, dispo_number = ?, buyer = ?,
                production_construction = ?, fabric_composition = ?,
                a_grade_mtr = ?, b_grade_mtr = ?, c_grade_mtr = ?,
                reject_c_grade_mtr = ?, greige_fabric_price_per_yds = ?,
                po_received_date = ?, bulk_fabric_delivery_date = ?,
                po_number = ?, account_holder = ?, buyer_dispo = ?,
                customer_ref_stl = ?, weave = ?, finish_type = ?,
                end_use = ?, order_type = ?, yarn_type = ?, process_type = ?,
                production_construction_dispo = ?, fabric_composition_dispo = ?,
                po_quantity_yds = ?, dispo_quantity_yds = ?,
                required_print_production_meter = ?, required_greige_production_meter = ?,
                required_loom_production_meter = ?, required_warp_length_meter = ?,
                cuttable_width_inch = ?, grey_width_inch = ?, total_ends = ?,
                reed_count = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.folding_production_date),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.a_grade_mtr),
                nullIfEmpty(formData.b_grade_mtr),
                nullIfEmpty(formData.c_grade_mtr),
                nullIfEmpty(formData.reject_c_grade_mtr),
                nullIfEmpty(formData.greige_fabric_price_per_yds),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count),
                foldingProductionId
            ]
        );

        // Delete existing breakdown details
        await connection.execute(
            'DELETE FROM folding_production_breakdown WHERE folding_production_id = ?',
            [foldingProductionId]
        );

        // Insert new breakdown details
        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.loom_production_date || detail.loom_production_qty_yds || 
                    detail.folding_production_date || detail.folding_production_qty_yds) {
                    await connection.execute(
                        `INSERT INTO folding_production_breakdown (
                            dispo_number, folding_production_id, loom_production_date, loom_production_qty_yds,
                            folding_production_date, folding_production_qty_yds, folding_balance
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            foldingProductionId,
                            nullIfEmpty(detail.loom_production_date),
                            nullIfEmpty(detail.loom_production_qty_yds),
                            nullIfEmpty(detail.folding_production_date),
                            nullIfEmpty(detail.folding_production_qty_yds),
                            nullIfEmpty(detail.folding_balance)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Folding production record updated successfully',
            id: foldingProductionId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating folding production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update folding production record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH FOLDING PRODUCTION RECORD BY ID WITH BREAKDOWN ==========
app.get('/main/api/folding-production/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const foldingProductionId = req.params.id;

        // Get main record with formatted dates
        const [mainRecords] = await connection.execute(
            `SELECT 
                id, 
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                dispo_number, buyer, production_construction, fabric_composition,
                a_grade_mtr, b_grade_mtr, c_grade_mtr, reject_c_grade_mtr,
                greige_fabric_price_per_yds,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl,
                weave, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            FROM folding_production_form 
            WHERE id = ?`,
            [foldingProductionId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Folding production record not found'
            });
        }

        // Get breakdown details with formatted dates
        const [breakdownDetails] = await connection.execute(
            `SELECT 
                id, folding_production_id,
                DATE_FORMAT(loom_production_date, '%Y-%m-%d') as loom_production_date,
                loom_production_qty_yds,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                folding_production_qty_yds, folding_balance
            FROM folding_production_breakdown 
            WHERE folding_production_id = ? 
            ORDER BY id`,
            [foldingProductionId]
        );

        res.json({
            ...mainRecords[0],
            breakdownData: breakdownDetails
        });

    } catch (error) {
        console.error('Error fetching folding production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch folding production record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DISPO DATA FOR FOLDING PRODUCTION FORM ==========
app.get('/main/api/folding-production/fetch-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);

        // Fetch dispo main data with formatted dates
        const [dispoData] = await connection.query(
            `SELECT 
                dispo_number, po_no, buyer_name, buyer_style_ref, weave_type,
                production_construction, fabric_composition,
                DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                DATE_FORMAT(bulk_delivery_date, '%Y-%m-%d') as bulk_delivery_date,
                account_holder, finish_type, end_use, order_type, yarn_type,
                process_type, po_qty_yds, finish_qty_yds, print_qty_mtr,
                grey_qty_mtr, loom_production_mtr, warp_beam_length,
                dispo_cuttable_width, grey_width_inch, beam_total_ends, reed_count
            FROM dispo_form_data 
            WHERE dispo_number = ?`,
            [dispoNumber]
        );

        if (dispoData.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dispo not found'
            });
        }

        const dispo = dispoData[0];

        // Map dispo fields to folding production form fields
        const mappedData = {
            // Main form fields
            dispo_number: dispo.dispo_number,
            po_number: dispo.po_no,
            buyer: dispo.buyer_name,
            production_construction: dispo.production_construction,
            fabric_composition: dispo.fabric_composition,
            
            // Dispo Information section
            po_received_date: dispo.po_issue_date,
            bulk_fabric_delivery_date: dispo.bulk_delivery_date,
            account_holder: dispo.account_holder,
            buyer_dispo: dispo.buyer_name,
            customer_ref_stl: dispo.buyer_style_ref,
            weave: dispo.weave_type,
            finish_type: dispo.finish_type,
            end_use: dispo.end_use,
            order_type: dispo.order_type,
            yarn_type: dispo.yarn_type,
            process_type: dispo.process_type,
            production_construction_dispo: dispo.production_construction,
            fabric_composition_dispo: dispo.fabric_composition,
            po_quantity_yds: dispo.po_qty_yds,
            dispo_quantity_yds: dispo.finish_qty_yds,
            required_print_production_meter: dispo.print_qty_mtr,
            required_greige_production_meter: dispo.grey_qty_mtr,
            required_loom_production_meter: dispo.loom_production_mtr,
            required_warp_length_meter: dispo.warp_beam_length,
            cuttable_width_inch: dispo.dispo_cuttable_width,
            grey_width_inch: dispo.grey_width_inch,
            total_ends: dispo.beam_total_ends,
            reed_count: dispo.reed_count
        };

        res.json({
            success: true,
            dispoData: mappedData
        });

    } catch (error) {
        console.error('Error fetching dispo data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo data',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE FOLDING PRODUCTION RECORD ==========
app.delete('/main/api/folding-production/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const foldingProductionId = req.params.id;

        // Delete breakdown details first (foreign key constraint)
        await connection.execute(
            'DELETE FROM folding_production_breakdown WHERE folding_production_id = ?',
            [foldingProductionId]
        );

        // Delete main record
        const [result] = await connection.execute(
            'DELETE FROM folding_production_form WHERE id = ?',
            [foldingProductionId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Folding production record not found'
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Folding production record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting folding production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete folding production record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED FOLDING PRODUCTION RECORDS ==========
app.get('/main/api/folding-production/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                dispo_number, po_number, buyer, production_construction,
                a_grade_mtr, b_grade_mtr, c_grade_mtr, reject_c_grade_mtr,
                greige_fabric_price_per_yds, created_at
            FROM folding_production_form 
            ORDER BY created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved folding production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT FOLDING PRODUCTION RECORDS TO CSV ==========
app.get('/main/api/folding-production/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                dispo_number, buyer, production_construction, fabric_composition,
                a_grade_mtr, b_grade_mtr, c_grade_mtr, reject_c_grade_mtr,
                greige_fabric_price_per_yds,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl,
                weave, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM folding_production_form 
            ORDER BY created_at DESC`
        );

        // Create CSV header
        const csvHeader = 'ID,Folding Production Date,Dispo Number,Buyer,Production Construction,Fabric Composition,A-Grade (Mtr),B-Grade (Mtr),C-Grade (Mtr),Reject/C Grade (Mtr),Greige Fabric Price/Yds,PO Received Date,Bulk Fabric Delivery Date,PO Number,Account Holder,Buyer (Dispo),Customer Ref/Stl,Weave,Finish Type,End Use,Order Type,Yarn Type,Process Type,Prod. Construction (Dispo),Fabric Comp. (Dispo),PO Quantity (Yds),Dispo Quantity (Yds),Req. Print Prod. (Mtr),Req. Greige Prod. (Mtr),Req. Loom Prod. (Mtr),Req. Warp Length (Mtr),Cuttable Width (Inch),Grey Width (Inch),Total Ends,Reed Count,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.folding_production_date || '',
                record.dispo_number || '',
                record.buyer || '',
                record.production_construction || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.a_grade_mtr || '',
                record.b_grade_mtr || '',
                record.c_grade_mtr || '',
                record.reject_c_grade_mtr || '',
                record.greige_fabric_price_per_yds || '',
                record.po_received_date || '',
                record.bulk_fabric_delivery_date || '',
                record.po_number || '',
                record.account_holder || '',
                record.buyer_dispo || '',
                record.customer_ref_stl || '',
                record.weave || '',
                record.finish_type || '',
                record.end_use || '',
                record.order_type || '',
                record.yarn_type || '',
                record.process_type || '',
                record.production_construction_dispo || '',
                (record.fabric_composition_dispo || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.required_print_production_meter || '',
                record.required_greige_production_meter || '',
                record.required_loom_production_meter || '',
                record.required_warp_length_meter || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.total_ends || '',
                record.reed_count || '',
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="folding_production_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting folding production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH FOLDING PRODUCTION RECORDS WITH FILTERS ==========
app.post('/main/api/folding-production/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            po_number,
            dispo_number,
            buyer,
            date_from,
            date_to
        } = req.body;

        let query = `SELECT 
            id, 
            DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
            po_number, dispo_number, buyer, production_construction,
            a_grade_mtr, b_grade_mtr
        FROM folding_production_form WHERE 1=1`;
        const params = [];

        if (po_number) {
            query += ' AND po_number LIKE ?';
            params.push(`%${po_number}%`);
        }

        if (dispo_number) {
            query += ' AND dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (date_from) {
            query += ' AND folding_production_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND folding_production_date <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching folding production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FOLDING PRODUCTION RECORDS BY DISPO NUMBER ==========
app.get('/main/api/folding-production/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);

        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                po_number, dispo_number, buyer, production_construction,
                a_grade_mtr, b_grade_mtr, greige_fabric_price_per_yds
            FROM folding_production_form
            WHERE dispo_number = ?
            ORDER BY folding_production_date DESC`,
                        [dispoNumber]
        );

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error fetching folding production records by dispo:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== BULK DELETE FOLDING PRODUCTION RECORDS ==========
app.post('/main/api/folding-production/bulk-delete', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { record_ids } = req.body;

        if (!record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No record IDs provided'
            });
        }

        // Delete breakdown records first (foreign key constraint)
        await connection.query(
            'DELETE FROM folding_production_breakdown WHERE folding_production_id IN (?)',
            [record_ids]
        );

        // Delete main records
        const [result] = await connection.query(
            'DELETE FROM folding_production_form WHERE id IN (?)',
            [record_ids]
        );

        await connection.commit();

        res.json({
            success: true,
            message: `Successfully deleted ${result.affectedRows} folding production records`,
            deleted_count: result.affectedRows
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error bulk deleting folding production records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to bulk delete folding production records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FOLDING PRODUCTION STATISTICS ==========
app.get('/main/api/folding-production/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        // Total records count
        const [totalRecords] = await connection.query(
            'SELECT COUNT(*) as total FROM folding_production_form'
        );

        // Total A-Grade production
        const [totalAGrade] = await connection.query(
            'SELECT SUM(a_grade_mtr) as total FROM folding_production_form'
        );

        // Total B-Grade production
        const [totalBGrade] = await connection.query(
            'SELECT SUM(b_grade_mtr) as total FROM folding_production_form'
        );

        // Total C-Grade production
        const [totalCGrade] = await connection.query(
            'SELECT SUM(c_grade_mtr) as total FROM folding_production_form'
        );

        // Total Reject production
        const [totalReject] = await connection.query(
            'SELECT SUM(reject_c_grade_mtr) as total FROM folding_production_form'
        );

        // Recent records (last 10)
        const [recentRecords] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                dispo_number, buyer, a_grade_mtr, b_grade_mtr
            FROM folding_production_form 
            ORDER BY created_at DESC 
            LIMIT 10`
        );

        // Records by month (last 6 months)
        const [byMonth] = await connection.query(
            `SELECT 
                DATE_FORMAT(folding_production_date, '%Y-%m') as month,
                COUNT(*) as count,
                SUM(a_grade_mtr) as total_a_grade,
                SUM(b_grade_mtr) as total_b_grade
            FROM folding_production_form 
            WHERE folding_production_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(folding_production_date, '%Y-%m')
            ORDER BY month DESC`
        );

        // Top buyers by production
        const [topBuyers] = await connection.query(
            `SELECT 
                buyer,
                COUNT(*) as record_count,
                SUM(a_grade_mtr) as total_a_grade,
                SUM(b_grade_mtr) as total_b_grade
            FROM folding_production_form 
            WHERE buyer IS NOT NULL AND buyer != ''
            GROUP BY buyer
            ORDER BY total_a_grade DESC
            LIMIT 10`
        );

        res.json({
            success: true,
            statistics: {
                total_records: totalRecords[0].total,
                total_a_grade_mtr: totalAGrade[0].total || 0,
                total_b_grade_mtr: totalBGrade[0].total || 0,
                total_c_grade_mtr: totalCGrade[0].total || 0,
                total_reject_mtr: totalReject[0].total || 0,
                recent_records: recentRecords,
                by_month: byMonth,
                top_buyers: topBuyers
            }
        });

    } catch (error) {
        console.error('Error fetching folding production statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch folding production statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FOLDING PRODUCTION SUMMARY BY DATE RANGE ==========
app.post('/main/api/folding-production/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const { date_from, date_to } = req.body;

        let query = `SELECT 
            COUNT(*) as total_records,
            SUM(a_grade_mtr) as total_a_grade,
            SUM(b_grade_mtr) as total_b_grade,
            SUM(c_grade_mtr) as total_c_grade,
            SUM(reject_c_grade_mtr) as total_reject,
            SUM(greige_fabric_price_per_yds * (COALESCE(a_grade_mtr, 0) + COALESCE(b_grade_mtr, 0))) as total_value
        FROM folding_production_form WHERE 1=1`;
        const params = [];

        if (date_from) {
            query += ' AND folding_production_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND folding_production_date <= ?';
            params.push(date_to);
        }

        const [summary] = await connection.query(query, params);

        res.json({
            success: true,
            summary: summary[0]
        });

    } catch (error) {
        console.error('Error fetching folding production summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch folding production summary',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DUPLICATE FOLDING PRODUCTION RECORD ==========
app.post('/main/api/folding-production/duplicate/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const sourceId = req.params.id;

        // Fetch source record
        const [sourceRecords] = await connection.execute(
            'SELECT * FROM folding_production_form WHERE id = ?',
            [sourceId]
        );

        if (sourceRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Source record not found'
            });
        }

        const source = sourceRecords[0];

        // Insert duplicate record (excluding id, created_at, updated_at)
        const [result] = await connection.execute(
            `INSERT INTO folding_production_form (
                folding_production_date, dispo_number, buyer, production_construction,
                fabric_composition, a_grade_mtr, b_grade_mtr, c_grade_mtr,
                reject_c_grade_mtr, greige_fabric_price_per_yds, po_received_date,
                bulk_fabric_delivery_date, po_number, account_holder, buyer_dispo,
                customer_ref_stl, weave, finish_type, end_use, order_type,
                yarn_type, process_type, production_construction_dispo,
                fabric_composition_dispo, po_quantity_yds, dispo_quantity_yds,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                cuttable_width_inch, grey_width_inch, total_ends, reed_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                source.folding_production_date,
                source.dispo_number,
                source.buyer,
                source.production_construction,
                source.fabric_composition,
                source.a_grade_mtr,
                source.b_grade_mtr,
                source.c_grade_mtr,
                source.reject_c_grade_mtr,
                source.greige_fabric_price_per_yds,
                source.po_received_date,
                source.bulk_fabric_delivery_date,
                source.po_number,
                source.account_holder,
                source.buyer_dispo,
                source.customer_ref_stl,
                source.weave,
                source.finish_type,
                source.end_use,
                source.order_type,
                source.yarn_type,
                source.process_type,
                source.production_construction_dispo,
                source.fabric_composition_dispo,
                source.po_quantity_yds,
                source.dispo_quantity_yds,
                source.required_print_production_meter,
                source.required_greige_production_meter,
                source.required_loom_production_meter,
                source.required_warp_length_meter,
                source.cuttable_width_inch,
                source.grey_width_inch,
                source.total_ends,
                source.reed_count
            ]
        );

        const newId = result.insertId;

        // Duplicate breakdown records
        const [breakdownRecords] = await connection.execute(
            'SELECT * FROM folding_production_breakdown WHERE folding_production_id = ?',
            [sourceId]
        );

        for (const breakdown of breakdownRecords) {
            await connection.execute(
                `INSERT INTO folding_production_breakdown (
                    dispo_number, folding_production_id, loom_production_date, loom_production_qty_yds,
                    folding_production_date, folding_production_qty_yds, folding_balance
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    source.dispo_number,
                    newId,
                    breakdown.loom_production_date,
                    breakdown.loom_production_qty_yds,
                    breakdown.folding_production_date,
                    breakdown.folding_production_qty_yds,
                    breakdown.folding_balance
                ]
            );
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Folding production record duplicated successfully',
            id: newId,
            source_id: sourceId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error duplicating folding production record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to duplicate folding production record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// GREIGE FABRIC STOCK REPORT - API ENDPOINTS
// =====================================================


// ========== V6: SEARCH DISPO NUMBERS FOR GREIGE STOCK WITHOUT FULL-LIST FLOODING ==========
app.get('/main/api/greige-stock-report/dispo-search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    const q = cleanDropdownSearchText(req.query.q || '');
    const limit = clampDropdownLimit(req.query.limit, 35);
    const pattern = q ? (q.length >= 3 ? `%${q}%` : `${q}%`) : null;
    const params = [];
    let sourceWhere = `dispo_number IS NOT NULL AND TRIM(dispo_number) != ''`;

    if (q) {
        sourceWhere += ` AND (dispo_number LIKE ? OR buyer LIKE ? OR production_construction LIKE ?)`;
        params.push(pattern, pattern, pattern);
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(`
            SELECT
                dispo_number,
                MAX(buyer) AS buyer,
                MAX(production_construction) AS production_construction,
                MAX(created_at) AS created_at
            FROM (
                SELECT TRIM(dispo_number) AS dispo_number, buyer, production_construction, created_at
                FROM folding_production_form
                WHERE ${sourceWhere}
                UNION ALL
                SELECT TRIM(dispo_number) AS dispo_number, buyer, production_construction, created_at
                FROM greige_delivery_form
                WHERE ${sourceWhere}
            ) src
            GROUP BY dispo_number
            ORDER BY created_at DESC, dispo_number DESC
            LIMIT ?
        `, [...params, ...params, limit]);

        res.json(rows.map(row => ({
            dispo_number: row.dispo_number,
            buyer: row.buyer || null,
            production_construction: row.production_construction || null
        })));
    } catch (error) {
        console.error('Error searching greige stock dispo numbers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DISPO NUMBERS FOR DROPDOWN (ULTRA ROBUST) ==========
app.get('/main/api/greige-stock-report/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch from folding_production_form
        const [foldingRecords] = await connection.query(`
            SELECT DISTINCT
                TRIM(dispo_number) as dispo_number,
                buyer,
                production_construction,
                created_at
            FROM folding_production_form 
            WHERE dispo_number IS NOT NULL 
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
        `);
        
        console.log(`Found ${foldingRecords.length} dispo numbers from folding_production_form`);
        
        // Fetch from greige_delivery_form
        const [deliveryRecords] = await connection.query(`
            SELECT DISTINCT
                TRIM(dispo_number) as dispo_number,
                buyer,
                production_construction,
                created_at
            FROM greige_delivery_form 
            WHERE dispo_number IS NOT NULL 
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
        `);
        
        console.log(`Found ${deliveryRecords.length} dispo numbers from greige_delivery_form`);
        
        // Merge and deduplicate in JavaScript
        const dispoMap = new Map();
        
        // Process folding records first
        foldingRecords.forEach(record => {
            const key = record.dispo_number.trim();
            if (key && !dispoMap.has(key)) {
                dispoMap.set(key, {
                    dispo_number: key,
                    buyer: record.buyer || null,
                    production_construction: record.production_construction || null,
                    source: 'folding'
                });
            } else if (key && dispoMap.has(key)) {
                // Update with non-null values if current is null
                const existing = dispoMap.get(key);
                if (!existing.buyer && record.buyer) {
                    existing.buyer = record.buyer;
                }
                if (!existing.production_construction && record.production_construction) {
                    existing.production_construction = record.production_construction;
                }
            }
        });
        
        // Process delivery records
        deliveryRecords.forEach(record => {
            const key = record.dispo_number.trim();
            if (key && !dispoMap.has(key)) {
                dispoMap.set(key, {
                    dispo_number: key,
                    buyer: record.buyer || null,
                    production_construction: record.production_construction || null,
                    source: 'delivery'
                });
            } else if (key && dispoMap.has(key)) {
                // Update with non-null values if current is null
                const existing = dispoMap.get(key);
                if (!existing.buyer && record.buyer) {
                    existing.buyer = record.buyer;
                }
                if (!existing.production_construction && record.production_construction) {
                    existing.production_construction = record.production_construction;
                }
            }
        });
        
        // Convert map to array and sort
        const results = Array.from(dispoMap.values()).sort((a, b) => {
            return b.dispo_number.localeCompare(a.dispo_number);
        });
        
        console.log('GREIGE_STOCK_DISPO_NUMBERS', `Total unique dispo numbers: ${results.length}`);
        results.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.dispo_number} - ${r.buyer || 'N/A'} - ${r.production_construction || 'N/A'} (${r.source})`);
        });
        
        res.json(results);
        
    } catch (error) {
        console.error('Error fetching dispo numbers for greige stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});



// ========== DEBUG: CHECK ALL DISPO NUMBERS IN BOTH TABLES ==========
app.get('/main/api/greige-stock-report/debug-dispos', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get all from folding
        const [foldingAll] = await connection.query(`
            SELECT id, dispo_number, buyer, production_construction, created_at
            FROM folding_production_form 
            ORDER BY created_at DESC
        `);
        
        // Get all from delivery
        const [deliveryAll] = await connection.query(`
            SELECT id, dispo_number, buyer, production_construction, created_at
            FROM greige_delivery_form 
            ORDER BY created_at DESC
        `);
        
        // Get distinct from folding
        const [foldingDistinct] = await connection.query(`
            SELECT DISTINCT dispo_number FROM folding_production_form WHERE dispo_number IS NOT NULL
        `);
        
        // Get distinct from delivery
        const [deliveryDistinct] = await connection.query(`
            SELECT DISTINCT dispo_number FROM greige_delivery_form WHERE dispo_number IS NOT NULL
        `);
        
        res.json({
            folding_production_form: {
                total_records: foldingAll.length,
                distinct_dispos: foldingDistinct.length,
                all_records: foldingAll,
                distinct_dispo_numbers: foldingDistinct.map(r => r.dispo_number)
            },
            greige_delivery_form: {
                total_records: deliveryAll.length,
                distinct_dispos: deliveryDistinct.length,
                all_records: deliveryAll,
                distinct_dispo_numbers: deliveryDistinct.map(r => r.dispo_number)
            }
        });
        
    } catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) connection.release();
    }
});


// ========== FETCH GREIGE FABRIC STOCK REPORT BY DISPO NUMBER ==========
app.get('/main/api/greige-stock-report/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        // Fetch dispo details from folding production or greige delivery
        const [dispoDetails] = await connection.query(`
            SELECT 
                dispo_number, po_number, buyer, account_holder,
                production_construction, fabric_composition, weave,
                finish_type, end_use, order_type, yarn_type, process_type,
                po_quantity_yds, dispo_quantity_yds, grey_width_inch
            FROM folding_production_form 
            WHERE dispo_number = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [dispoNumber]);
        
        let details = dispoDetails.length > 0 ? dispoDetails[0] : null;
        
        // If not found in folding production, try greige delivery
        if (!details) {
            const [greigeDetails] = await connection.query(`
                SELECT 
                    dispo_number, po_number, buyer, account_holder,
                    production_construction, fabric_composition, weave,
                    finish_type, end_use, order_type, yarn_type, process_type,
                    po_quantity_yds, dispo_quantity_yds, grey_width_inch
                FROM greige_delivery_form 
                WHERE dispo_number = ?
                ORDER BY created_at DESC
                LIMIT 1
            `, [dispoNumber]);
            details = greigeDetails.length > 0 ? greigeDetails[0] : {};
        }
        
        // Fetch folding production transactions
        const [foldingTransactions] = await connection.query(`
            SELECT 
                id,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                dispo_number, buyer, production_construction,
                a_grade_mtr, b_grade_mtr, c_grade_mtr, reject_c_grade_mtr,
                greige_fabric_price_per_yds
            FROM folding_production_form
            WHERE dispo_number = ?
            ORDER BY folding_production_date ASC
        `, [dispoNumber]);
        
        // Fetch delivery transactions
        const [deliveryTransactions] = await connection.query(`
            SELECT 
                id,
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no, dispo_number, buyer,
                delivery_quantity_a_grade, delivery_quantity_b_grade,
                delivery_quantity_c_grade, delivery_quantity_reject
            FROM greige_delivery_form
            WHERE dispo_number = ?
            ORDER BY delivery_date ASC
        `, [dispoNumber]);
        
        // Calculate summary totals
        const totalAGrade = foldingTransactions.reduce((sum, txn) => sum + (parseFloat(txn.a_grade_mtr) || 0), 0);
        const totalBGrade = foldingTransactions.reduce((sum, txn) => sum + (parseFloat(txn.b_grade_mtr) || 0), 0);
        const totalCGrade = foldingTransactions.reduce((sum, txn) => sum + (parseFloat(txn.c_grade_mtr) || 0), 0);
        const totalReject = foldingTransactions.reduce((sum, txn) => sum + (parseFloat(txn.reject_c_grade_mtr) || 0), 0);
        
        const totalFoldingProduction = totalAGrade + totalBGrade + totalCGrade;
        
        const totalDeliveryAGrade = deliveryTransactions.reduce((sum, txn) => sum + (parseFloat(txn.delivery_quantity_a_grade) || 0), 0);
        const totalDeliveryBGrade = deliveryTransactions.reduce((sum, txn) => sum + (parseFloat(txn.delivery_quantity_b_grade) || 0), 0);
        const totalDeliveryCGrade = deliveryTransactions.reduce((sum, txn) => sum + (parseFloat(txn.delivery_quantity_c_grade) || 0), 0);
        const totalDeliveryReject = deliveryTransactions.reduce((sum, txn) => sum + (parseFloat(txn.delivery_quantity_reject) || 0), 0);
        
        const totalDelivery = totalDeliveryAGrade + totalDeliveryBGrade + totalDeliveryCGrade;
        
        const closingBalance = totalFoldingProduction - totalDelivery;
        const freshStock = closingBalance - totalReject;
        
        const summary = {
            total_folding_production: totalFoldingProduction,
            total_delivery: totalDelivery,
            closing_balance: closingBalance,
            total_a_grade: totalAGrade,
            total_b_grade: totalBGrade,
            total_c_grade: totalCGrade,
            total_reject: totalReject,
            fresh_stock: freshStock > 0 ? freshStock : 0,
            folding_transaction_count: foldingTransactions.length,
            delivery_transaction_count: deliveryTransactions.length
        };
        
        res.json({
            success: true,
            dispo_number: dispoNumber,
            dispo_details: details,
            summary: summary,
            folding_transactions: foldingTransactions,
            delivery_transactions: deliveryTransactions
        });
        
    } catch (error) {
        console.error('Error fetching greige fabric stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige fabric stock report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH ALL GREIGE FABRIC STOCK SUMMARY ==========
app.get('/main/api/greige-stock-report/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get summary for all dispos
        const [records] = await connection.query(`
            SELECT 
                f.dispo_number,
                f.buyer,
                f.production_construction,
                SUM(f.a_grade_mtr) as total_a_grade,
                SUM(f.b_grade_mtr) as total_b_grade,
                SUM(f.c_grade_mtr) as total_c_grade,
                SUM(f.reject_c_grade_mtr) as total_reject,
                (SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) as total_folding,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM folding_production_form f
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivery_quantity_a_grade, 0) + COALESCE(delivery_quantity_b_grade, 0) + COALESCE(delivery_quantity_c_grade, 0)) as total_delivery
                FROM greige_delivery_form
                GROUP BY dispo_number
            ) d ON f.dispo_number = d.dispo_number
            WHERE f.dispo_number IS NOT NULL AND f.dispo_number != ''
            GROUP BY f.dispo_number, f.buyer, f.production_construction, d.total_delivery
            ORDER BY closing_balance DESC
        `);
        
        res.json({
            success: true,
            count: records.length,
            records: records
        });
        
    } catch (error) {
        console.error('Error fetching greige fabric stock summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige fabric stock summary',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT GREIGE FABRIC STOCK REPORT TO CSV ==========
app.get('/main/api/greige-stock-report/export/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        // Fetch folding production transactions
        const [foldingTransactions] = await connection.query(`
            SELECT 
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') as folding_production_date,
                a_grade_mtr, b_grade_mtr, c_grade_mtr, reject_c_grade_mtr,
                greige_fabric_price_per_yds
            FROM folding_production_form
            WHERE dispo_number = ?
            ORDER BY folding_production_date ASC
        `, [dispoNumber]);
        
        // Fetch delivery transactions
        const [deliveryTransactions] = await connection.query(`
            SELECT 
                DATE_FORMAT(delivery_date, '%Y-%m-%d') as delivery_date,
                challan_no,
                delivery_quantity_a_grade, delivery_quantity_b_grade,
                delivery_quantity_c_grade, delivery_quantity_reject
            FROM greige_delivery_form
            WHERE dispo_number = ?
            ORDER BY delivery_date ASC
        `, [dispoNumber]);
        
        // Create CSV content
        let csvContent = `GREIGE FABRIC STOCK REPORT - ${dispoNumber}\n`;
        csvContent += `Generated: ${new Date().toLocaleString()}\n\n`;
        
        // Folding Production Section
        csvContent += `FOLDING PRODUCTION TRANSACTIONS\n`;
        csvContent += `Date,A-Grade (Mtr),B-Grade (Mtr),C-Grade (Mtr),Reject (Mtr),Price/Yds\n`;
        
        let totalFoldingAGrade = 0, totalFoldingBGrade = 0, totalFoldingCGrade = 0, totalFoldingReject = 0;
        
        foldingTransactions.forEach(txn => {
            totalFoldingAGrade += parseFloat(txn.a_grade_mtr) || 0;
            totalFoldingBGrade += parseFloat(txn.b_grade_mtr) || 0;
            totalFoldingCGrade += parseFloat(txn.c_grade_mtr) || 0;
            totalFoldingReject += parseFloat(txn.reject_c_grade_mtr) || 0;
            
            csvContent += `${txn.folding_production_date},${txn.a_grade_mtr || 0},${txn.b_grade_mtr || 0},${txn.c_grade_mtr || 0},${txn.reject_c_grade_mtr || 0},${txn.greige_fabric_price_per_yds || 0}\n`;
        });
        
        csvContent += `TOTAL,${totalFoldingAGrade.toFixed(2)},${totalFoldingBGrade.toFixed(2)},${totalFoldingCGrade.toFixed(2)},${totalFoldingReject.toFixed(2)},\n\n`;
        
        // Delivery Section
        csvContent += `DELIVERY TRANSACTIONS\n`;
        csvContent += `Date,Challan No,A-Grade (Yds),B-Grade (Yds),C-Grade (Yds),Reject (Yds)\n`;
        
        let totalDeliveryAGrade = 0, totalDeliveryBGrade = 0, totalDeliveryCGrade = 0, totalDeliveryReject = 0;
        
        deliveryTransactions.forEach(txn => {
            totalDeliveryAGrade += parseFloat(txn.delivery_quantity_a_grade) || 0;
            totalDeliveryBGrade += parseFloat(txn.delivery_quantity_b_grade) || 0;
            totalDeliveryCGrade += parseFloat(txn.delivery_quantity_c_grade) || 0;
            totalDeliveryReject += parseFloat(txn.delivery_quantity_reject) || 0;
            
            csvContent += `${txn.delivery_date},${txn.challan_no || ''},${txn.delivery_quantity_a_grade || 0},${txn.delivery_quantity_b_grade || 0},${txn.delivery_quantity_c_grade || 0},${txn.delivery_quantity_reject || 0}\n`;
        });
        
        csvContent += `TOTAL,,${totalDeliveryAGrade.toFixed(2)},${totalDeliveryBGrade.toFixed(2)},${totalDeliveryCGrade.toFixed(2)},${totalDeliveryReject.toFixed(2)}\n\n`;
        
        // Summary Section
        const totalFolding = totalFoldingAGrade + totalFoldingBGrade + totalFoldingCGrade;
        const totalDelivery = totalDeliveryAGrade + totalDeliveryBGrade + totalDeliveryCGrade;
        const closingBalance = totalFolding - totalDelivery;
        
        csvContent += `SUMMARY\n`;
        csvContent += `Total Folding Production (Mtr),${totalFolding.toFixed(2)}\n`;
        csvContent += `Total Delivery (Yds),${totalDelivery.toFixed(2)}\n`;
        csvContent += `Closing Balance,${closingBalance.toFixed(2)}\n`;
        csvContent += `Total Reject (Mtr),${totalFoldingReject.toFixed(2)}\n`;
        csvContent += `Fresh Stock,${(closingBalance - totalFoldingReject).toFixed(2)}\n`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="greige_stock_report_${dispoNumber}_${Date.now()}.csv"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Error exporting greige fabric stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export greige fabric stock report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH GREIGE FABRIC STOCK WITH FILTERS ==========
app.post('/main/api/greige-stock-report/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            dispo_number,
            buyer,
            production_construction,
            min_balance,
            max_balance
        } = req.body;

        let query = `
            SELECT 
                f.dispo_number,
                f.buyer,
                f.production_construction,
                SUM(f.a_grade_mtr) as total_a_grade,
                SUM(f.b_grade_mtr) as total_b_grade,
                SUM(f.c_grade_mtr) as total_c_grade,
                SUM(f.reject_c_grade_mtr) as total_reject,
                (SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) as total_folding,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM folding_production_form f
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivery_quantity_a_grade, 0) + COALESCE(delivery_quantity_b_grade, 0) + COALESCE(delivery_quantity_c_grade, 0)) as total_delivery
                FROM greige_delivery_form
                GROUP BY dispo_number
            ) d ON f.dispo_number = d.dispo_number
            WHERE f.dispo_number IS NOT NULL AND f.dispo_number != ''
        `;
        
        const params = [];

        if (dispo_number) {
            query += ' AND f.dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND f.buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (production_construction) {
            query += ' AND f.production_construction LIKE ?';
            params.push(`%${production_construction}%`);
        }

        query += ' GROUP BY f.dispo_number, f.buyer, f.production_construction, d.total_delivery';
        
        if (min_balance !== undefined && min_balance !== '') {
            query += ' HAVING closing_balance >= ?';
            params.push(parseFloat(min_balance));
        }
        
        if (max_balance !== undefined && max_balance !== '') {
            if (min_balance !== undefined && min_balance !== '') {
                query += ' AND closing_balance <= ?';
            } else {
                query += ' HAVING closing_balance <= ?';
            }
            params.push(parseFloat(max_balance));
        }

        query += ' ORDER BY closing_balance DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching greige fabric stock:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search greige fabric stock',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET LOW STOCK ALERTS ==========
app.get('/main/api/greige-stock-report/low-stock-alerts', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const threshold = req.query.threshold || 100; // Default threshold 100 units
        
        const [records] = await connection.query(`
            SELECT 
                f.dispo_number,
                f.buyer,
                f.production_construction,
                (SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) as total_folding,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM folding_production_form f
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivery_quantity_a_grade, 0) + COALESCE(delivery_quantity_b_grade, 0) + COALESCE(delivery_quantity_c_grade, 0)) as total_delivery
                FROM greige_delivery_form
                GROUP BY dispo_number
            ) d ON f.dispo_number = d.dispo_number
            WHERE f.dispo_number IS NOT NULL AND f.dispo_number != ''
            GROUP BY f.dispo_number, f.buyer, f.production_construction, d.total_delivery
            HAVING closing_balance > 0 AND closing_balance <= ?
            ORDER BY closing_balance ASC
        `, [threshold]);
        
        res.json({
            success: true,
            threshold: threshold,
            count: records.length,
            alerts: records
        });
        
    } catch (error) {
        console.error('Error fetching low stock alerts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch low stock alerts',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET STOCK STATISTICS ==========
app.get('/main/api/greige-stock-report/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Total folding production
        const [totalFolding] = await connection.query(`
            SELECT 
                SUM(a_grade_mtr) as total_a_grade,
                SUM(b_grade_mtr) as total_b_grade,
                SUM(c_grade_mtr) as total_c_grade,
                SUM(reject_c_grade_mtr) as total_reject,
                COUNT(DISTINCT dispo_number) as dispo_count
            FROM folding_production_form
        `);
        
        // Total delivery
        const [totalDelivery] = await connection.query(`
            SELECT 
                SUM(delivery_quantity_a_grade) as total_a_grade,
                SUM(delivery_quantity_b_grade) as total_b_grade,
                SUM(delivery_quantity_c_grade) as total_c_grade,
                SUM(delivery_quantity_reject) as total_reject,
                COUNT(DISTINCT dispo_number) as dispo_count
            FROM greige_delivery_form
        `);
        
        // Top 10 dispos by stock
        const [topDispos] = await connection.query(`
            SELECT 
                f.dispo_number,
                f.buyer,
                ((SUM(f.a_grade_mtr) + SUM(f.b_grade_mtr) + SUM(f.c_grade_mtr)) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM folding_production_form f
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivery_quantity_a_grade, 0) + COALESCE(delivery_quantity_b_grade, 0) + COALESCE(delivery_quantity_c_grade, 0)) as total_delivery
                FROM greige_delivery_form
                GROUP BY dispo_number
            ) d ON f.dispo_number = d.dispo_number
            WHERE f.dispo_number IS NOT NULL AND f.dispo_number != ''
            GROUP BY f.dispo_number, f.buyer, d.total_delivery
            ORDER BY closing_balance DESC
            LIMIT 10
        `);
        
        // Monthly production trend (last 6 months)
        const [monthlyTrend] = await connection.query(`
            SELECT 
                DATE_FORMAT(folding_production_date, '%Y-%m') as month,
                SUM(a_grade_mtr + b_grade_mtr + c_grade_mtr) as total_production
            FROM folding_production_form
            WHERE folding_production_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(folding_production_date, '%Y-%m')
            ORDER BY month DESC
        `);
        
        const foldingTotal = (parseFloat(totalFolding[0].total_a_grade) || 0) + 
                           (parseFloat(totalFolding[0].total_b_grade) || 0) + 
                           (parseFloat(totalFolding[0].total_c_grade) || 0);
        
        const deliveryTotal = (parseFloat(totalDelivery[0].total_a_grade) || 0) + 
                             (parseFloat(totalDelivery[0].total_b_grade) || 0) + 
                             (parseFloat(totalDelivery[0].total_c_grade) || 0);
        
        res.json({
            success: true,
            statistics: {
                total_folding_production: foldingTotal,
                total_delivery: deliveryTotal,
                overall_closing_balance: foldingTotal - deliveryTotal,
                total_reject: parseFloat(totalFolding[0].total_reject) || 0,
                folding_dispo_count: totalFolding[0].dispo_count,
                delivery_dispo_count: totalDelivery[0].dispo_count,
                grade_breakdown: {
                    folding: {
                        a_grade: parseFloat(totalFolding[0].total_a_grade) || 0,
                        b_grade: parseFloat(totalFolding[0].total_b_grade) || 0,
                        c_grade: parseFloat(totalFolding[0].total_c_grade) || 0
                    },
                    delivery: {
                        a_grade: parseFloat(totalDelivery[0].total_a_grade) || 0,
                        b_grade: parseFloat(totalDelivery[0].total_b_grade) || 0,
                        c_grade: parseFloat(totalDelivery[0].total_c_grade) || 0
                    }
                },
                top_dispos: topDispos,
                monthly_trend: monthlyTrend
            }
        });
        
    } catch (error) {
        console.error('Error fetching greige stock statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch greige stock statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// FINISH FABRIC DELIVERY ENTRY FORM - API ENDPOINTS
// =====================================================

// ========== FETCH FINISH DELIVERY RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/finish-delivery/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                po_number,
                dispo_number,
                buyer,
                production_construction,
                challan_no,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                delivered_finish_qty_fresh_yds,
                delivered_finish_qty_reject_yds,
                created_at
            FROM finish_delivery_form 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching finish delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE FINISH DELIVERY WITH BREAKDOWN DATA ==========
app.post('/main/api/finish-delivery/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main finish delivery form record
        const [result] = await connection.execute(
            `INSERT INTO finish_delivery_form (
                finish_delivery_date, challan_no, total_no_of_than_roll,
                dispo_number, buyer, customer_ref_stl, weave,
                production_construction, fabric_composition, special_note,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds,
                po_received_date, bulk_fabric_delivery_date, po_number,
                account_holder, buyer_dispo, customer_ref_stl_dispo, weave_dispo,
                finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.finish_delivery_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.special_note),
                nullIfEmpty(formData.delivered_finish_qty_fresh_yds),
                nullIfEmpty(formData.delivered_finish_qty_reject_yds),
                nullIfEmpty(formData.delivered_fresh_finish_price_per_yds),
                nullIfEmpty(formData.delivered_reject_finish_price_per_yds),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl_dispo),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count)
            ]
        );

        const finishDeliveryId = result.insertId;

        // Insert breakdown details
        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.finish_receive_date || detail.finish_receive_qty_yds || 
                    detail.finish_delivery_date || detail.finish_delivery_qty_yds) {
                    await connection.execute(
                        `INSERT INTO finish_delivery_breakdown (
                            dispo_number, finish_delivery_id, finish_receive_date, finish_receive_qty_yds,
                            finish_delivery_date, finish_delivery_qty_yds, finish_stock
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            finishDeliveryId,
                            nullIfEmpty(detail.finish_receive_date),
                            nullIfEmpty(detail.finish_receive_qty_yds),
                            nullIfEmpty(detail.finish_delivery_date),
                            nullIfEmpty(detail.finish_delivery_qty_yds),
                            nullIfEmpty(detail.finish_stock)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish delivery record saved successfully',
            id: finishDeliveryId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving finish delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save finish delivery record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE FINISH DELIVERY RECORD ==========
app.put('/main/api/finish-delivery/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const finishDeliveryId = req.params.id;
        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main finish delivery form record
        await connection.execute(
            `UPDATE finish_delivery_form SET
                finish_delivery_date = ?, challan_no = ?, total_no_of_than_roll = ?,
                dispo_number = ?, buyer = ?, customer_ref_stl = ?, weave = ?,
                production_construction = ?, fabric_composition = ?, special_note = ?,
                delivered_finish_qty_fresh_yds = ?, delivered_finish_qty_reject_yds = ?,
                delivered_fresh_finish_price_per_yds = ?, delivered_reject_finish_price_per_yds = ?,
                po_received_date = ?, bulk_fabric_delivery_date = ?, po_number = ?,
                account_holder = ?, buyer_dispo = ?, customer_ref_stl_dispo = ?, weave_dispo = ?,
                finish_type = ?, end_use = ?, order_type = ?, yarn_type = ?, process_type = ?,
                production_construction_dispo = ?, fabric_composition_dispo = ?,
                po_quantity_yds = ?, dispo_quantity_yds = ?, required_print_production_meter = ?,
                required_greige_production_meter = ?, required_loom_production_meter = ?,
                required_warp_length_meter = ?, cuttable_width_inch = ?, grey_width_inch = ?,
                total_ends = ?, reed_count = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.finish_delivery_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.special_note),
                nullIfEmpty(formData.delivered_finish_qty_fresh_yds),
                nullIfEmpty(formData.delivered_finish_qty_reject_yds),
                nullIfEmpty(formData.delivered_fresh_finish_price_per_yds),
                nullIfEmpty(formData.delivered_reject_finish_price_per_yds),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl_dispo),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count),
                finishDeliveryId
            ]
        );

        // Delete existing breakdown details
        await connection.execute(
            'DELETE FROM finish_delivery_breakdown WHERE finish_delivery_id = ?',
            [finishDeliveryId]
        );

        // Insert new breakdown details
        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.finish_receive_date || detail.finish_receive_qty_yds || 
                    detail.finish_delivery_date || detail.finish_delivery_qty_yds) {
                    await connection.execute(
                        `INSERT INTO finish_delivery_breakdown (
                            dispo_number, finish_delivery_id, finish_receive_date, finish_receive_qty_yds,
                            finish_delivery_date, finish_delivery_qty_yds, finish_stock
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            finishDeliveryId,
                            nullIfEmpty(detail.finish_receive_date),
                            nullIfEmpty(detail.finish_receive_qty_yds),
                            nullIfEmpty(detail.finish_delivery_date),
                            nullIfEmpty(detail.finish_delivery_qty_yds),
                            nullIfEmpty(detail.finish_stock)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish delivery record updated successfully',
            id: finishDeliveryId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating finish delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update finish delivery record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH FINISH DELIVERY RECORD BY ID WITH BREAKDOWN ==========
app.get('/main/api/finish-delivery/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const finishDeliveryId = req.params.id;

        // Get main record with formatted dates
        const [mainRecords] = await connection.execute(
            `SELECT 
                id, 
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, total_no_of_than_roll, dispo_number, buyer,
                customer_ref_stl, weave, production_construction, fabric_composition,
                special_note, delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl_dispo,
                weave_dispo, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            FROM finish_delivery_form 
            WHERE id = ?`,
            [finishDeliveryId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Finish delivery record not found'
            });
        }

        // Get breakdown details with formatted dates
        const [breakdownDetails] = await connection.execute(
            `SELECT 
                id, finish_delivery_id,
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                finish_receive_qty_yds,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                finish_delivery_qty_yds, finish_stock
            FROM finish_delivery_breakdown 
            WHERE finish_delivery_id = ? 
            ORDER BY id`,
            [finishDeliveryId]
        );

        res.json({
            ...mainRecords[0],
            breakdownData: breakdownDetails
        });

    } catch (error) {
        console.error('Error fetching finish delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE FINISH DELIVERY RECORD ==========
app.delete('/main/api/finish-delivery/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const finishDeliveryId = req.params.id;

        // Delete breakdown details first (foreign key constraint)
        await connection.execute(
            'DELETE FROM finish_delivery_breakdown WHERE finish_delivery_id = ?',
            [finishDeliveryId]
        );

        // Delete main record
        const [result] = await connection.execute(
            'DELETE FROM finish_delivery_form WHERE id = ?',
            [finishDeliveryId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Finish delivery record not found'
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish delivery record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting finish delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete finish delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED FINISH DELIVERY RECORDS ==========
app.get('/main/api/finish-delivery/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, dispo_number, po_number, buyer, production_construction,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds,
                created_at
            FROM finish_delivery_form 
            ORDER BY created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved finish delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT FINISH DELIVERY RECORDS TO CSV ==========
app.get('/main/api/finish-delivery/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, total_no_of_than_roll, dispo_number, buyer,
                customer_ref_stl, weave, production_construction, fabric_composition,
                special_note, delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl_dispo,
                weave_dispo, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM finish_delivery_form 
            ORDER BY created_at DESC`
        );

        // Create CSV header
        const csvHeader = 'ID,Finish Delivery Date,Challan No,Total Than/Roll,Dispo Number,Buyer,Customer Ref/Stl,Weave,Production Construction,Fabric Composition,Special Note,Fresh Qty (Yds),Reject Qty (Yds),Fresh Price/Yds,Reject Price/Yds,PO Received Date,Bulk Fabric Del Date,PO Number,Account Holder,Buyer (Dispo),Customer Ref/Stl (Dispo),Weave (Dispo),Finish Type,End Use,Order Type,Yarn Type,Process Type,Prod Construction (Dispo),Fabric Comp (Dispo),PO Qty (Yds),Dispo Qty (Yds),Req Print Prod (Mtr),Req Greige Prod (Mtr),Req Loom Prod (Mtr),Req Warp Length (Mtr),Cuttable Width (Inch),Grey Width (Inch),Total Ends,Reed Count,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.finish_delivery_date || '',
                record.challan_no || '',
                record.total_no_of_than_roll || '',
                record.dispo_number || '',
                record.buyer || '',
                record.customer_ref_stl || '',
                record.weave || '',
                record.production_construction || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                (record.special_note || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.delivered_finish_qty_fresh_yds || '',
                record.delivered_finish_qty_reject_yds || '',
                record.delivered_fresh_finish_price_per_yds || '',
                record.delivered_reject_finish_price_per_yds || '',
                record.po_received_date || '',
                record.bulk_fabric_delivery_date || '',
                record.po_number || '',
                record.account_holder || '',
                record.buyer_dispo || '',
                record.customer_ref_stl_dispo || '',
                record.weave_dispo || '',
                record.finish_type || '',
                record.end_use || '',
                record.order_type || '',
                record.yarn_type || '',
                record.process_type || '',
                record.production_construction_dispo || '',
                (record.fabric_composition_dispo || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.required_print_production_meter || '',
                record.required_greige_production_meter || '',
                record.required_loom_production_meter || '',
                record.required_warp_length_meter || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.total_ends || '',
                record.reed_count || '',
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="finish_delivery_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting finish delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH FINISH DELIVERY RECORDS WITH FILTERS ==========
app.post('/main/api/finish-delivery/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            challan_no,
            po_number,
            dispo_number,
            buyer,
            date_from,
            date_to
        } = req.body;

        let query = `SELECT 
            id, 
            DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
            challan_no, po_number, dispo_number, buyer, production_construction,
            delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds
        FROM finish_delivery_form WHERE 1=1`;
        const params = [];

        if (challan_no) {
            query += ' AND challan_no LIKE ?';
            params.push(`%${challan_no}%`);
        }

        if (po_number) {
            query += ' AND po_number LIKE ?';
            params.push(`%${po_number}%`);
        }

        if (dispo_number) {
            query += ' AND dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (date_from) {
            query += ' AND finish_delivery_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND finish_delivery_date <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching finish delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH DELIVERY RECORDS BY DISPO NUMBER ==========
app.get('/main/api/finish-delivery/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);

        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, po_number, dispo_number, buyer, production_construction,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds
            FROM finish_delivery_form
            WHERE dispo_number = ?
            ORDER BY finish_delivery_date DESC`,
            [dispoNumber]
        );

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error fetching finish delivery records by dispo:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== BULK DELETE FINISH DELIVERY RECORDS ==========
app.post('/main/api/finish-delivery/bulk-delete', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { record_ids } = req.body;

        if (!record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No record IDs provided'
            });
        }

        // Delete breakdown records first (foreign key constraint)
        await connection.query(
            'DELETE FROM finish_delivery_breakdown WHERE finish_delivery_id IN (?)',
            [record_ids]
        );

        // Delete main records
        const [result] = await connection.query(
            'DELETE FROM finish_delivery_form WHERE id IN (?)',
            [record_ids]
        );

        await connection.commit();

        res.json({
            success: true,
            message: `Successfully deleted ${result.affectedRows} finish delivery records`,
            deleted_count: result.affectedRows
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error bulk deleting finish delivery records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to bulk delete finish delivery records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH DELIVERY STATISTICS ==========
app.get('/main/api/finish-delivery/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.get
Connection();

        // Total records count
        const [totalRecords] = await connection.query(
            'SELECT COUNT(*) as total FROM finish_delivery_form'
        );

        // Total fresh delivery
        const [totalFresh] = await connection.query(
            'SELECT SUM(delivered_finish_qty_fresh_yds) as total FROM finish_delivery_form'
        );

        // Total reject delivery
        const [totalReject] = await connection.query(
            'SELECT SUM(delivered_finish_qty_reject_yds) as total FROM finish_delivery_form'
        );

        // Total fresh value
        const [totalFreshValue] = await connection.query(
            'SELECT SUM(delivered_finish_qty_fresh_yds * delivered_fresh_finish_price_per_yds) as total FROM finish_delivery_form'
        );

        // Total reject value
        const [totalRejectValue] = await connection.query(
            'SELECT SUM(delivered_finish_qty_reject_yds * delivered_reject_finish_price_per_yds) as total FROM finish_delivery_form'
        );

        // Recent records (last 10)
        const [recentRecords] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, dispo_number, buyer,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds
            FROM finish_delivery_form 
            ORDER BY created_at DESC 
            LIMIT 10`
        );

        // Records by month (last 6 months)
        const [byMonth] = await connection.query(
            `SELECT 
                DATE_FORMAT(finish_delivery_date, '%Y-%m') as month,
                COUNT(*) as count,
                SUM(delivered_finish_qty_fresh_yds) as total_fresh,
                SUM(delivered_finish_qty_reject_yds) as total_reject
            FROM finish_delivery_form 
            WHERE finish_delivery_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(finish_delivery_date, '%Y-%m')
            ORDER BY month DESC`
        );

        // Top buyers by delivery
        const [topBuyers] = await connection.query(
            `SELECT 
                buyer,
                COUNT(*) as delivery_count,
                SUM(delivered_finish_qty_fresh_yds) as total_fresh,
                SUM(delivered_finish_qty_reject_yds) as total_reject
            FROM finish_delivery_form 
            WHERE buyer IS NOT NULL AND buyer != ''
            GROUP BY buyer
            ORDER BY total_fresh DESC
            LIMIT 10`
        );

        res.json({
            success: true,
            statistics: {
                total_records: totalRecords[0].total,
                total_fresh_delivery_yds: totalFresh[0].total || 0,
                total_reject_delivery_yds: totalReject[0].total || 0,
                total_fresh_value: totalFreshValue[0].total || 0,
                total_reject_value: totalRejectValue[0].total || 0,
                recent_records: recentRecords,
                by_month: byMonth,
                top_buyers: topBuyers
            }
        });

    } catch (error) {
        console.error('Error fetching finish delivery statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH DELIVERY SUMMARY BY DATE RANGE ==========
app.post('/main/api/finish-delivery/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const { date_from, date_to } = req.body;

        let query = `SELECT 
            COUNT(*) as total_records,
            SUM(delivered_finish_qty_fresh_yds) as total_fresh_qty,
            SUM(delivered_finish_qty_reject_yds) as total_reject_qty,
            SUM(delivered_finish_qty_fresh_yds * delivered_fresh_finish_price_per_yds) as total_fresh_value,
            SUM(delivered_finish_qty_reject_yds * delivered_reject_finish_price_per_yds) as total_reject_value,
            COUNT(DISTINCT dispo_number) as unique_dispos,
            COUNT(DISTINCT buyer) as unique_buyers
        FROM finish_delivery_form WHERE 1=1`;
        const params = [];

        if (date_from) {
            query += ' AND finish_delivery_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND finish_delivery_date <= ?';
            params.push(date_to);
        }

        const [summary] = await connection.query(query, params);

        res.json({
            success: true,
            summary: summary[0]
        });

    } catch (error) {
        console.error('Error fetching finish delivery summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery summary',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DUPLICATE FINISH DELIVERY RECORD ==========
app.post('/main/api/finish-delivery/duplicate/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const sourceId = req.params.id;

        // Fetch source record
        const [sourceRecords] = await connection.execute(
            'SELECT * FROM finish_delivery_form WHERE id = ?',
            [sourceId]
        );

        if (sourceRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Source record not found'
            });
        }

        const source = sourceRecords[0];

        // Insert duplicate record (excluding id, created_at, updated_at)
        const [result] = await connection.execute(
            `INSERT INTO finish_delivery_form (
                finish_delivery_date, challan_no, total_no_of_than_roll,
                dispo_number, buyer, customer_ref_stl, weave,
                production_construction, fabric_composition, special_note,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds,
                po_received_date, bulk_fabric_delivery_date, po_number,
                account_holder, buyer_dispo, customer_ref_stl_dispo, weave_dispo,
                finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                source.finish_delivery_date,
                source.challan_no,
                source.total_no_of_than_roll,
                source.dispo_number,
                source.buyer,
                source.customer_ref_stl,
                source.weave,
                source.production_construction,
                source.fabric_composition,
                source.special_note,
                source.delivered_finish_qty_fresh_yds,
                source.delivered_finish_qty_reject_yds,
                source.delivered_fresh_finish_price_per_yds,
                source.delivered_reject_finish_price_per_yds,
                source.po_received_date,
                source.bulk_fabric_delivery_date,
                source.po_number,
                source.account_holder,
                source.buyer_dispo,
                source.customer_ref_stl_dispo,
                source.weave_dispo,
                source.finish_type,
                source.end_use,
                source.order_type,
                source.yarn_type,
                source.process_type,
                source.production_construction_dispo,
                source.fabric_composition_dispo,
                source.po_quantity_yds,
                source.dispo_quantity_yds,
                source.required_print_production_meter,
                source.required_greige_production_meter,
                source.required_loom_production_meter,
                source.required_warp_length_meter,
                source.cuttable_width_inch,
                source.grey_width_inch,
                source.total_ends,
                source.reed_count
            ]
        );

        const newId = result.insertId;

        // Duplicate breakdown records
        const [breakdownRecords] = await connection.execute(
            'SELECT * FROM finish_delivery_breakdown WHERE finish_delivery_id = ?',
            [sourceId]
        );

        for (const breakdown of breakdownRecords) {
            await connection.execute(
                `INSERT INTO finish_delivery_breakdown (
                    dispo_number, finish_delivery_id, finish_receive_date, finish_receive_qty_yds,
                    finish_delivery_date, finish_delivery_qty_yds, finish_stock
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    source.dispo_number,
                    newId,
                    breakdown.finish_receive_date,
                    breakdown.finish_receive_qty_yds,
                    breakdown.finish_delivery_date,
                    breakdown.finish_delivery_qty_yds,
                    breakdown.finish_stock
                ]
            );
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish delivery record duplicated successfully',
            id: newId,
            source_id: sourceId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error duplicating finish delivery record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to duplicate finish delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH DELIVERY BY CHALLAN NUMBER ==========
app.get('/main/api/finish-delivery/by-challan/:challanNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const challanNo = decodeURIComponent(req.params.challanNo);

        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, po_number, dispo_number, buyer, production_construction,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds
            FROM finish_delivery_form
            WHERE challan_no = ?`,
            [challanNo]
        );

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No record found with this challan number'
            });
        }

        res.json({
            success: true,
            record: records[0]
        });

    } catch (error) {
        console.error('Error fetching finish delivery by challan:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish delivery record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH DELIVERY BREAKDOWN TOTALS ==========
app.get('/main/api/finish-delivery/breakdown-totals/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const finishDeliveryId = req.params.id;

        const [totals] = await connection.query(
            `SELECT 
                SUM(finish_receive_qty_yds) as total_receive_qty,
                SUM(finish_delivery_qty_yds) as total_delivery_qty,
                SUM(finish_stock) as total_stock,
                COUNT(*) as breakdown_count
            FROM finish_delivery_breakdown
            WHERE finish_delivery_id = ?`,
            [finishDeliveryId]
        );

        res.json({
            success: true,
            totals: totals[0]
        });

    } catch (error) {
        console.error('Error fetching breakdown totals:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch breakdown totals',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// FINISH FABRIC RECEIVE ENTRY FORM - API ENDPOINTS
// =====================================================

// ========== FETCH FINISH RECEIVE RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/finish-receive/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                po_number,
                dispo_number,
                buyer,
                production_construction,
                challan_no,
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                receive_qty_a_grade,
                receive_qty_b_grade,
                receive_qty_c_grade,
                receive_qty_reject,
                created_at
            FROM finish_receive_form 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching finish receive records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish receive records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE FINISH RECEIVE WITH BREAKDOWN DATA ==========
app.post('/main/api/finish-receive/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownData } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        // Insert main finish receive form record
        const [result] = await connection.execute(
            `INSERT INTO finish_receive_form (
                finish_receive_date, challan_no, total_no_of_than_roll,
                dispo_number, buyer, customer_ref_stl, weave,
                production_construction, fabric_composition,
                finish_fabric_price_per_yds,
                receive_qty_a_grade, receive_qty_b_grade,
                receive_qty_c_grade, receive_qty_reject,
                po_received_date, bulk_fabric_delivery_date, po_number,
                account_holder, buyer_dispo, customer_ref_stl_dispo, weave_dispo,
                finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(formData.finish_receive_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.finish_fabric_price_per_yds),
                nullIfEmpty(formData.receive_qty_a_grade),
                nullIfEmpty(formData.receive_qty_b_grade),
                nullIfEmpty(formData.receive_qty_c_grade),
                nullIfEmpty(formData.receive_qty_reject),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl_dispo),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count)
            ]
        );

        const finishReceiveId = result.insertId;

        // Insert breakdown details
        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.greige_delivery_date || detail.greige_delivery_qty || 
                    detail.finish_receive_date || detail.finish_receive_qty_yds) {
                    await connection.execute(
                        `INSERT INTO finish_receive_breakdown (
                            dispo_number, finish_receive_id, greige_delivery_date, greige_delivery_qty,
                            finish_receive_date, finish_receive_qty_yds, receive_balance
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            finishReceiveId,
                            nullIfEmpty(detail.greige_delivery_date),
                            nullIfEmpty(detail.greige_delivery_qty),
                            nullIfEmpty(detail.finish_receive_date),
                            nullIfEmpty(detail.finish_receive_qty_yds),
                            nullIfEmpty(detail.receive_balance)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish receive record saved successfully',
            id: finishReceiveId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving finish receive record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save finish receive record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE FINISH RECEIVE RECORD ==========
app.put('/main/api/finish-receive/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const finishReceiveId = req.params.id;
        const { formData, breakdownData } = req.body;

        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        await connection.execute(
            `UPDATE finish_receive_form SET
                finish_receive_date = ?, challan_no = ?, total_no_of_than_roll = ?,
                dispo_number = ?, buyer = ?, customer_ref_stl = ?, weave = ?,
                production_construction = ?, fabric_composition = ?,
                finish_fabric_price_per_yds = ?,
                receive_qty_a_grade = ?, receive_qty_b_grade = ?,
                receive_qty_c_grade = ?, receive_qty_reject = ?,
                po_received_date = ?, bulk_fabric_delivery_date = ?, po_number = ?,
                account_holder = ?, buyer_dispo = ?, customer_ref_stl_dispo = ?, weave_dispo = ?,
                finish_type = ?, end_use = ?, order_type = ?, yarn_type = ?, process_type = ?,
                production_construction_dispo = ?, fabric_composition_dispo = ?,
                po_quantity_yds = ?, dispo_quantity_yds = ?, required_print_production_meter = ?,
                required_greige_production_meter = ?, required_loom_production_meter = ?,
                required_warp_length_meter = ?, cuttable_width_inch = ?, grey_width_inch = ?,
                total_ends = ?, reed_count = ?, updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(formData.finish_receive_date),
                nullIfEmpty(formData.challan_no),
                nullIfEmpty(formData.total_no_of_than_roll),
                nullIfEmpty(formData.dispo_number),
                nullIfEmpty(formData.buyer),
                nullIfEmpty(formData.customer_ref_stl),
                nullIfEmpty(formData.weave),
                nullIfEmpty(formData.production_construction),
                nullIfEmpty(formData.fabric_composition),
                nullIfEmpty(formData.finish_fabric_price_per_yds),
                nullIfEmpty(formData.receive_qty_a_grade),
                nullIfEmpty(formData.receive_qty_b_grade),
                nullIfEmpty(formData.receive_qty_c_grade),
                nullIfEmpty(formData.receive_qty_reject),
                nullIfEmpty(formData.po_received_date),
                nullIfEmpty(formData.bulk_fabric_delivery_date),
                nullIfEmpty(formData.po_number),
                nullIfEmpty(formData.account_holder),
                nullIfEmpty(formData.buyer_dispo),
                nullIfEmpty(formData.customer_ref_stl_dispo),
                nullIfEmpty(formData.weave_dispo),
                nullIfEmpty(formData.finish_type),
                nullIfEmpty(formData.end_use),
                nullIfEmpty(formData.order_type),
                nullIfEmpty(formData.yarn_type),
                nullIfEmpty(formData.process_type),
                nullIfEmpty(formData.production_construction_dispo),
                nullIfEmpty(formData.fabric_composition_dispo),
                nullIfEmpty(formData.po_quantity_yds),
                nullIfEmpty(formData.dispo_quantity_yds),
                nullIfEmpty(formData.required_print_production_meter),
                nullIfEmpty(formData.required_greige_production_meter),
                nullIfEmpty(formData.required_loom_production_meter),
                nullIfEmpty(formData.required_warp_length_meter),
                nullIfEmpty(formData.cuttable_width_inch),
                nullIfEmpty(formData.grey_width_inch),
                nullIfEmpty(formData.total_ends),
                nullIfEmpty(formData.reed_count),
                finishReceiveId
            ]
        );

        await connection.execute(
            'DELETE FROM finish_receive_breakdown WHERE finish_receive_id = ?',
            [finishReceiveId]
        );

        if (breakdownData && Array.isArray(breakdownData)) {
            for (const detail of breakdownData) {
                if (detail.greige_delivery_date || detail.greige_delivery_qty || 
                    detail.finish_receive_date || detail.finish_receive_qty_yds) {
                    await connection.execute(
                        `INSERT INTO finish_receive_breakdown (
                            dispo_number, finish_receive_id, greige_delivery_date, greige_delivery_qty,
                            finish_receive_date, finish_receive_qty_yds, receive_balance
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            nullIfEmpty(formData.dispo_number),
                            finishReceiveId,
                            nullIfEmpty(detail.greige_delivery_date),
                            nullIfEmpty(detail.greige_delivery_qty),
                            nullIfEmpty(detail.finish_receive_date),
                            nullIfEmpty(detail.finish_receive_qty_yds),
                            nullIfEmpty(detail.receive_balance)
                        ]
                    );
                }
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish receive record updated successfully',
            id: finishReceiveId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating finish receive record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update finish receive record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH FINISH RECEIVE RECORD BY ID ==========
app.get('/main/api/finish-receive/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const finishReceiveId = req.params.id;

        const [mainRecords] = await connection.execute(
            `SELECT 
                id, 
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                challan_no, total_no_of_than_roll, dispo_number, buyer,
                customer_ref_stl, weave, production_construction, fabric_composition,
                finish_fabric_price_per_yds,
                receive_qty_a_grade, receive_qty_b_grade,
                receive_qty_c_grade, receive_qty_reject,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl_dispo,
                weave_dispo, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count, created_at, updated_at
            FROM finish_receive_form 
            WHERE id = ?`,
            [finishReceiveId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Finish receive record not found'
            });
        }

        const [breakdownDetails] = await connection.execute(
            `SELECT 
                id, finish_receive_id,
                DATE_FORMAT(greige_delivery_date, '%Y-%m-%d') as greige_delivery_date,
                greige_delivery_qty,
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                finish_receive_qty_yds, receive_balance
            FROM finish_receive_breakdown 
            WHERE finish_receive_id = ? 
            ORDER BY id`,
            [finishReceiveId]
        );

        res.json({
            ...mainRecords[0],
            breakdownData: breakdownDetails
        });

    } catch (error) {
        console.error('Error fetching finish receive record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish receive record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE FINISH RECEIVE RECORD ==========
app.delete('/main/api/finish-receive/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const finishReceiveId = req.params.id;

        await connection.execute(
            'DELETE FROM finish_receive_breakdown WHERE finish_receive_id = ?',
            [finishReceiveId]
        );

        const [result] = await connection.execute(
            'DELETE FROM finish_receive_form WHERE id = ?',
            [finishReceiveId]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Finish receive record not found'
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Finish receive record deleted successfully'
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting finish receive record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete finish receive record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH SAVED FINISH RECEIVE RECORDS ==========
app.get('/main/api/finish-receive/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id, 
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                challan_no, dispo_number, po_number, buyer, production_construction,
                receive_qty_a_grade, receive_qty_b_grade,
                receive_qty_c_grade, receive_qty_reject,
                finish_fabric_price_per_yds,
                created_at
            FROM finish_receive_form 
            ORDER BY created_at DESC`
        );

        res.json(records);

    } catch (error) {
        console.error('Error fetching saved finish receive records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch saved finish receive records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT FINISH RECEIVE RECORDS TO CSV ==========
app.get('/main/api/finish-receive/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                challan_no, total_no_of_than_roll, dispo_number, buyer,
                customer_ref_stl, weave, production_construction, fabric_composition,
                finish_fabric_price_per_yds,
                receive_qty_a_grade, receive_qty_b_grade,
                receive_qty_c_grade, receive_qty_reject,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                po_number, account_holder, buyer_dispo, customer_ref_stl_dispo,
                weave_dispo, finish_type, end_use, order_type, yarn_type, process_type,
                production_construction_dispo, fabric_composition_dispo,
                po_quantity_yds, dispo_quantity_yds, required_print_production_meter,
                required_greige_production_meter, required_loom_production_meter,
                required_warp_length_meter, cuttable_width_inch, grey_width_inch,
                total_ends, reed_count,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM finish_receive_form 
            ORDER BY created_at DESC`
        );

        const csvHeader = 'ID,Finish Receive Date,Challan No,Total Than/Roll,Dispo Number,Buyer,Customer Ref/Stl,Weave,Production Construction,Fabric Composition,Finish Fabric Price/Yds,A Grade Qty,B Grade Qty,C Grade Qty,Reject Qty,PO Received Date,Bulk Fabric Del Date,PO Number,Account Holder,Buyer Dispo,Customer Ref/Stl Dispo,Weave Dispo,Finish Type,End Use,Order Type,Yarn Type,Process Type,Prod Construction Dispo,Fabric Comp Dispo,PO Qty,Dispo Qty,Req Print Prod,Req Greige Prod,Req Loom Prod,Req Warp Length,Cuttable Width,Grey Width,Total Ends,Reed Count,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.finish_receive_date || '',
                record.challan_no || '',
                record.total_no_of_than_roll || '',
                record.dispo_number || '',
                record.buyer || '',
                record.customer_ref_stl || '',
                record.weave || '',
                record.production_construction || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.finish_fabric_price_per_yds || '',
                record.receive_qty_a_grade || '',
                record.receive_qty_b_grade || '',
                record.receive_qty_c_grade || '',
                record.receive_qty_reject || '',
                record.po_received_date || '',
                record.bulk_fabric_delivery_date || '',
                record.po_number || '',
                record.account_holder || '',
                record.buyer_dispo || '',
                record.customer_ref_stl_dispo || '',
                record.weave_dispo || '',
                record.finish_type || '',
                record.end_use || '',
                record.order_type || '',
                record.yarn_type || '',
                record.process_type || '',
                record.production_construction_dispo || '',
                (record.fabric_composition_dispo || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.required_print_production_meter || '',
                record.required_greige_production_meter || '',
                record.required_loom_production_meter || '',
                record.required_warp_length_meter || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.total_ends || '',
                record.reed_count || '',
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="finish_receive_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting finish receive records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export finish receive records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// FINISH FABRIC STOCK REPORT - API ENDPOINTS
// =====================================================

// ========== FETCH DISPO NUMBERS FOR FINISH STOCK DROPDOWN ==========
app.get('/main/api/finish-stock-report/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch from finish_receive_form
        const [receiveRecords] = await connection.query(`
            SELECT DISTINCT
                TRIM(dispo_number) as dispo_number,
                buyer,
                production_construction,
                created_at
            FROM finish_receive_form 
            WHERE dispo_number IS NOT NULL 
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
        `);
        
        console.log(`Found ${receiveRecords.length} dispo numbers from finish_receive_form`);
        
        // Fetch from finish_delivery_form
        const [deliveryRecords] = await connection.query(`
            SELECT DISTINCT
                TRIM(dispo_number) as dispo_number,
                buyer,
                production_construction,
                created_at
            FROM finish_delivery_form 
            WHERE dispo_number IS NOT NULL 
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
        `);
        
        console.log(`Found ${deliveryRecords.length} dispo numbers from finish_delivery_form`);
        
        // Merge and deduplicate
        const dispoMap = new Map();
        
        // Process receive records first
        receiveRecords.forEach(record => {
            const key = record.dispo_number.trim();
            if (key && !dispoMap.has(key)) {
                dispoMap.set(key, {
                    dispo_number: key,
                    buyer: record.buyer || null,
                    production_construction: record.production_construction || null,
                    source: 'receive'
                });
            } else if (key && dispoMap.has(key)) {
                const existing = dispoMap.get(key);
                if (!existing.buyer && record.buyer) {
                    existing.buyer = record.buyer;
                }
                if (!existing.production_construction && record.production_construction) {
                    existing.production_construction = record.production_construction;
                }
            }
        });
        
        // Process delivery records
        deliveryRecords.forEach(record => {
            const key = record.dispo_number.trim();
            if (key && !dispoMap.has(key)) {
                dispoMap.set(key, {
                    dispo_number: key,
                    buyer: record.buyer || null,
                    production_construction: record.production_construction || null,
                    source: 'delivery'
                });
            } else if (key && dispoMap.has(key)) {
                const existing = dispoMap.get(key);
                if (!existing.buyer && record.buyer) {
                    existing.buyer = record.buyer;
                }
                if (!existing.production_construction && record.production_construction) {
                    existing.production_construction = record.production_construction;
                }
            }
        });
        
        // Convert map to array and sort
        const results = Array.from(dispoMap.values()).sort((a, b) => {
            return b.dispo_number.localeCompare(a.dispo_number);
        });
        
        console.log('FINISH_STOCK_DISPO_NUMBERS', `Total unique dispo numbers: ${results.length}`);
        
        res.json(results);
        
    } catch (error) {
        console.error('Error fetching dispo numbers for finish stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH FINISH FABRIC STOCK REPORT BY DISPO NUMBER ==========
app.get('/main/api/finish-stock-report/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        // ========================================
        // 1. Fetch dispo details from multiple sources
        // ========================================
        let details = null;
        
        // Try finish_receive_form first
        const [receiveDetails] = await connection.query(`
            SELECT 
                dispo_number, po_number, buyer, account_holder,
                production_construction, fabric_composition, weave,
                finish_type, end_use, order_type, yarn_type, process_type,
                po_quantity_yds, dispo_quantity_yds, grey_width_inch,
                cuttable_width_inch, total_ends, reed_count,
                finish_fabric_price_per_yds
            FROM finish_receive_form 
            WHERE dispo_number = ?
            ORDER BY created_at DESC
            LIMIT 1
        `, [dispoNumber]);
        
        if (receiveDetails.length > 0) {
            details = receiveDetails[0];
        }
        
        // If not found, try finish_delivery_form
        if (!details) {
            const [deliveryDetails] = await connection.query(`
                SELECT 
                    dispo_number, po_number, buyer, account_holder,
                    production_construction, fabric_composition, weave,
                    finish_type, end_use, order_type, yarn_type, process_type,
                    po_quantity_yds, dispo_quantity_yds, grey_width_inch,
                    cuttable_width_inch, total_ends, reed_count,
                    delivered_fresh_finish_price_per_yds as finish_fabric_price_per_yds
                FROM finish_delivery_form 
                WHERE dispo_number = ?
                ORDER BY created_at DESC
                LIMIT 1
            `, [dispoNumber]);
            
            if (deliveryDetails.length > 0) {
                details = deliveryDetails[0];
            }
        }
        
        // If still not found, try dispo_form_data
        if (!details) {
            const [dispoDetails] = await connection.query(`
                SELECT 
                    dispo_number, po_no as po_number, buyer_name as buyer, 
                    account_holder, production_construction, fabric_composition, 
                    weave_type as weave, finish_type, end_use, order_type, 
                    yarn_type, process_type, po_qty_yds as po_quantity_yds, 
                    finish_qty_yds as dispo_quantity_yds, grey_width_inch,
                    dispo_cuttable_width as cuttable_width_inch, 
                    beam_total_ends as total_ends, reed_count
                FROM dispo_form_data 
                WHERE dispo_number = ?
                ORDER BY created_at DESC
                LIMIT 1
            `, [dispoNumber]);
            
            if (dispoDetails.length > 0) {
                details = dispoDetails[0];
            } else {
                details = { dispo_number: dispoNumber };
            }
        }
        
        // ========================================
        // 2. Fetch finish receive transactions
        // ========================================
        const [receiveTransactions] = await connection.query(`
            SELECT 
                id,
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                dispo_number, buyer, production_construction, challan_no,
                receive_qty_a_grade, receive_qty_b_grade, 
                receive_qty_c_grade, receive_qty_reject,
                finish_fabric_price_per_yds
            FROM finish_receive_form
            WHERE dispo_number = ?
            ORDER BY finish_receive_date ASC
        `, [dispoNumber]);
        
        // ========================================
        // 3. Fetch finish delivery transactions
        // ========================================
        const [deliveryTransactions] = await connection.query(`
            SELECT 
                id,
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no, dispo_number, buyer,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds
            FROM finish_delivery_form
            WHERE dispo_number = ?
            ORDER BY finish_delivery_date ASC
        `, [dispoNumber]);
        
        // ========================================
        // 4. Calculate summary totals
        // ========================================
        
        // Receive totals by grade
        const totalReceiveAGrade = receiveTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.receive_qty_a_grade) || 0), 0);
        const totalReceiveBGrade = receiveTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.receive_qty_b_grade) || 0), 0);
        const totalReceiveCGrade = receiveTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.receive_qty_c_grade) || 0), 0);
        const totalReceiveReject = receiveTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.receive_qty_reject) || 0), 0);
        
        // Total finish receive (excluding reject for fresh calculation)
        const totalFinishReceive = totalReceiveAGrade + totalReceiveBGrade + totalReceiveCGrade;
        const totalFinishReceiveWithReject = totalFinishReceive + totalReceiveReject;
        
        // Delivery totals
        const totalDeliveryFresh = deliveryTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.delivered_finish_qty_fresh_yds) || 0), 0);
        const totalDeliveryReject = deliveryTransactions.reduce((sum, txn) => 
            sum + (parseFloat(txn.delivered_finish_qty_reject_yds) || 0), 0);
        const totalFinishDelivery = totalDeliveryFresh + totalDeliveryReject;
        
        // Stock calculations based on Excel formulas
        const closingBalance = totalFinishReceiveWithReject - totalFinishDelivery;
        const totalRejectStock = totalReceiveReject - totalDeliveryReject;
        const freshStock = closingBalance - (totalRejectStock > 0 ? totalRejectStock : 0);
        
        // Balance calculations
        const poQuantity = parseFloat(details.po_quantity_yds) || 0;
        const dispoQuantity = parseFloat(details.dispo_quantity_yds) || 0;
        const balanceToDelivery = poQuantity - totalFinishDelivery;
        const balanceToProduction = dispoQuantity - totalFinishReceiveWithReject;
        
        // ========================================
        // 5. Build summary object
        // ========================================
        const summary = {
            // Primary totals
            total_finish_receive: totalFinishReceiveWithReject,
            total_finish_delivery: totalFinishDelivery,
            closing_balance: closingBalance,
            
            // Receive breakdown by grade
            total_receive_a_grade: totalReceiveAGrade,
            total_receive_b_grade: totalReceiveBGrade,
            total_receive_c_grade: totalReceiveCGrade,
            total_receive_reject: totalReceiveReject,
            
            // Delivery breakdown
            total_delivery_fresh: totalDeliveryFresh,
            total_delivery_reject: totalDeliveryReject,
            
            // Stock calculations
            total_reject_stock: totalRejectStock > 0 ? totalRejectStock : 0,
            fresh_stock: freshStock > 0 ? freshStock : 0,
            
            // Balance calculations
            balance_to_delivery: balanceToDelivery,
            balance_to_production: balanceToProduction,
            
            // Transaction counts
            receive_transaction_count: receiveTransactions.length,
            delivery_transaction_count: deliveryTransactions.length
        };
        
        // ========================================
        // 6. Return response
        // ========================================
        res.json({
            success: true,
            dispo_number: dispoNumber,
            dispo_details: details,
            summary: summary,
            receive_transactions: receiveTransactions,
            delivery_transactions: deliveryTransactions
        });
        
    } catch (error) {
        console.error('Error fetching finish fabric stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish fabric stock report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH ALL FINISH FABRIC STOCK SUMMARY ==========
app.get('/main/api/finish-stock-report/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get summary for all dispos with finish stock
        const [records] = await connection.query(`
            SELECT 
                r.dispo_number,
                r.buyer,
                r.production_construction,
                SUM(COALESCE(r.receive_qty_a_grade, 0)) as total_receive_a_grade,
                SUM(COALESCE(r.receive_qty_b_grade, 0)) as total_receive_b_grade,
                SUM(COALESCE(r.receive_qty_c_grade, 0)) as total_receive_c_grade,
                SUM(COALESCE(r.receive_qty_reject, 0)) as total_receive_reject,
                (SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                 SUM(COALESCE(r.receive_qty_reject, 0))) as total_receive,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                  SUM(COALESCE(r.receive_qty_reject, 0))) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM finish_receive_form r
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivered_finish_qty_fresh_yds, 0) + 
                        COALESCE(delivered_finish_qty_reject_yds, 0)) as total_delivery
                FROM finish_delivery_form
                GROUP BY dispo_number
            ) d ON r.dispo_number = d.dispo_number
            WHERE r.dispo_number IS NOT NULL AND r.dispo_number != ''
            GROUP BY r.dispo_number, r.buyer, r.production_construction, d.total_delivery
            ORDER BY closing_balance DESC
        `);
        
        res.json({
            success: true,
            count: records.length,
            records: records
        });
        
    } catch (error) {
        console.error('Error fetching finish fabric stock summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish fabric stock summary',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT FINISH FABRIC STOCK REPORT TO CSV ==========
app.get('/main/api/finish-stock-report/export/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        // Fetch receive transactions
        const [receiveTransactions] = await connection.query(`
            SELECT 
                DATE_FORMAT(finish_receive_date, '%Y-%m-%d') as finish_receive_date,
                challan_no,
                receive_qty_a_grade, receive_qty_b_grade,
                receive_qty_c_grade, receive_qty_reject,
                finish_fabric_price_per_yds
            FROM finish_receive_form
            WHERE dispo_number = ?
            ORDER BY finish_receive_date ASC
        `, [dispoNumber]);
        
        // Fetch delivery transactions
        const [deliveryTransactions] = await connection.query(`
            SELECT 
                DATE_FORMAT(finish_delivery_date, '%Y-%m-%d') as finish_delivery_date,
                challan_no,
                delivered_finish_qty_fresh_yds, delivered_finish_qty_reject_yds,
                delivered_fresh_finish_price_per_yds, delivered_reject_finish_price_per_yds
            FROM finish_delivery_form
            WHERE dispo_number = ?
            ORDER BY finish_delivery_date ASC
        `, [dispoNumber]);
        
        // Create CSV content
        let csvContent = `FINISH FABRIC STOCK REPORT - ${dispoNumber}\n`;
        csvContent += `Generated: ${new Date().toLocaleString()}\n\n`;
        
        // Receive Section
        csvContent += `FINISH RECEIVE TRANSACTIONS\n`;
        csvContent += `Date,Challan No,A-Grade (Yds),B-Grade (Yds),C-Grade (Yds),Reject (Yds),Price/Yds\n`;
        
        let totalReceiveA = 0, totalReceiveB = 0, totalReceiveC = 0, totalReceiveReject = 0;
        
        receiveTransactions.forEach(txn => {
            totalReceiveA += parseFloat(txn.receive_qty_a_grade) || 0;
            totalReceiveB += parseFloat(txn.receive_qty_b_grade) || 0;
            totalReceiveC += parseFloat(txn.receive_qty_c_grade) || 0;
            totalReceiveReject += parseFloat(txn.receive_qty_reject) || 0;
            
            csvContent += `${txn.finish_receive_date},${txn.challan_no || ''},${txn.receive_qty_a_grade || 0},${txn.receive_qty_b_grade || 0},${txn.receive_qty_c_grade || 0},${txn.receive_qty_reject || 0},${txn.finish_fabric_price_per_yds || 0}\n`;
        });
        
        const totalReceive = totalReceiveA + totalReceiveB + totalReceiveC + totalReceiveReject;
        csvContent += `TOTAL,,${totalReceiveA.toFixed(2)},${totalReceiveB.toFixed(2)},${totalReceiveC.toFixed(2)},${totalReceiveReject.toFixed(2)},\n\n`;
        
        // Delivery Section
        csvContent += `FINISH DELIVERY TRANSACTIONS\n`;
        csvContent += `Date,Challan No,Fresh Qty (Yds),Reject Qty (Yds),Fresh Price/Yds,Reject Price/Yds\n`;
        
        let totalDeliveryFresh = 0, totalDeliveryReject = 0;
        
        deliveryTransactions.forEach(txn => {
            totalDeliveryFresh += parseFloat(txn.delivered_finish_qty_fresh_yds) || 0;
            totalDeliveryReject += parseFloat(txn.delivered_finish_qty_reject_yds) || 0;
            
            csvContent += `${txn.finish_delivery_date},${txn.challan_no || ''},${txn.delivered_finish_qty_fresh_yds || 0},${txn.delivered_finish_qty_reject_yds || 0},${txn.delivered_fresh_finish_price_per_yds || 0},${txn.delivered_reject_finish_price_per_yds || 0}\n`;
        });
        
        const totalDelivery = totalDeliveryFresh + totalDeliveryReject;
        csvContent += `TOTAL,,${totalDeliveryFresh.toFixed(2)},${totalDeliveryReject.toFixed(2)},,\n\n`;
        
        // Summary Section
        const closingBalance = totalReceive - totalDelivery;
        const rejectStock = totalReceiveReject - totalDeliveryReject;
        const freshStock = closingBalance - (rejectStock > 0 ? rejectStock : 0);
        
        csvContent += `SUMMARY\n`;
        csvContent += `Total Finish Receive (Yds),${totalReceive.toFixed(2)}\n`;
        csvContent += `Total Finish Delivery (Yds),${totalDelivery.toFixed(2)}\n`;
        csvContent += `Closing Balance (Yds),${closingBalance.toFixed(2)}\n`;
        csvContent += `Total Reject Stock (Yds),${(rejectStock > 0 ? rejectStock : 0).toFixed(2)}\n`;
        csvContent += `Fresh Stock (Yds),${(freshStock > 0 ? freshStock : 0).toFixed(2)}\n`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="finish_stock_report_${dispoNumber}_${Date.now()}.csv"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Error exporting finish fabric stock report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export finish fabric stock report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH FINISH FABRIC STOCK WITH FILTERS ==========
app.post('/main/api/finish-stock-report/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            dispo_number,
            buyer,
            production_construction,
            min_balance,
            max_balance
        } = req.body;

        let query = `
            SELECT 
                r.dispo_number,
                r.buyer,
                r.production_construction,
                SUM(COALESCE(r.receive_qty_a_grade, 0)) as total_receive_a_grade,
                SUM(COALESCE(r.receive_qty_b_grade, 0)) as total_receive_b_grade,
                SUM(COALESCE(r.receive_qty_c_grade, 0)) as total_receive_c_grade,
                SUM(COALESCE(r.receive_qty_reject, 0)) as total_receive_reject,
                (SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                 SUM(COALESCE(r.receive_qty_reject, 0))) as total_receive,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                  SUM(COALESCE(r.receive_qty_reject, 0))) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM finish_receive_form r
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivered_finish_qty_fresh_yds, 0) + 
                        COALESCE(delivered_finish_qty_reject_yds, 0)) as total_delivery
                FROM finish_delivery_form
                GROUP BY dispo_number
            ) d ON r.dispo_number = d.dispo_number
            WHERE r.dispo_number IS NOT NULL AND r.dispo_number != ''
        `;
        
        const params = [];

        if (dispo_number) {
            query += ' AND r.dispo_number LIKE ?';
            params.push(`%${dispo_number}%`);
        }

        if (buyer) {
            query += ' AND r.buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (production_construction) {
            query += ' AND r.production_construction LIKE ?';
            params.push(`%${production_construction}%`);
        }

        query += ' GROUP BY r.dispo_number, r.buyer, r.production_construction, d.total_delivery';
        
        if (min_balance !== undefined && min_balance !== '') {
            query += ' HAVING closing_balance >= ?';
            params.push(parseFloat(min_balance));
        }
        
        if (max_balance !== undefined && max_balance !== '') {
            if (min_balance !== undefined && min_balance !== '') {
                query += ' AND closing_balance <= ?';
            } else {
                query += ' HAVING closing_balance <= ?';
            }
            params.push(parseFloat(max_balance));
        }

        query += ' ORDER BY closing_balance DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching finish fabric stock:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search finish fabric stock',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET LOW STOCK ALERTS FOR FINISH FABRIC ==========
app.get('/main/api/finish-stock-report/low-stock-alerts', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const threshold = req.query.threshold || 100;
        
        const [records] = await connection.query(`
            SELECT 
                r.dispo_number,
                r.buyer,
                r.production_construction,
                (SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                 SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                 SUM(COALESCE(r.receive_qty_reject, 0))) as total_receive,
                COALESCE(d.total_delivery, 0) as total_delivery,
                ((SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                  SUM(COALESCE(r.receive_qty_reject, 0))) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM finish_receive_form r
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivered_finish_qty_fresh_yds, 0) + 
                        COALESCE(delivered_finish_qty_reject_yds, 0)) as total_delivery
                FROM finish_delivery_form
                GROUP BY dispo_number
            ) d ON r.dispo_number = d.dispo_number
            WHERE r.dispo_number IS NOT NULL AND r.dispo_number != ''
            GROUP BY r.dispo_number, r.buyer, r.production_construction, d.total_delivery
            HAVING closing_balance > 0 AND closing_balance <= ?
            ORDER BY closing_balance ASC
        `, [threshold]);
        
        res.json({
            success: true,
            threshold: threshold,
            count: records.length,
            alerts: records
        });
        
    } catch (error) {
        console.error('Error fetching finish stock low alerts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch low stock alerts',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET FINISH STOCK STATISTICS ==========
app.get('/main/api/finish-stock-report/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Total receive by grade
        const [totalReceive] = await connection.query(`
            SELECT 
                SUM(receive_qty_a_grade) as total_a_grade,
                SUM(receive_qty_b_grade) as total_b_grade,
                SUM(receive_qty_c_grade) as total_c_grade,
                SUM(receive_qty_reject) as total_reject,
                COUNT(DISTINCT dispo_number) as dispo_count
            FROM finish_receive_form
        `);
        
        // Total delivery
        const [totalDelivery] = await connection.query(`
            SELECT 
                SUM(delivered_finish_qty_fresh_yds) as total_fresh,
                SUM(delivered_finish_qty_reject_yds) as total_reject,
                COUNT(DISTINCT dispo_number) as dispo_count
            FROM finish_delivery_form
        `);
        
        // Top 10 dispos by stock
        const [topDispos] = await connection.query(`
            SELECT 
                r.dispo_number,
                r.buyer,
                ((SUM(COALESCE(r.receive_qty_a_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_b_grade, 0)) + 
                  SUM(COALESCE(r.receive_qty_c_grade, 0)) +
                  SUM(COALESCE(r.receive_qty_reject, 0))) - COALESCE(d.total_delivery, 0)) as closing_balance
            FROM finish_receive_form r
            LEFT JOIN (
                SELECT 
                    dispo_number,
                    SUM(COALESCE(delivered_finish_qty_fresh_yds, 0) + 
                        COALESCE(delivered_finish_qty_reject_yds, 0)) as total_delivery
                FROM finish_delivery_form
                GROUP BY dispo_number
            ) d ON r.dispo_number = d.dispo_number
            WHERE r.dispo_number IS NOT NULL AND r.dispo_number != ''
            GROUP BY r.dispo_number, r.buyer, d.total_delivery
            ORDER BY closing_balance DESC
            LIMIT 10
        `);
        
        // Monthly receive trend (last 6 months)
        const [monthlyReceiveTrend] = await connection.query(`
            SELECT 
                DATE_FORMAT(finish_receive_date, '%Y-%m') as month,
                SUM(COALESCE(receive_qty_a_grade, 0) + 
                    COALESCE(receive_qty_b_grade, 0) + 
                    COALESCE(receive_qty_c_grade, 0) +
                    COALESCE(receive_qty_reject, 0)) as total_receive
            FROM finish_receive_form
            WHERE finish_receive_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(finish_receive_date, '%Y-%m')
            ORDER BY month DESC
        `);
        
        // Monthly delivery trend (last 6 months)
        const [monthlyDeliveryTrend] = await connection.query(`
            SELECT 
                DATE_FORMAT(finish_delivery_date, '%Y-%m') as month,
                SUM(COALESCE(delivered_finish_qty_fresh_yds, 0) + 
                    COALESCE(delivered_finish_qty_reject_yds, 0)) as total_delivery
            FROM finish_delivery_form
            WHERE finish_delivery_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(finish_delivery_date, '%Y-%m')
            ORDER BY month DESC
        `);
        
        // Calculate totals
        const receiveTotal = (parseFloat(totalReceive[0].total_a_grade) || 0) + 
                            (parseFloat(totalReceive[0].total_b_grade) || 0) + 
                            (parseFloat(totalReceive[0].total_c_grade) || 0) +
                            (parseFloat(totalReceive[0].total_reject) || 0);
        
        const deliveryTotal = (parseFloat(totalDelivery[0].total_fresh) || 0) + 
                             (parseFloat(totalDelivery[0].total_reject) || 0);
        
        res.json({
            success: true,
            statistics: {
                total_finish_receive: receiveTotal,
                total_finish_delivery: deliveryTotal,
                overall_closing_balance: receiveTotal - deliveryTotal,
                receive_dispo_count: totalReceive[0].dispo_count,
                delivery_dispo_count: totalDelivery[0].dispo_count,
                grade_breakdown: {
                    receive: {
                        a_grade: parseFloat(totalReceive[0].total_a_grade) || 0,
                        b_grade: parseFloat(totalReceive[0].total_b_grade) || 0,
                        c_grade: parseFloat(totalReceive[0].total_c_grade) || 0,
                        reject: parseFloat(totalReceive[0].total_reject) || 0
                    },
                    delivery: {
                        fresh: parseFloat(totalDelivery[0].total_fresh) || 0,
                        reject: parseFloat(totalDelivery[0].total_reject) || 0
                    }
                },
                top_dispos: topDispos,
                monthly_receive_trend: monthlyReceiveTrend,
                monthly_delivery_trend: monthlyDeliveryTrend
            }
        });
        
    } catch (error) {
        console.error('Error fetching finish stock statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch finish stock statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DEBUG: CHECK ALL DISPO NUMBERS IN FINISH TABLES ==========
app.get('/main/api/finish-stock-report/debug-dispos', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get all from finish receive
        const [receiveAll] = await connection.query(`
            SELECT id, dispo_number, buyer, production_construction, created_at
            FROM finish_receive_form 
            ORDER BY created_at DESC
        `);
        
        // Get all from finish delivery
        const [deliveryAll] = await connection.query(`
            SELECT id, dispo_number, buyer, production_construction, created_at
            FROM finish_delivery_form 
            ORDER BY created_at DESC
        `);
        
        // Get distinct from receive
        const [receiveDistinct] = await connection.query(`
            SELECT DISTINCT dispo_number FROM finish_receive_form WHERE dispo_number IS NOT NULL
        `);
        
        // Get distinct from delivery
        const [deliveryDistinct] = await connection.query(`
            SELECT DISTINCT dispo_number FROM finish_delivery_form WHERE dispo_number IS NOT NULL
        `);
        
        res.json({
            finish_receive_form: {
                total_records: receiveAll.length,
                distinct_dispos: receiveDistinct.length,
                all_records: receiveAll,
                distinct_dispo_numbers: receiveDistinct.map(r => r.dispo_number)
            },
            finish_delivery_form: {
                total_records: deliveryAll.length,
                distinct_dispos: deliveryDistinct.length,
                all_records: deliveryAll,
                distinct_dispo_numbers: deliveryDistinct.map(r => r.dispo_number)
            }
        });
        
    } catch (error) {
        console.error('Error in finish stock debug endpoint:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// ORDER CLOSING REPORT — SERVER SCRIPT (CORRECTED)
// Changes from previous version:
//   1. yarn_wastage = leftover_yarn_kgs raw KG from warping_form
//      (removed percentage calculation)
//   2. fabric_rejection removed from fetch-from-dispo and
//      getFabricRejection helper — now computed client-side
//      from timeline totals
//   3. Production column values (prod_warp/sizing/loom/greige/
//      delivery) derived from timeline in applyServerDerivedFields
//      — unchanged, already correct
// =====================================================

// ---------- UNIT CONSTANTS ----------
const M_TO_YD = 1.093613;
const YD_TO_M = 0.9144;

// =====================================================
// HELPERS
// =====================================================

const nullIfEmpty = v =>
    (v === '' || v === undefined || v === null) ? null : v;

function toNum(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).trim().replace(/%$/, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

function toStrNum(n, decimals = 2) {
    const x = Number.isFinite(n) ? n : 0;
    return decimals === null ? String(x) : x.toFixed(decimals);
}

function pct(production, required, cap100 = false) {
    const p = toNum(production);
    const r = toNum(required);
    if (r <= 0) return '0';
    let val = (p / r) * 100;
    if (cap100) val = Math.min(val, 100);
    return String(Math.round(val));
}

function sumTimeline(timelineData, key) {
    if (!Array.isArray(timelineData)) return 0;
    return timelineData.reduce((s, r) => s + toNum(r?.[key]), 0);
}

// =====================================================
// DISPO POSITION CALCULATORS
// =====================================================

function calcDispoPosition({
    balanceWarp, requiredSizing, balanceSizing,
    prodLoom, balanceLoom, balanceGreige, balanceDelivery
}) {
    if (balanceWarp > 0)      return 'Warping Running';
    if (requiredSizing === 0) return 'No Need to Sizing';
    if (balanceSizing > 0)    return 'Sizing Running';
    if (prodLoom === 0)       return 'Wait for Weaving';
    if (balanceLoom > 0)      return 'Weaving Running';
    if (balanceGreige > 0)    return 'Folding Production Running';
    if (balanceDelivery > 0)  return 'Delivery Running';
    return 'Delivery Complete';
}

function calcRowDispoPositions({
    balanceWarp, requiredSizing, balanceSizing,
    prodLoom, balanceLoom, balanceGreige, balanceDelivery
}) {
    return {
        warp: balanceWarp > 0 ? 'Warping Running' : 'Warping Complete',
        sizing: requiredSizing === 0
            ? 'No Need to Sizing'
            : balanceSizing > 0 ? 'Sizing Running' : 'Sizing Complete',
        loom: prodLoom === 0
            ? 'Wait for Weaving'
            : balanceLoom > 0 ? 'Weaving Running' : 'Weaving Complete',
        greige: balanceGreige > 0 ? 'Folding Production Running' : 'Grey Complete',
        delivery: balanceDelivery > 0 ? 'Delivery Running' : 'Delivery Complete'
    };
}

// =====================================================
// SERVER-AUTHORITATIVE DERIVED FIELD CALCULATOR
// =====================================================

function applyServerDerivedFields(f, timelineData) {
    const out = { ...f };

    const reqWarpYarn    = toNum(out.required_warp_yarn);
    const reqWeftYarn    = toNum(out.required_weft_yarn);
    const reqWarpLenM    = toNum(out.required_warp_length);
    const reqSizingLenM  = toNum(out.required_sizing_length);
    const reqLoomM       = toNum(out.required_loom_production);
    const reqGreigeM     = toNum(out.required_greige_production);
    const reqDeliveryYds = toNum(out.delivery_yds);

    const hasTimeline = Array.isArray(timelineData) && timelineData.length > 0;

    if (hasTimeline) {
        const warpProdM      = sumTimeline(timelineData, 'warping_qty_mtr');
        const sizingProdM    = sumTimeline(timelineData, 'sizing_qty_mtr');
        const loomProdYds    = sumTimeline(timelineData, 'loom_production_qty_yds');
        const foldingProdYds = sumTimeline(timelineData, 'total_folding');
        const deliveryProdYds= sumTimeline(timelineData, 'total_delivered_qty');

        const loomProdM   = loomProdYds    * YD_TO_M;
        const greigeProdM = foldingProdYds * YD_TO_M;

        out.prod_warp_length       = toStrNum(warpProdM,       2);
        out.prod_sizing_length     = toStrNum(sizingProdM,     2);
        out.prod_loom_production   = toStrNum(loomProdM,       2);
        out.prod_greige_production = toStrNum(greigeProdM,     2);
        out.prod_delivery          = toStrNum(deliveryProdYds, 2);

        out.prod_yds_1 = toStrNum(warpProdM    * M_TO_YD, 2);
        out.prod_yds_2 = toStrNum(sizingProdM  * M_TO_YD, 2);
        out.prod_yds_3 = toStrNum(loomProdYds,             2);
        out.prod_yds_4 = toStrNum(foldingProdYds,          2);
        out.prod_yds_5 = toStrNum(deliveryProdYds,         2);

        // FIX 2: fabric_rejection computed server-side on save/update from timeline
        // Formula: (Σ folding_cut_pcs × 100) / Σ total_folding
        const totalCutPcs    = sumTimeline(timelineData, 'folding_cut_pcs');
        const totalFolding   = sumTimeline(timelineData, 'total_folding');
        out.fabric_rejection = totalFolding > 0
            ? toStrNum((totalCutPcs / totalFolding) * 100, 2) + '%'
            : '0.00%';
    }

    const issuedWarp = toNum(out.total_yarn_issue_warp);
    const issuedWeft = toNum(out.total_yarn_issue_weft);
    out.balance_warp = toStrNum(reqWarpYarn - issuedWarp, 2);
    out.balance_weft = toStrNum(reqWeftYarn - issuedWeft, 2);

    const prodWarpM    = toNum(out.prod_warp_length);
    const prodSizingM  = toNum(out.prod_sizing_length);
    const prodLoomM    = toNum(out.prod_loom_production);
    const prodGreigeM  = toNum(out.prod_greige_production);
    const prodDelYds   = toNum(out.prod_delivery);

    out.balance_warp_length       = toStrNum(reqWarpLenM   - prodWarpM,   2);
    out.balance_sizing_length     = toStrNum(reqSizingLenM - prodSizingM, 2);
    out.balance_loom_production   = toStrNum(reqLoomM      - prodLoomM,   2);
    out.balance_greige_production = toStrNum(reqGreigeM    - prodGreigeM, 2);
    out.balance_delivery          = toStrNum(reqDeliveryYds - prodDelYds, 2);

    out.completion_warp     = pct(prodWarpM,   reqWarpLenM,   true);
    out.completion_sizing   = pct(prodSizingM, reqSizingLenM, true);
    out.completion_loom     = pct(prodLoomM,   reqLoomM,      false);
    out.completion_greige   = pct(prodGreigeM, reqGreigeM,    false);
    out.completion_delivery = pct(prodDelYds,  reqDeliveryYds,false);

    const fresh = toNum(out.stock_greige_fresh);
    const rej   = toNum(out.stock_greige_reject);
    const floor = toNum(out.prod_floor_return);
    out.stock_greige_balance = toStrNum(fresh + rej - floor, 2);

    const dpArgs = {
        balanceWarp:     toNum(out.balance_warp_length),
        requiredSizing:  toNum(out.required_sizing_length),
        balanceSizing:   toNum(out.balance_sizing_length),
        prodLoom:        toNum(out.prod_loom_production),
        balanceLoom:     toNum(out.balance_loom_production),
        balanceGreige:   toNum(out.balance_greige_production),
        balanceDelivery: toNum(out.balance_delivery)
    };

    const rowPos  = calcRowDispoPositions(dpArgs);
    const overall = calcDispoPosition(dpArgs);

    out.dispo_warp     = rowPos.warp;
    out.dispo_sizing   = rowPos.sizing;
    out.dispo_loom     = rowPos.loom;
    out.dispo_greige   = rowPos.greige;
    out.dispo_delivery = rowPos.delivery;

    out.__dispo_position = overall;
    out.__row_positions  = rowPos;

    return out;
}

// =====================================================
// CLIENT ID ALIAS MAP
// =====================================================

function addClientIdAliases(payload) {
    const p = { ...payload };

    const alias = {
        po_no:                      'poNo',
        customer_ref:               'customerRef',
        order_type:                 'orderType',
        beneficiary_factory:        'beneficiaryFactory',
        fabric_type:                'fabricType',
        po_issue_date:              'poIssueDate',
        warp_consumption:           'warpConsumption',
        fabric_price_per_yd:        'fabricPricePerYd',
        bulk_delivery_date:         'bulkDeliveryDate',
        production_construction:    'productionConstruction',
        fabric_composition:         'fabricComposition',
        po_quantity:                'poQuantity',
        dispo_quantity:             'dispoQuantity',
        adjust_quantity:            'adjustQuantity',
        finishing_loss:             'finishingLoss',
        printing_allowance:         'printingAllowance',
        weft_consumption:           'weftConsumption',
        yarn_cost_per_yd:           'yarnCostPerYd',
        order_no:                   'orderNo',
        account_holder:             'accountHolder',
        loom_contraction:           'loomContraction',
        beam_crimp:                 'beamCrimp',
        finish_width:               'finishWidth',
        grey_width:                 'greyWidth',
        total_ends:                 'totalEnds',
        total_consumption:          'totalConsumption',
        material_cost:              'materialCost',
        document_status:            'documentStatus',
        buyer_colorway:             'buyerColorway',
        buyer_color_reference:      'buyerColorway',
        color:                      'buyerColorway',

        required_warp_yarn:         'requiredWarpYarn',
        total_yarn_issue_warp:      'totalYarnIssueWarp',
        balance_warp:               'balanceWarp',
        required_warp_length:       'requiredWarpLength',
        prod_warp_length:           'prodWarpLength',
        balance_warp_length:        'balanceWarpLength',
        completion_warp:            'completionWarp',
        dispo_warp:                 'dispoWarp',
        prod_yds_1:                 'prodYds1',

        required_weft_yarn:         'requiredWeftYarn',
        total_yarn_issue_weft:      'totalYarnIssueWeft',
        balance_weft:               'balanceWeft',
        required_sizing_length:     'requiredSizingLength',
        prod_sizing_length:         'prodSizingLength',
        balance_sizing_length:      'balanceSizingLength',
        completion_sizing:          'completionSizing',
        dispo_sizing:               'dispoSizing',
        prod_yds_2:                 'prodYds2',

        actual_crimp:               'actualCrimp',
        prod_floor_return:          'prodFloorReturn',
        required_loom_production:   'requiredLoomProduction',
        prod_loom_production:       'prodLoomProduction',
        balance_loom_production:    'balanceLoomProduction',
        completion_loom:            'completionLoom',
        dispo_loom:                 'dispoLoom',
        prod_yds_3:                 'prodYds3',

        yarn_wastage:               'yarnWastage',
        stock_greige_fresh:         'stockGreigeFresh',
        required_greige_production: 'requiredGreigeProduction',
        prod_greige_production:     'prodGreigeProduction',
        balance_greige_production:  'balanceGreigeProduction',
        completion_greige:          'completionGreige',
        dispo_greige:               'dispoGreige',
        prod_yds_4:                 'prodYds4',

        fabric_rejection:           'fabricRejection',
        stock_greige_reject:        'stockGreigeReject',
        delivery_yds:               'deliveryYds',
        prod_delivery:              'prodDelivery',
        balance_delivery:           'balanceDelivery',
        completion_delivery:        'completionDelivery',
        dispo_delivery:             'dispoDelivery',
        prod_yds_5:                 'prodYds5',

        stock_greige_balance:       'stockGreigeBalance'
    };

    for (const [snake, camel] of Object.entries(alias)) {
        if (p[snake] !== undefined && p[camel] === undefined) {
            p[camel] = p[snake];
        }
    }

    if (p.__dispo_position !== undefined) {
        p.dispo_position = p.__dispo_position;
        delete p.__dispo_position;
    }
    if (p.__row_positions !== undefined) {
        p.row_positions = p.__row_positions;
        delete p.__row_positions;
    }

    return p;
}

// =====================================================
// HELPER: Yarn issue totals for a dispo number
// =====================================================
async function getYarnIssueTotals(connection, dispoNumber) {
    try {
        const [rows] = await connection.execute(
            `SELECT
                COALESCE(SUM(total_warp_issue_kgs), 0) AS total_warp_issue_kgs,
                COALESCE(SUM(total_weft_issue_kgs), 0) AS total_weft_issue_kgs
             FROM yarn_issue_form
             WHERE received_against_dispo_nos = ?
                OR received_against_dispo_nos LIKE ?
                OR received_against_dispo_nos LIKE ?
                OR received_against_dispo_nos LIKE ?`,
            [
                dispoNumber,
                `${dispoNumber},%`,
                `%,${dispoNumber},%`,
                `%,${dispoNumber}`
            ]
        );
        return {
            total_warp_issue_kgs: toNum(rows[0]?.total_warp_issue_kgs),
            total_weft_issue_kgs: toNum(rows[0]?.total_weft_issue_kgs)
        };
    } catch (e) {
        console.warn('yarn_issue_form fetch failed:', e.message);
        return { total_warp_issue_kgs: 0, total_weft_issue_kgs: 0 };
    }
}

// =====================================================
// 1) SEARCH RECORDS
// =====================================================
app.get('/main/api/order-closing-report/search-records', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT
                id, po_no, order_no, buyer, dispo_quantity,
                DATE_FORMAT(po_issue_date,     '%Y-%m-%d') AS po_issue_date,
                DATE_FORMAT(bulk_delivery_date,'%Y-%m-%d') AS bulk_delivery_date,
                document_status, created_at
            FROM order_closing_reports
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json(records);
    } catch (err) {
        console.error('search-records error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch records', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 2) DISPO NUMBERS
// =====================================================
app.get('/main/api/order-closing-report/dispo-numbers', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        const [tableCheck] = await connection.query(`SHOW TABLES LIKE 'dispo_form_data'`);
        if (tableCheck.length === 0) return res.json([]);

        const [rows] = await connection.query(`
            SELECT
                dispo_number, po_no, buyer_name, production_construction,
                finish_qty_yds AS dispo_quantity, created_at
            FROM dispo_form_data
            WHERE dispo_number IS NOT NULL AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json(rows);
    } catch (err) {
        console.error('dispo-numbers error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dispo numbers', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 3) FETCH FROM DISPO — pre-populate form
//    CORRECTED:
//      - yarn_wastage = raw leftover_yarn_kgs from warping_form
//      - fabric_rejection removed (now computed client-side)
//      - buyer_colorway from dispo.buyer_color_reference
//      - total_yarn_issue_warp/weft from yarn_issue_form
// =====================================================
app.get('/main/api/order-closing-report/fetch-from-dispo/:dispo_number', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = req.params.dispo_number;

        const [dispoData] = await connection.execute(
            `SELECT *,
                DATE_FORMAT(po_issue_date,     '%Y-%m-%d') AS po_issue_date,
                DATE_FORMAT(bulk_delivery_date,'%Y-%m-%d') AS bulk_delivery_date,
                DATE_FORMAT(pp_delivery_date,  '%Y-%m-%d') AS pp_delivery_date
             FROM dispo_form_data
             WHERE dispo_number = ?`,
            [dispoNumber]
        );
        if (dispoData.length === 0) {
            return res.status(404).json({ success: false, message: 'Dispo data not found' });
        }
        const dispo = dispoData[0];

        // ── Warp / weft yarn requirements (Grey KG only) ─────────
        const [warpYarnDetails] = await connection.execute(
            'SELECT grey_qty_kg FROM warp_yarn_details WHERE dispo_number = ?',
            [dispoNumber]
        );
        const [weftYarnDetails] = await connection.execute(
            'SELECT grey_qty_kg FROM weft_yarn_details WHERE dispo_number = ?',
            [dispoNumber]
        );
        const totalWarpGrey = warpYarnDetails.reduce((s, r) => s + toNum(r.grey_qty_kg), 0);
        const totalWeftGrey = weftYarnDetails.reduce((s, r) => s + toNum(r.grey_qty_kg), 0);

        // ── Required sizing length ────────────────────────────────
        let requiredSizingLength = toNum(dispo.warp_beam_length);
        try {
            const [sizingData] = await connection.execute(
                `SELECT required_sizing_length_mtr
                 FROM sizing_form
                 WHERE dispo_number = ?
                 ORDER BY created_at DESC LIMIT 1`,
                [dispoNumber]
            );
            if (sizingData.length > 0 && sizingData[0].required_sizing_length_mtr != null) {
                requiredSizingLength = toNum(sizingData[0].required_sizing_length_mtr);
            }
        } catch (e) {
            console.warn('sizing_form fetch failed, using warp_beam_length fallback:', e.message);
        }

        // ── FIX 1: Yarn wastage = raw leftover_yarn_kgs from warping_form ──
        // (NOT a percentage — the raw KG value is returned directly)
        let yarnWastage = '0';
        try {
            const [warpingData] = await connection.execute(
                `SELECT leftover_yarn_kgs FROM warping_form
                 WHERE dispo_number = ?
                 ORDER BY created_at DESC LIMIT 1`,
                [dispoNumber]
            );
            if (warpingData.length > 0 && warpingData[0].leftover_yarn_kgs != null) {
                yarnWastage = toStrNum(toNum(warpingData[0].leftover_yarn_kgs), 2);
            }
        } catch (e) {
            console.warn('warping_form fetch failed:', e.message);
        }

        // ── Yarn issue totals (warp + weft) from yarn_issue_form ──
        const yarnIssueTotals = await getYarnIssueTotals(connection, dispoNumber);

        // ── Buyer colorway from dispo.buyer_color_reference ───────
        const buyerColorway = dispo.buyer_color_reference || '';

        // ── Derived display values ────────────────────────────────
        const actualCrimp = dispo.lower_beam_crimp != null
            ? `${toNum(dispo.lower_beam_crimp).toFixed(2)}%`
            : '0.00%';

        const fabricPricePerYd = dispo.pc_upcharge_price_usd || '0';
        const yarnCostPerYd    = dispo.pc_raw_yarn_cost_usd  || '0';

        const materialCost = (dispo.pc_total_consumption != null && dispo.pc_total_consumption !== '')
            ? `${toNum(dispo.pc_total_consumption).toFixed(2)}%`
            : '0.00%';

        // ── Build mappedData ──────────────────────────────────────
        let mappedData = {
            // Order Details
            po_no:                   dispo.po_no                   || '',
            buyer:                   dispo.buyer_name              || '',
            customer_ref:            dispo.buyer_style_ref         || '',
            weave:                   dispo.weave_type              || '',
            order_type:              dispo.order_type              || 'bulk',
            beneficiary_factory:     dispo.account_holder          || '',
            fabric_type:             dispo.fabric_type             || '',
            po_issue_date:           dispo.po_issue_date           || '',
            warp_consumption:        dispo.warp_consumption_yds    || '0',
            fabric_price_per_yd:     fabricPricePerYd,
            bulk_delivery_date:      dispo.bulk_delivery_date      || '',
            production_construction: dispo.production_construction || '',
            fabric_composition:      dispo.fabric_composition      || '',
            po_quantity:             dispo.po_qty_yds              || '0',
            dispo_quantity:          dispo.finish_qty_yds          || '0',
            adjust_quantity:         dispo.adjust_qty_yds          || '0',
            finishing_loss:          dispo.finishing_process_loss  || '0',
            printing_allowance:      dispo.print_allowance         || '0',
            weft_consumption:        dispo.weft_consumption_yds    || '0',
            yarn_cost_per_yd:        yarnCostPerYd,
            order_no:                dispo.order_no                || '',
            account_holder:          dispo.account_holder          || '',
            loom_contraction:        dispo.loom_contraction != null
                                         ? `${toNum(dispo.loom_contraction).toFixed(2)}%`
                                         : '0.00%',
            beam_crimp:              dispo.lower_beam_crimp        || '0',
            finish_width:            dispo.dispo_cuttable_width    || '0',
            grey_width:              dispo.grey_width_inch         || '0',
            total_ends:              dispo.beam_total_ends         || '0',
            total_consumption:       dispo.total_consumption_yds   || '0',
            material_cost:           materialCost,

            // Required production metrics
            required_warp_yarn:         toStrNum(totalWarpGrey,                    2),
            required_weft_yarn:         toStrNum(totalWeftGrey,                    2),
            required_warp_length:       toStrNum(toNum(dispo.warp_beam_length),    2),
            required_sizing_length:     toStrNum(requiredSizingLength,             2),
            required_loom_production:   toStrNum(toNum(dispo.loom_production_mtr), 2),
            required_greige_production: toStrNum(toNum(dispo.grey_qty_mtr),        2),
            delivery_yds:               toStrNum(toNum(dispo.finish_qty_yds),      2),

            // Yarn issued from yarn_issue_form
            total_yarn_issue_warp:   toStrNum(yarnIssueTotals.total_warp_issue_kgs, 2),
            total_yarn_issue_weft:   toStrNum(yarnIssueTotals.total_weft_issue_kgs, 2),

            // Buyer colorway from dispo.buyer_color_reference
            color:          buyerColorway,
            buyer_colorway: buyerColorway,

            // FIX 1: yarn_wastage is raw leftover_yarn_kgs (KG value, not a %)
            yarn_wastage: yarnWastage,

            // FIX 2: fabric_rejection is NOT set here — computed client-side
            // from timeline totals after loadProductionTimelineFromModules runs.
            // Initialise to '0.00%' so the field is not blank before timeline loads.
            fabric_rejection: '0.00%',

            actual_crimp: actualCrimp,

            // Production actuals — derived from timeline; start at zero
            prod_warp_length:        '0',
            prod_sizing_length:      '0',
            prod_loom_production:    '0',
            prod_greige_production:  '0',
            prod_delivery:           '0',
            prod_floor_return:       '0',

            // Stock greige — manual input
            stock_greige_fresh:      '0',
            stock_greige_reject:     '0',

            // Placeholders (all recomputed after timeline loads)
            balance_warp:            '0',
            balance_weft:            '0',
            balance_warp_length:     '0',
            balance_sizing_length:   '0',
            balance_loom_production: '0',
            balance_greige_production:'0',
            balance_delivery:        '0',
            completion_warp:         '0',
            completion_sizing:       '0',
            completion_loom:         '0',
            completion_greige:       '0',
            completion_delivery:     '0',
            dispo_warp:              '0',
            dispo_sizing:            '0',
            dispo_loom:              '0',
            dispo_greige:            '0',
            dispo_delivery:          '0',
            prod_yds_1:              '0',
            prod_yds_2:              '0',
            prod_yds_3:              '0',
            prod_yds_4:              '0',
            prod_yds_5:              '0',
            stock_greige_balance:    '0',
            document_status:         'pending'
        };

        // Compute server-side derived fields (no timeline on first load)
        mappedData = applyServerDerivedFields(mappedData, []);

        const responseData = addClientIdAliases(mappedData);

        res.json({
            success: true,
            data: responseData,
            source: {
                dispo_number:   dispoNumber,
                po_no:          dispo.po_no,
                total_warp_qty: totalWarpGrey,
                total_weft_qty: totalWeftGrey,
                warp_issued_kg: yarnIssueTotals.total_warp_issue_kgs,
                weft_issued_kg: yarnIssueTotals.total_weft_issue_kgs,
                buyer_colorway: buyerColorway,
                yarn_wastage:   yarnWastage
            }
        });

    } catch (err) {
        console.error('fetch-from-dispo error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dispo data', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 4) PRODUCTION TIMELINE FROM MODULES (by dispo_number)
// =====================================================
app.get('/main/api/order-closing-report/production-timeline/:dispo_number', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    const dispoNumber = req.params.dispo_number;
    let connection;
    try {
        connection = await pool.getConnection();

        const [yarnReceived] = await connection.query(
            `SELECT
                DATE_FORMAT(rd.received_date,'%Y-%m-%d') AS yarn_received_date,
                GROUP_CONCAT(DISTINCT yrf.yarn_count ORDER BY yrf.yarn_count SEPARATOR ',') AS yarn_count_received,
                GROUP_CONCAT(DISTINCT yrf.yarn_ply   ORDER BY yrf.yarn_ply   SEPARATOR ',') AS yarn_ply_received,
                SUM(COALESCE(rd.quantity_kgs,0)) AS yarn_received_qty
             FROM yarn_received_details rd
             JOIN yarn_receive_form yrf ON yrf.id = rd.yarn_receive_form_id
             WHERE rd.dispo_number = ?
             GROUP BY rd.received_date
             ORDER BY rd.received_date ASC`,
            [dispoNumber]
        );

        const [yarnIssue] = await connection.query(
            `SELECT
                DATE_FORMAT(yid.issue_date,'%Y-%m-%d') AS yarn_issue_date,
                GROUP_CONCAT(DISTINCT yif.yarn_count ORDER BY yif.yarn_count SEPARATOR ',') AS yarn_count_issue,
                GROUP_CONCAT(DISTINCT yif.yarn_ply   ORDER BY yif.yarn_ply   SEPARATOR ',') AS yarn_ply_issue,
                SUM(COALESCE(yid.issued_quantity,0)) AS yarn_issue_qty
             FROM yarn_issue_details yid
             JOIN yarn_issue_form yif ON yif.id = yid.yarn_issue_form_id
             WHERE yid.dispo_number = ?
             GROUP BY yid.issue_date
             ORDER BY yid.issue_date ASC`,
            [dispoNumber]
        );

        const [warping] = await connection.query(
            `SELECT
                DATE_FORMAT(wb.warping_date,'%Y-%m-%d') AS warping_date,
                SUM(COALESCE(wb.warping_length_mtr,0)) AS warping_qty_mtr
             FROM warping_breakdown wb
             WHERE wb.dispo_number = ?
             GROUP BY wb.warping_date
             ORDER BY wb.warping_date ASC`,
            [dispoNumber]
        );

        const [sizing] = await connection.query(
            `SELECT
                DATE_FORMAT(sb.sizing_date,'%Y-%m-%d') AS sizing_date,
                SUM(COALESCE(sb.sizing_qty_mtr,0)) AS sizing_qty_mtr
             FROM sizing_breakdown sb
             WHERE sb.dispo_number = ?
             GROUP BY sb.sizing_date
             ORDER BY sb.sizing_date ASC`,
            [dispoNumber]
        );

        const [loomProd] = await connection.query(
            `SELECT
                DATE_FORMAT(lpb.loom_production_date,'%Y-%m-%d') AS loom_production_date,
                CASE
                    WHEN MAX(COALESCE(lpb.run_loom,0)) > 0 THEN MAX(COALESCE(lpb.run_loom,0))
                    ELSE COUNT(DISTINCT lpf.loom_no)
                END AS run_loom,
                SUM(COALESCE(lpb.loom_production_quantity_yds,0)) AS loom_production_qty_yds
             FROM loom_production_breakdown lpb
             JOIN loom_production_form lpf ON lpf.id = lpb.loom_production_id
             WHERE lpb.dispo_number = ?
             GROUP BY lpb.loom_production_date
             ORDER BY lpb.loom_production_date ASC`,
            [dispoNumber]
        );

        const [folding] = await connection.query(
            `SELECT
                DATE_FORMAT(fpf.folding_production_date,'%Y-%m-%d') AS folding_production_date,
                SUM(COALESCE(fpf.a_grade_mtr,0))            AS folding_a_grade,
                SUM(COALESCE(fpf.b_grade_mtr,0))            AS folding_b_grade,
                SUM(COALESCE(fpf.c_grade_mtr,0))            AS folding_c_grade,
                SUM(COALESCE(fpf.reject_c_grade_mtr,0))     AS folding_cut_pcs,
                SUM(
                    COALESCE(fpf.a_grade_mtr,0) +
                    COALESCE(fpf.b_grade_mtr,0) +
                    COALESCE(fpf.c_grade_mtr,0) +
                    COALESCE(fpf.reject_c_grade_mtr,0)
                ) AS total_folding
             FROM folding_production_form fpf
             WHERE fpf.dispo_number = ?
             GROUP BY fpf.folding_production_date
             ORDER BY fpf.folding_production_date ASC`,
            [dispoNumber]
        );

        const [delivery] = await connection.query(
            `SELECT
                DATE_FORMAT(fdf.finish_delivery_date,'%Y-%m-%d') AS delivery_date,
                GROUP_CONCAT(DISTINCT fdf.challan_no ORDER BY fdf.challan_no SEPARATOR ',') AS challan_no,
                SUM(COALESCE(fdf.total_no_of_than_roll,0))                    AS total_than_roll,
                SUM(COALESCE(fdf.delivered_finish_qty_fresh_yds,0))           AS delivery_a_grade,
                SUM(COALESCE(fdf.delivered_finish_qty_reject_yds,0))          AS delivery_b_grade,
                SUM(
                    COALESCE(fdf.delivered_finish_qty_fresh_yds,0) +
                    COALESCE(fdf.delivered_finish_qty_reject_yds,0)
                ) AS total_delivered_qty
             FROM finish_delivery_form fdf
             WHERE fdf.dispo_number = ?
             GROUP BY fdf.finish_delivery_date
             ORDER BY fdf.finish_delivery_date ASC`,
            [dispoNumber]
        );

        const toMap = (rows, key) => {
            const m = {};
            for (const r of rows) { if (r[key]) m[r[key]] = r; }
            return m;
        };

        const yr = toMap(yarnReceived, 'yarn_received_date');
        const yi = toMap(yarnIssue,    'yarn_issue_date');
        const w  = toMap(warping,      'warping_date');
        const s  = toMap(sizing,       'sizing_date');
        const lp = toMap(loomProd,     'loom_production_date');
        const f  = toMap(folding,      'folding_production_date');
        const d  = toMap(delivery,     'delivery_date');

        const dateSet = new Set([
            ...Object.keys(yr), ...Object.keys(yi), ...Object.keys(w), ...Object.keys(s),
            ...Object.keys(lp), ...Object.keys(f),  ...Object.keys(d)
        ]);
        const dates = Array.from(dateSet).sort();

        const emptyRow = () => ({
            yarn_received_date: null, yarn_count_received: '', yarn_ply_received: '', yarn_received_qty: 0,
            yarn_issue_date:    null, yarn_count_issue:    '', yarn_ply_issue:    '', yarn_issue_qty:    0,
            warping_date:       null, warping_qty_mtr:     0,
            sizing_date:        null, sizing_qty_mtr:      0,
            loom_production_date: null, run_loom: 0, loom_production_qty_yds: 0,
            folding_production_date: null,
            folding_a_grade: 0, folding_b_grade: 0, folding_c_grade: 0,
            folding_cut_pcs: 0, total_folding:   0, special_note:    '',
            delivery_date:   null, challan_no: '', total_than_roll: 0,
            delivery_a_grade: 0, delivery_b_grade: 0, total_delivered_qty: 0
        });

        const timeline = [];

        if (dates.length === 0) {
            timeline.push(emptyRow());
        } else {
            for (const dt of dates) {
                const row = emptyRow();

                if (yr[dt]) {
                    row.yarn_received_date  = dt;
                    row.yarn_count_received = yr[dt].yarn_count_received || '';
                    row.yarn_ply_received   = yr[dt].yarn_ply_received   || '';
                    row.yarn_received_qty   = Number(yr[dt].yarn_received_qty || 0);
                }
                if (yi[dt]) {
                    row.yarn_issue_date  = dt;
                    row.yarn_count_issue = yi[dt].yarn_count_issue || '';
                    row.yarn_ply_issue   = yi[dt].yarn_ply_issue   || '';
                    row.yarn_issue_qty   = Number(yi[dt].yarn_issue_qty || 0);
                }
                if (w[dt]) {
                    row.warping_date    = dt;
                    row.warping_qty_mtr = Number(w[dt].warping_qty_mtr || 0);
                }
                if (s[dt]) {
                    row.sizing_date    = dt;
                    row.sizing_qty_mtr = Number(s[dt].sizing_qty_mtr || 0);
                }
                if (lp[dt]) {
                    row.loom_production_date    = dt;
                    row.run_loom                = Number(lp[dt].run_loom || 0);
                    row.loom_production_qty_yds = Number(lp[dt].loom_production_qty_yds || 0);
                }
                if (f[dt]) {
                    row.folding_production_date = dt;
                    row.folding_a_grade = Number(f[dt].folding_a_grade || 0);
                    row.folding_b_grade = Number(f[dt].folding_b_grade || 0);
                    row.folding_c_grade = Number(f[dt].folding_c_grade || 0);
                    row.folding_cut_pcs = Number(f[dt].folding_cut_pcs || 0);
                    row.total_folding   = Number(f[dt].total_folding   || 0);
                }
                if (d[dt]) {
                    row.delivery_date        = dt;
                    row.challan_no           = d[dt].challan_no           || '';
                    row.total_than_roll      = Number(d[dt].total_than_roll      || 0);
                    row.delivery_a_grade     = Number(d[dt].delivery_a_grade     || 0);
                    row.delivery_b_grade     = Number(d[dt].delivery_b_grade     || 0);
                    row.total_delivered_qty  = Number(d[dt].total_delivered_qty  || 0);
                }

                timeline.push(row);
            }
        }

        res.json({ success: true, dispo_number: dispoNumber, timeline });

    } catch (err) {
        console.error('production-timeline error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch production timeline',
            error: err.message,
            details: err.sqlMessage || err.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// SHARED HELPER — insert production timeline rows
// =====================================================
async function insertTimeline(connection, reportId, timelineData) {
    if (!timelineData || timelineData.length === 0) return;

    const sql = `
        INSERT INTO production_timeline (
            order_report_id,
            yarn_received_date, yarn_count_received, yarn_ply_received, yarn_received_qty,
            yarn_issue_date, yarn_count_issue, yarn_ply_issue, yarn_issue_qty,
            warping_date, warping_qty_mtr,
            sizing_date, sizing_qty_mtr,
            loom_production_date, run_loom, loom_production_qty_yds,
            folding_production_date, folding_a_grade, folding_b_grade, folding_c_grade,
            folding_cut_pcs, total_folding, special_note,
            delivery_date, challan_no, total_than_roll,
            delivery_a_grade, delivery_b_grade, total_delivered_qty,
            created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`;

    for (const t of timelineData) {
        await connection.execute(sql, [
            reportId,
            nullIfEmpty(t.yarn_received_date),  nullIfEmpty(t.yarn_count_received), nullIfEmpty(t.yarn_ply_received), nullIfEmpty(t.yarn_received_qty),
            nullIfEmpty(t.yarn_issue_date),     nullIfEmpty(t.yarn_count_issue),    nullIfEmpty(t.yarn_ply_issue),    nullIfEmpty(t.yarn_issue_qty),
            nullIfEmpty(t.warping_date),        nullIfEmpty(t.warping_qty_mtr),
            nullIfEmpty(t.sizing_date),         nullIfEmpty(t.sizing_qty_mtr),
            nullIfEmpty(t.loom_production_date),nullIfEmpty(t.run_loom),            nullIfEmpty(t.loom_production_qty_yds),
            nullIfEmpty(t.folding_production_date), nullIfEmpty(t.folding_a_grade), nullIfEmpty(t.folding_b_grade),
            nullIfEmpty(t.folding_c_grade),     nullIfEmpty(t.folding_cut_pcs),     nullIfEmpty(t.total_folding),
            nullIfEmpty(t.special_note),
            nullIfEmpty(t.delivery_date),       nullIfEmpty(t.challan_no),          nullIfEmpty(t.total_than_roll),
            nullIfEmpty(t.delivery_a_grade),    nullIfEmpty(t.delivery_b_grade),    nullIfEmpty(t.total_delivered_qty)
        ]);
    }
}

// =====================================================
// SHARED HELPER — normalize order_type & buyer_colorway
// =====================================================
function normalizeFormFields(f) {
    // buyer_colorway: accept legacy field names
    if (!f.buyer_colorway) {
        f.buyer_colorway = f.color ?? f.buyer_color_reference ?? null;
    }
    // order_type: safe enum values
    if (typeof f.order_type === 'string') {
        const ot = f.order_type.trim().toLowerCase();
        if (ot.includes('sample'))     f.order_type = 'sample';
        else if (ot.includes('bulk'))  f.order_type = 'bulk';
    }
    return f;
}

// =====================================================
// 5) SAVE
// =====================================================
app.post('/main/api/order-closing-report/save', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData: rawF, timelineData } = req.body;
        let f = applyServerDerivedFields(rawF || {}, timelineData || []);
        f = normalizeFormFields(f);

        const [result] = await connection.execute(
            `INSERT INTO order_closing_reports (
                po_no, buyer, customer_ref, weave, order_type, beneficiary_factory, fabric_type,
                po_issue_date, warp_consumption, fabric_price_per_yd,
                bulk_delivery_date, production_construction, fabric_composition, po_quantity,
                dispo_quantity, adjust_quantity, finishing_loss, printing_allowance,
                weft_consumption, yarn_cost_per_yd,
                order_no, account_holder, loom_contraction, beam_crimp, finish_width,
                grey_width, total_ends, document_upload, total_consumption, material_cost,

                required_warp_yarn, total_yarn_issue_warp, balance_warp,
                required_warp_length, prod_warp_length, balance_warp_length,
                completion_warp, dispo_warp, prod_yds_1,

                required_weft_yarn, total_yarn_issue_weft, balance_weft,
                required_sizing_length, prod_sizing_length, balance_sizing_length,
                completion_sizing, dispo_sizing, prod_yds_2,

                actual_crimp, prod_floor_return, required_loom_production, prod_loom_production,
                balance_loom_production, completion_loom, dispo_loom, prod_yds_3,

                yarn_wastage, stock_greige_fresh, required_greige_production, prod_greige_production,
                balance_greige_production, completion_greige, dispo_greige, prod_yds_4,

                fabric_rejection, stock_greige_reject, delivery_yds, prod_delivery,
                balance_delivery, completion_delivery, dispo_delivery, prod_yds_5,

                buyer_colorway, stock_greige_balance, document_status,
                created_at, updated_at
            ) VALUES (
                ?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,?,?,?,?,?,?,
                ?,?,?,NOW(),NOW()
            )`,
            [
                nullIfEmpty(f.po_no),               nullIfEmpty(f.buyer),                nullIfEmpty(f.customer_ref),
                nullIfEmpty(f.weave),               nullIfEmpty(f.order_type),           nullIfEmpty(f.beneficiary_factory),
                nullIfEmpty(f.fabric_type),         nullIfEmpty(f.po_issue_date),        nullIfEmpty(f.warp_consumption),
                nullIfEmpty(f.fabric_price_per_yd),
                nullIfEmpty(f.bulk_delivery_date),  nullIfEmpty(f.production_construction), nullIfEmpty(f.fabric_composition),
                nullIfEmpty(f.po_quantity),         nullIfEmpty(f.dispo_quantity),       nullIfEmpty(f.adjust_quantity),
                nullIfEmpty(f.finishing_loss),      nullIfEmpty(f.printing_allowance),   nullIfEmpty(f.weft_consumption),
                nullIfEmpty(f.yarn_cost_per_yd),
                nullIfEmpty(f.order_no),            nullIfEmpty(f.account_holder),       nullIfEmpty(f.loom_contraction),
                nullIfEmpty(f.beam_crimp),          nullIfEmpty(f.finish_width),         nullIfEmpty(f.grey_width),
                nullIfEmpty(f.total_ends),          nullIfEmpty(f.document_upload),      nullIfEmpty(f.total_consumption),
                nullIfEmpty(f.material_cost),

                nullIfEmpty(f.required_warp_yarn),  nullIfEmpty(f.total_yarn_issue_warp), nullIfEmpty(f.balance_warp),
                nullIfEmpty(f.required_warp_length),nullIfEmpty(f.prod_warp_length),     nullIfEmpty(f.balance_warp_length),
                nullIfEmpty(f.completion_warp),     nullIfEmpty(f.dispo_warp),           nullIfEmpty(f.prod_yds_1),

                nullIfEmpty(f.required_weft_yarn),  nullIfEmpty(f.total_yarn_issue_weft), nullIfEmpty(f.balance_weft),
                nullIfEmpty(f.required_sizing_length), nullIfEmpty(f.prod_sizing_length), nullIfEmpty(f.balance_sizing_length),
                nullIfEmpty(f.completion_sizing),   nullIfEmpty(f.dispo_sizing),         nullIfEmpty(f.prod_yds_2),

                nullIfEmpty(f.actual_crimp),        nullIfEmpty(f.prod_floor_return),    nullIfEmpty(f.required_loom_production),
                nullIfEmpty(f.prod_loom_production),nullIfEmpty(f.balance_loom_production), nullIfEmpty(f.completion_loom),
                nullIfEmpty(f.dispo_loom),          nullIfEmpty(f.prod_yds_3),

                nullIfEmpty(f.yarn_wastage),        nullIfEmpty(f.stock_greige_fresh),   nullIfEmpty(f.required_greige_production),
                nullIfEmpty(f.prod_greige_production), nullIfEmpty(f.balance_greige_production), nullIfEmpty(f.completion_greige),
                nullIfEmpty(f.dispo_greige),        nullIfEmpty(f.prod_yds_4),

                nullIfEmpty(f.fabric_rejection),    nullIfEmpty(f.stock_greige_reject),  nullIfEmpty(f.delivery_yds),
                nullIfEmpty(f.prod_delivery),       nullIfEmpty(f.balance_delivery),     nullIfEmpty(f.completion_delivery),
                nullIfEmpty(f.dispo_delivery),      nullIfEmpty(f.prod_yds_5),

                nullIfEmpty(f.buyer_colorway),      nullIfEmpty(f.stock_greige_balance), nullIfEmpty(f.document_status)
            ]
        );

        const reportId = result.insertId;
        await insertTimeline(connection, reportId, timelineData);
        await connection.commit();
        res.json({ success: true, message: 'Order closing report saved successfully', id: reportId });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('save error:', err);
        res.status(500).json({ success: false, message: 'Failed to save order closing report', error: err.message, details: err.sqlMessage || err.toString() });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 6) UPDATE
// =====================================================
app.put('/main/api/order-closing-report/update/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const reportId = req.params.id;
        const { formData: rawF, timelineData } = req.body;
        let f = applyServerDerivedFields(rawF || {}, timelineData || []);
        f = normalizeFormFields(f);

        await connection.execute(
            `UPDATE order_closing_reports SET
                po_no=?, buyer=?, customer_ref=?, weave=?, order_type=?,
                beneficiary_factory=?, fabric_type=?, po_issue_date=?,
                warp_consumption=?, fabric_price_per_yd=?,
                bulk_delivery_date=?, production_construction=?, fabric_composition=?,
                po_quantity=?, dispo_quantity=?, adjust_quantity=?,
                finishing_loss=?, printing_allowance=?, weft_consumption=?,
                yarn_cost_per_yd=?, order_no=?, account_holder=?,
                loom_contraction=?, beam_crimp=?, finish_width=?,
                grey_width=?, total_ends=?, document_upload=?,
                total_consumption=?, material_cost=?,
                required_warp_yarn=?, total_yarn_issue_warp=?, balance_warp=?,
                required_warp_length=?, prod_warp_length=?, balance_warp_length=?,
                completion_warp=?, dispo_warp=?, prod_yds_1=?,
                required_weft_yarn=?, total_yarn_issue_weft=?, balance_weft=?,
                required_sizing_length=?, prod_sizing_length=?, balance_sizing_length=?,
                completion_sizing=?, dispo_sizing=?, prod_yds_2=?,
                actual_crimp=?, prod_floor_return=?, required_loom_production=?,
                prod_loom_production=?, balance_loom_production=?, completion_loom=?,
                dispo_loom=?, prod_yds_3=?,
                yarn_wastage=?, stock_greige_fresh=?, required_greige_production=?,
                prod_greige_production=?, balance_greige_production=?, completion_greige=?,
                dispo_greige=?, prod_yds_4=?,
                fabric_rejection=?, stock_greige_reject=?, delivery_yds=?,
                prod_delivery=?, balance_delivery=?, completion_delivery=?,
                dispo_delivery=?, prod_yds_5=?,
                buyer_colorway=?, stock_greige_balance=?, document_status=?,
                updated_at=NOW()
             WHERE id=?`,
            [
                nullIfEmpty(f.po_no),               nullIfEmpty(f.buyer),                nullIfEmpty(f.customer_ref),
                nullIfEmpty(f.weave),               nullIfEmpty(f.order_type),           nullIfEmpty(f.beneficiary_factory),
                nullIfEmpty(f.fabric_type),         nullIfEmpty(f.po_issue_date),        nullIfEmpty(f.warp_consumption),
                nullIfEmpty(f.fabric_price_per_yd),
                nullIfEmpty(f.bulk_delivery_date),  nullIfEmpty(f.production_construction), nullIfEmpty(f.fabric_composition),
                nullIfEmpty(f.po_quantity),         nullIfEmpty(f.dispo_quantity),       nullIfEmpty(f.adjust_quantity),
                nullIfEmpty(f.finishing_loss),      nullIfEmpty(f.printing_allowance),   nullIfEmpty(f.weft_consumption),
                nullIfEmpty(f.yarn_cost_per_yd),
                nullIfEmpty(f.order_no),            nullIfEmpty(f.account_holder),       nullIfEmpty(f.loom_contraction),
                nullIfEmpty(f.beam_crimp),          nullIfEmpty(f.finish_width),         nullIfEmpty(f.grey_width),
                nullIfEmpty(f.total_ends),          nullIfEmpty(f.document_upload),      nullIfEmpty(f.total_consumption),
                nullIfEmpty(f.material_cost),

                nullIfEmpty(f.required_warp_yarn),  nullIfEmpty(f.total_yarn_issue_warp), nullIfEmpty(f.balance_warp),
                nullIfEmpty(f.required_warp_length),nullIfEmpty(f.prod_warp_length),     nullIfEmpty(f.balance_warp_length),
                nullIfEmpty(f.completion_warp),     nullIfEmpty(f.dispo_warp),           nullIfEmpty(f.prod_yds_1),

                nullIfEmpty(f.required_weft_yarn),  nullIfEmpty(f.total_yarn_issue_weft), nullIfEmpty(f.balance_weft),
                nullIfEmpty(f.required_sizing_length), nullIfEmpty(f.prod_sizing_length), nullIfEmpty(f.balance_sizing_length),
                nullIfEmpty(f.completion_sizing),   nullIfEmpty(f.dispo_sizing),         nullIfEmpty(f.prod_yds_2),

                nullIfEmpty(f.actual_crimp),        nullIfEmpty(f.prod_floor_return),    nullIfEmpty(f.required_loom_production),
                nullIfEmpty(f.prod_loom_production),nullIfEmpty(f.balance_loom_production), nullIfEmpty(f.completion_loom),
                nullIfEmpty(f.dispo_loom),          nullIfEmpty(f.prod_yds_3),

                nullIfEmpty(f.yarn_wastage),        nullIfEmpty(f.stock_greige_fresh),   nullIfEmpty(f.required_greige_production),
                nullIfEmpty(f.prod_greige_production), nullIfEmpty(f.balance_greige_production), nullIfEmpty(f.completion_greige),
                nullIfEmpty(f.dispo_greige),        nullIfEmpty(f.prod_yds_4),

                nullIfEmpty(f.fabric_rejection),    nullIfEmpty(f.stock_greige_reject),  nullIfEmpty(f.delivery_yds),
                nullIfEmpty(f.prod_delivery),       nullIfEmpty(f.balance_delivery),     nullIfEmpty(f.completion_delivery),
                nullIfEmpty(f.dispo_delivery),      nullIfEmpty(f.prod_yds_5),

                nullIfEmpty(f.buyer_colorway),      nullIfEmpty(f.stock_greige_balance), nullIfEmpty(f.document_status),
                reportId
            ]
        );

        await connection.execute('DELETE FROM production_timeline WHERE order_report_id = ?', [reportId]);
        await insertTimeline(connection, reportId, timelineData);
        await connection.commit();
        res.json({ success: true, message: 'Order closing report updated successfully', id: reportId });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update order closing report', error: err.message, details: err.sqlMessage || err.toString() });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 7) FETCH BY ID — load saved record
// =====================================================
app.get('/main/api/order-closing-report/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        const reportId = req.params.id;

        const [reports] = await connection.execute(
            `SELECT
                id, po_no, buyer, customer_ref, weave, order_type, beneficiary_factory,
                fabric_type, DATE_FORMAT(po_issue_date,'%Y-%m-%d') AS po_issue_date,
                warp_consumption, fabric_price_per_yd,
                DATE_FORMAT(bulk_delivery_date,'%Y-%m-%d') AS bulk_delivery_date,
                production_construction, fabric_composition, po_quantity, dispo_quantity,
                adjust_quantity, finishing_loss, printing_allowance, weft_consumption,
                yarn_cost_per_yd, order_no, account_holder, loom_contraction, beam_crimp,
                finish_width, grey_width, total_ends, document_upload, total_consumption,
                material_cost,
                required_warp_yarn, total_yarn_issue_warp, balance_warp, required_warp_length,
                prod_warp_length, balance_warp_length, completion_warp, dispo_warp, prod_yds_1,
                required_weft_yarn, total_yarn_issue_weft, balance_weft, required_sizing_length,
                prod_sizing_length, balance_sizing_length, completion_sizing, dispo_sizing, prod_yds_2,
                actual_crimp, prod_floor_return, required_loom_production, prod_loom_production,
                balance_loom_production, completion_loom, dispo_loom, prod_yds_3,
                yarn_wastage, stock_greige_fresh, required_greige_production, prod_greige_production,
                balance_greige_production, completion_greige, dispo_greige, prod_yds_4,
                fabric_rejection, stock_greige_reject, delivery_yds, prod_delivery, balance_delivery,
                completion_delivery, dispo_delivery, prod_yds_5, buyer_colorway, stock_greige_balance,
                document_status, created_at, updated_at
             FROM order_closing_reports
             WHERE id = ?`,
            [reportId]
        );

        if (reports.length === 0) {
            return res.status(404).json({ success: false, message: 'Order closing report not found' });
        }

        const [timeline] = await connection.execute(
            `SELECT
                id,
                DATE_FORMAT(yarn_received_date,      '%Y-%m-%d') AS yarn_received_date,
                yarn_count_received, yarn_ply_received, yarn_received_qty,
                DATE_FORMAT(yarn_issue_date,         '%Y-%m-%d') AS yarn_issue_date,
                yarn_count_issue, yarn_ply_issue, yarn_issue_qty,
                DATE_FORMAT(warping_date,            '%Y-%m-%d') AS warping_date,
                warping_qty_mtr,
                DATE_FORMAT(sizing_date,             '%Y-%m-%d') AS sizing_date,
                sizing_qty_mtr,
                DATE_FORMAT(loom_production_date,    '%Y-%m-%d') AS loom_production_date,
                run_loom, loom_production_qty_yds,
                DATE_FORMAT(folding_production_date, '%Y-%m-%d') AS folding_production_date,
                folding_a_grade, folding_b_grade, folding_c_grade, folding_cut_pcs,
                total_folding, special_note,
                DATE_FORMAT(delivery_date,           '%Y-%m-%d') AS delivery_date,
                challan_no, total_than_roll, delivery_a_grade, delivery_b_grade, total_delivered_qty
             FROM production_timeline
             WHERE order_report_id = ?
             ORDER BY id ASC`,
            [reportId]
        );

        // Re-derive all computed fields from stored timeline on every load
        const computed = applyServerDerivedFields(reports[0], timeline);

        const responsePayload = addClientIdAliases({ ...computed, timeline });

        res.json(responsePayload);

    } catch (err) {
        console.error('fetch-by-id error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order closing report', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 8) DELETE
// =====================================================
app.delete('/main/api/order-closing-report/delete/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const reportId = req.params.id;
        await connection.execute('DELETE FROM production_timeline WHERE order_report_id = ?', [reportId]);

        const [result] = await connection.execute(
            'DELETE FROM order_closing_reports WHERE id = ?', [reportId]
        );
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Order closing report not found' });
        }

        await connection.commit();
        res.json({ success: true, message: 'Order closing report deleted successfully' });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete order closing report', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// 9) EXPORT TO CSV
// =====================================================
app.get('/main/api/order-closing-report/export-excel', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });

    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT
                ocr.*,
                DATE_FORMAT(ocr.po_issue_date,     '%Y-%m-%d')          AS po_issue_date,
                DATE_FORMAT(ocr.bulk_delivery_date,'%Y-%m-%d')          AS bulk_delivery_date,
                DATE_FORMAT(ocr.created_at,        '%Y-%m-%d %H:%i:%s') AS created_at
             FROM order_closing_reports ocr
             ORDER BY ocr.created_at DESC`
        );

        const csvHeader = [
            'ID','PO No','Buyer','Customer Ref','Weave','Order Type','Beneficiary Factory','Fabric Type',
            'PO Issue Date','Warp Consumption','Fabric Price/Yd','Bulk Delivery Date',
            'Production Construction','Fabric Composition','PO Quantity','Dispo Quantity',
            'Adjust Quantity','Finishing Loss','Printing Allowance','Weft Consumption','Yarn Cost/Yd',
            'Order No','Account Holder','Loom Contraction','Beam Crimp','Finish Width','Grey Width',
            'Total Ends','Total Consumption','Material Cost',
            'Req Warp Yarn','Issued Warp','Balance Warp','Req Warp Length','Prod Warp Length',
            'Bal Warp Length','Comp Warp','Dispo Warp','Prod Yds 1',
            'Req Weft Yarn','Issued Weft','Balance Weft','Req Sizing Length','Prod Sizing Length',
            'Bal Sizing Length','Comp Sizing','Dispo Sizing','Prod Yds 2',
            'Actual Crimp','Prod Floor Return','Req Loom Prod','Prod Loom','Bal Loom',
            'Comp Loom','Dispo Loom','Prod Yds 3',
            'Yarn Wastage (KG)','Stock Greige Fresh','Req Greige Prod','Prod Greige','Bal Greige',
            'Comp Greige','Dispo Greige','Prod Yds 4',
            'Fabric Rejection%','Stock Greige Reject','Delivery Yds','Prod Delivery','Bal Delivery',
            'Comp Delivery','Dispo Delivery','Prod Yds 5',
            'Buyer Colorway','Stock Greige Balance','Document Status','Created At'
        ].join(',') + '\n';

        const escapeCSV = v => {
            if (v == null) return '';
            const s = String(v);
            return (s.includes(',') || s.includes('"') || s.includes('\n'))
                ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const csvRows = records.map(r => [
            r.id, r.po_no, r.buyer, r.customer_ref, r.weave, r.order_type, r.beneficiary_factory,
            r.fabric_type, r.po_issue_date, r.warp_consumption, r.fabric_price_per_yd, r.bulk_delivery_date,
            r.production_construction, r.fabric_composition, r.po_quantity, r.dispo_quantity,
            r.adjust_quantity, r.finishing_loss, r.printing_allowance, r.weft_consumption, r.yarn_cost_per_yd,
            r.order_no, r.account_holder, r.loom_contraction, r.beam_crimp, r.finish_width, r.grey_width,
            r.total_ends, r.total_consumption, r.material_cost,
            r.required_warp_yarn, r.total_yarn_issue_warp, r.balance_warp, r.required_warp_length,
            r.prod_warp_length, r.balance_warp_length, r.completion_warp, r.dispo_warp, r.prod_yds_1,
            r.required_weft_yarn, r.total_yarn_issue_weft, r.balance_weft, r.required_sizing_length,
            r.prod_sizing_length, r.balance_sizing_length, r.completion_sizing, r.dispo_sizing, r.prod_yds_2,
            r.actual_crimp, r.prod_floor_return, r.required_loom_production, r.prod_loom_production,
            r.balance_loom_production, r.completion_loom, r.dispo_loom, r.prod_yds_3,
            r.yarn_wastage, r.stock_greige_fresh, r.required_greige_production, r.prod_greige_production,
            r.balance_greige_production, r.completion_greige, r.dispo_greige, r.prod_yds_4,
            r.fabric_rejection, r.stock_greige_reject, r.delivery_yds, r.prod_delivery,
            r.balance_delivery, r.completion_delivery, r.dispo_delivery, r.prod_yds_5,
            r.buyer_colorway, r.stock_greige_balance, r.document_status, r.created_at
        ].map(escapeCSV).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="order_closing_reports_${Date.now()}.csv"`);
        res.send(csvHeader + csvRows);

    } catch (err) {
        console.error('export error:', err);
        res.status(500).json({ success: false, message: 'Failed to export', error: err.message });
    } finally {
        if (connection) connection.release();
    }
});


// =====================================================
// DAILY LOG REPORT - API ENDPOINTS
// =====================================================

// ========== FETCH DISPO NUMBERS FOR DAILY LOG DROPDOWN ==========
app.get('/main/api/daily-log-report/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Fetch from loom_production_form
        const [logRecords] = await connection.query(`
            SELECT DISTINCT
                TRIM(dispo_number) as dispo_number,
                buyer,
                po_number,
                production_construction as fabric_construction,
                created_at
            FROM loom_production_form
            WHERE dispo_number IS NOT NULL
              AND TRIM(dispo_number) != ''
            ORDER BY created_at DESC
        `);

        console.log(`Found ${logRecords.length} dispo numbers from loom_production_form`);
        
        // Merge and deduplicate
        const dispoMap = new Map();
        
        logRecords.forEach(record => {
            const key = record.dispo_number.trim();
            if (key && !dispoMap.has(key)) {
                dispoMap.set(key, {
                    dispo_number: key,
                    buyer: record.buyer || null,
                    po_number: record.po_number || null,
                    fabric_construction: record.fabric_construction || null
                });
            } else if (key && dispoMap.has(key)) {
                const existing = dispoMap.get(key);
                if (!existing.buyer && record.buyer) {
                    existing.buyer = record.buyer;
                }
                if (!existing.po_number && record.po_number) {
                    existing.po_number = record.po_number;
                }
                if (!existing.fabric_construction && record.fabric_construction) {
                    existing.fabric_construction = record.fabric_construction;
                }
            }
        });
        
        // Convert map to array and sort
        const results = Array.from(dispoMap.values()).sort((a, b) => {
            return b.dispo_number.localeCompare(a.dispo_number);
        });
        
        console.log('DAILY_LOG_DISPO_NUMBERS', `Total unique dispo numbers: ${results.length}`);
        
        res.json(results);
        
    } catch (error) {
        console.error('Error fetching dispo numbers for daily log report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DAILY LOG REPORT BY DISPO NUMBER ==========
app.get('/main/api/daily-log-report/by-dispo/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        console.log(`Fetching daily log report for dispo: ${dispoNumber}`);
        
        // ========================================
        // 1. Fetch all daily log entries for this dispo
        // ========================================
        const [logEntries] = await connection.query(`
            SELECT
                lpf.id,
                lpf.dispo_number AS dispo_no,
                lpf.po_number AS po_no,
                lpf.buyer,
                lpf.production_construction AS fabric_construction,
                lpf.cuttable_width_inch AS finish_width,
                lpf.fabric_composition,
                lpf.weave AS weave_design,
                lpf.beam_total_ends AS total_ends,
                lpf.reed_count,
                lpf.customer_ref AS order_reference,
                DATE_FORMAT(lpf.beam_start_date, '%Y-%m-%d') AS beam_start_date,
                NULL AS beam_start_time,
                lpf.loom_no,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_run,
                lpf.created_at
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.dispo_number = ?
            GROUP BY lpf.id
            ORDER BY lpf.beam_start_date ASC
        `, [dispoNumber]);
        
        console.log(`Found ${logEntries.length} log entries for dispo ${dispoNumber}`);
        
        if (logEntries.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No daily log entries found for this dispo number'
            });
        }
        
        // ========================================
        // 2. Calculate grand total of runs
        // ========================================
        const grandTotal = logEntries.reduce((sum, entry) => {
            return sum + (parseInt(entry.total_run) || 0);
        }, 0);
        
        // ========================================
        // 3. Return response
        // ========================================
        res.json({
            success: true,
            dispo_number: dispoNumber,
            log_entries: logEntries,
            grand_total: grandTotal,
            entry_count: logEntries.length
        });
        
    } catch (error) {
        console.error('Error fetching daily log report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch daily log report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH ALL DAILY LOG SUMMARY ==========
app.get('/main/api/daily-log-report/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get summary for all dispos
        const [records] = await connection.query(`
            SELECT
                lpf.dispo_number AS dispo_no,
                lpf.buyer,
                lpf.po_number AS po_no,
                lpf.production_construction AS fabric_construction,
                COUNT(DISTINCT lpf.id) AS total_entries,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                MIN(lpf.beam_start_date) AS first_start_date,
                MAX(lpf.beam_start_date) AS last_start_date,
                GROUP_CONCAT(DISTINCT lpf.loom_no ORDER BY lpf.loom_no SEPARATOR ', ') AS looms_used
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.dispo_number IS NOT NULL AND lpf.dispo_number != ''
            GROUP BY lpf.dispo_number, lpf.buyer, lpf.po_number, lpf.production_construction
            ORDER BY last_start_date DESC
        `);
        
        res.json({
            success: true,
            count: records.length,
            records: records
        });
        
    } catch (error) {
        console.error('Error fetching daily log summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch daily log summary',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT DAILY LOG REPORT TO CSV ==========
app.get('/main/api/daily-log-report/export/:dispoNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = decodeURIComponent(req.params.dispoNumber);
        
        // Fetch log entries
        const [logEntries] = await connection.query(`
            SELECT
                lpf.dispo_number AS dispo_no,
                lpf.po_number AS po_no,
                lpf.buyer,
                lpf.production_construction AS fabric_construction,
                lpf.cuttable_width_inch AS finish_width,
                lpf.fabric_composition,
                lpf.weave AS weave_design,
                lpf.beam_total_ends AS total_ends,
                lpf.reed_count,
                lpf.customer_ref AS order_reference,
                DATE_FORMAT(lpf.beam_start_date, '%Y-%m-%d') AS beam_start_date,
                lpf.loom_no,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_run
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.dispo_number = ?
            GROUP BY lpf.id
            ORDER BY lpf.beam_start_date ASC
        `, [dispoNumber]);

        // Create CSV content
        let csvContent = `DAILY LOG REPORT - ${dispoNumber}\n`;
        csvContent += `Generated: ${new Date().toLocaleString()}\n\n`;

        // Headers
        csvContent += `Dispo No,PO NO,Buyer,Fabric Construction,Finish Width,Fabric Composition,Weave Design,Total Ends,Reed Count,Order Reference,Beam Start Date,Loom No,Total Run\n`;

        let grandTotal = 0;

        logEntries.forEach(entry => {
            const totalRun = parseFloat(entry.total_run) || 0;
            grandTotal += totalRun;

            csvContent += `${entry.dispo_no || ''},${entry.po_no || ''},${entry.buyer || ''},${entry.fabric_construction || ''},${entry.finish_width || ''},${entry.fabric_composition || ''},${entry.weave_design || ''},${entry.total_ends || ''},${entry.reed_count || ''},${entry.order_reference || ''},${entry.beam_start_date || ''},${entry.loom_no || ''},${totalRun}\n`;
        });
        
        // Grand total row
        csvContent += `\n,,,,,,,,,,,,,Grand Total,${grandTotal}\n`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="daily_log_report_${dispoNumber}_${Date.now()}.csv"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Error exporting daily log report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export daily log report',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SEARCH DAILY LOG WITH FILTERS ==========
app.post('/main/api/daily-log-report/search', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const {
            dispo_no,
            buyer,
            po_no,
            fabric_construction,
            loom_no,
            date_from,
            date_to
        } = req.body;

        let query = `
            SELECT
                lpf.dispo_number AS dispo_no,
                lpf.buyer,
                lpf.po_number AS po_no,
                lpf.production_construction AS fabric_construction,
                COUNT(DISTINCT lpf.id) AS total_entries,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                MIN(lpf.beam_start_date) AS first_start_date,
                MAX(lpf.beam_start_date) AS last_start_date,
                GROUP_CONCAT(DISTINCT lpf.loom_no ORDER BY lpf.loom_no SEPARATOR ', ') AS looms_used
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.dispo_number IS NOT NULL AND lpf.dispo_number != ''
        `;

        const params = [];

        if (dispo_no) {
            query += ' AND lpf.dispo_number LIKE ?';
            params.push(`%${dispo_no}%`);
        }

        if (buyer) {
            query += ' AND lpf.buyer LIKE ?';
            params.push(`%${buyer}%`);
        }

        if (po_no) {
            query += ' AND lpf.po_number LIKE ?';
            params.push(`%${po_no}%`);
        }

        if (fabric_construction) {
            query += ' AND lpf.production_construction LIKE ?';
            params.push(`%${fabric_construction}%`);
        }

        if (loom_no) {
            query += ' AND lpf.loom_no LIKE ?';
            params.push(`%${loom_no}%`);
        }

        if (date_from) {
            query += ' AND lpf.beam_start_date >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND lpf.beam_start_date <= ?';
            params.push(date_to);
        }

        query += ' GROUP BY lpf.dispo_number, lpf.buyer, lpf.po_number, lpf.production_construction';
        query += ' ORDER BY last_start_date DESC LIMIT 100';

        const [records] = await connection.query(query, params);

        res.json({
            success: true,
            count: records.length,
            records: records
        });

    } catch (error) {
        console.error('Error searching daily log:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search daily log',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET DAILY LOG BY DATE RANGE ==========
app.get('/main/api/daily-log-report/by-date-range', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const { date_from, date_to } = req.query;
        
        if (!date_from || !date_to) {
            return res.status(400).json({
                success: false,
                message: 'date_from and date_to are required'
            });
        }
        
        const [logEntries] = await connection.query(`
            SELECT
                lpf.id,
                lpf.dispo_number AS dispo_no,
                lpf.po_number AS po_no,
                lpf.buyer,
                lpf.production_construction AS fabric_construction,
                lpf.cuttable_width_inch AS finish_width,
                lpf.fabric_composition,
                lpf.weave AS weave_design,
                lpf.beam_total_ends AS total_ends,
                lpf.reed_count,
                lpf.customer_ref AS order_reference,
                DATE_FORMAT(lpf.beam_start_date, '%Y-%m-%d') AS beam_start_date,
                NULL AS beam_start_time,
                lpf.loom_no,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_run
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.beam_start_date BETWEEN ? AND ?
            GROUP BY lpf.id
            ORDER BY lpf.beam_start_date ASC
        `, [date_from, date_to]);
        
        const grandTotal = logEntries.reduce((sum, entry) => {
            return sum + (parseInt(entry.total_run) || 0);
        }, 0);
        
        res.json({
            success: true,
            date_from: date_from,
            date_to: date_to,
            log_entries: logEntries,
            grand_total: grandTotal,
            entry_count: logEntries.length
        });
        
    } catch (error) {
        console.error('Error fetching daily log by date range:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch daily log by date range',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET DAILY LOG STATISTICS ==========
app.get('/main/api/daily-log-report/statistics', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Total statistics
        const [totalStats] = await connection.query(`
            SELECT
                COUNT(DISTINCT lpf.id) AS total_entries,
                COUNT(DISTINCT lpf.dispo_number) AS total_dispos,
                COUNT(DISTINCT lpf.buyer) AS total_buyers,
                COUNT(DISTINCT lpf.loom_no) AS total_looms,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                MIN(lpf.beam_start_date) AS earliest_date,
                MAX(lpf.beam_start_date) AS latest_date
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
        `);

        // Top 10 dispos by total runs
        const [topDispos] = await connection.query(`
            SELECT
                lpf.dispo_number AS dispo_no,
                lpf.buyer,
                lpf.production_construction AS fabric_construction,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                COUNT(DISTINCT lpf.id) AS entry_count
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.dispo_number IS NOT NULL AND lpf.dispo_number != ''
            GROUP BY lpf.dispo_number, lpf.buyer, lpf.production_construction
            ORDER BY total_runs DESC
            LIMIT 10
        `);

        // Top looms by utilization
        const [topLooms] = await connection.query(`
            SELECT
                lpf.loom_no,
                COUNT(DISTINCT lpf.id) AS usage_count,
                COUNT(DISTINCT lpf.dispo_number) AS dispos_processed,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.loom_no IS NOT NULL AND lpf.loom_no != ''
            GROUP BY lpf.loom_no
            ORDER BY usage_count DESC
            LIMIT 10
        `);

        // Daily production trend (last 30 days)
        const [dailyTrend] = await connection.query(`
            SELECT
                DATE_FORMAT(lpf.beam_start_date, '%Y-%m-%d') AS date,
                COUNT(DISTINCT lpf.id) AS entry_count,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                COUNT(DISTINCT lpf.loom_no) AS looms_used
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.beam_start_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE_FORMAT(lpf.beam_start_date, '%Y-%m-%d')
            ORDER BY date DESC
        `);

        // Monthly production trend (last 6 months)
        const [monthlyTrend] = await connection.query(`
            SELECT
                DATE_FORMAT(lpf.beam_start_date, '%Y-%m') AS month,
                COUNT(DISTINCT lpf.id) AS entry_count,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                COUNT(DISTINCT lpf.dispo_number) AS dispos_processed,
                COUNT(DISTINCT lpf.loom_no) AS looms_used
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.beam_start_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(lpf.beam_start_date, '%Y-%m')
            ORDER BY month DESC
        `);

        // Buyer-wise statistics
        const [buyerStats] = await connection.query(`
            SELECT
                lpf.buyer,
                COUNT(DISTINCT lpf.dispo_number) AS total_dispos,
                COUNT(DISTINCT lpf.id) AS total_entries,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.buyer IS NOT NULL AND lpf.buyer != ''
            GROUP BY lpf.buyer
            ORDER BY total_runs DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            statistics: {
                overall: totalStats[0],
                top_dispos: topDispos,
                top_looms: topLooms,
                daily_trend: dailyTrend,
                monthly_trend: monthlyTrend,
                buyer_stats: buyerStats
            }
        });
        
    } catch (error) {
        console.error('Error fetching daily log statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch daily log statistics',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET LOOM UTILIZATION REPORT ==========
app.get('/main/api/daily-log-report/loom-utilization', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const { date_from, date_to } = req.query;
        
        let query = `
            SELECT
                lpf.loom_no,
                COUNT(DISTINCT lpf.id) AS total_entries,
                COUNT(DISTINCT lpf.dispo_number) AS dispos_processed,
                COUNT(DISTINCT lpf.buyer) AS buyers_served,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_runs,
                MIN(lpf.beam_start_date) AS first_use_date,
                MAX(lpf.beam_start_date) AS last_use_date,
                COALESCE(AVG(lpb.loom_production_quantity_yds), 0) AS avg_run_per_entry
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            WHERE lpf.loom_no IS NOT NULL AND lpf.loom_no != ''
        `;

        const params = [];

        if (date_from && date_to) {
            query += ' AND lpf.beam_start_date BETWEEN ? AND ?';
            params.push(date_from, date_to);
        }

        query += ' GROUP BY lpf.loom_no ORDER BY total_runs DESC';
        
        const [loomData] = await connection.query(query, params);
        
        res.json({
            success: true,
            date_from: date_from || null,
            date_to: date_to || null,
            loom_count: loomData.length,
            looms: loomData
        });
        
    } catch (error) {
        console.error('Error fetching loom utilization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch loom utilization',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DEBUG: CHECK ALL DAILY LOG ENTRIES ==========
app.get('/main/api/daily-log-report/debug-entries', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get all entries
        const [allEntries] = await connection.query(`
            SELECT
                lpf.id,
                lpf.dispo_number AS dispo_no,
                lpf.buyer,
                lpf.po_number AS po_no,
                lpf.production_construction AS fabric_construction,
                lpf.loom_no,
                COALESCE(SUM(lpb.loom_production_quantity_yds), 0) AS total_run,
                lpf.beam_start_date,
                lpf.created_at
            FROM loom_production_form lpf
            LEFT JOIN loom_production_breakdown lpb ON lpb.loom_production_id = lpf.id
            GROUP BY lpf.id
            ORDER BY lpf.created_at DESC
            LIMIT 100
        `);

        // Get distinct dispo numbers
        const [distinctDispos] = await connection.query(`
            SELECT DISTINCT dispo_number AS dispo_no
            FROM loom_production_form
            WHERE dispo_number IS NOT NULL
            ORDER BY dispo_number
        `);

        // Get distinct looms
        const [distinctLooms] = await connection.query(`
            SELECT DISTINCT loom_no
            FROM loom_production_form
            WHERE loom_no IS NOT NULL
            ORDER BY loom_no
        `);

        res.json({
            total_entries: allEntries.length,
            distinct_dispos: distinctDispos.length,
            distinct_looms: distinctLooms.length,
            recent_entries: allEntries,
            all_dispo_numbers: distinctDispos.map(r => r.dispo_no),
            all_looms: distinctLooms.map(r => r.loom_no)
        });
        
    } catch (error) {
        console.error('Error in daily log debug endpoint:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// DISPO WISE MAIN PLAN ENTRY FORM - API ENDPOINTS (PROPERLY CORRECTED)
// =====================================================

// ========== FETCH DISPO NUMBERS FOR SEARCH DROPDOWN ==========
app.get('/main/api/dispo-plan/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                dispo_no,
                po_no,
                buyer,
                production_construction,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                created_at
            FROM dispo_plan_form 
            WHERE dispo_no IS NOT NULL AND dispo_no != ''
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching dispo numbers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo numbers',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE DISPO PLAN RECORD (PROPERLY FIXED) ==========
app.post('/main/api/dispo-plan/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        const data = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        // PROPERLY FIXED: Removed created_at, updated_at from columns (they have defaults)
        // Removed reed_space (doesn't exist in schema)
        const [result] = await connection.execute(
            `INSERT INTO dispo_plan_form (
                po_issue_date, po_received_date, pp_sample_delivery_date,
                bulk_fabric_delivery_date, po_revised_date, bulk_revised_no,
                bulk_revised_reason, reproduction_revised_no, reproduction_revised_reason,
                po_no, pi_unit_lc_unit, order_no, account_holder, buyer,
                garments_name, customer_ref_stl, buyer_color_reference, weave,
                finish_type, marketing_reff_tracking_no, desk_loom_strike_off_no,
                end_use, order_type, yarn_type, fabric_type, process_type,
                print_method, dispo_no, sticker_construction, production_construction,
                sticker_composition, fabric_composition, finish_epi, finish_ppi,
                grey_epi, grey_ppi, po_quantity_yds, dispo_quantity_yds,
                adjust_quantity_yds, finishing_process_loss, printing_allowance,
                loom_construction, loom_contraction, lower_beam_crimp,
                left_selvedge_specification, right_selvedge_specification,
                selvedge_width, selvedge_ends_per_dent, total_ends_of_body,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                finish_width_inch, cuttable_width_inch, grey_width_inch,
                total_ends, no_of_section_in_lower_beam, creel_repeat_of_lower_beam,
                reed_count, ends_per_dent, reed_width_inch, flange_to_flange,
                warp_cover_factor, weft_cover_factor, total_cover_factor,
                warp_yarn_dyeing_allowance, weft_yarn_dyeing_allowance,
                warp_consumption, weft_consumption, total_consumption,
                rpm, eff, yarn_dyeing_lead_time, dyed_yarn_advance_days_for_inhouse,
                total_greige_lot, finishing_lead_time, final_loom_production_date,
                loom_start_date, start_up_days, per_day_run_loom_in_startup
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nullIfEmpty(data.po_issue_date),
                nullIfEmpty(data.po_received_date),
                nullIfEmpty(data.pp_sample_delivery_date),
                nullIfEmpty(data.bulk_fabric_delivery_date),
                nullIfEmpty(data.po_revised_date),
                nullIfEmpty(data.bulk_revised_no),
                nullIfEmpty(data.bulk_revised_reason),
                nullIfEmpty(data.reproduction_revised_no),
                nullIfEmpty(data.reproduction_revised_reason),
                nullIfEmpty(data.po_no),
                nullIfEmpty(data.pi_unit_lc_unit),
                nullIfEmpty(data.order_no),
                nullIfEmpty(data.account_holder),
                nullIfEmpty(data.buyer),
                nullIfEmpty(data.garments_name),
                nullIfEmpty(data.customer_ref_stl),
                nullIfEmpty(data.buyer_color_reference),
                nullIfEmpty(data.weave),
                nullIfEmpty(data.finish_type),
                nullIfEmpty(data.marketing_reff_tracking_no),
                nullIfEmpty(data.desk_loom_strike_off_no),
                nullIfEmpty(data.end_use),
                nullIfEmpty(data.order_type),
                nullIfEmpty(data.yarn_type),
                nullIfEmpty(data.fabric_type),
                nullIfEmpty(data.process_type),
                nullIfEmpty(data.print_method),
                nullIfEmpty(data.dispo_no),
                nullIfEmpty(data.sticker_construction),
                nullIfEmpty(data.production_construction),
                nullIfEmpty(data.sticker_composition),
                nullIfEmpty(data.fabric_composition),
                nullIfEmpty(data.finish_epi),
                nullIfEmpty(data.finish_ppi),
                nullIfEmpty(data.grey_epi),
                nullIfEmpty(data.grey_ppi),
                nullIfEmpty(data.po_quantity_yds),
                nullIfEmpty(data.dispo_quantity_yds),
                nullIfEmpty(data.adjust_quantity_yds),
                nullIfEmpty(data.finishing_process_loss),
                nullIfEmpty(data.printing_allowance),
                nullIfEmpty(data.loom_construction),
                nullIfEmpty(data.loom_contraction),
                nullIfEmpty(data.lower_beam_crimp),
                nullIfEmpty(data.left_selvedge_specification),
                nullIfEmpty(data.right_selvedge_specification),
                nullIfEmpty(data.selvedge_width),
                nullIfEmpty(data.selvedge_ends_per_dent),
                nullIfEmpty(data.total_ends_of_body),
                nullIfEmpty(data.required_print_production_meter),
                nullIfEmpty(data.required_greige_production_meter),
                nullIfEmpty(data.required_loom_production_meter),
                nullIfEmpty(data.required_warp_length_meter),
                nullIfEmpty(data.finish_width_inch),
                nullIfEmpty(data.cuttable_width_inch),
                nullIfEmpty(data.grey_width_inch),
                nullIfEmpty(data.total_ends),
                nullIfEmpty(data.no_of_section_in_lower_beam),
                nullIfEmpty(data.creel_repeat_of_lower_beam),
                nullIfEmpty(data.reed_count),
                nullIfEmpty(data.ends_per_dent),
                nullIfEmpty(data.reed_width_inch),
                nullIfEmpty(data.flange_to_flange),
                nullIfEmpty(data.warp_cover_factor),
                nullIfEmpty(data.weft_cover_factor),
                nullIfEmpty(data.total_cover_factor),
                nullIfEmpty(data.warp_yarn_dyeing_allowance),
                nullIfEmpty(data.weft_yarn_dyeing_allowance),
                nullIfEmpty(data.warp_consumption),
                nullIfEmpty(data.weft_consumption),
                nullIfEmpty(data.total_consumption),
                nullIfEmpty(data.rpm),
                nullIfEmpty(data.eff),
                nullIfEmpty(data.yarn_dyeing_lead_time),
                nullIfEmpty(data.dyed_yarn_advance_days_for_inhouse),
                nullIfEmpty(data.total_greige_lot),
                nullIfEmpty(data.finishing_lead_time),
                nullIfEmpty(data.final_loom_production_date),
                nullIfEmpty(data.loom_start_date),
                nullIfEmpty(data.start_up_days),
                nullIfEmpty(data.per_day_run_loom_in_startup)
            ]
        );

        const dispoPlanId = result.insertId;

        res.json({
            success: true,
            message: 'Dispo plan record saved successfully',
            id: dispoPlanId
        });

    } catch (error) {
        console.error('Error saving dispo plan record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save dispo plan record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE DISPO PLAN RECORD (PROPERLY FIXED) ==========
app.put('/main/api/dispo-plan/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        const dispoPlanId = req.params.id;
        const data = req.body;

        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined || value === null) return null;
            return value;
        };

        await connection.execute(
            `UPDATE dispo_plan_form SET
                po_issue_date = ?, po_received_date = ?, pp_sample_delivery_date = ?,
                bulk_fabric_delivery_date = ?, po_revised_date = ?, bulk_revised_no = ?,
                bulk_revised_reason = ?, reproduction_revised_no = ?, reproduction_revised_reason = ?,
                po_no = ?, pi_unit_lc_unit = ?, order_no = ?, account_holder = ?, buyer = ?,
                garments_name = ?, customer_ref_stl = ?, buyer_color_reference = ?, weave = ?,
                finish_type = ?, marketing_reff_tracking_no = ?, desk_loom_strike_off_no = ?,
                end_use = ?, order_type = ?, yarn_type = ?, fabric_type = ?, process_type = ?,
                print_method = ?, dispo_no = ?, sticker_construction = ?, production_construction = ?,
                sticker_composition = ?, fabric_composition = ?, finish_epi = ?, finish_ppi = ?,
                grey_epi = ?, grey_ppi = ?, po_quantity_yds = ?, dispo_quantity_yds = ?,
                adjust_quantity_yds = ?, finishing_process_loss = ?, printing_allowance = ?,
                loom_construction = ?, loom_contraction = ?, lower_beam_crimp = ?,
                left_selvedge_specification = ?, right_selvedge_specification = ?,
                selvedge_width = ?, selvedge_ends_per_dent = ?, total_ends_of_body = ?,
                required_print_production_meter = ?, required_greige_production_meter = ?,
                required_loom_production_meter = ?, required_warp_length_meter = ?,
                finish_width_inch = ?, cuttable_width_inch = ?, grey_width_inch = ?,
                total_ends = ?, no_of_section_in_lower_beam = ?, creel_repeat_of_lower_beam = ?,
                reed_count = ?, ends_per_dent = ?, reed_width_inch = ?, flange_to_flange = ?,
                warp_cover_factor = ?, weft_cover_factor = ?, total_cover_factor = ?,
                warp_yarn_dyeing_allowance = ?, weft_yarn_dyeing_allowance = ?,
                warp_consumption = ?, weft_consumption = ?, total_consumption = ?,
                rpm = ?, eff = ?, yarn_dyeing_lead_time = ?, dyed_yarn_advance_days_for_inhouse = ?,
                total_greige_lot = ?, finishing_lead_time = ?, final_loom_production_date = ?,
                loom_start_date = ?, start_up_days = ?, per_day_run_loom_in_startup = ?
            WHERE id = ?`,
            [
                nullIfEmpty(data.po_issue_date),
                nullIfEmpty(data.po_received_date),
                nullIfEmpty(data.pp_sample_delivery_date),
                nullIfEmpty(data.bulk_fabric_delivery_date),
                nullIfEmpty(data.po_revised_date),
                nullIfEmpty(data.bulk_revised_no),
                nullIfEmpty(data.bulk_revised_reason),
                nullIfEmpty(data.reproduction_revised_no),
                nullIfEmpty(data.reproduction_revised_reason),
                nullIfEmpty(data.po_no),
                nullIfEmpty(data.pi_unit_lc_unit),
                nullIfEmpty(data.order_no),
                nullIfEmpty(data.account_holder),
                nullIfEmpty(data.buyer),
                nullIfEmpty(data.garments_name),
                nullIfEmpty(data.customer_ref_stl),
                nullIfEmpty(data.buyer_color_reference),
                nullIfEmpty(data.weave),
                nullIfEmpty(data.finish_type),
                nullIfEmpty(data.marketing_reff_tracking_no),
                nullIfEmpty(data.desk_loom_strike_off_no),
                nullIfEmpty(data.end_use),
                nullIfEmpty(data.order_type),
                nullIfEmpty(data.yarn_type),
                nullIfEmpty(data.fabric_type),
                nullIfEmpty(data.process_type),
                nullIfEmpty(data.print_method),
                nullIfEmpty(data.dispo_no),
                nullIfEmpty(data.sticker_construction),
                nullIfEmpty(data.production_construction),
                nullIfEmpty(data.sticker_composition),
                nullIfEmpty(data.fabric_composition),
                nullIfEmpty(data.finish_epi),
                nullIfEmpty(data.finish_ppi),
                nullIfEmpty(data.grey_epi),
                nullIfEmpty(data.grey_ppi),
                nullIfEmpty(data.po_quantity_yds),
                nullIfEmpty(data.dispo_quantity_yds),
                nullIfEmpty(data.adjust_quantity_yds),
                nullIfEmpty(data.finishing_process_loss),
                nullIfEmpty(data.printing_allowance),
                nullIfEmpty(data.loom_construction),
                nullIfEmpty(data.loom_contraction),
                nullIfEmpty(data.lower_beam_crimp),
                nullIfEmpty(data.left_selvedge_specification),
                nullIfEmpty(data.right_selvedge_specification),
                nullIfEmpty(data.selvedge_width),
                nullIfEmpty(data.selvedge_ends_per_dent),
                nullIfEmpty(data.total_ends_of_body),
                nullIfEmpty(data.required_print_production_meter),
                nullIfEmpty(data.required_greige_production_meter),
                nullIfEmpty(data.required_loom_production_meter),
                nullIfEmpty(data.required_warp_length_meter),
                nullIfEmpty(data.finish_width_inch),
                nullIfEmpty(data.cuttable_width_inch),
                nullIfEmpty(data.grey_width_inch),
                nullIfEmpty(data.total_ends),
                nullIfEmpty(data.no_of_section_in_lower_beam),
                nullIfEmpty(data.creel_repeat_of_lower_beam),
                nullIfEmpty(data.reed_count),
                nullIfEmpty(data.ends_per_dent),
                nullIfEmpty(data.reed_width_inch),
                nullIfEmpty(data.flange_to_flange),
                nullIfEmpty(data.warp_cover_factor),
                nullIfEmpty(data.weft_cover_factor),
                nullIfEmpty(data.total_cover_factor),
                nullIfEmpty(data.warp_yarn_dyeing_allowance),
                nullIfEmpty(data.weft_yarn_dyeing_allowance),
                nullIfEmpty(data.warp_consumption),
                nullIfEmpty(data.weft_consumption),
                nullIfEmpty(data.total_consumption),
                nullIfEmpty(data.rpm),
                nullIfEmpty(data.eff),
                nullIfEmpty(data.yarn_dyeing_lead_time),
                nullIfEmpty(data.dyed_yarn_advance_days_for_inhouse),
                nullIfEmpty(data.total_greige_lot),
                nullIfEmpty(data.finishing_lead_time),
                nullIfEmpty(data.final_loom_production_date),
                nullIfEmpty(data.loom_start_date),
                nullIfEmpty(data.start_up_days),
                nullIfEmpty(data.per_day_run_loom_in_startup),
                dispoPlanId
            ]
        );

        res.json({
            success: true,
            message: 'Dispo plan record updated successfully',
            id: dispoPlanId
        });

    } catch (error) {
        console.error('Error updating dispo plan record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update dispo plan record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DISPO PLAN RECORD BY ID ==========
app.get('/main/api/dispo-plan/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoPlanId = req.params.id;

        const [records] = await connection.execute(
            `SELECT 
                id,
                DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(pp_sample_delivery_date, '%Y-%m-%d') as pp_sample_delivery_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                DATE_FORMAT(po_revised_date, '%Y-%m-%d') as po_revised_date,
                bulk_revised_no, bulk_revised_reason, reproduction_revised_no,
                reproduction_revised_reason, po_no, pi_unit_lc_unit, order_no,
                account_holder, buyer, garments_name, customer_ref_stl,
                buyer_color_reference, weave, finish_type, marketing_reff_tracking_no,
                desk_loom_strike_off_no, end_use, order_type, yarn_type, fabric_type,
                process_type, print_method, dispo_no, sticker_construction,
                production_construction, sticker_composition, fabric_composition,
                finish_epi, finish_ppi, grey_epi, grey_ppi, po_quantity_yds,
                dispo_quantity_yds, adjust_quantity_yds, finishing_process_loss,
                printing_allowance, loom_construction, loom_contraction, lower_beam_crimp,
                left_selvedge_specification, right_selvedge_specification,
                selvedge_width, selvedge_ends_per_dent, total_ends_of_body,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                finish_width_inch, cuttable_width_inch, grey_width_inch, total_ends,
                no_of_section_in_lower_beam, creel_repeat_of_lower_beam, reed_count,
                ends_per_dent, reed_width_inch, flange_to_flange, warp_cover_factor,
                weft_cover_factor, total_cover_factor, warp_yarn_dyeing_allowance,
                weft_yarn_dyeing_allowance, warp_consumption, weft_consumption,
                total_consumption, rpm, eff, yarn_dyeing_lead_time,
                dyed_yarn_advance_days_for_inhouse, total_greige_lot, finishing_lead_time,
                DATE_FORMAT(final_loom_production_date, '%Y-%m-%d') as final_loom_production_date,
                DATE_FORMAT(loom_start_date, '%Y-%m-%d') as loom_start_date,
                start_up_days, per_day_run_loom_in_startup, created_at, updated_at
            FROM dispo_plan_form 
            WHERE id = ?`,
            [dispoPlanId]
        );

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dispo plan record not found'
            });
        }

        res.json(records[0]);

    } catch (error) {
        console.error('Error fetching dispo plan record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo plan record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE DISPO PLAN RECORD ==========
app.delete('/main/api/dispo-plan/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        const dispoPlanId = req.params.id;

        const [result] = await connection.execute(
            'DELETE FROM dispo_plan_form WHERE id = ?',
            [dispoPlanId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dispo plan record not found'
            });
        }

        res.json({
            success: true,
            message: 'Dispo plan record deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting dispo plan record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete dispo plan record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT DISPO PLAN RECORDS TO CSV ==========
app.get('/main/api/dispo-plan/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            `SELECT 
                id,
                DATE_FORMAT(po_issue_date, '%Y-%m-%d') as po_issue_date,
                DATE_FORMAT(po_received_date, '%Y-%m-%d') as po_received_date,
                DATE_FORMAT(pp_sample_delivery_date, '%Y-%m-%d') as pp_sample_delivery_date,
                DATE_FORMAT(bulk_fabric_delivery_date, '%Y-%m-%d') as bulk_fabric_delivery_date,
                DATE_FORMAT(po_revised_date, '%Y-%m-%d') as po_revised_date,
                bulk_revised_no, bulk_revised_reason, reproduction_revised_no,
                reproduction_revised_reason, po_no, pi_unit_lc_unit, order_no,
                account_holder, buyer, garments_name, customer_ref_stl,
                buyer_color_reference, weave, finish_type, marketing_reff_tracking_no,
                desk_loom_strike_off_no, end_use, order_type, yarn_type, fabric_type,
                process_type, print_method, dispo_no, sticker_construction,
                production_construction, sticker_composition, fabric_composition,
                finish_epi, finish_ppi, grey_epi, grey_ppi, po_quantity_yds,
                dispo_quantity_yds, adjust_quantity_yds, finishing_process_loss,
                printing_allowance, loom_construction, loom_contraction, lower_beam_crimp,
                left_selvedge_specification, right_selvedge_specification,
                selvedge_width, selvedge_ends_per_dent, total_ends_of_body,
                required_print_production_meter, required_greige_production_meter,
                required_loom_production_meter, required_warp_length_meter,
                finish_width_inch, cuttable_width_inch, grey_width_inch, total_ends,
                no_of_section_in_lower_beam, creel_repeat_of_lower_beam, reed_count,
                ends_per_dent, reed_width_inch, flange_to_flange, warp_cover_factor,
                weft_cover_factor, total_cover_factor, warp_yarn_dyeing_allowance,
                weft_yarn_dyeing_allowance, warp_consumption, weft_consumption,
                total_consumption, rpm, eff, yarn_dyeing_lead_time,
                dyed_yarn_advance_days_for_inhouse, total_greige_lot, finishing_lead_time,
                DATE_FORMAT(final_loom_production_date, '%Y-%m-%d') as final_loom_production_date,
                DATE_FORMAT(loom_start_date, '%Y-%m-%d') as loom_start_date,
                start_up_days, per_day_run_loom_in_startup,
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM dispo_plan_form 
            ORDER BY created_at DESC`
        );

        const csvHeader = 'ID,PO Issue Date,PO Received Date,PP Sample Delivery Date,Bulk Fabric Delivery Date,PO Revised Date,Bulk Revised No,Bulk Revised Reason,Reproduction Revised No,Reproduction Revised Reason,PO No,PI Unit/LC Unit,Order No,Account Holder,Buyer,Garments Name,Customer Ref/Stl,Buyer Color Reference,Weave,Finish Type,Marketing Reff/Tracking No,Desk Loom/Strike Off No,End Use,Order Type,Yarn Type,Fabric Type,Process Type,Print Method,Dispo No,Sticker Construction,Production Construction,Sticker Composition,Fabric Composition,Finish EPI,Finish PPI,Grey EPI,Grey PPI,PO Quantity Yds,Dispo Quantity Yds,Adjust Quantity Yds,Finishing Process Loss,Printing Allowance,Loom Construction,Loom Contraction,Lower Beam Crimp,Left Selvedge Specification,Right Selvedge Specification,Selvedge Width,Selvedge Ends Per Dent,Total Ends of Body,Required Print Production Meter,Required Greige Production Meter,Required Loom Production Meter,Required Warp Length Meter,Finish Width Inch,Cuttable Width Inch,Grey Width Inch,Total Ends,No of Section in Lower Beam,Creel Repeat of Lower Beam,Reed Count,Ends Per Dent,Reed Width Inch,Flange To Flange,Warp Cover Factor,Weft Cover Factor,Total Cover Factor,Warp Yarn Dyeing Allowance,Weft Yarn Dyeing Allowance,Warp Consumption,Weft Consumption,Total Consumption,RPM,Eff,Yarn Dyeing Lead Time,Dyed Yarn Advance Days For Inhouse,Total Greige Lot,Finishing Lead Time,Final Loom Production Date,Loom Start Date,Start Up Days,Per Day Run Loom In Startup,Created At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.po_issue_date || '',
                record.po_received_date || '',
                record.pp_sample_delivery_date || '',
                record.bulk_fabric_delivery_date || '',
                record.po_revised_date || '',
                record.bulk_revised_no || '',
                (record.bulk_revised_reason || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.reproduction_revised_no || '',
                (record.reproduction_revised_reason || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.po_no || '',
                record.pi_unit_lc_unit || '',
                record.order_no || '',
                record.account_holder || '',
                record.buyer || '',
                record.garments_name || '',
                record.customer_ref_stl || '',
                record.buyer_color_reference || '',
                record.weave || '',
                record.finish_type || '',
                record.marketing_reff_tracking_no || '',
                record.desk_loom_strike_off_no || '',
                record.end_use || '',
                record.order_type || '',
                record.yarn_type || '',
                record.fabric_type || '',
                record.process_type || '',
                record.print_method || '',
                record.dispo_no || '',
                record.sticker_construction || '',
                record.production_construction || '',
                record.sticker_composition || '',
                (record.fabric_composition || '').replace(/,/g, ';').replace(/\n/g, ' '),
                record.finish_epi || '',
                record.finish_ppi || '',
                record.grey_epi || '',
                record.grey_ppi || '',
                record.po_quantity_yds || '',
                record.dispo_quantity_yds || '',
                record.adjust_quantity_yds || '',
                record.finishing_process_loss || '',
                record.printing_allowance || '',
                record.loom_construction || '',
                record.loom_contraction || '',
                record.lower_beam_crimp || '',
                record.left_selvedge_specification || '',
                record.right_selvedge_specification || '',
                record.selvedge_width || '',
                record.selvedge_ends_per_dent || '',
                record.total_ends_of_body || '',
                record.required_print_production_meter || '',
                record.required_greige_production_meter || '',
                record.required_loom_production_meter || '',
                record.required_warp_length_meter || '',
                record.finish_width_inch || '',
                record.cuttable_width_inch || '',
                record.grey_width_inch || '',
                record.total_ends || '',
                record.no_of_section_in_lower_beam || '',
                record.creel_repeat_of_lower_beam || '',
                record.reed_count || '',
                record.ends_per_dent || '',
                record.reed_width_inch || '',
                record.flange_to_flange || '',
                record.warp_cover_factor || '',
                record.weft_cover_factor || '',
                record.total_cover_factor || '',
                record.warp_yarn_dyeing_allowance || '',
                record.weft_yarn_dyeing_allowance || '',
                record.warp_consumption || '',
                record.weft_consumption || '',
                record.total_consumption || '',
                record.rpm || '',
                record.eff || '',
                record.yarn_dyeing_lead_time || '',
                record.dyed_yarn_advance_days_for_inhouse || '',
                record.total_greige_lot || '',
                record.finishing_lead_time || '',
                record.final_loom_production_date || '',
                record.loom_start_date || '',
                record.start_up_days || '',
                record.per_day_run_loom_in_startup || '',
                record.created_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="dispo_plan_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting dispo plan records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export dispo plan records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// FLOOR POSITION FORM - API ENDPOINTS
// =====================================================

// ========== FETCH FLOOR DATA RECORDS FOR SEARCH DROPDOWN ==========
app.get('/main/api/floor-position/search-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(`
            SELECT 
                id,
                loom_no,
                beam_no,
                beam_length_in_yds,
                weaving_beam_set_no,
                DATE_FORMAT(beam_start_date, '%Y-%m-%d') as beam_start_date,
                beam_start_time,
                loom_status,
                dispo_no
            FROM floor_position 
            ORDER BY created_at DESC
            LIMIT 100
        `);
        
        res.json(records);
        
    } catch (error) {
        console.error('Error fetching floor position records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch floor position records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH DISPO NUMBERS FOR DROPDOWN ==========
app.get('/main/api/floor-position/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        let dispoNumbers = [];
        
        // Try dispo_form_data first
        try {
            const [rows1] = await connection.query(`
                SELECT DISTINCT dispo_number 
                FROM dispo_form_data 
                WHERE dispo_number IS NOT NULL AND dispo_number != ''
                ORDER BY dispo_number DESC
                LIMIT 100
            `);
            dispoNumbers = rows1.map(r => r.dispo_number);
        } catch (e) {
            console.log('dispo_form_data not available:', e.message);
        }
        
        // If no results, try floor_position table
        if (dispoNumbers.length === 0) {
            try {
                const [rows2] = await connection.query(`
                    SELECT DISTINCT dispo_no
                    FROM floor_position 
                    WHERE dispo_no IS NOT NULL AND dispo_no != ''
                    ORDER BY dispo_no DESC
                    LIMIT 100
                `);
                dispoNumbers = rows2.map(r => r.dispo_no);
            } catch (e) {
                console.log('floor_position not available:', e.message);
            }
        }
        
        res.json(dispoNumbers);
        
    } catch (error) {
        console.error('Error fetching dispo numbers:', error);
        res.json([]);
    } finally {
        if (connection) connection.release();
    }
});

// ========== SAVE FLOOR POSITION RECORD ==========
app.post('/main/api/floor-position/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        const data = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert floor position record
        const [result] = await connection.execute(
            `INSERT INTO floor_position (
                loom_no, beam_no, type_of_loom, color_capacity, 
                no_of_color_in_warp, no_of_count_in_weft, beam_length_in_yds,
                weaving_beam_set_no, beam_finish_time, beam_start_date,
                beam_start_time, total_down_time, fill_length, weft_count,
                machine_rpm, loom_status, buyer, po_no, dispo_no,
                construction, total_ends, finished_width, blend, weave,
                reed_count, crimp_percent, greige_pick, customer_ref_stl,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                nullIfEmpty(data.loom_no),
                nullIfEmpty(data.beam_no),
                nullIfEmpty(data.type_of_loom),
                nullIfEmpty(data.color_capacity),
                nullIfEmpty(data.no_of_color_in_warp),
                nullIfEmpty(data.no_of_count_in_weft),
                nullIfEmpty(data.beam_length_in_yds),
                nullIfEmpty(data.weaving_beam_set_no),
                nullIfEmpty(data.beam_finish_time),
                nullIfEmpty(data.beam_start_date),
                nullIfEmpty(data.beam_start_time),
                nullIfEmpty(data.total_down_time),
                nullIfEmpty(data.fill_length),
                nullIfEmpty(data.weft_count),
                nullIfEmpty(data.machine_rpm),
                nullIfEmpty(data.loom_status),
                nullIfEmpty(data.buyer),
                nullIfEmpty(data.po_no),
                nullIfEmpty(data.dispo_no),
                nullIfEmpty(data.construction),
                nullIfEmpty(data.total_ends),
                nullIfEmpty(data.finished_width),
                nullIfEmpty(data.blend),
                nullIfEmpty(data.weave),
                nullIfEmpty(data.reed_count),
                nullIfEmpty(data.crimp_percent),
                nullIfEmpty(data.greige_pick),
                nullIfEmpty(data.customer_ref_stl)
            ]
        );

        res.json({
            success: true,
            message: 'Floor position record saved successfully',
            id: result.insertId
        });

    } catch (error) {
        console.error('Error saving floor position record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save floor position record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== UPDATE FLOOR POSITION RECORD ==========
app.put('/main/api/floor-position/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();

        const recordId = req.params.id;
        const data = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update floor position record
        await connection.execute(
            `UPDATE floor_position SET
                loom_no = ?, beam_no = ?, type_of_loom = ?, color_capacity = ?,
                no_of_color_in_warp = ?, no_of_count_in_weft = ?, beam_length_in_yds = ?,
                weaving_beam_set_no = ?, beam_finish_time = ?, beam_start_date = ?,
                beam_start_time = ?, total_down_time = ?, fill_length = ?, weft_count = ?,
                machine_rpm = ?, loom_status = ?, buyer = ?, po_no = ?, dispo_no = ?,
                construction = ?, total_ends = ?, finished_width = ?, blend = ?, weave = ?,
                reed_count = ?, crimp_percent = ?, greige_pick = ?, customer_ref_stl = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [
                nullIfEmpty(data.loom_no),
                nullIfEmpty(data.beam_no),
                nullIfEmpty(data.type_of_loom),
                nullIfEmpty(data.color_capacity),
                nullIfEmpty(data.no_of_color_in_warp),
                nullIfEmpty(data.no_of_count_in_weft),
                nullIfEmpty(data.beam_length_in_yds),
                nullIfEmpty(data.weaving_beam_set_no),
                nullIfEmpty(data.beam_finish_time),
                nullIfEmpty(data.beam_start_date),
                nullIfEmpty(data.beam_start_time),
                nullIfEmpty(data.total_down_time),
                nullIfEmpty(data.fill_length),
                nullIfEmpty(data.weft_count),
                nullIfEmpty(data.machine_rpm),
                nullIfEmpty(data.loom_status),
                nullIfEmpty(data.buyer),
                nullIfEmpty(data.po_no),
                nullIfEmpty(data.dispo_no),
                nullIfEmpty(data.construction),
                nullIfEmpty(data.total_ends),
                nullIfEmpty(data.finished_width),
                nullIfEmpty(data.blend),
                nullIfEmpty(data.weave),
                nullIfEmpty(data.reed_count),
                nullIfEmpty(data.crimp_percent),
                nullIfEmpty(data.greige_pick),
                nullIfEmpty(data.customer_ref_stl),
                recordId
            ]
        );

        res.json({
            success: true,
            message: 'Floor position record updated successfully',
            id: recordId
        });

    } catch (error) {
        console.error('Error updating floor position record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update floor position record',
            error: error.message,
            details: error.sqlMessage || error.toString()
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== FETCH FLOOR POSITION BY ID ==========

// ========== FETCH DISPO DATA FOR FLOOR POSITION (ONLY DISPO FIELDS) ==========
app.get('/main/api/floor-position/fetch-dispo-data/:dispo_number', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dispoNumber = req.params.dispo_number;

        // Fetch ONLY from dispo_form_data table
        // Do NOT check floor_position table - this ensures we only get base dispo data
        const [dispoData] = await connection.execute(
            `SELECT 
                dispo_number,
                po_no,
                buyer_name,
                production_construction,
                beam_total_ends,
                dispo_cuttable_width,
                fabric_composition,
                weave_type,
                reed_count,
                buyer_style_ref,
                lower_beam_crimp,
                grey_ppi
            FROM dispo_form_data 
            WHERE dispo_number = ?`,
            [dispoNumber]
        );

        if (dispoData.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dispo data not found in dispo_form_data table'
            });
        }

        const dispo = dispoData[0];

        // Return mapped data for floor position form
        // Only includes dispo-related fields, NOT floor-specific fields
        res.json({
            success: true,
            data: {
                dispo_no: dispo.dispo_number || '',
                po_no: dispo.po_no || '',
                buyer: dispo.buyer_name || '',
                construction: dispo.production_construction || '',
                total_ends: dispo.beam_total_ends || '',
                finished_width: dispo.dispo_cuttable_width || '',
                blend: dispo.fabric_composition || '',
                weave: dispo.weave_type || '',
                reed_count: dispo.reed_count || '',
                customer_ref_stl: dispo.buyer_style_ref || '',
                crimp_percent: dispo.lower_beam_crimp || '', // NEW: Crimp% ← Lower Beam Crimp
                greige_pick: dispo.grey_ppi || '' // NEW: Greige Pick ← Grey PPI
            },
            source: 'dispo_form_data'
        });

    } catch (error) {
        console.error('Error fetching dispo data for floor position:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dispo data',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

app.get('/main/api/floor-position/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const recordId = req.params.id;

        const [records] = await connection.execute(
            'SELECT * FROM floor_position WHERE id = ?',
            [recordId]
        );

        if (records.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Floor position record not found'
            });
        }

        res.json(records[0]);

    } catch (error) {
        console.error('Error fetching floor position record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch floor position record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== DELETE FLOOR POSITION RECORD ==========
app.delete('/main/api/floor-position/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const recordId = req.params.id;

        await connection.execute(
            'DELETE FROM floor_position WHERE id = ?',
            [recordId]
        );

        res.json({
            success: true,
            message: 'Floor position record deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting floor position record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete floor position record',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// ========== EXPORT TO EXCEL/CSV ==========
app.get('/main/api/floor-position/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const [records] = await connection.query(
            'SELECT * FROM floor_position ORDER BY created_at DESC'
        );

        // Create CSV content
        const csvHeader = 'ID,Loom No,Beam No,Type of Loom,Color Capacity,No of Color in Warp,No of Count in Weft,Beam Length (yds),Weaving Beam Set No,Beam Finish Time,Beam Start Date,Beam Start Time,Total Down Time,Fill Length,Weft Count,Machine RPM,Loom Status,Buyer,PO No,Dispo No,Construction,Total Ends,Finished Width,Blend,Weave,Reed Count,Crimp%,Greige Pick,Customer Ref/Stl,Created At,Updated At\n';
        
        const csvRows = records.map(record => {
            return [
                record.id,
                record.loom_no || '',
                record.beam_no || '',
                record.type_of_loom || '',
                record.color_capacity || '',
                record.no_of_color_in_warp || '',
                record.no_of_count_in_weft || '',
                record.beam_length_in_yds || '',
                record.weaving_beam_set_no || '',
                record.beam_finish_time || '',
                record.beam_start_date || '',
                record.beam_start_time || '',
                record.total_down_time || '',
                record.fill_length || '',
                record.weft_count || '',
                record.machine_rpm || '',
                record.loom_status || '',
                record.buyer || '',
                record.po_no || '',
                record.dispo_no || '',
                record.construction || '',
                record.total_ends || '',
                record.finished_width || '',
                record.blend || '',
                record.weave || '',
                record.reed_count || '',
                record.crimp_percent || '',
                record.greige_pick || '',
                (record.customer_ref_stl || '').replace(/,/g, ';'),
                record.created_at,
                record.updated_at
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="floor_position_records_${Date.now()}.csv"`);
        res.send(csvContent);

    } catch (error) {
        console.error('Error exporting records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export records',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
});

// API endpoint to retrieve logs
app.get('/main/api/logs', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        // Return last 100 logs (adjust as needed)
        res.status(200).json(logs.slice(-100));
    } catch (error) {
        enhancedLog('LOGS_FETCH_ERROR', 'Failed to fetch logs', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch logs', details: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
