-- Each company sets its own working hours, slot length, working days and how many jobs fit in one slot.
CREATE TABLE CompanySchedule(
  CompanyId INT NOT NULL PRIMARY KEY REFERENCES Companies(Id),
  OpenTime CHAR(5) NOT NULL DEFAULT '08:00',
  CloseTime CHAR(5) NOT NULL DEFAULT '20:00',
  SlotMinutes INT NOT NULL DEFAULT 120,
  Days VARCHAR(7) NOT NULL DEFAULT '0123456',   -- 0 = Sunday ... 6 = Saturday
  MaxPerSlot INT NOT NULL DEFAULT 3);
GO
ALTER TABLE BookingRequests ADD PreferredTime CHAR(5) NULL;
GO
