-- Official documents a company uploads for review (commercial registration, VAT certificate, national address).
-- The file bytes live in the database; Extracted holds values read from the file (suggestions only, never trusted).
CREATE TABLE CompanyDocuments(
  Id INT IDENTITY PRIMARY KEY,
  CompanyId INT NOT NULL REFERENCES Companies(Id),
  Kind VARCHAR(10) NOT NULL CHECK (Kind IN ('cr','vat','address')),
  FileName NVARCHAR(200) NOT NULL,
  MimeType VARCHAR(60) NOT NULL,
  SizeBytes INT NOT NULL,
  Data VARBINARY(MAX) NOT NULL,
  Extracted NVARCHAR(MAX) NULL,
  ExtractStatus VARCHAR(20) NOT NULL DEFAULT 'skipped',
  UploadedBy INT NULL,
  UploadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  IsCurrent BIT NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX UX_CompanyDocs_Current ON CompanyDocuments(CompanyId, Kind) WHERE IsCurrent = 1;
GO
