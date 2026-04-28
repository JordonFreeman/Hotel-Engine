// routes/bookings.js
// CRITICAL PATH: Pessimistic Locking via SQL Server UPDLOCK + ROWLOCK hints
//
// Why pessimistic (not optimistic)?
// Topic 14 explicitly requires it, and the business scenario justifies it:
// "If two users book the same last room, the system must resolve it atomically."
// With optimistic locking, both transactions read the booking table, both see
// no conflict, both INSERT — and we get a double-booking. UPDLOCK acquires an
// update lock on the Rooms row at READ time, blocking any concurrent locker
// so the second transaction waits until the first commits or rolls back.
//
// Race condition prevented:
//   T1: SELECT Rooms WITH(UPDLOCK)  → locks row
//   T2: SELECT Rooms WITH(UPDLOCK)  → WAITS (blocked by T1's U-lock)
//   T1: date-overlap check → none → INSERT booking → COMMIT → releases lock
//   T2: resumes → date-overlap check → conflict found → 409 → no double-booking
//
// Overbooking prevention (date-overlap):
//   Two bookings overlap when: newCheckIn < existingCheckOut AND newCheckOut > existingCheckIn
//   We check this inside the same locked transaction so no concurrent INSERT
//   can slip in between our SELECT and our INSERT (REPEATABLE_READ prevents phantoms).
//
// Room Status semantics (status-at-check-in pattern):
//   Rooms.Status reflects the PHYSICAL state of the room right now:
//     AVAILABLE  = no guest currently occupying it
//     BOOKED     = a guest is currently checked in
//   Future reservations are stored in Bookings and checked via date ranges —
//   a room stays AVAILABLE physically until the guest actually arrives.
const express = require('express');
const { getPool, sql } = require('../config/mssql');
const router = express.Router();

// POST /api/bookings — create a booking with pessimistic lock + date-overlap guard
router.post('/', async (req, res) => {
  const {
    room_id, guest_name, guest_email, check_in, check_out,
    num_adults = 1, num_children = 0, total_override = null,
  } = req.body;

  if (!room_id || !guest_name || !check_in || !check_out) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const adults   = parseInt(num_adults)   || 1;
  const children = parseInt(num_children) || 0;

  if (adults < 1) {
    return res.status(400).json({ success: false, message: 'At least 1 adult is required' });
  }
  if (children < 0) {
    return res.status(400).json({ success: false, message: 'Number of children cannot be negative' });
  }

  const checkInDate  = new Date(check_in);
  const checkOutDate = new Date(check_out);
  if (checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, message: 'Check-out must be after check-in' });
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    // REPEATABLE_READ: prevents phantom reads — no other session can INSERT a
    // conflicting booking row between our overlap SELECT and our own INSERT.
    await transaction.begin(sql.ISOLATION_LEVEL.REPEATABLE_READ);

    const request = new sql.Request(transaction);
    request.input('roomId', sql.Int, room_id);

    // ── PESSIMISTIC LOCK ────────────────────────────────────────────────────
    // UPDLOCK: escalates shared lock to update lock at read time.
    // ROWLOCK: pins the lock to this specific Rooms row (not page/table).
    // Any concurrent transaction attempting the same lock on this room WAITS
    // here until we commit or rollback, serialising all booking attempts.
    const lockResult = await request.query(`
      SELECT ID, HotelID, RoomNumber, Rate, Status
      FROM Rooms WITH (UPDLOCK, ROWLOCK)
      WHERE ID = @roomId
    `);

    if (lockResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    const room = lockResult.recordset[0];

    // ── CAPACITY CHECK ──────────────────────────────────────────────────────
    // Validate guest counts against room maximums now that we hold the lock.
    // MaxAdults / MaxChildren come from the SQL Rooms table (transactional,
    // enforced here at booking time — not in MongoDB which is BASE/AP).
    if (adults > room.MaxAdults) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Room ${room.RoomNumber} allows a maximum of ${room.MaxAdults} adult(s). You requested ${adults}.`,
      });
    }
    if (children > room.MaxChildren) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Room ${room.RoomNumber} allows a maximum of ${room.MaxChildren} child(ren). You requested ${children}.`,
      });
    }

    // ── DATE-OVERLAP CHECK (overbooking prevention) ─────────────────────────
    // Standard interval-overlap predicate: two ranges [A,B) and [C,D) overlap
    // when A < D AND B > C.  We only check CONFIRMED bookings — CANCELLED ones
    // free the slot.  This runs inside the UPDLOCK transaction so no concurrent
    // booking can insert between this check and our own INSERT below.
    const overlapReq = new sql.Request(transaction);
    overlapReq.input('roomId',   sql.Int,  room_id);
    overlapReq.input('checkIn',  sql.Date, checkInDate);
    overlapReq.input('checkOut', sql.Date, checkOutDate);

    const overlapResult = await overlapReq.query(`
      SELECT TOP 1 ID, GuestName, CheckIn, CheckOut
      FROM Bookings WITH (UPDLOCK, ROWLOCK)
      WHERE RoomID  = @roomId
        AND Status  = 'CONFIRMED'
        AND CheckIn  < @checkOut
        AND CheckOut > @checkIn
    `);

    if (overlapResult.recordset.length > 0) {
      const clash = overlapResult.recordset[0];
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        message: `Room ${room.RoomNumber} is already booked for overlapping dates ` +
                 `(existing booking #${clash.ID}: ` +
                 `${new Date(clash.CheckIn).toLocaleDateString()} – ` +
                 `${new Date(clash.CheckOut).toLocaleDateString()})`,
      });
    }

    // Calculate total amount
    // total_override carries the client-side computed total (incl. child charges
    // and senior discounts sourced from MongoDB age_policy.pricing). If not
    // provided, fall back to base rate × nights.
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    const total  = (total_override && total_override > 0)
      ? parseFloat(total_override)
      : room.Rate * nights;

    const req2 = new sql.Request(transaction);
    req2.input('roomId',      sql.Int,           room_id);
    req2.input('guestName',   sql.NVarChar(200), guest_name);
    req2.input('guestEmail',  sql.NVarChar(200), guest_email || '');
    req2.input('checkIn',     sql.Date,          checkInDate);
    req2.input('checkOut',    sql.Date,          checkOutDate);
    req2.input('total',       sql.Decimal(10,2), total);
    req2.input('numAdults',   sql.Int,           adults);
    req2.input('numChildren', sql.Int,           children);

    // ── ATOMIC WRITE ────────────────────────────────────────────────────────
    // Room Status stays AVAILABLE — it reflects physical occupancy, not
    // reservations. Future availability is determined by Bookings date ranges.
    const bookingResult = await req2.query(`
      INSERT INTO Bookings
        (RoomID, GuestName, GuestEmail, CheckIn, CheckOut, TotalAmount, NumAdults, NumChildren)
      OUTPUT INSERTED.ID, INSERTED.BookedAt
      VALUES (@roomId, @guestName, @guestEmail, @checkIn, @checkOut, @total, @numAdults, @numChildren)
    `);

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: 'Booking confirmed',
      data: {
        booking_id:   bookingResult.recordset[0].ID,
        room_number:  room.RoomNumber,
        nights,
        total_amount: total,
        num_adults:   adults,
        num_children: children,
        booked_at:    bookingResult.recordset[0].BookedAt,
      },
    });

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/bookings — list all bookings (manager view)
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT b.ID, b.GuestName, b.GuestEmail,
             r.RoomNumber, r.RoomType, h.Name AS HotelName,
             b.CheckIn, b.CheckOut, b.TotalAmount, b.BookedAt, b.Status,
             b.NumAdults, b.NumChildren
      FROM Bookings b
      JOIN Rooms r   ON b.RoomID  = r.ID
      JOIN Hotels h  ON r.HotelID = h.ID
      ORDER BY b.BookedAt DESC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/bookings/:id — cancel a booking
// Marks the booking CANCELLED so it is excluded from future overlap checks.
// Room.Status is left unchanged (rooms are AVAILABLE by default; physical
// occupancy is tracked separately from reservations).
router.delete('/:id', async (req, res) => {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const req1 = new sql.Request(transaction);
    req1.input('id', sql.Int, parseInt(req.params.id));

    const booking = await req1.query(
      `SELECT RoomID FROM Bookings WHERE ID = @id AND Status = 'CONFIRMED'`
    );
    if (!booking.recordset.length) {
      await transaction.rollback();
      return res.status(404).json({ success: false, message: 'Booking not found or already cancelled' });
    }

    const req2 = new sql.Request(transaction);
    req2.input('id', sql.Int, parseInt(req.params.id));
    await req2.query(`UPDATE Bookings SET Status = 'CANCELLED' WHERE ID = @id`);
    await transaction.commit();

    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
