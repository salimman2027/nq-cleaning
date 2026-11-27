-- Category pictures. Categories themselves are the text in Services.Category; this table only holds their image.
CREATE TABLE ServiceCategories(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  Name NVARCHAR(80) NOT NULL, ImageUrl NVARCHAR(500) NULL, SortOrder INT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_ServiceCategories UNIQUE (CompanyId, Name));
GO
