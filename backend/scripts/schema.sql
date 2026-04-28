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
    ID         INT IDENTITY(1,1) PRIMARY KEY,
    HotelID    INT            NOT NULL REFERENCES Hotels(ID),
    RoomNumber NVARCHAR(20)   NOT NULL,
    RoomType   NVARCHAR(50)   NOT NULL DEFAULT 'Standard', -- Standard, Deluxe, Suite
    Rate       DECIMAL(10,2)  NOT NULL CHECK (Rate > 0),
    Status     NVARCHAR(20)   NOT NULL DEFAULT 'AVAILABLE'
                              CHECK (Status IN ('AVAILABLE','BOOKED','MAINTENANCE')),
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
CREATE OR ALTER TRIGGER trg_RoomRateChange
ON Rooms
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only act when the Rate column was actually modified
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
    -- Only log changes greater than 50%
    WHERE ABS((i.Rate - d.Rate) / d.Rate) > 0.50;
END;
GO

-- ── View — Top 3 Revenue Rooms per Hotel per Quarter ─────────
-- Uses RANK() OVER(PARTITION BY ...) as required by Topic 14.
-- RANK() is used (not ROW_NUMBER()) so tied rooms share a rank —
-- the business requirement is "top performers", not an arbitrary ordering.
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
    JOIN Hotels   h  ON r.ID   = h.ID          -- wait — should be r.HotelID = h.ID
    JOIN Bookings b  ON b.RoomID = r.ID
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
SELECT *
FROM Ranked
WHERE RevenueRank <= 3;
GO

-- ── Fix JOIN in view (Hotels join was wrong above) ───────────
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

-- Enable sa login and set a password
ALTER LOGIN sa ENABLE;
ALTER LOGIN sa WITH PASSWORD = 'Password123';

EXEC xp_instance_regwrite 
  N'HKEY_LOCAL_MACHINE', 
  N'Software\Microsoft\MSSQLServer\MSSQLServer',
  N'LoginMode', REG_DWORD, 2;