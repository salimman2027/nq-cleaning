-- Company-level grouping: a sector holds several sections (ServiceCategories), a section holds services.
CREATE TABLE ServiceSectors(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  Name NVARCHAR(80) NOT NULL, SortOrder INT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_ServiceSectors UNIQUE (CompanyId, Name));
GO
ALTER TABLE ServiceCategories ADD SectorId INT NULL REFERENCES ServiceSectors(Id);
GO
