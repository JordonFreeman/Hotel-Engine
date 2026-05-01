-- =============================================================
-- schema.sql — MS SQL Server DDL for Hotel Reservation Engine
-- Topic 14: Global Hotel Reservation Engine (CS-402 Final Project)
-- =============================================================

-- ── Databases & Helpers ──────────────────────────────────────
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'HotelDB')
    CREATE DATABASE HotelDB;
GO
USE HotelDB;
GO

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE Hotels (
    ID      INT IDENTITY(1,1) PRIMARY KEY,
    Name    NVARCHAR(200)  NOT NULL,
    City    NVARCHAR(100)  NOT NULL,
    -- hotel_id is mirrored in MongoDB HotelCatalog for the polyglot join
    CONSTRAINT UQ_Hotel_Name UNIQUE (Name)
);

CREATE TABLE Rooms (
    ID          INT IDENTITY(1,1) PRIMARY KEY,
    HotelID     INT            NOT NULL REFERENCES Hotels(ID),
    RoomNumber  NVARCHAR(20)   NOT NULL,
    RoomType    NVARCHAR(50)   NOT NULL DEFAULT 'Standard',
    Rate        DECIMAL(10,2)  NOT NULL CHECK (Rate > 0),
    Status      NVARCHAR(20)   NOT NULL DEFAULT 'AVAILABLE'
                               CHECK (Status IN ('AVAILABLE','BOOKED','MAINTENANCE')),
    MaxAdults   INT            NOT NULL DEFAULT 2,
    MaxChildren INT            NOT NULL DEFAULT 1,
    CONSTRAINT UQ_Room UNIQUE (HotelID, RoomNumber)
);

CREATE TABLE Bookings (
    ID           INT IDENTITY(1,1) PRIMARY KEY,
    RoomID       INT            NOT NULL REFERENCES Rooms(ID),
    GuestName    NVARCHAR(200)  NOT NULL,
    GuestEmail   NVARCHAR(200),
    CheckIn      DATE           NOT NULL,
    CheckOut     DATE           NOT NULL,
    TotalAmount  DECIMAL(10,2)  NOT NULL,
    BookedAt     DATETIME       NOT NULL DEFAULT GETDATE(),
    Status       NVARCHAR(20)   NOT NULL DEFAULT 'CONFIRMED'
                                CHECK (Status IN ('CONFIRMED','CANCELLED')),
    NumAdults    INT            NOT NULL DEFAULT 1,
    NumChildren  INT            NOT NULL DEFAULT 0,
    CONSTRAINT CHK_Dates CHECK (CheckOut > CheckIn)
);

-- Audit log populated by the trigger below
CREATE TABLE RateChangeLog (
    ID          INT IDENTITY(1,1) PRIMARY KEY,
    RoomID      INT            NOT NULL REFERENCES Rooms(ID),
    HotelID     INT            NOT NULL,
    RoomNumber  NVARCHAR(20)   NOT NULL,
    OldRate     DECIMAL(10,2)  NOT NULL,
    NewRate     DECIMAL(10,2)  NOT NULL,
    PctChange   DECIMAL(8,2)   NOT NULL,
    ChangedAt   DATETIME       NOT NULL DEFAULT GETDATE()
);
GO

-- ── Trigger — Rate Change > 50% Alert ────────────────────────
-- Business rule: hotel managers must be audited when rates jump/drop
-- by more than 50% (potential pricing error or intentional promotion).
-- The trigger fires AFTER UPDATE on Rooms. It reads from the virtual
-- `inserted` (new values) and `deleted` (old values) tables that SQL
-- Server populates automatically — no explicit SELECT needed.
CREATE OR ALTER TRIGGER trg_RoomRateChange
ON Rooms
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only fire when the Rate column was actually modified
    IF NOT UPDATE(Rate) RETURN;

    INSERT INTO RateChangeLog (RoomID, HotelID, RoomNumber, OldRate, NewRate, PctChange)
    SELECT
        i.ID,
        i.HotelID,
        i.RoomNumber,
        d.Rate                                       AS OldRate,
        i.Rate                                       AS NewRate,
        ABS((i.Rate - d.Rate) / d.Rate) * 100.0     AS PctChange
    FROM inserted i
    JOIN deleted  d ON i.ID = d.ID
    WHERE ABS((i.Rate - d.Rate) / d.Rate) > 0.50;
END;
GO

-- ── View — Top 3 Revenue Rooms per Hotel per Quarter ─────────
-- Uses RANK() OVER(PARTITION BY ...) as required by Topic 14.
-- RANK() gives tied rooms the same position — the correct business
-- semantic for "top performers". ROW_NUMBER() would arbitrarily break
-- ties, potentially excluding a room with equal revenue.
CREATE OR ALTER VIEW vw_TopRevenueRooms AS
WITH QuarterlyRevenue AS (
    SELECT
        r.ID          AS RoomID,
        r.HotelID,
        h.Name        AS HotelName,
        r.RoomNumber,
        r.RoomType,
        DATEPART(YEAR,    b.CheckIn) AS [Year],
        DATEPART(QUARTER, b.CheckIn) AS [Quarter],
        SUM(b.TotalAmount)           AS TotalRevenue,
        COUNT(b.ID)                  AS BookingCount
    FROM Rooms    r
    JOIN Hotels   h  ON r.HotelID = h.ID
    JOIN Bookings b  ON b.RoomID  = r.ID
    WHERE b.Status = 'CONFIRMED'
    GROUP BY r.ID, r.HotelID, h.Name, r.RoomNumber, r.RoomType,
             DATEPART(YEAR, b.CheckIn), DATEPART(QUARTER, b.CheckIn)
),
Ranked AS (
    SELECT *,
           RANK() OVER (
               PARTITION BY HotelID, [Year], [Quarter]
               ORDER BY TotalRevenue DESC
           ) AS RevenueRank
    FROM QuarterlyRevenue
)
SELECT * FROM Ranked WHERE RevenueRank <= 3;
GO

-- ── Recursive CTE — Booking Stay Date Series ─────────────────
-- Expands each confirmed booking into one row per night of the stay.
-- Used by GET /api/reports/occupancy to show night-by-night room
-- occupancy without storing redundant date rows in the schema.
--
-- How it works:
--   Anchor: selects each booking's CheckIn date as the first night.
--   Recursive step: adds 1 day until the day before CheckOut.
--   DATEADD(day,1,StayDate) < CheckOut ensures we stop at the last
--   occupied night (a guest checking out on day N does not occupy
--   the room on night N).
--
-- Example: CheckIn=2025-01-01, CheckOut=2025-01-03 → rows for
--   2025-01-01 and 2025-01-02 (2 nights billed).
CREATE OR ALTER VIEW vw_OccupancyByNight AS
WITH StayDates AS (
    -- Anchor: first night of every confirmed booking
    SELECT
        b.ID          AS BookingID,
        b.RoomID,
        r.HotelID,
        h.Name        AS HotelName,
        r.RoomNumber,
        r.RoomType,
        b.CheckIn     AS StayDate,
        b.CheckOut
    FROM Bookings b
    JOIN Rooms   r ON b.RoomID  = r.ID
    JOIN Hotels  h ON r.HotelID = h.ID
    WHERE b.Status = 'CONFIRMED'

    UNION ALL

    -- Recursive step: advance one night at a time until checkout eve
    SELECT
        sd.BookingID,
        sd.RoomID,
        sd.HotelID,
        sd.HotelName,
        sd.RoomNumber,
        sd.RoomType,
        DATEADD(day, 1, sd.StayDate),
        sd.CheckOut
    FROM StayDates sd
    WHERE DATEADD(day, 1, sd.StayDate) < sd.CheckOut
)
SELECT
    HotelID,
    HotelName,
    RoomID,
    RoomNumber,
    RoomType,
    StayDate,
    DATEPART(YEAR,    StayDate) AS [Year],
    DATEPART(MONTH,   StayDate) AS [Month],
    DATEPART(QUARTER, StayDate) AS [Quarter]
FROM StayDates;
GO

-- ── Seed Data ────────────────────────────────────────────────
INSERT INTO Hotels (Name, City) VALUES
('Grand Saigon Palace', 'Ho Chi Minh City'),
('Hanoi Heritage Hotel', 'Hanoi'),
('Da Nang Beach Resort', 'Da Nang');

INSERT INTO Rooms (HotelID, RoomNumber, RoomType, Rate, Status) VALUES
(1, '101', 'Standard', 1200000, 'AVAILABLE'),
(1, '201', 'Deluxe',   2500000, 'AVAILABLE'),
(1, '301', 'Suite',    5000000, 'AVAILABLE'),
(2, '101', 'Standard',  900000, 'AVAILABLE'),
(2, '201', 'Deluxe',   1800000, 'AVAILABLE'),
(3, '101', 'Standard',  800000, 'AVAILABLE'),
(3, '201', 'Suite',    4200000, 'AVAILABLE');
GO

-- Enable SQL Server mixed-mode authentication
ALTER LOGIN sa ENABLE;
ALTER LOGIN sa WITH PASSWORD = 'Password123';

EXEC xp_instance_regwrite
  N'HKEY_LOCAL_MACHINE',
  N'Software\Microsoft\MSSQLServer\MSSQLServer',
  N'LoginMode', REG_DWORD, 2;
