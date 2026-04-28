# Final Project Report
## Global Hotel Reservation Engine
### Advanced Database Systems — Topic 14
### Academic Year 2025–2026

---

# PART I — GROUP SECTION

---

## 1. Business Analysis

### 1.1 Scenario Description

A mid-size hospitality company operates a network of hotels across Vietnam (Ho Chi Minh City, Hanoi, Da Nang). The business needs a unified reservation platform that:

- Allows travelers to **search and browse hotels** by keyword, city, and amenities — at very high speed.
- Lets travelers **book specific rooms** with a hard guarantee that no two guests ever land in the same room on the same dates.
- Allows **hotel managers** to update amenity listings on the fly as resorts upgrade their facilities (add a spa, remove a business center, etc.) without touching SQL schema.
- Provides **quarterly revenue rankings** per hotel so management can identify top-performing rooms and adjust pricing.
- Maintains an **automatic audit trail** whenever a room rate changes by more than 50%, for compliance and pricing integrity.

### 1.2 User Requirements

| Actor | Requirement |
|---|---|
| Traveler | Search hotels by name/keyword (fuzzy), city (autocomplete), and multiple amenities (AND filter) |
| Traveler | View all rooms in a hotel with real-time date-range availability |
| Traveler | Book a room with guaranteed no double-booking or overbooking |
| Traveler | View and cancel/check-out of their own bookings |
| Hotel Manager | Update hotel amenity lists without schema changes |
| Hotel Manager | View Top-3 revenue-generating rooms per hotel per quarter |
| Hotel Manager | See an automatic audit log of all room rate changes exceeding 50% |
| System | Prevent any race condition that could produce two confirmed bookings for the same room on overlapping dates |

### 1.3 Read vs. Write Workload Analysis

| Operation | Frequency | Consistency Requirement |
|---|---|---|
| Hotel/amenity search | Very High (read) | Low — slightly stale amenity data is acceptable |
| Room availability check | High (read) | Medium — must be accurate at booking time |
| New booking (write) | Medium | **Critical** — must be fully atomic and race-free |
| Rate update (write) | Low | High — triggers audit automatically |
| Revenue report | Low (read) | High — must aggregate real financial data |

This asymmetry directly justifies the polyglot architecture: high-volume reads go to MongoDB (AP), while all write-critical and financial paths go to MS SQL Server (CP/ACID).

---

## 2. System Architecture

### 2.1 Polyglot Persistence Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Browser (SPA)                       │
│   index.html  hotel.html  booking.html  reports.html     │
│   mybookings.html                                        │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP/REST (JSON)
                         ▼
┌─────────────────────────────────────────────────────────┐
│               Node.js / Express API Server               │
│                    (server.js — port 3000)               │
│                                                          │
│  /api/hotels  ──────────────────────────► MongoDB        │
│  (BASE / AP)        Hotel Catalog store   (hotelCatalog) │
│                                                          │
│  /api/rooms   ──────────────────────────► MS SQL Server  │
│  /api/bookings  (ACID / CP)              (hotel_db)      │
│  /api/reports ──────────────────────────►                │
└─────────────────────────────────────────────────────────┘

MongoDB Store (BASE / AP):
  Collection: hotels
  { hotel_id, name, city, description, star_rating,
    amenities: [...], images: [...], location: {...} }

MS SQL Store (ACID / CP):
  Hotels(ID, Name, City)
  Rooms(ID, HotelID, RoomNumber, RoomType, Rate, Status)
  Bookings(ID, RoomID, GuestName, GuestEmail,
           CheckIn, CheckOut, TotalAmount, BookedAt, Status)
  RateChangeLog(ID, RoomID, OldRate, NewRate, PctChange, ChangedAt)
  VIEW: vw_TopRevenueRooms  (RANK() window function)
  TRIGGER: trg_RoomRateChange
```

### 2.2 CAP Theorem Justification

**MongoDB (AP — Available + Partition Tolerant):**
A traveler browsing hotels expects sub-100ms responses. If a hotel manager just updated the spa amenity and some replicas haven't caught up, a traveler briefly seeing the old list is a **tolerable inconsistency** — they will not be harmed. MongoDB prioritizes availability and horizontal read scalability for this use case.

**MS SQL Server (CP — Consistent + Partition Tolerant):**
When two travelers simultaneously attempt to book the last available room for the same dates, exactly one must succeed and one must fail with a clear error. There is zero tolerance for inconsistency here — a double-booking causes real financial and reputational damage. MS SQL's ACID transactions, row-level locking, and isolation levels make it the only acceptable choice for the booking path.

### 2.3 Data Flow: Booking Request

```
Browser POST /api/bookings
    │
    ▼
BEGIN TRANSACTION (REPEATABLE_READ)
    │
    ├─► SELECT Rooms WITH (UPDLOCK, ROWLOCK)   ← Pessimistic lock acquired
    │       other sessions on same room BLOCK here
    │
    ├─► SELECT Bookings WITH (UPDLOCK, ROWLOCK) ← Date-overlap check
    │       WHERE CheckIn < @checkOut AND CheckOut > @checkIn
    │       AND Status = 'CONFIRMED'
    │       if row found → ROLLBACK → 409 Conflict
    │
    ├─► INSERT INTO Bookings (...)
    │
    └─► COMMIT  ← Lock released; concurrent session resumes, sees conflict
```

---

## 3. Database Design

### 3.1 MS SQL Server — Entity Relationship Diagram

```
Hotels
──────
PK  ID          INT IDENTITY
    Name        NVARCHAR(200)
    City        NVARCHAR(100)
    └─── 1:N ──────────────────────────────────────────────────┐
                                                               │
Rooms                                                          │
─────                                                          │
PK  ID          INT IDENTITY                                   │
FK  HotelID     INT  ─────────────────────────────────────────┘
    RoomNumber  NVARCHAR(20)
    RoomType    NVARCHAR(50)     -- 'STANDARD','DELUXE','SUITE'
    Rate        DECIMAL(10,2)    -- triggers audit on >50% change
    Status      NVARCHAR(20)     -- 'AVAILABLE','BOOKED' (physical state)
    └─── 1:N ──────────────────────────────────────────────────┐
                                                               │
Bookings                                                       │
────────                                                       │
PK  ID          INT IDENTITY                                   │
FK  RoomID      INT  ─────────────────────────────────────────┘
    GuestName   NVARCHAR(200)
    GuestEmail  NVARCHAR(200)
    CheckIn     DATE
    CheckOut    DATE
    TotalAmount DECIMAL(10,2)
    BookedAt    DATETIME2  DEFAULT GETDATE()
    Status      NVARCHAR(20) DEFAULT 'CONFIRMED'  -- 'CONFIRMED','CANCELLED'
    └─── referenced by ────────────────────────────────────────┐
                                                               │
RateChangeLog                                                  │
─────────────                                                  │
PK  ID          INT IDENTITY                                   │
FK  RoomID      INT  ──────── (from Rooms)                     │
    OldRate     DECIMAL(10,2)                                   │
    NewRate     DECIMAL(10,2)                                   │
    PctChange   DECIMAL(6,2)                                    │
    ChangedAt   DATETIME2  DEFAULT GETDATE()                    │
    (populated automatically by trg_RoomRateChange trigger)     │
```

### 3.2 MS SQL — Key Objects

**Trigger: trg_RoomRateChange**
```sql
CREATE TRIGGER trg_RoomRateChange
ON Rooms
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO RateChangeLog (RoomID, OldRate, NewRate, PctChange)
    SELECT
        i.ID,
        d.Rate                              AS OldRate,
        i.Rate                              AS NewRate,
        ((i.Rate - d.Rate) / d.Rate) * 100  AS PctChange
    FROM inserted i
    JOIN deleted  d ON i.ID = d.ID
    WHERE ABS((i.Rate - d.Rate) / d.Rate) > 0.50;  -- only >50% changes
END;
```
*Fires automatically on every `UPDATE Rooms SET Rate = ...`. No application code can bypass it.*

**View: vw_TopRevenueRooms**
```sql
CREATE VIEW vw_TopRevenueRooms AS
WITH RoomRevenue AS (
    SELECT
        r.ID          AS RoomID,
        r.HotelID,
        h.Name        AS HotelName,
        r.RoomNumber,
        r.RoomType,
        YEAR(b.CheckIn)                    AS [Year],
        DATEPART(QUARTER, b.CheckIn)       AS [Quarter],
        COUNT(*)                           AS BookingCount,
        SUM(b.TotalAmount)                 AS TotalRevenue
    FROM Bookings b
    JOIN Rooms r  ON b.RoomID  = r.ID
    JOIN Hotels h ON r.HotelID = h.ID
    WHERE b.Status = 'CONFIRMED'
    GROUP BY r.ID, r.HotelID, h.Name, r.RoomNumber, r.RoomType,
             YEAR(b.CheckIn), DATEPART(QUARTER, b.CheckIn)
)
SELECT *,
    RANK() OVER (
        PARTITION BY HotelID, [Year], [Quarter]
        ORDER BY TotalRevenue DESC
    ) AS RevenueRank
FROM RoomRevenue;
```
*Only rows where `RevenueRank <= 3` are the "Top 3" — the API filters this at query time.*

### 3.3 MongoDB — NoSQL Collection Structure

**Collection: `hotels` (database: `hotelCatalog`)**

```json
{
  "hotel_id":    1,
  "name":        "Grand Saigon Palace",
  "city":        "Ho Chi Minh City",
  "description": "A 5-star landmark in the heart of District 1...",
  "star_rating": 5,
  "amenities":   ["pool", "wifi", "gym", "spa", "restaurant", "bar",
                  "concierge", "valet", "airport-shuttle"],
  "images":      ["https://cdn.example.com/hotels/1/lobby.jpg", "..."],
  "location": {
    "lat":     10.7769,
    "lng":     106.7009,
    "address": "123 Dong Khoi St, District 1"
  },
  "updated_at": "2025-04-26T00:00:00.000Z"
}
```

**Indexes:**
- `hotel_id`: unique index (mirrors `Hotels.ID` in SQL — the cross-store join key)
- `city`: regular index (most common filter)
- Compound text index on `{ name, description, amenities }` — powers the `?q=` full-text search

**Design Decision — Why Embed Amenities:**
Amenities are always read *with* the hotel document, never queried alone. Embedding avoids a join and enables the `$text` index to search amenity content alongside name and description in a single query. If amenities were a separate collection, every search would require a `$lookup` — expensive and contrary to the document model.

**Design Decision — Why hotel_id as Cross-Store Link:**
Rather than duplicating hotel data in SQL, we store only the `hotel_id` integer in both stores. The API joins them at the application layer: SQL provides room/booking data; MongoDB provides catalog/description/amenity data. This keeps each store lean and in its natural model.

---

# PART II — INDIVIDUAL SECTION

> **Note to students:** Each student must write their own version of this section (1–2 pages). The template below shows the required structure. Fill in your own name and owned modules.

---

## Individual Technical Defense — [Student Name]

### 4.1 Module Ownership

| Module | File(s) | Description |
|---|---|---|
| Booking Engine | `backend/routes/bookings.js` | Pessimistic lock + date-overlap overbooking prevention |
| Hotel Catalog API | `backend/routes/hotels.js` | MongoDB search, city/amenity/full-text filter |
| MongoDB Schema | `backend/config/mongodb.js` | Schema definition, text index, BASE/AP justification |
| Search UI | `frontend/js/search.js` | Fuzzy city autocomplete, amenity checkbox panel, tabbed results |
| Hotel Detail UI | `frontend/js/hotel.js` | Date-range availability filter, room display, booking navigation |

*(Adjust this table to reflect your actual contribution. Each student must own at least one backend and one frontend module.)*

---

### 4.2 Design Justification

#### Why REPEATABLE_READ + UPDLOCK (not Optimistic Locking)?

The project brief states: *"If two users book the same last room, the system must resolve it atomically."*

Optimistic locking (version columns + retry) fails here because both transactions read the Bookings table, both see no overlap, both pass the check, and both INSERT a booking — producing a double-booking before either has committed. The problem is a **write-write race**, not just a read inconsistency.

`UPDLOCK` on the Rooms row serializes access at the point of the first SELECT. Transaction T2 physically waits at the lock acquisition, so by the time it runs the overlap check, T1's INSERT is already committed and visible. T2 then correctly detects the conflict and returns HTTP 409.

`REPEATABLE_READ` isolation is layered on top to prevent phantom reads: without it, even with UPDLOCK on Rooms, a third transaction could INSERT a Bookings row between T1's overlap check and T1's own INSERT (a phantom). REPEATABLE_READ blocks that gap.

#### Why MongoDB for the Hotel Catalog?

Amenity data is **write-rarely, read-constantly**. A traveler hitting the search page 100 times per minute expects a fresh set of results in under 100ms. The data shape is also inherently flexible: some hotels have 12 amenities, others have 3; new amenity types emerge (e.g., "EV charging") without needing a schema migration. MongoDB's schemaless embedded arrays, horizontal read scaling, and `$text` index satisfy all three requirements simultaneously. No equivalent SQL solution provides the same combination without significant engineering overhead.

#### Why Embed Amenities Instead of a Separate Collection?

Every hotel read fetches amenities — they are displayed immediately on the search results page and the hotel detail page. If amenities were a separate collection, every hotel query would need a `$lookup` aggregation pipeline, adding at minimum one round-trip or a complex pipeline stage. Since amenities are always read with their parent hotel and are bounded in size (typically 5–15 items), embedding is the textbook correct choice for MongoDB document design.

---

### 4.3 Logic Walkthrough — Most Complex Code Block

**The Overbooking Prevention Transaction (`backend/routes/bookings.js`)**

This is the most technically precise block in the system. Here is a line-by-line walkthrough:

```javascript
// Step 1: Begin at REPEATABLE_READ isolation
await transaction.begin(sql.ISOLATION_LEVEL.REPEATABLE_READ);
```
*REPEATABLE_READ prevents any other session from inserting a Bookings row that could become a phantom between our overlap check (step 3) and our own INSERT (step 4).*

```javascript
// Step 2: Acquire pessimistic lock on the Room row
const lockResult = await request.query(`
  SELECT ID, HotelID, RoomNumber, Rate, Status
  FROM Rooms WITH (UPDLOCK, ROWLOCK)
  WHERE ID = @roomId
`);
```
*UPDLOCK: converts the shared read lock to an update lock. Any concurrent transaction trying the same lock on this room row will block here and wait. ROWLOCK: ensures the lock is at row granularity, not page or table — we don't want to lock every room in the hotel, only this specific one.*

```javascript
// Step 3: Date-overlap check inside the lock
const overlapResult = await overlapReq.query(`
  SELECT TOP 1 ID, GuestName, CheckIn, CheckOut
  FROM Bookings WITH (UPDLOCK, ROWLOCK)
  WHERE RoomID  = @roomId
    AND Status  = 'CONFIRMED'
    AND CheckIn  < @checkOut     -- existing booking starts before ours ends
    AND CheckOut > @checkIn      -- existing booking ends after ours starts
`);
```
*The overlap predicate `A.start < B.end AND A.end > B.start` is the canonical interval-intersection test. It catches all overlap cases: full containment, partial left overlap, partial right overlap, and exact match. We apply UPDLOCK here too so no concurrent session can insert a new confirmed booking between this SELECT and our INSERT below.*

```javascript
// Step 4: If no overlap found, insert the booking
const bookingResult = await req2.query(`
  INSERT INTO Bookings (RoomID, GuestName, GuestEmail, CheckIn, CheckOut, TotalAmount)
  OUTPUT INSERTED.ID, INSERTED.BookedAt
  VALUES (@roomId, @guestName, @guestEmail, @checkIn, @checkOut, @total)
`);
await transaction.commit();
```
*`OUTPUT INSERTED.*` returns the auto-generated ID and BookedAt timestamp in the same statement — no second SELECT needed. On COMMIT, all locks are released. Any transaction that was waiting at Step 2 now resumes and will find the newly inserted booking in Step 3, correctly receiving a 409 Conflict.*

**Execution result:** It is mathematically impossible for two bookings for the same room to overlap in dates, as long as every booking request goes through this transaction. The lock serializes the check-then-insert into a single atomic unit.

---

### 4.4 AI Critical Review

**Instance: The initial AI-generated booking route did not include date-overlap checking.**

The first version of `bookings.js` generated with AI assistance used only a single `Status = 'AVAILABLE'` check on the `Rooms` table:

```javascript
// Original AI-generated version (INCORRECT)
if (room.Status !== 'AVAILABLE') {
  return res.status(409).json({ ... });
}
await req2.query(`UPDATE Rooms SET Status = 'BOOKED' WHERE ID = @roomId`);
await req2.query(`INSERT INTO Bookings ...`);
```

**Why this is wrong:** This approach treats a room as permanently unavailable once any booking exists. A room booked for January 1–5 becomes `BOOKED` forever — nobody can reserve it for January 10. Furthermore, after a cancellation resets status to `AVAILABLE`, the slot is open again with no memory of previous date commitments, allowing overlapping re-bookings.

**Manual correction applied:**
1. Removed `UPDATE Rooms SET Status = 'BOOKED'` from the booking path entirely. Room status now reflects *physical occupancy* only, not future reservations.
2. Added the date-overlap SELECT with the interval-intersection predicate (`CheckIn < @checkOut AND CheckOut > @checkIn`) inside the same locked transaction.
3. Applied `UPDLOCK` to the Bookings rows as well, not just Rooms, to prevent phantom inserts between the overlap check and our own INSERT.
4. Switched isolation level from default `READ_COMMITTED` to `REPEATABLE_READ` to close the phantom read gap.

This required understanding that the AI was solving a simpler problem (binary availability) rather than the actual business problem (date-range reservation without overlap).

---

# APPENDIX — AI Audit Log

| # | Prompt (summary) | Tool | Purpose | Manual Correction Required |
|---|---|---|---|---|
| 1 | "Decorate the hotel-engine frontend with Bootstrap 5, dark/gold theme (#2d2d2d, #c8a96e)" | Claude Code | Apply consistent UI theme across all 4 HTML pages | Minor CSS adjustments |
| 2 | "Add a tab for All Hotels on index page, fix keyword search Route not found error" | Claude Code | Bug fix: old code called /api/search which didn't exist; corrected to /api/hotels?q= | Route path correction required |
| 3 | "Replace amenity text input with checkbox panel; city input with fuzzy autocomplete" | Claude Code | UX improvement: multi-select amenities, scored city suggestions | Logic for AND-filter of multiple amenities added manually |
| 4 | "Create a My Bookings page with checkout button that updates the database" | Claude Code | New page: list bookings, cancel via DELETE /api/bookings/:id | Success message markup corrected for new HTML structure |
| 5 | "Does the system prevent overbooking? Use tips from hotel booking schema article" | Claude Code | Critical bug fix: added date-overlap check + corrected Room.Status semantics | Complete redesign of booking logic; AI initial version only checked Status flag |
| 6 | "Add date picker on hotel detail page to show room availability for a date range" | Claude Code | Feature: GET /api/rooms?check_in=&check_out= returns AvailableForDates per room | LEFT JOIN subquery written manually; AI draft used simple WHERE clause |
| 7 | "Generate the full project report based on the assignment brief" | Claude Code | This document | Students must personalize Individual Section with real ownership details |

---

## Quick Reference: Defense Q&A Preparation

**Q: Why did you choose REPEATABLE_READ and not SERIALIZABLE?**
A: SERIALIZABLE would also lock ranges in the index, preventing any INSERT to Bookings even for different rooms — unnecessary overhead. REPEATABLE_READ combined with UPDLOCK on the specific Bookings rows we read gives us phantom protection for this specific room without serializing the entire table.

**Q: If you remove `WITH (UPDLOCK)` what race condition occurs?**
A: With only a shared read lock on Rooms, T1 and T2 both pass the overlap check simultaneously (neither sees the other's in-flight INSERT, which hasn't committed yet). Both proceed to INSERT. Both commit. The same room now has two confirmed bookings for the same dates — a classic double-booking.

**Q: Change RANK() to ROW_NUMBER() — what's the business difference?**
A: `RANK()` assigns the same rank to ties (e.g., two rooms with identical revenue both get rank 1, and rank 2 is skipped). `ROW_NUMBER()` assigns a unique sequential number regardless of ties — no two rooms share a rank. For "Top 3" reporting, `RANK()` is more generous (you might surface 4 rooms if there's a tie for 3rd). `ROW_NUMBER()` is stricter and deterministic but arbitrary when values are equal.

**Q: Why are amenities embedded in MongoDB rather than in a separate collection?**
A: The read access pattern is always "give me the hotel AND its amenities together." A separate collection would require a `$lookup` join on every search query — expensive and contrary to MongoDB's document design principle of co-locating data that is accessed together. Amenities are bounded in size and change infrequently enough that embedding is the correct choice.

**Q: What is the interval-overlap predicate and why does it work?**
A: Two date ranges [A, B) and [C, D) overlap if and only if `A < D AND B > C`. This works because: if `A >= D`, range 1 starts after range 2 ends (no overlap); if `B <= C`, range 1 ends before range 2 starts (no overlap). The negation of both non-overlap conditions gives the overlap condition. It catches all cases: containment, left-partial, right-partial, exact match.
