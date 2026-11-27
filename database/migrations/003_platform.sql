-- NQ Cleaning platform: multi-company marketplace foundation.
-- Companies become tenants of the platform. Existing rows (created by bootstrap) stay 'approved'.
ALTER TABLE Companies ADD
  Slug VARCHAR(60) NULL,
  Phone VARCHAR(20) NULL,
  Status VARCHAR(20) NOT NULL CONSTRAINT DF_Companies_Status DEFAULT 'approved',
  IsPlatform BIT NOT NULL CONSTRAINT DF_Companies_IsPlatform DEFAULT 0,
  Description NVARCHAR(1000) NULL,
  LogoUrl NVARCHAR(500) NULL,
  PrimaryColor VARCHAR(7) NULL,
  CrNumber VARCHAR(10) NULL,
  VatNumber VARCHAR(15) NULL,
  NationalAddress NVARCHAR(1000) NULL,
  SubmittedAt DATETIME2 NULL,
  ReviewedAt DATETIME2 NULL,
  ReviewedBy INT NULL,
  ReviewNote NVARCHAR(500) NULL;

ALTER TABLE Users ADD Phone VARCHAR(20) NULL;
GO

SET XACT_ABORT ON;
BEGIN TRAN;

ALTER TABLE Companies ADD CONSTRAINT CK_Companies_Status
  CHECK (Status IN ('draft','pending_review','approved','rejected','suspended'));

CREATE TABLE Sectors(
  Id INT IDENTITY PRIMARY KEY, Code VARCHAR(40) NOT NULL UNIQUE,
  NameAr NVARCHAR(100) NOT NULL, NameEn NVARCHAR(100) NOT NULL,
  SortOrder INT NOT NULL DEFAULT 0, IsActive BIT NOT NULL DEFAULT 1);

INSERT INTO Sectors (Code, NameAr, NameEn, SortOrder) VALUES
  ('cleaning',    N'نظافة',        N'Cleaning',      1),
  ('plumbing',    N'سباكة',        N'Plumbing',      2),
  ('electrical',  N'كهرباء',       N'Electrical',    3),
  ('ac',          N'تكييف',        N'Air conditioning', 4),
  ('pest_control',N'مكافحة حشرات', N'Pest control',  5),
  ('laundry',     N'مغسلة',        N'Laundry',       6),
  ('maintenance', N'صيانة عامة',   N'General maintenance', 7),
  ('moving',      N'نقل أثاث',     N'Furniture moving', 8);

CREATE TABLE CompanySectors(
  CompanyId INT NOT NULL REFERENCES Companies(Id), SectorId INT NOT NULL REFERENCES Sectors(Id),
  PRIMARY KEY (CompanyId, SectorId));

-- One-time codes for phone verification. Only a keyed hash of the code is stored.
CREATE TABLE OtpCodes(
  Id BIGINT IDENTITY PRIMARY KEY, Phone VARCHAR(20) NOT NULL, Purpose VARCHAR(30) NOT NULL,
  CodeHash CHAR(64) NOT NULL, ExpiresAt DATETIME2 NOT NULL, Attempts INT NOT NULL DEFAULT 0,
  ConsumedAt DATETIME2 NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), Ip VARCHAR(64) NULL);
CREATE INDEX IX_Otp_Phone ON OtpCodes(Phone, Purpose, CreatedAt DESC);

-- Platform-wide customer identity (verified phone). Company-level Customers rows are linked by phone at booking time.
CREATE TABLE MarketplaceCustomers(
  Id INT IDENTITY PRIMARY KEY, Phone VARCHAR(20) NOT NULL, Name NVARCHAR(200) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), IsDeleted BIT NOT NULL DEFAULT 0);

CREATE TABLE NotificationLogs(
  Id BIGINT IDENTITY PRIMARY KEY, CompanyId INT NULL, Phone VARCHAR(20) NOT NULL, Channel VARCHAR(20) NOT NULL,
  Template VARCHAR(60) NOT NULL, Status VARCHAR(20) NOT NULL, Error NVARCHAR(500) NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());

COMMIT;
GO

CREATE UNIQUE INDEX UX_Companies_Slug ON Companies(Slug) WHERE Slug IS NOT NULL;
CREATE UNIQUE INDEX UX_Companies_Phone ON Companies(Phone) WHERE Phone IS NOT NULL AND IsDeleted = 0;
CREATE UNIQUE INDEX UX_Users_Phone ON Users(Phone) WHERE Phone IS NOT NULL AND IsDeleted = 0;
CREATE UNIQUE INDEX UX_MarketCust_Phone ON MarketplaceCustomers(Phone) WHERE IsDeleted = 0;
CREATE INDEX IX_Companies_Status ON Companies(Status) INCLUDE (IsPlatform);
GO
