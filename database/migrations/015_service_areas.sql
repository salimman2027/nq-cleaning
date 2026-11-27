-- Where a company works. A city row with District NULL means the whole city; district rows restrict that city to those districts.
CREATE TABLE CompanyAreas(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  City NVARCHAR(60) NOT NULL, District NVARCHAR(80) NULL);
CREATE UNIQUE INDEX UX_CompanyAreas ON CompanyAreas(CompanyId, City, District);
GO
ALTER TABLE BookingRequests ADD City NVARCHAR(60) NULL, District NVARCHAR(80) NULL;
GO
