# 🏨 Global Hotel Reservation Engine
**CS-402 Advanced Database Systems — Topic 14 Final Project**

---

## Architecture Overview

```
Android App (Java)
       │  HTTP/JSON via Retrofit
       ▼
Node.js + Express REST API  (:3000)
       │                    │
       ▼                    ▼
MS SQL Server (ACID)    MongoDB (BASE)
Hotels, Rooms,          HotelCatalog
Bookings,               amenities, images,
RateChangeLog           description
[CP — consistency]      [AP — availability]
```

### Why Polyglot?

| Data Type | Store | Justification |
|-----------|-------|---------------|
| Rooms, Bookings | **MS SQL** | Requires ACID. Double-booking must be impossible. Pessimistic locking (UPDLOCK) enforces this. |
| Hotel Catalog, Amenities | **MongoDB** | Read-heavy, schema-flexible. Amenities change as resorts upgrade — no ALTER TABLE. Embedded arrays avoid joins. AP in CAP: a slightly stale amenity list is acceptable; slow search is not. |

---

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env        # edit with your DB credentials
npm install
node scripts/seed.js        # seed MongoDB catalog
node server.js              # start API on :3000
```

Run the SQL schema first:
```
SQL Server Management Studio → Open scripts/schema.sql → Execute
```

### 2. Android

1. Open `android/` folder in Android Studio (Hedgehog or newer)
2. In `app/build.gradle`, `BASE_URL` is set to `http://10.0.2.2:3000/api/` — this routes emulator traffic to your PC's localhost. Change to your actual server IP for a physical device.
3. Run → AVD emulator or physical device

---

## API Reference

| Method | Endpoint | Store | Purpose |
|--------|----------|-------|---------|
| GET | `/api/hotels?city=&amenity=` | MongoDB | Search hotel catalog |
| GET | `/api/hotels/:id` | MongoDB | Hotel detail + amenities |
| GET | `/api/rooms?hotel_id=&status=` | MS SQL | Room availability |
| PATCH | `/api/rooms/:id/rate` | MS SQL | Update rate (triggers audit if >50%) |
| POST | `/api/bookings` | MS SQL | Create booking (pessimistic lock) |
| DELETE | `/api/bookings/:id` | MS SQL | Cancel booking |
| GET | `/api/reports/top-rooms` | MS SQL | Revenue ranking (RANK window fn) |
| GET | `/api/reports/rate-changes` | MS SQL | Trigger audit log |

---

## Key Database Features

### Pessimistic Locking (Double-Booking Prevention)
```sql
-- routes/bookings.js — critical section
SELECT ID, Status FROM Rooms
WITH (UPDLOCK, ROWLOCK)   -- acquires update lock at READ time
WHERE ID = @roomId;
-- Second concurrent transaction blocks here until first commits
```

**Defense talking point:** UPDLOCK escalates from shared to update lock at read time. This blocks any concurrent transaction from acquiring a compatible lock on the same row, preventing the TOCTOU race where two sessions both read `AVAILABLE` and both proceed to book.

### Rate Change Trigger (>50% Alert)
```sql
CREATE TRIGGER trg_RoomRateChange ON Rooms AFTER UPDATE AS
INSERT INTO RateChangeLog (...)
SELECT ... FROM inserted i JOIN deleted d ON i.ID = d.ID
WHERE ABS((i.Rate - d.Rate) / d.Rate) > 0.50;
```

### Window Function (Top 3 Revenue Rooms)
```sql
RANK() OVER (
    PARTITION BY HotelID, [Year], [Quarter]
    ORDER BY TotalRevenue DESC
)
-- RANK() used (not ROW_NUMBER()) so tied rooms share a position
```

---

## Individual Defense Prep

**Q: Why UPDLOCK instead of XLOCK?**  
A: UPDLOCK converts to XLOCK on modification but allows read-compatible access before that, reducing blocking compared to an exclusive lock held from the start.

**Q: Change RANK() to ROW_NUMBER() — what changes?**  
A: ROW_NUMBER() assigns a unique sequential number even to tied revenues, so two rooms with identical revenue would get ranks 1 and 2 arbitrarily. RANK() gives them both rank 1, which is the correct business semantics for "top performers."

**Q: What if FOR UPDATE is removed from the booking query?**  
A: Without UPDLOCK, two concurrent sessions both read `Status = 'AVAILABLE'`, both pass the check, both execute `UPDATE` and `INSERT` — resulting in a double-booking and orphaned booking record.

**Q: Why embed amenities in MongoDB instead of a separate collection?**  
A: Amenities are always read with the hotel document and never queried in isolation. Embedding avoids a lookup, improves read latency, and the flexible array allows adding new amenity types without a schema migration.
