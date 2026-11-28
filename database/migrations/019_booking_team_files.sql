-- The team on a job: free-text notes (names) and private copies of their residence (iqama) IDs. Files are served only to signed-in staff with the assign permission.
ALTER TABLE Bookings ADD TeamNotes NVARCHAR(1000) NULL;
GO
CREATE TABLE BookingTeamFiles(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id), BookingId INT NOT NULL REFERENCES Bookings(Id),
  FileName NVARCHAR(200) NOT NULL, MimeType VARCHAR(30) NOT NULL, SizeBytes INT NOT NULL, Data VARBINARY(MAX) NOT NULL,
  UploadedBy INT NULL, UploadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
CREATE INDEX IX_BookingTeamFiles_Booking ON BookingTeamFiles(BookingId);
GO
