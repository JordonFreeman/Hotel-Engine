-- migrate_guest_types.sql
-- Run this once in MS SQL Server to add occupancy columns
-- to Rooms and guest-count columns to Bookings.

-- 1. Room capacity constraints
ALTER TABLE Rooms
  ADD MaxAdults   INT NOT NULL DEFAULT 2,
      MaxChildren INT NOT NULL DEFAULT 1;

-- 2. Guest counts on each booking
ALTER TABLE Bookings
  ADD NumAdults   INT NOT NULL DEFAULT 1,
      NumChildren INT NOT NULL DEFAULT 0;

-- 3. Verify
SELECT 'Rooms columns'    AS [Table], COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Rooms'   AND COLUMN_NAME IN ('MaxAdults','MaxChildren')
UNION ALL
SELECT 'Bookings columns' AS [Table], COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Bookings' AND COLUMN_NAME IN ('NumAdults','NumChildren');
