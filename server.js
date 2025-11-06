// Load environment variables first
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const fs = require('fs');

// Initialize the Express app
const app = express();

// Validate required environment variables
const requiredEnvVars = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('ERROR: Missing required environment variables:', missingVars.join(', '));
    console.error('Please create a .env file based on .env.example');
    process.exit(1);
}

// MySQL connection configuration using environment variables
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
});

// Session store
const sessionStore = new MySQLStore({}, pool);

// CORS configuration - environment-based
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://precostingdatabase.com', 'https://precostingdatabase.com'];

// Add localhost only in development
if (process.env.NODE_ENV === 'development') {
    corsOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

app.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    credentials: true,
    preflightContinue: true,
    optionsSuccessStatus: 200
}));

app.use(express.json());

// Enhanced session configuration with environment variables
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
    key: process.env.SESSION_KEY || 'precosting_session',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.COOKIE_SECURE === 'true' || isProduction,
        httpOnly: true,
        maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000,
        sameSite: process.env.COOKIE_SAME_SITE || (isProduction ? 'strict' : 'lax')
    },
    rolling: true
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    next();
};

// Admin authentication middleware
const requireAdmin = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    next();
};

// Input validation middleware
const validateInput = (req, res, next) => {
    // Sanitize string inputs to prevent XSS
    const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;
        return str.trim().replace(/<script[^>]*>.*?<\/script>/gi, '');
    };

    // Recursively sanitize object
    const sanitizeObject = (obj) => {
        if (typeof obj !== 'object' || obj === null) return obj;

        const sanitized = Array.isArray(obj) ? [] : {};
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                sanitized[key] = sanitizeString(obj[key]);
            } else if (typeof obj[key] === 'object') {
                sanitized[key] = sanitizeObject(obj[key]);
            } else {
                sanitized[key] = obj[key];
            }
        }
        return sanitized;
    };

    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }
    next();
};

// Apply input validation to all routes
app.use(validateInput);

// Enhanced session validation middleware
app.use((req, res, next) => {
    // Skip session check for login/register routes
    if (req.path === '/main/api/login' || req.path === '/main/api/register') {
        return next();
    }

    // Enhanced session logging for API routes (only in development)
    if (req.path.includes('/api/') && process.env.NODE_ENV === 'development') {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        console.log(`  Session ID: ${req.sessionID}`);
        console.log(`  Session exists: ${!!req.session}`);
        console.log(`  Has user: ${!!req.session?.user}`);

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
app.use('/main', express.static(__dirname));
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
    .then((connection) => {
        console.log('Connected to MySQL database');
        connection.release();
    })
    .catch((err) => {
        console.error('Error connecting to MySQL:', err.stack);
    });

// Session debugging endpoint - requires admin authentication in production
app.get('/main/api/debug/session-info', isProduction ? requireAdmin : (req, res, next) => next(), (req, res) => {
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

// Diagnostic route for file system information - requires admin authentication in production
app.get('/main/api/debug/file-check', isProduction ? requireAdmin : (req, res, next) => next(), (req, res) => {
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

// API endpoint to check table structure - requires admin authentication in production
app.get('/main/api/debug/check-tables', isProduction ? requireAdmin : (req, res, next) => next(), async (req, res) => {
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
app.get('/main/api/debug/po-dispo-table-check', isProduction ? requireAdmin : requireAuth, async (req, res) => {
    
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

// Generate Next Pre-Costing Number
app.get('/main/api/precosting/next-pre-costing-no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        const currentYear = new Date().getFullYear();
        const [rows] = await pool.query(
            'SELECT pre_costing_no FROM pre_costing_data WHERE pre_costing_no LIKE ? ORDER BY pre_costing_no DESC LIMIT 1',
            [`${currentYear}/%`]
        );

        let nextNumber = 1;
        if (rows.length > 0) {
            const lastPreCostingNo = rows[0].pre_costing_no;
            const lastNumber = parseInt(lastPreCostingNo.split('/')[1], 10);
            nextNumber = lastNumber + 1;
        }

        const formattedNextNumber = `${currentYear}/${String(nextNumber).padStart(2, '0')}`;
        res.status(200).json({ pre_costing_no: formattedNextNumber });
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

// Search PO by PO No
app.get('/main/api/po/search-by-po-no/:poNo', async (req, res) => {
  if (!req.session.user) {
    enhancedLog('PO_SEARCH_ERROR', 'Unauthorized access', { poNo: req.params.poNo });
    return res.status(401).json({ error: 'Not logged in' });
  }

  const poNo = req.params.poNo;
  let connection;
  try {
    connection = await pool.getConnection();
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

// FINAL CORRECTED Enhanced Dispo save data to MySQL - FIXED column count
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

    // CORRECTED Enhanced data mapping - MATCHES database schema exactly (112 fields excluding created_at)
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
       
       // CORRECTED: New selvedge fields according to updated schema
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
       
       // Precosting fields (ADDED BACK to match database schema exactly)
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

       // CORRECTED INSERT query - MATCHES database schema exactly (112 columns excluding created_at)
       const insertDispoQuery = `
           INSERT INTO dispo_form_data (
               dispo_number, po_no, po_issue_date, po_revise_date, po_approval_date, dispo_creating_date, order_no,
               precosting_number, pi_no, account_holder, buyer_name, order_status, buyer_style_ref, development_id,
               handloom_number, print_method, process_type, fabric_type, yarn_type, order_type, pp_delivery_date,
               bulk_delivery_date, end_use, wash_type, light_source, weave_type, sticker_construction,
               production_construction, sticker_composition, fabric_composition, reed_count, ends_per_dent,
               warp_count_1, warp_ply_1, warp_count_2, warp_ply_2, warp_count_3, warp_ply_3, weft_count_1,
               weft_ply_1, weft_count_2, weft_ply_2, weft_count_3, weft_ply_3, finish_epi, finish_ppi,
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
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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

      // CORRECTED values array (112 values - matches database schema exactly)
      const dispoValues = [
          data.dispo_number, data.po_no, data.po_issue_date, data.po_revise_date, data.po_approval_date,
          data.dispo_creating_date, data.order_no, data.precosting_number, data.pi_no, data.account_holder,
          data.buyer_name, data.order_status, data.buyer_style_ref, data.development_id, data.handloom_number,
          data.print_method, data.process_type, data.fabric_type, data.yarn_type, data.order_type,
          data.pp_delivery_date, data.bulk_delivery_date, data.end_use, data.wash_type, data.light_source,
          data.weave_type, data.sticker_construction, data.production_construction, data.sticker_composition,
          data.fabric_composition, data.reed_count, data.ends_per_dent, data.warp_count_1, data.warp_ply_1,
          data.warp_count_2, data.warp_ply_2, data.warp_count_3, data.warp_ply_3, data.weft_count_1,
          data.weft_ply_1, data.weft_count_2, data.weft_ply_2, data.weft_count_3, data.weft_ply_3,
          data.finish_epi, data.finish_ppi, data.calculation_width, data.dispo_overall_width,
          data.dispo_cuttable_width, data.finish_type, data.selvedge_width, data.selvedge_ends_per_dent,
          data.po_qty_yds, data.finish_qty_yds, data.adjust_qty_yds, data.warp_yd_allowance,
          data.weft_yd_allowance, data.finishing_process_loss, data.print_allowance, data.loom_contraction,
          data.weft_contraction, data.lower_beam_crimp, data.reduce_pick, data.pick_length_inch,
          data.creel_repeat, data.extra_cone_length, data.grey_epi, data.grey_ppi, data.beam_total_ends,
          data.body_ends, data.actual_section, data.calculated_section, data.finish_length_mtr,
          data.print_qty_mtr, data.grey_qty_mtr, data.loom_production_mtr, data.warp_beam_length,
          data.reed_space_inch, data.grey_width_inch, data.warp_consumption_yds, data.weft_consumption_yds,
          data.total_consumption_yds, data.warp_cover_factor, data.weft_cover_factor, data.total_cover_factor,
          data.calculated_gsm_regular, data.calculated_gsm_lycra, 
          data.left_selvedge_ends, data.right_selvedge_ends, data.selvedge_dents_per_side,
          data.left_selvedge_spec, data.right_selvedge_spec,
          data.warp_tear_strength, data.weft_tear_strength, data.warp_tensile_strength, data.weft_tensile_strength,
          data.pilling_grade, data.rubbing_grade, data.elongation, data.growth, data.recovery,
          data.buyer_gsm_bw, data.buyer_gsm_aw, data.warp_shrinkage, data.weft_shrinkage,
          data.quality_parameter, data.additional_remarks, data.pc_regular_price_usd, data.pc_upcharge_price_usd,
          data.pc_total_consumption, data.pc_raw_yarn_cost_usd, data.pc_pick_rate_usd
      ];

      console.log('=== FINAL CORRECTED DISPO SAVE DEBUG INFO ===');
      console.log('Total columns in INSERT (excluding created_at):', 112);
      console.log('Values array length:', dispoValues.length);
      console.log('Is Update:', isUpdate);
      console.log('=== END DEBUG INFO ===');

      await connection.query(insertDispoQuery, dispoValues);

       // Enhanced warp_yarn_details handling with corrected schema
      await connection.query('DELETE FROM warp_yarn_details WHERE dispo_number = ?', [data.dispo_number]);
      for (const detail of warpYarnDetails || []) {
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
      for (const detail of weftYarnDetails || []) {
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
      console.log('DISPO_SAVE', 'Successfully saved dispo form data with corrected column count', { 
          dispo_number: data.dispo_number, 
          po_no: data.po_no,
          isUpdate: isUpdate,
          warpRows: warpYarnDetails?.length || 0,
          weftRows: weftYarnDetails?.length || 0
      });
      res.status(200).json({ 
          message: `Dispo data ${isUpdate ? 'updated' : 'created'} successfully with corrected column count!` 
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

       enhancedLog('DISPO_FETCH', 'Successfully fetched dispo data', { 
           dispo_number,
           warpRows: warpYarnDetails.length,
           weftRows: weftYarnDetails.length
       });

       res.status(200).json({
           dispoData: dispoData[0],
           warpYarnDetails,
           weftYarnDetails,
           warpBrokenSection,
           warpBrokenPattern
       });
   } catch (error) {
       enhancedLog('DISPO_FETCH_ERROR', 'Failed to fetch dispo data', { 
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

// Fetch dispo data by PO number
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
           enhancedLog('DISPO_FETCH_PO_NOT_FOUND', 'PO not found for dispo population', { po_no });
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
           po_qty_yds: po.po_qty_yds && !isNaN(parseInt(po.po_qty_yds)) ? parseInt(po.po_qty_yds) : null,
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
           mappedDispoData.pc_raw_yarn_cost_usd = preCostingData.total_greige_yarn_cost_per_yd && !isNaN(parseFloat(preCostingData.total_greige_yarn_cost_per_yd)) ? parseFloat(preCostingData.total_greige_yarn_cost_per_yd) : null;
           mappedDispoData.pc_pick_rate_usd = preCostingData.weaving_cost && !isNaN(parseFloat(preCostingData.weaving_cost)) ? parseFloat(preCostingData.weaving_cost) : null;
       }

       enhancedLog('DISPO_FETCH_PO_SUCCESS', 'Successfully fetched PO data for dispo population', { 
           po_no, 
           hasPrecosting: !!preCostingData,
           pre_costing_no: po.pre_costing_no,
           mappedFields: Object.keys(mappedDispoData).length
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
       enhancedLog('DISPO_FETCH_PO_ERROR', 'Failed to fetch PO data for dispo population', { 
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
       enhancedLog('DISPO_FETCH_BY_PO_AUTH_ERROR', 'Unauthorized access attempt');
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
           enhancedLog('DISPO_FETCH_BY_PO_NOT_FOUND', 'No existing dispo data found for this PO number', { po_no });
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
               warpYarnDetails,
               weftYarnDetails,
               warpBrokenSection,
               warpBrokenPattern
           };
       }));

       enhancedLog('DISPO_FETCH_BY_PO_SUCCESS', 'Successfully fetched existing dispo data by PO', { 
           po_no, 
           count: result.length 
       });
       res.status(200).json(result);
   } catch (error) {
       enhancedLog('DISPO_FETCH_BY_PO_ERROR', 'Failed to fetch existing dispo data by PO', { 
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
       enhancedLog('DISPO_DELETE', 'Successfully deleted dispo data with all related tables', { dispo_number });
       res.status(200).json({ 
           message: 'Dispo data and all related information deleted successfully',
           deleted_dispo: dispo_number
       });
   } catch (error) {
       if (connection) await connection.rollback();
       enhancedLog('DISPO_DELETE_ERROR', 'Failed to delete dispo data', { 
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
               warpYarnDetails,
               weftYarnDetails,
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
               version: '2.0-enhanced'
           },
           dispoRecords: result
       };

       res.setHeader('Content-Type', 'application/json');
       res.setHeader('Content-Disposition', 'attachment; filename=enhanced_dispo_data_export.json');
       
       enhancedLog('DISPO_EXPORT', 'Successfully exported dispo data', { 
           recordCount: result.length,
           exportedBy: req.session.user.username
       });
       
       res.status(200).json(exportData);
   } catch (error) {
       enhancedLog('DISPO_EXPORT_ERROR', 'Failed to export dispo data', { 
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
                d.development_id,
                d.dispo_number,
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
            'Precosting Number', 'PO No', 'Buyer Name', 'NF Number', 'Dispo Number', 
            'Weave Type', 'Production Construction', 'Fabric Composition', 'Finish Type',
            'PO Qty (Yds)', 'Finish Qty (Yds)', 'Adjust Qty (Yds)', 
            'Warp Consumption kg/Yd', 'Weft Consumption kg/Yd',
            'Warp Dyed Qty (KG)', 'Warp Grey Qty (KG)', 'Weft Dyed Qty (KG)', 'Weft Grey Qty (KG)',
            'Created At'
        ].join(',');

        const csvRows = rows.map(row => [
            `"${(row.precosting_number || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.po_no || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.buyer_name || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.development_id || 'N/A').toString().replace(/"/g, '""')}"`,
            `"${(row.dispo_number || 'N/A').toString().replace(/"/g, '""')}"`,
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
       enhancedLog('DISPO_NUMBERS_AUTH_ERROR', 'Unauthorized access attempt');
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
       
       enhancedLog('DISPO_NUMBERS_SUCCESS', 'Fetched dispo numbers with metadata', { 
           count: rows.length 
       });
       
       // Return just the dispo numbers for dropdown compatibility
       res.status(200).json(rows.map(row => row.dispo_number));
   } catch (error) {
       enhancedLog('DISPO_NUMBERS_ERROR', 'Failed to fetch dispo numbers', { 
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
       enhancedLog('PO_NUMBERS_AUTH_ERROR', 'Unauthorized access attempt');
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
       
       enhancedLog('PO_NUMBERS_SUCCESS', 'Fetched PO numbers with metadata', { 
           count: rows.length 
       });
       
       // Return just the PO numbers for dropdown compatibility
       res.status(200).json(rows.map(row => row.po_no));
   } catch (error) {
       enhancedLog('PO_NUMBERS_ERROR', 'Failed to fetch PO numbers', { 
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

       enhancedLog('DISPO_STATISTICS', 'Generated dispo statistics', statistics);
       res.status(200).json(statistics);
   } catch (error) {
       enhancedLog('DISPO_STATISTICS_ERROR', 'Failed to generate dispo statistics', { 
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
// YARN RECEIVE FORM API ENDPOINTS
// =====================================================

// Updated server endpoint - fix the field order and format
app.get('/main/api/yarn/yarn-details', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
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

// Fetch Posted LCs for dropdown
app.get('/main/api/yarn/posted-lcs', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
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

// Enhanced fetch by ID with comprehensive dispo aggregation
app.get('/main/api/yarn/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Direct ID lookup - gets the EXACT record user selected
        const [mainData] = await connection.query(`
            SELECT * FROM yarn_receive_form 
            WHERE id = ?
        `, [id]);
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'No data found for this ID' });
        }
        
        const formId = mainData[0].id;
        const yarnLot = mainData[0].yarn_lot; // Extract yarn_lot for aggregation
        
        // Fetch breakdown data for THIS specific record
        const [receivedDetails] = await connection.query(
            'SELECT * FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        // Comprehensive dispo aggregation from ALL records with the same yarn_lot
        const allDispoNumbers = new Set();
        
        if (yarnLot && yarnLot.trim() !== '') {
            // Source 1: received_against_dispo_nos from ALL records with this yarn_lot
            const [dispoFromReceived] = await connection.query(`
                SELECT DISTINCT received_against_dispo_nos 
                FROM yarn_receive_form 
                WHERE yarn_lot = ? 
                AND received_against_dispo_nos IS NOT NULL 
                AND received_against_dispo_nos != ''
            `, [yarnLot]);
            
            dispoFromReceived.forEach(record => {
                if (record.received_against_dispo_nos) {
                    const disposNos = record.received_against_dispo_nos.split(',')
                        .map(dispo => dispo.trim())
                        .filter(dispo => dispo && dispo !== 'N/A');
                    disposNos.forEach(dispo => allDispoNumbers.add(dispo));
                }
            });
            
            // Source 2: dispo_no from requirements for ALL records with this yarn_lot
            const [dispoFromRequirements] = await connection.query(`
                SELECT DISTINCT req.dispo_no 
                FROM yarn_requirements_details req
                JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
                WHERE y.yarn_lot = ? 
                AND req.dispo_no IS NOT NULL 
                AND req.dispo_no != ''
            `, [yarnLot]);
            
            dispoFromRequirements.forEach(record => {
                if (record.dispo_no && record.dispo_no !== 'N/A') {
                    allDispoNumbers.add(record.dispo_no.trim());
                }
            });
            
            // Source 3: search_dispo from ALL records with this yarn_lot
            const [dispoFromSearch] = await connection.query(`
                SELECT DISTINCT search_dispo 
                FROM yarn_receive_form 
                WHERE yarn_lot = ? 
                AND search_dispo IS NOT NULL 
                AND search_dispo != ''
            `, [yarnLot]);
            
            dispoFromSearch.forEach(record => {
                if (record.search_dispo && record.search_dispo !== 'N/A') {
                    allDispoNumbers.add(record.search_dispo.trim());
                }
            });
        }
        
        const relatedDispoNumbers = Array.from(allDispoNumbers)
            .filter(dispo => dispo && dispo.length > 0)
            .sort();
        
        console.log(`Fetched record ID ${id} with yarn_lot "${yarnLot}". Found ${relatedDispoNumbers.length} related dispo numbers.`);
        
        res.status(200).json({
            ...mainData[0],
            yarn_received_details: receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers: relatedDispoNumbers
        });
    } catch (error) {
        console.error('Error fetching data by ID:', error);
        res.status(500).json({ error: 'Failed to fetch data by ID', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// UPDATED: Yarn lots endpoint to include record ID in the data attribute
app.get('/main/api/yarn/yarn-lots', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
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
                id, yarn_lot, yarn_count, yarn_ply, received_against_po_no, received_against_dispo_nos,
                yarn_type, yarn_brand, yarn_composition, import_local_source, lc_unit, beneficiary_factory
            FROM yarn_receive_form 
            WHERE yarn_lot IS NOT NULL AND yarn_lot != '' 
            ORDER BY created_at DESC
        `);
        
        res.status(200).json(rows.map(row => ({
            display: row.yarn_lot_detail,
            yarn_lot: row.yarn_lot,
            data: {
                id: row.id,
                yarn_lot: row.yarn_lot,
                yarn_count: row.yarn_count,
                yarn_ply: row.yarn_ply,
                received_against_po_no: row.received_against_po_no,
                received_against_dispo_nos: row.received_against_dispo_nos,
                yarn_type: row.yarn_type,
                yarn_brand: row.yarn_brand,
                yarn_composition: row.yarn_composition,
                import_local_source: row.import_local_source,
                lc_unit: row.lc_unit,
                beneficiary_factory: row.beneficiary_factory
            }
        })));
    } catch (error) {
        console.error('Error fetching yarn lots:', error);
        res.status(500).json({ error: 'Failed to fetch yarn lots', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});


// UPDATED: /main/api/yarn/fetch-by-detail/:recordId with dispo aggregation
app.get('/main/api/yarn/fetch-by-detail/:recordId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { recordId } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Direct lookup by ID
        const [mainData] = await connection.query(`
            SELECT * FROM yarn_receive_form 
            WHERE id = ?
            ORDER BY created_at DESC LIMIT 1
        `, [recordId]);
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'No data found for this record' });
        }
        
        const formId = mainData[0].id;
        
        // Fetch related breakdown data
        const [receivedDetails] = await connection.query(
            'SELECT * FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        // ============ DISPO AGGREGATION LOGIC ============
        const yarnLot = mainData[0].yarn_lot;
        const allDispoNumbers = new Set();
        
        if (yarnLot && yarnLot.trim() !== '') {
            // Query 1: From yarn_received_details
            const [dispoFromReceived] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_received_details WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromReceived.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
            
            // Query 2: From yarn_requirements_details
            const [dispoFromRequirements] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_requirements_details WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromRequirements.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
            
            // Query 3: From yarn_receive_form
            const [dispoFromSearch] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_receive_form WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromSearch.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
        }
        
        const relatedDispoNumbers = Array.from(allDispoNumbers)
            .filter(dispo => dispo && dispo.length > 0)
            .sort();
        // ============ END DISPO AGGREGATION ============
        
        res.status(200).json({
            ...mainData[0],
            yarn_received_details: receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers: relatedDispoNumbers
        });
    } catch (error) {
        console.error('Error fetching data by detail:', error);
        res.status(500).json({ error: 'Failed to fetch data by detail', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// UPDATED: /main/api/yarn/fetch-by-lc/:lcNumber with dispo aggregation
app.get('/main/api/yarn/fetch-by-lc/:lcNumber', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { lcNumber } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [mainData] = await connection.query(`
            SELECT * FROM yarn_receive_form 
            WHERE lc_no = ?
            ORDER BY created_at DESC LIMIT 1
        `, [lcNumber]);
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'No data found for this LC number' });
        }
        
        const formId = mainData[0].id;
        
        const [receivedDetails] = await connection.query(
            'SELECT * FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        // ============ DISPO AGGREGATION LOGIC ============
        const yarnLot = mainData[0].yarn_lot;
        const allDispoNumbers = new Set();
        
        if (yarnLot && yarnLot.trim() !== '') {
            // Query 1: From yarn_received_details
            const [dispoFromReceived] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_received_details WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromReceived.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
            
            // Query 2: From yarn_requirements_details
            const [dispoFromRequirements] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_requirements_details WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromRequirements.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
            
            // Query 3: From yarn_receive_form
            const [dispoFromSearch] = await connection.query(
                'SELECT DISTINCT dispo_no FROM yarn_receive_form WHERE yarn_lot = ?',
                [yarnLot]
            );
            dispoFromSearch.forEach(row => {
                if (row.dispo_no) allDispoNumbers.add(row.dispo_no);
            });
        }
        
        const relatedDispoNumbers = Array.from(allDispoNumbers)
            .filter(dispo => dispo && dispo.length > 0)
            .sort();
        // ============ END DISPO AGGREGATION ============
        
        res.status(200).json({
            ...mainData[0],
            yarn_received_details: receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers: relatedDispoNumbers
        });
    } catch (error) {
        console.error('Error fetching data by LC:', error);
        res.status(500).json({ error: 'Failed to fetch data by LC', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Fetch data by yarn lot
app.get('/main/api/yarn/fetch-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [mainData] = await connection.query(`
            SELECT * FROM yarn_receive_form 
            WHERE yarn_lot = ?
            ORDER BY created_at DESC LIMIT 1
        `, [yarnLot]);
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'No data found for this yarn lot' });
        }
        
        const formId = mainData[0].id;
        
        const [receivedDetails] = await connection.query(
            'SELECT * FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        res.status(200).json({
            ...mainData[0],
            yarn_received_details: receivedDetails,
            yarn_requirements_details: requirementsDetails
        });
    } catch (error) {
        console.error('Error fetching data by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch data by yarn lot', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Enhanced API endpoint for fetching yarn data by lot with comprehensive dispo aggregation
app.get('/main/api/yarn/fetch-by-lot-enhanced/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    try {
        connection = await pool.getConnection();
        
        // Get the most recent record for form population
        const [mainData] = await connection.query(`
            SELECT * FROM yarn_receive_form 
            WHERE yarn_lot = ?
            ORDER BY created_at DESC LIMIT 1
        `, [yarnLot]);
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'No data found for this yarn lot' });
        }
        
        const formId = mainData[0].id;
        
        // Fetch breakdown data
        const [receivedDetails] = await connection.query(
            'SELECT * FROM yarn_received_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        const [requirementsDetails] = await connection.query(
            'SELECT * FROM yarn_requirements_details WHERE yarn_receive_form_id = ? ORDER BY id',
            [formId]
        );
        
        // Comprehensive dispo number aggregation from multiple sources
        const allDispoNumbers = new Set();
        
        // Source 1: received_against_dispo_nos field from all records with this yarn_lot
        const [dispoFromReceived] = await connection.query(`
            SELECT DISTINCT received_against_dispo_nos 
            FROM yarn_receive_form 
            WHERE yarn_lot = ? 
            AND received_against_dispo_nos IS NOT NULL 
            AND received_against_dispo_nos != ''
        `, [yarnLot]);
        
        dispoFromReceived.forEach(record => {
            if (record.received_against_dispo_nos) {
                const disposNos = record.received_against_dispo_nos.split(',')
                    .map(dispo => dispo.trim())
                    .filter(dispo => dispo && dispo !== 'N/A');
                disposNos.forEach(dispo => allDispoNumbers.add(dispo));
            }
        });
        
        // Source 2: dispo_no from yarn_requirements_details for all records with this yarn_lot
        const [dispoFromRequirements] = await connection.query(`
            SELECT DISTINCT req.dispo_no 
            FROM yarn_requirements_details req
            JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
            WHERE y.yarn_lot = ? 
            AND req.dispo_no IS NOT NULL 
            AND req.dispo_no != ''
        `, [yarnLot]);
        
        dispoFromRequirements.forEach(record => {
            if (record.dispo_no && record.dispo_no !== 'N/A') {
                allDispoNumbers.add(record.dispo_no.trim());
            }
        });
        
        // Source 3: search_dispo field from all records with this yarn_lot
        const [dispoFromSearch] = await connection.query(`
            SELECT DISTINCT search_dispo 
            FROM yarn_receive_form 
            WHERE yarn_lot = ? 
            AND search_dispo IS NOT NULL 
            AND search_dispo != ''
        `, [yarnLot]);
        
        dispoFromSearch.forEach(record => {
            if (record.search_dispo && record.search_dispo !== 'N/A') {
                allDispoNumbers.add(record.search_dispo.trim());
            }
        });
        
        // Source 4: Check if yarn_lot matches any dispo_number pattern
        const [directDispoMatch] = await connection.query(`
            SELECT dispo_number 
            FROM dispo_form_data 
            WHERE dispo_number LIKE ? 
            OR LOWER(dispo_number) LIKE LOWER(?)
        `, [`%${yarnLot}%`, `%${yarnLot}%`]);
        
        directDispoMatch.forEach(record => {
            if (record.dispo_number) {
                allDispoNumbers.add(record.dispo_number.trim());
            }
        });
        
        const relatedDispoNumbers = Array.from(allDispoNumbers)
            .filter(dispo => dispo && dispo.length > 0)
            .sort();
        
        console.log(`Found ${relatedDispoNumbers.length} related dispo numbers for yarn lot ${yarnLot}:`, relatedDispoNumbers);
        
        res.status(200).json({
            ...mainData[0],
            yarn_received_details: receivedDetails,
            yarn_requirements_details: requirementsDetails,
            related_dispo_numbers: relatedDispoNumbers
        });
    } catch (error) {
        console.error('Error fetching enhanced data by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch enhanced data by yarn lot', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Update yarn receive form data
app.put('/main/api/yarn/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    const { formData, yarnReceivedDetails, yarnRequirementsDetails } = req.body;
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Update main form data
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
        
        // Delete and re-insert yarn received details
        await connection.query('DELETE FROM yarn_received_details WHERE yarn_receive_form_id = ?', [id]);
        if (yarnReceivedDetails && yarnReceivedDetails.length > 0) {
            for (const detail of yarnReceivedDetails) {
                await connection.query(`
                    INSERT INTO yarn_received_details (yarn_receive_form_id, received_date, quantity_kgs)
                    VALUES (?, ?, ?)
                `, [id, detail.received_date, detail.quantity_kgs]);
            }
        }
        
        // Delete and re-insert yarn requirements details
        await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [id]);
        if (yarnRequirementsDetails && yarnRequirementsDetails.length > 0) {
            for (const detail of yarnRequirementsDetails) {
                await connection.query(`
                    INSERT INTO yarn_requirements_details (yarn_receive_form_id, warp_required_kgs, weft_required_kgs, dispo_no, total_required_kgs)
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

// Save yarn receive form data to MySQL (with update functionality)
app.post('/main/api/yarn/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { formData, yarnReceivedDetails, yarnRequirementsDetails } = req.body;
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Check if record exists based on unique combination of yarn_count, yarn_brand, yarn_lot
        const [existingRecord] = await connection.query(`
            SELECT id FROM yarn_receive_form 
            WHERE yarn_count = ? AND yarn_brand = ? AND yarn_lot = ?
            ORDER BY created_at DESC LIMIT 1
        `, [formData.yarn_count, formData.yarn_brand, formData.yarn_lot]);
        
        let formId;
        let isUpdate = false;
        
        if (existingRecord.length > 0) {
            // Update existing record
            formId = existingRecord[0].id;
            isUpdate = true;
            
            await connection.query(`
                UPDATE yarn_receive_form SET
                yarn_ply = ?, lc_no = ?, lc_date = ?, beneficiary_factory = ?, received_against_po_no = ?,
                received_against_dispo_nos = ?, pi_no = ?, received_start_date = ?, yarn_type = ?, yarn_composition = ?,
                last_received_date = ?, pi_lc_rate = ?, dollar_rate = ?, rate_cost_sheet = ?, country_of_origin = ?,
                import_local_source = ?, receipt_qty_kgs = ?, total_taka_bd = ?, lc_unit = ?, challan_no = ?, special_notes = ?,
                search_dispo = ?, total_received_against_gd = ?, dispo_nos_for_yarn_lot = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                formData.yarn_ply, formData.lc_no, formData.lc_date,
                formData.beneficiary_factory, formData.received_against_po_no, formData.received_against_dispo_nos,
                formData.pi_no, formData.received_start_date, formData.yarn_type, formData.yarn_composition,
                formData.last_received_date, formData.pi_lc_rate, formData.dollar_rate, formData.rate_cost_sheet, 
                formData.country_of_origin, formData.import_local_source, formData.receipt_qty_kgs, formData.total_taka_bd, 
                formData.lc_unit, formData.challan_no, formData.special_notes, formData.search_dispo, 
                formData.total_received_against_gd, formData.dispo_nos_for_yarn_lot, formId
            ]);
            
            // Delete existing related records before inserting new ones
            await connection.query('DELETE FROM yarn_received_details WHERE yarn_receive_form_id = ?', [formId]);
            await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [formId]);
        } else {
            // Insert new record
            const [result] = await connection.query(`
                INSERT INTO yarn_receive_form (
                    yarn_count, yarn_ply, lc_no, lc_date, beneficiary_factory, received_against_po_no,
                    received_against_dispo_nos, pi_no, received_start_date, yarn_type, yarn_composition,
                    last_received_date, yarn_brand, yarn_lot, pi_lc_rate, dollar_rate, rate_cost_sheet, 
                    country_of_origin, import_local_source, receipt_qty_kgs, total_taka_bd, lc_unit, 
                    challan_no, special_notes, search_dispo, total_received_against_gd, dispo_nos_for_yarn_lot
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
        
        // Insert yarn received details
        if (yarnReceivedDetails && yarnReceivedDetails.length > 0) {
            for (const detail of yarnReceivedDetails) {
                await connection.query(`
                    INSERT INTO yarn_received_details (yarn_receive_form_id, received_date, quantity_kgs)
                    VALUES (?, ?, ?)
                `, [formId, detail.received_date, detail.quantity_kgs]);
            }
        }
        
        // Insert yarn requirements details
        if (yarnRequirementsDetails && yarnRequirementsDetails.length > 0) {
            for (const detail of yarnRequirementsDetails) {
                await connection.query(`
                    INSERT INTO yarn_requirements_details (yarn_receive_form_id, warp_required_kgs, weft_required_kgs, dispo_no, total_required_kgs)
                    VALUES (?, ?, ?, ?, ?)
                `, [formId, detail.warp_required_kgs, detail.weft_required_kgs, detail.dispo_no, detail.total_required_kgs]);
            }
        }
        
        await connection.commit();
        res.status(200).json({ 
            message: isUpdate ? 'Yarn receive data updated successfully!' : 'Yarn receive data saved successfully!', 
            id: formId,
            isUpdate: isUpdate
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving yarn receive data:', error);
        res.status(500).json({ error: 'Failed to save yarn receive data', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get saved yarn records
app.get('/main/api/yarn/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                y.id, y.yarn_count, y.yarn_ply, y.lc_no, y.yarn_brand, y.yarn_lot,
                y.beneficiary_factory, y.receipt_qty_kgs, y.total_taka_bd, y.dollar_rate, y.created_at,
                COUNT(r.id) as received_entries,
                COUNT(req.id) as requirement_entries,
                SUM(r.quantity_kgs) as total_received_qty,
                SUM(req.total_required_kgs) as total_required_qty
            FROM yarn_receive_form y
            LEFT JOIN yarn_received_details r ON y.id = r.yarn_receive_form_id
            LEFT JOIN yarn_requirements_details req ON y.id = req.yarn_receive_form_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(y.created_at) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(y.created_at) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(y.created_at) <= DATE(?)';
            params.push(endDate);
        }
        
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

// Export yarn records to Excel/CSV
app.get('/main/api/yarn/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { startDate, endDate } = req.query;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        let query = `
            SELECT 
                y.*,
                GROUP_CONCAT(DISTINCT CONCAT(r.received_date, ':', r.quantity_kgs) SEPARATOR ';') as received_details,
                GROUP_CONCAT(DISTINCT CONCAT(req.warp_required_kgs, ':', req.weft_required_kgs, ':', req.dispo_no, ':', req.total_required_kgs) SEPARATOR ';') as requirement_details
            FROM yarn_receive_form y
            LEFT JOIN yarn_received_details r ON y.id = r.yarn_receive_form_id
            LEFT JOIN yarn_requirements_details req ON y.id = req.yarn_receive_form_id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (startDate && endDate) {
            query += ' AND DATE(y.created_at) BETWEEN DATE(?) AND DATE(?)';
            params.push(startDate, endDate);
        } else if (startDate) {
            query += ' AND DATE(y.created_at) >= DATE(?)';
            params.push(startDate);
        } else if (endDate) {
            query += ' AND DATE(y.created_at) <= DATE(?)';
            params.push(endDate);
        }
        
        query += ' GROUP BY y.id ORDER BY y.created_at DESC';
        
        const [rows] = await connection.query(query, params);
        
        // Create CSV content with dollar_rate included
        const csvHeader = [
            'ID', 'Yarn Count', 'Yarn Ply', 'LC No', 'LC Date', 'Beneficiary Factory',
            'Received Against PO No', 'Received Against Dispo Nos', 'PI No', 'Received Start Date',
            'Yarn Type', 'Yarn Composition', 'Last Received Date', 'Yarn Brand', 'Yarn Lot',
            'PI/LC Rate', 'Dollar Rate', 'Rate Cost Sheet', 'Country of Origin', 'Import/Local Source',
            'Receipt Qty (Kgs)', 'Total Taka (BD)', 'LC Unit', 'Challan No', 'Special Notes',
            'Search Dispo', 'Total Received Against GD', 'Created At'
        ].join(',');
        
        const csvRows = rows.map(row => [
            row.id, row.yarn_count, row.yarn_ply, row.lc_no, row.lc_date, row.beneficiary_factory,
            row.received_against_po_no, row.received_against_dispo_nos, row.pi_no, row.received_start_date,
            row.yarn_type, row.yarn_composition, row.last_received_date, row.yarn_brand, row.yarn_lot,
            row.pi_lc_rate, row.dollar_rate, row.rate_cost_sheet, row.country_of_origin, row.import_local_source,
            row.receipt_qty_kgs, row.total_taka_bd, row.lc_unit, row.challan_no, row.special_notes,
            row.search_dispo, row.total_received_against_gd, row.created_at
        ].map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(','));
        
        const csv = [csvHeader, ...csvRows].join('\n');
        
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `yarn_receive_records_${startDate || 'all'}_${endDate || 'all'}_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting yarn records:', error);
        res.status(500).json({ error: 'Failed to export yarn records', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Delete yarn record
app.delete('/main/api/yarn/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Delete related records first (foreign key constraints)
        await connection.query('DELETE FROM yarn_received_details WHERE yarn_receive_form_id = ?', [id]);
        await connection.query('DELETE FROM yarn_requirements_details WHERE yarn_receive_form_id = ?', [id]);
        
        // Delete main record
        const [result] = await connection.query('DELETE FROM yarn_receive_form WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            throw new Error('No record found with this ID');
        }
        
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

// Fetch dispo numbers related to a yarn lot
app.get('/main/api/yarn/dispo-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Get dispo numbers from yarn_requirements_details for this yarn lot
        const [dispoFromRequirements] = await connection.query(`
            SELECT DISTINCT req.dispo_no 
            FROM yarn_requirements_details req
            JOIN yarn_receive_form y ON req.yarn_receive_form_id = y.id
            WHERE y.yarn_lot = ? AND req.dispo_no IS NOT NULL AND req.dispo_no != ''
        `, [yarnLot]);
        
        // Get dispo numbers from received_against_dispo_nos field
        const [dispoFromReceived] = await connection.query(`
            SELECT DISTINCT received_against_dispo_nos 
            FROM yarn_receive_form 
            WHERE yarn_lot = ? AND received_against_dispo_nos IS NOT NULL AND received_against_dispo_nos != ''
        `, [yarnLot]);
        
        // Combine and deduplicate dispo numbers
        const allDispos = new Set();
        
        // Add from requirements table
        dispoFromRequirements.forEach(row => {
            if (row.dispo_no) allDispos.add(row.dispo_no.trim());
        });
        
        // Add from received field (could be multiple comma-separated values)
        dispoFromReceived.forEach(row => {
            if (row.received_against_dispo_nos) {
                const dispos = row.received_against_dispo_nos.split(',');
                dispos.forEach(dispo => {
                    const trimmed = dispo.trim();
                    if (trimmed) allDispos.add(trimmed);
                });
            }
        });
        
        const uniqueDispos = Array.from(allDispos).sort();
        
        res.status(200).json({ 
            dispo_numbers: uniqueDispos,
            yarn_lot: yarnLot,
            count: uniqueDispos.length
        });
    } catch (error) {
        console.error('Error fetching dispo numbers by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch dispo numbers', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// New API endpoint to get total received quantity by dispo number
app.get('/main/api/yarn/total-received-by-dispo/:dispoNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { dispoNo } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Get total from yarn_requirements_details for this dispo
        const [requirementsTotals] = await connection.query(`
            SELECT SUM(total_required_kgs) as total_from_requirements
            FROM yarn_requirements_details 
            WHERE dispo_no = ?
        `, [dispoNo]);
        
        // Get total from yarn_received_details where the main form has this dispo in received_against_dispo_nos
        const [receivedTotals] = await connection.query(`
            SELECT SUM(rd.quantity_kgs) as total_from_received
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.received_against_dispo_nos LIKE ?
        `, [`%${dispoNo}%`]);
        
        const totalFromRequirements = parseFloat(requirementsTotals[0]?.total_from_requirements || 0);
        const totalFromReceived = parseFloat(receivedTotals[0]?.total_from_received || 0);
        
        // Use the higher of the two totals (or combine them based on your business logic)
        const totalReceived = Math.max(totalFromRequirements, totalFromReceived);
        
        res.status(200).json({ 
            total_received: totalReceived,
            dispo_no: dispoNo,
            breakdown: {
                from_requirements: totalFromRequirements,
                from_received_details: totalFromReceived
            }
        });
    } catch (error) {
        console.error('Error fetching total received by dispo:', error);
        res.status(500).json({ error: 'Failed to fetch total received', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================
// UPDATED YARN ISSUE FORM API ENDPOINTS
// =====================================================

// Generate next issue number for yarn issue
app.get('/main/api/yarn-issue/next-issue-no', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const currentYear = new Date().getFullYear();
        
        const [rows] = await connection.query(
            'SELECT issue_challan_no FROM yarn_issue_form WHERE issue_challan_no LIKE ? ORDER BY issue_challan_no DESC LIMIT 1',
            [`YI-${currentYear}-%`]
        );

        let nextNumber = 1;
        if (rows.length > 0) {
            const lastIssueNo = rows[0].issue_challan_no;
            const lastNumber = parseInt(lastIssueNo.split('-')[2], 10);
            nextNumber = lastNumber + 1;
        }

        const formattedNextNumber = `YI-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
        res.status(200).json({ issue_no: formattedNextNumber });
    } catch (error) {
        console.error('Error generating next issue number:', error);
        res.status(500).json({ error: 'Failed to generate next issue number', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});


// Fetch yarn lots from yarn_issue_form for dropdown
app.get('/main/api/yarn-issue/yarn-lots', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [rows] = await connection.query(`
            SELECT DISTINCT
                id,
                yarn_lot,
                yarn_count,
                yarn_ply,
                yarn_brand,
                yarn_type,
                yarn_composition,
                issued_to,
                issue_type,
                issue_date,
                total_issued_kg,
                remaining_stock_kg
            FROM yarn_issue_form
            WHERE yarn_lot IS NOT NULL AND yarn_lot != ''
            ORDER BY created_at DESC
        `);
        
        const formattedRows = rows.map(row => {
            const displayParts = [
                row.yarn_count || 'N/A',
                row.yarn_ply || 'N/A',
                row.yarn_lot || 'N/A',
                row.yarn_brand || 'N/A',
                row.issued_to || 'N/A',
                row.issue_type || 'N/A',
                row.issue_date ? new Date(row.issue_date).toISOString().split('T')[0] : 'N/A'
            ];
            
            return {
                yarn_lot: row.yarn_lot,
                display: displayParts.join(' | '),
                data: row
            };
        });
        
        res.status(200).json(formattedRows);
    } catch (error) {
        console.error('Error fetching yarn issue lots:', error);
        res.status(500).json({ error: 'Failed to fetch yarn issue lots', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});



// Fetch dispo numbers from yarn_issue_form for dropdown
app.get('/main/api/yarn-issue/dispo-numbers', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [rows] = await connection.query(`
            SELECT DISTINCT
                id,
                received_against_dispo_nos as dispo_no,
                yarn_count,
                yarn_ply,
                yarn_lot,
                yarn_brand,
                yarn_composition,
                issued_to,
                issue_date,
                total_issued_kg
            FROM yarn_issue_form
            WHERE received_against_dispo_nos IS NOT NULL 
            AND received_against_dispo_nos != ''
            ORDER BY created_at DESC
        `);
        
        const formattedRows = rows.map(row => {
            const displayParts = [
                row.yarn_count || 'N/A',
                row.yarn_ply || 'N/A',
                row.dispo_no || 'N/A',
                row.yarn_lot || 'N/A',
                row.yarn_brand || 'N/A',
                row.issued_to || 'N/A',
                row.issue_date ? new Date(row.issue_date).toISOString().split('T')[0] : 'N/A',
                `${row.total_issued_kg || 0} kg`
            ];
            
            return {
                dispo_no: row.dispo_no,
                display: displayParts.join(' | '),
                data: row
            };
        });
        
        res.status(200).json(formattedRows);
    } catch (error) {
        console.error('Error fetching yarn issue dispo numbers:', error);
        res.status(500).json({ error: 'Failed to fetch dispo numbers', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});


// Fetch yarn issue record by ID for editing
app.get('/main/api/yarn-issue/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        const [mainData] = await connection.query(
            'SELECT * FROM yarn_issue_form WHERE id = ?',
            [id]
        );
        
        if (mainData.length === 0) {
            return res.status(404).json({ error: 'Issue record not found' });
        }
        
        const [issueDetails] = await connection.query(
            'SELECT * FROM yarn_issue_details WHERE yarn_issue_form_id = ? ORDER BY id',
            [id]
        );
        
        res.status(200).json({
            ...mainData[0],
            issue_details: issueDetails
        });
    } catch (error) {
        console.error('Error fetching yarn issue by ID:', error);
        res.status(500).json({ error: 'Failed to fetch issue record', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});



// Save yarn issue form data
app.post('/main/api/yarn-issue/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { formData, issueDetails } = req.body;
    
    console.log('Received formData:', formData);
    console.log('Received issueDetails:', issueDetails);
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Insert main form data
        const [result] = await connection.query(`
            INSERT INTO yarn_issue_form (
                yarn_count, yarn_ply, lc_no, lc_date, beneficiary_factory,
                received_against_po_no, received_against_dispo_nos, pi_no,
                received_start_date, last_received_date, yarn_lot, yarn_brand,
                yarn_type, yarn_composition, pi_lc_rate, rate_cost_sheet,
                issued_to, country_of_origin, import_local_source,
                receive_challan_no, issue_challan_no, issue_date, issue_type,
                outside_issue_kg, total_warp_issue_kgs, total_weft_issue_kgs,
                warp_yarn_price, weft_yarn_price, total_received_kg,
                total_issued_kg, remaining_stock_kg, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            formData.yarn_count, formData.yarn_ply, formData.lc_no, formData.lc_date,
            formData.beneficiary_factory, formData.received_against_po_no,
            formData.received_against_dispo_nos, formData.pi_no, formData.received_start_date,
            formData.last_received_date, formData.yarn_lot, formData.yarn_brand,
            formData.yarn_type, formData.yarn_composition, formData.pi_lc_rate,
            formData.rate_cost_sheet, formData.issued_to, formData.country_of_origin,
            formData.import_local_source, formData.receive_challan_no, formData.issue_challan_no,
            formData.issue_date, formData.issue_type, formData.outside_issue_kg,
            formData.total_warp_issue_kgs, formData.total_weft_issue_kgs,
            formData.warp_yarn_price, formData.weft_yarn_price, formData.total_received_kg,
            formData.total_issued_kg, formData.remaining_stock_kg, formData.remarks
        ]);
        
        const formId = result.insertId;
        
        // Insert issue details (with both receive and issue data)
        if (issueDetails && issueDetails.length > 0) {
            for (const detail of issueDetails) {
                await connection.query(`
                    INSERT INTO yarn_issue_details (
                        yarn_issue_form_id, receive_date, receive_quantity,
                        issue_date, issued_quantity
                    ) VALUES (?, ?, ?, ?, ?)
                `, [
                    formId,
                    detail.receive_date || null,
                    detail.receive_quantity || 0,
                    detail.issue_date || null,
                    detail.issued_quantity || 0
                ]);
            }
        }
        
        await connection.commit();
        res.status(200).json({ message: 'Yarn issue data saved successfully!', id: formId });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error saving yarn issue data:', error);
        res.status(500).json({ error: 'Failed to save yarn issue data', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Update yarn issue form data
app.put('/main/api/yarn-issue/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    const { formData, issueDetails } = req.body;
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Update main form data
        await connection.query(`
            UPDATE yarn_issue_form SET
                yarn_count = ?, yarn_ply = ?, lc_no = ?, lc_date = ?,
                beneficiary_factory = ?, received_against_po_no = ?,
                received_against_dispo_nos = ?, pi_no = ?, received_start_date = ?,
                last_received_date = ?, yarn_lot = ?, yarn_brand = ?,
                yarn_type = ?, yarn_composition = ?, pi_lc_rate = ?,
                rate_cost_sheet = ?, issued_to = ?, country_of_origin = ?,
                import_local_source = ?, receive_challan_no = ?, issue_challan_no = ?,
                issue_date = ?, issue_type = ?, outside_issue_kg = ?,
                total_warp_issue_kgs = ?, total_weft_issue_kgs = ?,
                warp_yarn_price = ?, weft_yarn_price = ?, total_received_kg = ?,
                total_issued_kg = ?, remaining_stock_kg = ?, remarks = ?
            WHERE id = ?
        `, [
            formData.yarn_count, formData.yarn_ply, formData.lc_no, formData.lc_date,
            formData.beneficiary_factory, formData.received_against_po_no,
            formData.received_against_dispo_nos, formData.pi_no, formData.received_start_date,
            formData.last_received_date, formData.yarn_lot, formData.yarn_brand,
            formData.yarn_type, formData.yarn_composition, formData.pi_lc_rate,
            formData.rate_cost_sheet, formData.issued_to, formData.country_of_origin,
            formData.import_local_source, formData.receive_challan_no, formData.issue_challan_no,
            formData.issue_date, formData.issue_type, formData.outside_issue_kg,
            formData.total_warp_issue_kgs, formData.total_weft_issue_kgs,
            formData.warp_yarn_price, formData.weft_yarn_price, formData.total_received_kg,
            formData.total_issued_kg, formData.remaining_stock_kg, formData.remarks, id
        ]);
        
        // Delete and re-insert issue details
        await connection.query('DELETE FROM yarn_issue_details WHERE yarn_issue_form_id = ?', [id]);
        
        if (issueDetails && issueDetails.length > 0) {
            for (const detail of issueDetails) {
                await connection.query(`
                    INSERT INTO yarn_issue_details (
                        yarn_issue_form_id, receive_date, receive_quantity,
                        issue_date, issued_quantity
                    ) VALUES (?, ?, ?, ?, ?)
                `, [
                    id,
                    detail.receive_date || null,
                    detail.receive_quantity || 0,
                    detail.issue_date || null,
                    detail.issued_quantity || 0
                ]);
            }
        }
        
        await connection.commit();
        res.status(200).json({ message: 'Yarn issue data updated successfully!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error updating yarn issue data:', error);
        res.status(500).json({ error: 'Failed to update yarn issue data', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get saved yarn issue records
app.get('/main/api/yarn-issue/saved-records', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [rows] = await connection.query(`
            SELECT 
                y.id, y.yarn_lot, y.yarn_count, y.yarn_ply, y.issued_to,
                y.issue_type, y.issue_date, y.total_issued_kg, y.total_received_kg,
                y.remaining_stock_kg, y.created_at,
                COUNT(d.id) as detail_entries,
                SUM(d.issued_quantity) as total_issued_from_details
            FROM yarn_issue_form y
            LEFT JOIN yarn_issue_details d ON y.id = d.yarn_issue_form_id
            GROUP BY y.id
            ORDER BY y.created_at DESC
        `);
        
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching saved yarn issue records:', error);
        res.status(500).json({ error: 'Failed to fetch saved records', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Export yarn issue records to CSV
app.get('/main/api/yarn-issue/export-excel', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [rows] = await connection.query(`
            SELECT * FROM yarn_issue_form ORDER BY created_at DESC
        `);
        
        const csvHeader = [
            'ID', 'Yarn Lot', 'Yarn Count', 'Yarn Ply', 'Yarn Brand', 'Yarn Type',
            'Yarn Composition', 'LC No', 'LC Date', 'Beneficiary Factory',
            'Received Against PO No', 'Received Against Dispo Nos', 'PI No',
            'Received Start Date', 'Last Received Date', 'PI/LC Rate', 'Rate Cost Sheet',
            'Issued To', 'Country of Origin', 'Import/Local Source',
            'Receive Challan No', 'Issue Challan No', 'Issue Date', 'Issue Type',
            'Outside Issue (KG)', 'Total Warp Issue (KG)', 'Total Weft Issue (KG)',
            'Warp Yarn Price', 'Weft Yarn Price', 'Total Received (KG)',
            'Total Issued (KG)', 'Remaining Stock (KG)', 'Remarks', 'Created At'
        ].join(',');
        
        const csvRows = rows.map(row => [
            row.id, row.yarn_lot, row.yarn_count, row.yarn_ply, row.yarn_brand,
            row.yarn_type, row.yarn_composition, row.lc_no, row.lc_date,
            row.beneficiary_factory, row.received_against_po_no,
            row.received_against_dispo_nos, row.pi_no, row.received_start_date,
            row.last_received_date, row.pi_lc_rate, row.rate_cost_sheet,
            row.issued_to, row.country_of_origin, row.import_local_source,
            row.receive_challan_no, row.issue_challan_no, row.issue_date,
            row.issue_type, row.outside_issue_kg, row.total_warp_issue_kgs,
            row.total_weft_issue_kgs, row.warp_yarn_price, row.weft_yarn_price,
            row.total_received_kg, row.total_issued_kg, row.remaining_stock_kg,
            row.remarks, row.created_at
        ].map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(','));
        
        const csv = [csvHeader, ...csvRows].join('\n');
        
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `yarn_issue_records_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Error exporting yarn issue records:', error);
        res.status(500).json({ error: 'Failed to export records', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Delete yarn issue record
app.delete('/main/api/yarn-issue/delete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { id } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        
        // Delete related details first (cascade should handle this, but explicit is safer)
        await connection.query('DELETE FROM yarn_issue_details WHERE yarn_issue_form_id = ?', [id]);
        
        // Delete main record
        const [result] = await connection.query('DELETE FROM yarn_issue_form WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            throw new Error('No record found with this ID');
        }
        
        await connection.commit();
        res.status(200).json({ message: 'Yarn issue record deleted successfully!' });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error deleting yarn issue record:', error);
        res.status(500).json({ error: 'Failed to delete record', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Fetch PO numbers for dropdown
app.get('/main/api/po/numbers', async (req, res) => {
    if (!req.session.user) {
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
        
        res.status(200).json(rows.map(row => row.po_no));
    } catch (error) {
        console.error('Error fetching PO numbers:', error);
        res.status(500).json({ error: 'Failed to fetch PO numbers', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});


// =====================================================
// AGGREGATED TOTALS API ENDPOINTS
// =====================================================

// Get total received quantity by PO number
app.get('/main/api/yarn/total-received-by-po/:poNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { poNo } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Sum from yarn_receive_form
        const [mainTotals] = await connection.query(`
            SELECT SUM(receipt_qty_kgs) as total_received
            FROM yarn_receive_form 
            WHERE received_against_po_no = ?
        `, [poNo]);
        
        // Sum from yarn_received_details
        const [detailTotals] = await connection.query(`
            SELECT SUM(rd.quantity_kgs) as total_from_details
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.received_against_po_no = ?
        `, [poNo]);
        
        const totalFromMain = parseFloat(mainTotals[0]?.total_received || 0);
        const totalFromDetails = parseFloat(detailTotals[0]?.total_from_details || 0);
        
        // Use the higher value or details if both exist
        const totalReceived = totalFromDetails > 0 ? totalFromDetails : totalFromMain;
        
        res.status(200).json({ 
            total_received: totalReceived,
            po_no: poNo
        });
    } catch (error) {
        console.error('Error fetching total received by PO:', error);
        res.status(500).json({ error: 'Failed to fetch total received', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get total issued quantity by PO number
app.get('/main/api/yarn-issue/total-issued-by-po/:poNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { poNo } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Sum from yarn_issue_form
        const [mainTotals] = await connection.query(`
            SELECT SUM(total_issued_kg) as total_issued
            FROM yarn_issue_form 
            WHERE received_against_po_no = ?
        `, [poNo]);
        
        // Sum from yarn_issue_details
        const [detailTotals] = await connection.query(`
            SELECT SUM(id.issued_quantity) as total_from_details
            FROM yarn_issue_details id
            JOIN yarn_issue_form yif ON id.yarn_issue_form_id = yif.id
            WHERE yif.received_against_po_no = ?
        `, [poNo]);
        
        const totalFromMain = parseFloat(mainTotals[0]?.total_issued || 0);
        const totalFromDetails = parseFloat(detailTotals[0]?.total_from_details || 0);
        
        // Use the higher value or details if both exist
        const totalIssued = totalFromDetails > 0 ? totalFromDetails : totalFromMain;
        
        res.status(200).json({ 
            total_issued: totalIssued,
            po_no: poNo
        });
    } catch (error) {
        console.error('Error fetching total issued by PO:', error);
        res.status(500).json({ error: 'Failed to fetch total issued', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get total received quantity by Dispo number
app.get('/main/api/yarn/total-received-by-dispo/:dispoNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { dispoNo } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Sum from yarn_receive_form where dispo is in received_against_dispo_nos
        const [mainTotals] = await connection.query(`
            SELECT SUM(receipt_qty_kgs) as total_received
            FROM yarn_receive_form 
            WHERE received_against_dispo_nos LIKE ? 
            OR received_against_dispo_nos = ?
        `, [`%${dispoNo}%`, dispoNo]);
        
        // Sum from yarn_received_details
        const [detailTotals] = await connection.query(`
            SELECT SUM(rd.quantity_kgs) as total_from_details
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.received_against_dispo_nos LIKE ? 
            OR yrf.received_against_dispo_nos = ?
        `, [`%${dispoNo}%`, dispoNo]);
        
        // Sum from yarn_requirements_details
        const [requirementTotals] = await connection.query(`
            SELECT SUM(total_required_kgs) as total_from_requirements
            FROM yarn_requirements_details 
            WHERE dispo_no = ?
        `, [dispoNo]);
        
        const totalFromMain = parseFloat(mainTotals[0]?.total_received || 0);
        const totalFromDetails = parseFloat(detailTotals[0]?.total_from_details || 0);
        const totalFromRequirements = parseFloat(requirementTotals[0]?.total_from_requirements || 0);
        
        // Use the highest value
        const totalReceived = Math.max(totalFromMain, totalFromDetails, totalFromRequirements);
        
        res.status(200).json({ 
            total_received: totalReceived,
            dispo_no: dispoNo
        });
    } catch (error) {
        console.error('Error fetching total received by dispo:', error);
        res.status(500).json({ error: 'Failed to fetch total received', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get total issued quantity by Dispo number
app.get('/main/api/yarn-issue/total-issued-by-dispo/:dispoNo', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { dispoNo } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Sum from yarn_issue_form where dispo is in received_against_dispo_nos
        const [mainTotals] = await connection.query(`
            SELECT SUM(total_issued_kg) as total_issued
            FROM yarn_issue_form 
            WHERE received_against_dispo_nos LIKE ? 
            OR received_against_dispo_nos = ?
        `, [`%${dispoNo}%`, dispoNo]);
        
        // Sum from yarn_issue_details
        const [detailTotals] = await connection.query(`
            SELECT SUM(id.issued_quantity) as total_from_details
            FROM yarn_issue_details id
            JOIN yarn_issue_form yif ON id.yarn_issue_form_id = yif.id
            WHERE yif.received_against_dispo_nos LIKE ? 
            OR yif.received_against_dispo_nos = ?
        `, [`%${dispoNo}%`, dispoNo]);
        
        const totalFromMain = parseFloat(mainTotals[0]?.total_issued || 0);
        const totalFromDetails = parseFloat(detailTotals[0]?.total_from_details || 0);
        
        // Use the higher value
        const totalIssued = Math.max(totalFromMain, totalFromDetails);
        
        res.status(200).json({ 
            total_issued: totalIssued,
            dispo_no: dispoNo
        });
    } catch (error) {
        console.error('Error fetching total issued by dispo:', error);
        res.status(500).json({ error: 'Failed to fetch total issued', details: error.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get combined totals by yarn lot
app.get('/main/api/yarn/totals-by-lot/:yarnLot', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { yarnLot } = req.params;
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Total received from yarn_receive_form
        const [receivedMain] = await connection.query(`
            SELECT SUM(receipt_qty_kgs) as total_received
            FROM yarn_receive_form 
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        // Total received from yarn_received_details
        const [receivedDetails] = await connection.query(`
            SELECT SUM(rd.quantity_kgs) as total_from_details
            FROM yarn_received_details rd
            JOIN yarn_receive_form yrf ON rd.yarn_receive_form_id = yrf.id
            WHERE yrf.yarn_lot = ?
        `, [yarnLot]);
        
        // Total issued from yarn_issue_form
        const [issuedMain] = await connection.query(`
            SELECT SUM(total_issued_kg) as total_issued
            FROM yarn_issue_form 
            WHERE yarn_lot = ?
        `, [yarnLot]);
        
        // Total issued from yarn_issue_details
        const [issuedDetails] = await connection.query(`
            SELECT SUM(id.issued_quantity) as total_from_details
            FROM yarn_issue_details id
            JOIN yarn_issue_form yif ON id.yarn_issue_form_id = yif.id
            WHERE yif.yarn_lot = ?
        `, [yarnLot]);
        
        const totalReceivedMain = parseFloat(receivedMain[0]?.total_received || 0);
        const totalReceivedDetails = parseFloat(receivedDetails[0]?.total_from_details || 0);
        const totalIssuedMain = parseFloat(issuedMain[0]?.total_issued || 0);
        const totalIssuedDetails = parseFloat(issuedDetails[0]?.total_from_details || 0);
        
        const totalReceived = Math.max(totalReceivedMain, totalReceivedDetails);
        const totalIssued = Math.max(totalIssuedMain, totalIssuedDetails);
        const remaining = totalReceived - totalIssued;
        
        res.status(200).json({ 
            total_received: totalReceived,
            total_issued: totalIssued,
            remaining: remaining,
            yarn_lot: yarnLot
        });
    } catch (error) {
        console.error('Error fetching totals by yarn lot:', error);
        res.status(500).json({ error: 'Failed to fetch totals', details: error.message });
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


// =====================================================
// DYED YARN RECEIVE FORM - NEW API ENDPOINTS
// =====================================================



// ========== FETCH DYED YARN RECORDS FOR SEARCH DROPDOWN (UPDATED) ==========
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
                dyed_yarn_received_date,
                received_against_po_no,
                received_against_dispo_no,
                buyer,
                batch_no,
                yarn_count,
                number_of_ply,
                yarn_shade_category
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

// ========== SAVE DYED YARN RECORD (UPDATED) ==========
app.post('/main/api/dyed-yarn/save', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { formData, breakdownDetails, warpDetails, weftDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Insert main dyed yarn record with proper null handling
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
                    dyedYarnId,
                    nullIfEmpty(detail.dyed_yarn_received_date),
                    nullIfEmpty(detail.dyed_yarn_received_color),
                    parseFloat(detail.dyed_yarn_received_qty) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_breakdown (
                        dyed_yarn_id, dyed_yarn_received_date, 
                        dyed_yarn_received_color, dyed_yarn_received_qty
                    ) VALUES ?`,
                    [breakdownValues]
                );
            }
        }

        // Insert warp details (only if not empty)
        if (warpDetails && warpDetails.length > 0) {
            const validWarpDetails = warpDetails.filter(detail => 
                detail.warp_required_kgs > 0 && detail.dispo_no
            );
            
            if (validWarpDetails.length > 0) {
                const warpValues = validWarpDetails.map(detail => [
                    dyedYarnId,
                    parseFloat(detail.warp_required_kgs) || 0,
                    nullIfEmpty(detail.dispo_no),
                    nullIfEmpty(detail.count),
                    nullIfEmpty(detail.ply),
                    nullIfEmpty(detail.color_name),
                    parseFloat(detail.dyed_qty_kg) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_warp_details (
                        dyed_yarn_id, warp_required_kgs, dispo_no,
                        count, ply, color_name, dyed_qty_kg
                    ) VALUES ?`,
                    [warpValues]
                );
            }
        }

        // Insert weft details (only if not empty)
        if (weftDetails && weftDetails.length > 0) {
            const validWeftDetails = weftDetails.filter(detail => 
                detail.weft_required_kgs > 0 && detail.dispo_no
            );
            
            if (validWeftDetails.length > 0) {
                const weftValues = validWeftDetails.map(detail => [
                    dyedYarnId,
                    parseFloat(detail.weft_required_kgs) || 0,
                    nullIfEmpty(detail.dispo_no),
                    nullIfEmpty(detail.count),
                    nullIfEmpty(detail.ply),
                    nullIfEmpty(detail.color_name),
                    parseFloat(detail.dyed_qty_kg) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_weft_details (
                        dyed_yarn_id, weft_required_kgs, dispo_no,
                        count, ply, color_name, dyed_qty_kg
                    ) VALUES ?`,
                    [weftValues]
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

// ========== UPDATE DYED YARN RECORD (UPDATED) ==========
app.put('/main/api/dyed-yarn/update/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const dyedYarnId = req.params.id;
        const { formData, breakdownDetails, warpDetails, weftDetails } = req.body;

        // Helper function to convert empty strings to null
        const nullIfEmpty = (value) => {
            if (value === '' || value === undefined) return null;
            return value;
        };

        // Update main dyed yarn record with proper null handling
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
                    dyedYarnId,
                    nullIfEmpty(detail.dyed_yarn_received_date),
                    nullIfEmpty(detail.dyed_yarn_received_color),
                    parseFloat(detail.dyed_yarn_received_qty) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_breakdown (
                        dyed_yarn_id, dyed_yarn_received_date, 
                        dyed_yarn_received_color, dyed_yarn_received_qty
                    ) VALUES ?`,
                    [breakdownValues]
                );
            }
        }

        // Delete existing warp details
        await connection.execute(
            'DELETE FROM dyed_yarn_warp_details WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        // Insert updated warp details (only if not empty)
        if (warpDetails && warpDetails.length > 0) {
            const validWarpDetails = warpDetails.filter(detail => 
                detail.warp_required_kgs > 0 && detail.dispo_no
            );
            
            if (validWarpDetails.length > 0) {
                const warpValues = validWarpDetails.map(detail => [
                    dyedYarnId,
                    parseFloat(detail.warp_required_kgs) || 0,
                    nullIfEmpty(detail.dispo_no),
                    nullIfEmpty(detail.count),
                    nullIfEmpty(detail.ply),
                    nullIfEmpty(detail.color_name),
                    parseFloat(detail.dyed_qty_kg) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_warp_details (
                        dyed_yarn_id, warp_required_kgs, dispo_no,
                        count, ply, color_name, dyed_qty_kg
                    ) VALUES ?`,
                    [warpValues]
                );
            }
        }

        // Delete existing weft details
        await connection.execute(
            'DELETE FROM dyed_yarn_weft_details WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        // Insert updated weft details (only if not empty)
        if (weftDetails && weftDetails.length > 0) {
            const validWeftDetails = weftDetails.filter(detail => 
                detail.weft_required_kgs > 0 && detail.dispo_no
            );
            
            if (validWeftDetails.length > 0) {
                const weftValues = validWeftDetails.map(detail => [
                    dyedYarnId,
                    parseFloat(detail.weft_required_kgs) || 0,
                    nullIfEmpty(detail.dispo_no),
                    nullIfEmpty(detail.count),
                    nullIfEmpty(detail.ply),
                    nullIfEmpty(detail.color_name),
                    parseFloat(detail.dyed_qty_kg) || 0
                ]);

                await connection.query(
                    `INSERT INTO dyed_yarn_weft_details (
                        dyed_yarn_id, weft_required_kgs, dispo_no,
                        count, ply, color_name, dyed_qty_kg
                    ) VALUES ?`,
                    [weftValues]
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
        console.error('Error updating dyed yarn record:', error);
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

// ========== FETCH DYED YARN BY ID ==========
app.get('/main/api/dyed-yarn/fetch-by-id/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        const dyedYarnId = req.params.id;

        // Get main record
        const [mainRecords] = await connection.execute(
            'SELECT * FROM dyed_yarn_receive WHERE id = ?',
            [dyedYarnId]
        );

        if (mainRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Dyed yarn record not found'
            });
        }

        const mainRecord = mainRecords[0];

        // Get breakdown details
        const [breakdownDetails] = await connection.execute(
            `SELECT * FROM dyed_yarn_breakdown 
             WHERE dyed_yarn_id = ? 
             ORDER BY id`,
            [dyedYarnId]
        );

        // Get warp details
        const [warpDetails] = await connection.execute(
            `SELECT * FROM dyed_yarn_warp_details 
             WHERE dyed_yarn_id = ? 
             ORDER BY id`,
            [dyedYarnId]
        );

        // Get weft details
        const [weftDetails] = await connection.execute(
            `SELECT * FROM dyed_yarn_weft_details 
             WHERE dyed_yarn_id = ? 
             ORDER BY id`,
            [dyedYarnId]
        );

        res.json({
            ...mainRecord,
            breakdown_details: breakdownDetails,
            warp_details: warpDetails,
            weft_details: weftDetails
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
                (SELECT COUNT(*) FROM dyed_yarn_breakdown WHERE dyed_yarn_id = dyr.id) as breakdown_entries,
                (SELECT COUNT(*) FROM dyed_yarn_warp_details WHERE dyed_yarn_id = dyr.id) as warp_entries,
                (SELECT COUNT(*) FROM dyed_yarn_weft_details WHERE dyed_yarn_id = dyr.id) as weft_entries
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

        // Delete related records (CASCADE should handle this if FK constraints are set)
        await connection.execute(
            'DELETE FROM dyed_yarn_breakdown WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        await connection.execute(
            'DELETE FROM dyed_yarn_warp_details WHERE dyed_yarn_id = ?',
            [dyedYarnId]
        );

        await connection.execute(
            'DELETE FROM dyed_yarn_weft_details WHERE dyed_yarn_id = ?',
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

// In-memory log storage (replace with file or database if needed)
const logs = [];

// Enhanced logging function for better debugging
function enhancedLog(stage, message, data = null) {
   const timestamp = new Date().toISOString();
   console.log(`[${timestamp}] [${stage}] ${message}`);
   if (data) {
       console.log(`[${timestamp}] [${stage}] Data:`, JSON.stringify(data, null, 2));
   }
}

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