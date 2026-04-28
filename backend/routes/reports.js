// routes/reports.js
// Manager reports — backed by the vw_TopRevenueRooms view (RANK() window function)
const express = require('express');
const { getPool, sql } = require('../config/mssql');
const router = express.Router();

// GET /api/reports/top-rooms?hotel_id=1&year=2025&quarter=1
// Returns top 3 revenue-generating rooms per hotel per quarter
router.get('/top-rooms', async (req, res) => {
  try {
    const pool = await getPool();
    const { hotel_id, year, quarter } = req.query;

    let query = `SELECT * FROM vw_TopRevenueRooms WHERE 1=1`;
    const request = pool.request();

    if (hotel_id) {
      query += ' AND HotelID = @hotelId';
      request.input('hotelId', sql.Int, parseInt(hotel_id));
    }
    if (year) {
      query += ' AND [Year] = @year';
      request.input('year', sql.Int, parseInt(year));
    }
    if (quarter) {
      query += ' AND [Quarter] = @quarter';
      request.input('quarter', sql.Int, parseInt(quarter));
    }
    query += ' ORDER BY HotelID, [Year], [Quarter], RevenueRank';

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/rate-changes — audit log from trigger
router.get('/rate-changes', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT rcl.*, h.Name AS HotelName
      FROM RateChangeLog rcl
      JOIN Rooms r ON rcl.RoomID = r.ID
      JOIN Hotels h ON r.HotelID = h.ID
      ORDER BY rcl.ChangedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
