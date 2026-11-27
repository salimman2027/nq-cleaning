-- Images uploaded by companies (logo, cover, service photos). Public read, validated on upload.
CREATE TABLE MediaFiles(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  MimeType VARCHAR(30) NOT NULL, SizeBytes INT NOT NULL, Data VARBINARY(MAX) NOT NULL,
  CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
ALTER TABLE Services ADD Description NVARCHAR(1000) NULL, Includes NVARCHAR(1500) NULL, Notes NVARCHAR(500) NULL;
GO
