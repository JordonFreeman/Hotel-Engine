// routes/reports.js
// Manager reports — two SQL features demonstrated:
//   1. vw_TopRevenueRooms  → RANK() window function (partitioned by hotel/quarter)
//   2. vw_OccupancyByNight → Recursive CTE (expands bookings into per-night rows)
const express = require('express');
const { getPool, sql } = require('../config/mssql');
const router = express.Router();

// GET /api/reports/top-rooms?hotel_id=1&year=2025&quarter=1
// Queries vw_TopRevenueRooms which uses RANK() OVER(PARTITION BY HotelID, Year, Quarter)
// Returns top 3 revenue-generating rooms per hotel per quarter.
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

// GET /api/reports/occupancy?hotel_id=1&year=2025&month=1
// Queries vw_OccupancyByNight — backed by the Recursive CTE in schema.sql.
//
// The Recursive CTE expands each booking into one row per night of stay:
//   Anchor    → selects CheckIn as the first StayDate for every CONFIRMED booking
//   Recursive → DATEADD(day,1,StayDate) repeated until the day before CheckOut
//
// This endpoint counts how many rooms were occupied on each calendar night,
// enabling a night-by-night occupancy report without storing redundant rows.
router.get('/occupancy', async (req, res) => {
  try {
    const pool    = await getPool();
    const { hotel_id, year, month } = req.query;

    const request = pool.request();
    let query = `
      SELECT
        HotelName,
        StayDate,
        COUNT(DISTINCT RoomID) AS RoomsOccupied
      FROM vw_OccupancyByNight
      WHERE 1=1
    `;

    if (hotel_id) {
      query += ' AND HotelID = @hotelId';
      request.input('hotelId', sql.Int, parseInt(hotel_id));
    }
    if (year) {
      query += ' AND [Year] = @year';
      request.input('year', sql.Int, parseInt(year));
    }
    if (month) {
      query += ' AND [Month] = @month';
      request.input('month', sql.Int, parseInt(month));
    }

    query += ' GROUP BY HotelName, StayDate ORDER BY StayDate';

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/rate-changes — audit log populated by trg_RoomRateChange trigger
// The trigger fires automatically on any Rooms UPDATE where |ΔRate| > 50%.
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
