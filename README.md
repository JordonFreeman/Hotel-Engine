# Global Hotel Reservation Engine
**CS-402 Advanced Database Systems — Topic 14 Final Project**

---

## Architecture Overview

```
Browser (Bootstrap 5 Frontend)
        │  HTTP/JSON  (fetch API)
        ▼
Node.js + Express REST API  (:3000)
        │                    │
        ▼                    ▼
MS SQL Server (ACID/CP)   MongoDB (BASE/AP)
Hotels, Rooms,            HotelCatalog
Bookings,                 amenities[], description,
RateChangeLog             age_policy, pricing
[Consistency priority]    [Availability priority]
```

### Why Polyglot?

| Data | Store | Reason |
|------|-------|--------|
| Rooms, Bookings | MS SQL | ACID required. Double-booking must be impossible. Pessimistic locking (UPDLOCK + ROWLOCK) enforces atomicity. |
| Hotel Catalog, Amenities | MongoDB | Read-heavy, schema-flexible. Amenities change as resorts upgrade — no ALTER TABLE needed. Embedded arrays avoid joins. AP in CAP: a slightly stale amenity list is acceptable; a slow search is not. |

---

## Key Database Features (Topic 14 Requirements)

### 1. Pessimistic Locking — Double-Booking Prevention
```sql
-- Inside REPEATABLE_READ transaction
SELECT ID, Rate FROM Rooms WITH (UPDLOCK, ROWLOCK) WHERE ID = @roomId;
-- Concurrent transaction blocks here until this one commits or rolls back
```
T1 acquires UPDLOCK → T2 waits → T1 checks date overlap → T1 INSERTs → T1 COMMITs → T2 resumes → T2 finds conflict → T2 returns 409.

### 2. Date-Overlap Guard (Overbooking Prevention)
```sql
SELECT TOP 1 ID FROM Bookings WITH (UPDLOCK, ROWLOCK)
WHERE RoomID = @roomId AND Status = 'CONFIRMED'
  AND CheckIn < @checkOut AND CheckOut > @checkIn;
```
Standard interval predicate: ranges [A,B) and [C,D) overlap when A < D AND B > C.

### 3. SQL Trigger — Rate Change > 50% Audit
```sql
CREATE TRIGGER trg_RoomRateChange ON Rooms AFTER UPDATE AS
BEGIN
    IF NOT UPDATE(Rate) RETURN;
    INSERT INTO RateChangeLog (...)
    SELECT ... FROM inserted i JOIN deleted d ON i.ID = d.ID
    WHERE ABS((i.Rate - d.Rate) / d.Rate) > 0.50;
END;
```
Fires automatically on every `UPDATE Rooms SET Rate = ...`. Reads `inserted` (new) and `deleted` (old) virtual tables built by SQL Server.

### 4. Window Function — Top 3 Revenue Rooms per Quarter
```sql
-- vw_TopRevenueRooms
RANK() OVER (
    PARTITION BY HotelID, [Year], [Quarter]
    ORDER BY TotalRevenue DESC
)
-- RANK() used (not ROW_NUMBER()) so tied rooms share a rank
```

### 5. Recursive CTE — Night-by-Night Occupancy
```sql
-- vw_OccupancyByNight
WITH StayDates AS (
    SELECT b.ID, b.RoomID, b.CheckIn AS StayDate, b.CheckOut FROM Bookings b ...  -- anchor
    UNION ALL
    SELECT sd.BookingID, sd.RoomID, DATEADD(day,1,sd.StayDate), sd.CheckOut       -- recursive
    FROM StayDates sd WHERE DATEADD(day,1,sd.StayDate) < sd.CheckOut
)
SELECT HotelName, StayDate, COUNT(DISTINCT RoomID) AS RoomsOccupied ...
```
Expands each booking into one row per occupied night without storing redundant data.

### 6. Saga Pattern (Choreography)
The booking flow spans SQL + MongoDB. Because MongoDB is read-only during a booking POST (pricing rules only), no distributed transaction is needed. Cancellation (DELETE) is the compensating action — it sets `Status='CANCELLED'` so the date slot is freed from future overlap checks automatically.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| MS SQL Server | 2019+ (Developer or Express edition) |
| MongoDB | 6+ (local) or any MongoDB Atlas free tier |
| SQL Server Management Studio (SSMS) | Any recent version |
| MongoDB Compass | Any recent version |

---

## Setup Instructions

### Step 1 — Configure environment variables

```bash
cd backend
copy .env.example .env
```

Edit `.env` and fill in your values:

```
DB_SERVER=localhost
DB_NAME=HotelDB
DB_USER=sa
DB_PASSWORD=Password123
MONGO_URI=mongodb://localhost:27017/hotelengine
PORT=3000
```

### Step 2 — Run the SQL schema in SSMS

Open **SQL Server Management Studio**, connect to your SQL Server instance, then:

```
File → Open → backend/scripts/schema.sql → Execute (F5)
```

This creates the `HotelDB` database, all tables, the trigger, the two views (`vw_TopRevenueRooms`, `vw_OccupancyByNight`), and seeds the Hotels and Rooms data.

> If your database already exists from a previous run and you need to add the guest-type columns, run `backend/scripts/migrate_guest_types.sql` instead (it only adds `MaxAdults`, `MaxChildren`, `NumAdults`, `NumChildren`).

### Step 3 — Install backend dependencies

```bash
cd backend
npm install
```

### Step 4 — Seed MongoDB

```bash
node scripts/seed.js
```

This inserts 3 hotel catalog documents into MongoDB with `description`, `amenities[]`, `age_policy`, and `pricing` fields.

### Step 5 — Start the server

```bash
node server.js
```

Server starts on `http://localhost:3000`.

### Step 6 — Open the frontend

Open any of these files directly in your browser (no build step needed):

```
frontend/index.html       ← Hotel search (all hotels + filters)
frontend/hotel.html       ← Hotel detail + room availability
frontend/booking.html     ← Make a reservation
frontend/mybookings.html  ← View & check out bookings
frontend/reports.html     ← Revenue report (manager view)
```

---

## API Reference

| Method | Endpoint | Store | Feature |
|--------|----------|-------|---------|
| GET | `/api/hotels?q=&city=&amenity=` | MongoDB | Full-text + amenity search |
| GET | `/api/hotels/:id` | MongoDB | Hotel detail + amenities |
| GET | `/api/rooms?hotel_id=&check_in=&check_out=` | MS SQL | Date-aware room availability |
| PATCH | `/api/rooms/:id/rate` | MS SQL | Update rate (triggers audit if >50%) |
| POST | `/api/bookings` | MS SQL | Create booking (pessimistic lock) |
| GET | `/api/bookings` | MS SQL | List all bookings |
| DELETE | `/api/bookings/:id` | MS SQL | Cancel / check out |
| GET | `/api/reports/top-rooms?year=&quarter=` | MS SQL | RANK() window function report |
| GET | `/api/reports/occupancy?year=&month=` | MS SQL | Recursive CTE occupancy report |
| GET | `/api/reports/rate-changes` | MS SQL | Trigger audit log |

---

## Individual Defense Q&A

**Q: Why UPDLOCK instead of XLOCK (exclusive lock) from the start?**
A: UPDLOCK converts to XLOCK only on modification, allowing reads to proceed compatibly before that point. An XLOCK from the start would block even read-only queries on that row, increasing contention unnecessarily.

**Q: Change RANK() to ROW_NUMBER() — what changes?**
A: ROW_NUMBER() assigns a unique sequential integer regardless of ties, so two rooms with identical revenue get ranks 1 and 2 arbitrarily. RANK() gives both rank 1, which is the correct business meaning of "top performers." ROW_NUMBER() could exclude a room from the Top 3 that earned exactly the same as the #3 room.

**Q: If FOR UPDATE / UPDLOCK is removed, what race condition occurs?**
A: Without UPDLOCK, T1 and T2 both read the Bookings table with only a shared lock. Both see no conflict for the same date range. Both proceed to INSERT. The result is two confirmed bookings for the same room on the same dates — a double-booking. UPDLOCK prevents this by blocking T2's lock acquisition until T1 commits.

**Q: Why embed amenities in MongoDB instead of a relational table?**
A: Amenities are always read together with the hotel document and never queried in isolation across hotels. Embedding avoids a JOIN, improves read latency for search, and allows adding new amenity types without an `ALTER TABLE`. The trade-off is that updating one amenity name requires updating each hotel document — acceptable because amenity changes are rare writes versus constant reads.

**Q: Why is the Recursive CTE needed? Could you use a calendar table instead?**
A: A calendar table is a static pre-populated table of dates. A Recursive CTE generates the date series on-the-fly from actual booking data — no maintenance required, no storage overhead, and it automatically handles any date range. The trade-off is that CTEs re-execute on every query, while a calendar table can be indexed. For the scale of this project, the CTE is appropriate.
