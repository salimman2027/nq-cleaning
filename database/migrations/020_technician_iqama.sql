-- Residence (iqama) number and a private copy of the ID for each technician. The file is served only to authorised signed-in staff.
ALTER TABLE Technicians ADD IqamaNumber VARCHAR(10) NULL;
GO
CREATE TABLE TechnicianIqama(
  TechnicianId INT NOT NULL PRIMARY KEY REFERENCES Technicians(Id), CompanyId INT NOT NULL REFERENCES Companies(Id),
  MimeType VARCHAR(30) NOT NULL, SizeBytes INT NOT NULL, Data VARBINARY(MAX) NOT NULL, UploadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
