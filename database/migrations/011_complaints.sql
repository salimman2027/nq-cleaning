-- Customer complaints about a company, reviewed by the platform team.
CREATE TABLE Complaints(
  Id INT IDENTITY PRIMARY KEY,
  CompanyId INT NOT NULL REFERENCES Companies(Id),
  RequestId INT NULL REFERENCES BookingRequests(Id),
  CustomerId INT NULL REFERENCES MarketplaceCustomers(Id),
  CustomerName NVARCHAR(120) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  Message NVARCHAR(1000) NOT NULL,
  Status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (Status IN ('open','in_review','resolved')),
  PlatformNote NVARCHAR(500) NULL,
  HandledBy INT NULL,
  HandledAt DATETIME2 NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
CREATE INDEX IX_Complaints_Status ON Complaints(Status, CreatedAt DESC);
CREATE INDEX IX_Complaints_Company ON Complaints(CompanyId, CreatedAt DESC);
GO
