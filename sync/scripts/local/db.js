'use strict';
const mysql = require('mysql2/promise');
const { loadEnv } = require('./common');
loadEnv();
function cfg(database = process.env.DB_NAME) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST || '127.0.0.1') || database !== 'weavonpq_weaving_local') {
    throw new Error('Local database guard: only loopback / weavonpq_weaving_local is permitted.');
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    multipleStatements: true,
  };
}
async function connect(database = process.env.DB_NAME) { return mysql.createConnection(cfg(database)); }
async function pool(database = process.env.DB_NAME) { return mysql.createPool(cfg(database)); }
module.exports = { cfg, connect, pool };
