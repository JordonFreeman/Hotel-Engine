// routes/rooms.js
// WRITE-HEAVY path → MS SQL Server (CP, ACID)
const express = require('express');
const { getPool, sql } = require('../config/mssql');
const router = express.Router();

// GET /api/rooms?hotel_id=1&check_in=YYYY-MM-DD&check_out=YYYY-MM-DD
// When check_in + check_out are provided, AvailableForDates is computed via
// a date-overlap LEFT JOIN against the Bookings table so the UI can show
// true date-range availability rather than the static Status flag.
// Without dates, AvailableForDates falls back to Status = 'AVAILABLE'.
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const { hotel_id, check_in, check_out } = req.query;

    const request = pool.request();
    let query;

    if (check_in && check_out) {
      // Date-aware availability: a room is available for [check_in, check_out)
      // if NO confirmed booking exists where CheckIn < check_out AND CheckOut > check_in.
      request.input('checkIn',  sql.Date, new Date(check_in));
      request.input('checkOut', sql.Date, new Date(check_out));

      query = `
        SELECT r.ID, r.HotelID, h.Name AS HotelName, r.RoomNumber,
               r.RoomType, r.Rate, r.Status,
               r.MaxAdults, r.MaxChildren,
               CASE WHEN clash.RoomID IS NULL THEN 1 ELSE 0 END AS AvailableForDates
        FROM Rooms r
        JOIN Hotels h ON r.HotelID = h.ID
        LEFT JOIN (
          SELECT DISTINCT RoomID
          FROM Bookings
          WHERE Status   = 'CONFIRMED'
            AND CheckIn  < @checkOut
            AND CheckOut > @checkIn
        ) clash ON clash.RoomID = r.ID
        WHERE 1=1
      `;
    } else {
      query = `
        SELECT r.ID, r.HotelID, h.Name AS HotelName, r.RoomNumber,
               r.RoomType, r.Rate, r.Status,
               r.MaxAdults, r.MaxChildren,
               CASE WHEN r.Status = 'AVAILABLE' THEN 1 ELSE 0 END AS AvailableForDates
        FROM Rooms r
        JOIN Hotels h ON r.HotelID = h.ID
        WHERE 1=1
      `;
    }

    if (hotel_id) {
      query += ' AND r.HotelID = @hotelId';
      request.input('hotelId', sql.Int, parseInt(hotel_id));
    }
    query += ' ORDER BY r.RoomType, r.Rate';

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/:id/rate — update room rate (triggers audit log if >50%)
router.patch('/:id/rate', async (req, res) => {
  try {
    const { rate } = req.body;
    if (!rate || rate <= 0) return res.status(400).json({ success: false, message: 'Invalid rate' });

    const pool = await getPool();
    const request = pool.request();
    request.input('roomId', sql.Int, parseInt(req.params.id));
    request.input('rate', sql.Decimal(10, 2), rate);

    // The trg_RoomRateChange trigger fires automatically on UPDATE
    await request.query('UPDATE Rooms SET Rate = @rate WHERE ID = @roomId');

    // Check if trigger logged a >50% change
    const logCheck = await pool.request()
      .input('roomId', sql.Int, parseInt(req.params.id))
      .query(`SELECT TOP 1 * FROM RateChangeLog WHERE RoomID = @roomId ORDER BY ChangedAt DESC`);

    res.json({
      success: true,
      message: 'Rate updated',
      auditTriggered: logCheck.recordset.length > 0,
      auditEntry: logCheck.recordset[0] || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
