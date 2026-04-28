// config/mssql.js
// MS SQL Server handles ACID-compliant transactions:
//   - Room bookings with pessimistic locking (FOR UPDATE equivalent via UPDLOCK hint)
//   - Triggers for rate-change auditing
//   - Window functions for revenue ranking
const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.MSSQL_HOST || 'localhost',
  port: parseInt(process.env.MSSQL_PORT) || 1433,
  database: process.env.MSSQL_DATABASE || 'HotelDB',
  user: process.env.MSSQL_USER || 'sa',
  password: process.env.MSSQL_PASSWORD,
  options: {
    encrypt: false,            // set true for Azure
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: 'SQLEXPRESS', // added for local development with SQL Express
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('[MSSQL] Connected to SQL Server (ACID store)');
  }
  return pool;
}

module.exports = { getPool, sql };
