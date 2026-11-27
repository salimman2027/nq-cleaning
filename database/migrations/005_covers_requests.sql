ALTER TABLE Companies ADD CoverUrl NVARCHAR(500) NULL;
GO
-- Booking requests from marketplace visitors. The company confirms by phone; no payment or slot reservation yet.
CREATE TABLE BookingRequests(
  Id INT IDENTITY PRIMARY KEY,
  CompanyId INT NOT NULL REFERENCES Companies(Id),
  ServiceId INT NOT NULL REFERENCES Services(Id),
  CustomerName NVARCHAR(120) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  Address NVARCHAR(300) NULL,
  PreferredDate DATE NOT NULL,
  PreferredPeriod VARCHAR(10) NOT NULL CHECK (PreferredPeriod IN ('morning','afternoon','evening')),
  Notes NVARCHAR(500) NULL,
  Status VARCHAR(12) NOT NULL DEFAULT 'new' CHECK (Status IN ('new','contacted','confirmed','cancelled')),
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2 NULL);
CREATE INDEX IX_BookingRequests_Company ON BookingRequests(CompanyId, Status, CreatedAt DESC);
GO
