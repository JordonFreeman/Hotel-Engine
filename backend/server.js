// server.js — Entry point for Hotel Reservation REST API
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { getPool }      = require('./config/mssql');
const { connectMongo } = require('./config/mongodb');

const app = express();
app.use(cors());
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────
// /api/hotels   → MongoDB (catalog, amenities) — AP / BASE
// /api/rooms    → MS SQL (room availability)   — CP / ACID
// /api/bookings → MS SQL (booking, locking)    — CP / ACID
// /api/reports  → MS SQL (window functions)    — CP / ACID
app.use('/api/hotels',   require('./routes/hotels'));
app.use('/api/rooms',    require('./routes/rooms'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/reports',  require('./routes/reports'));

// Health check — confirms both DB connections are alive
app.get('/api/health', async (req, res) => {
  try {
    const sqlPool = await getPool();
    await sqlPool.request().query('SELECT 1');
    res.json({
      status: 'ok',
      mssql:  'connected',
      mongodb: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Bootstrap ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await connectMongo();  // BASE store — catalog
    await getPool();       // ACID store — transactions
    app.listen(PORT, () => {
      console.log(`\n🏨  Hotel Reservation API running on http://localhost:${PORT}`);
      console.log('    Polyglot stores: MS SQL (ACID) + MongoDB (BASE)');
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
})();
