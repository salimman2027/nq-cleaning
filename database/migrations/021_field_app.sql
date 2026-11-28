-- Field supervisor app: a login for each supervisor, per-company rules for each work stage, and a log of what happened on site (notes, photos, videos, cash).
ALTER TABLE Supervisors ADD UserId INT NULL REFERENCES Users(Id);
GO
CREATE TABLE FieldStageSettings(
  CompanyId INT NOT NULL REFERENCES Companies(Id), Stage VARCHAR(12) NOT NULL,
  NoteReq BIT NOT NULL DEFAULT 0, PhotoReq BIT NOT NULL DEFAULT 0, VideoReq BIT NOT NULL DEFAULT 0,
  PRIMARY KEY (CompanyId, Stage));
GO
CREATE TABLE BookingStageEvents(
  Id BIGINT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id), BookingId BIGINT NOT NULL REFERENCES Bookings(Id),
  Stage VARCHAR(12) NOT NULL, Note NVARCHAR(1000) NULL, Amount DECIMAL(18,2) NULL,
  Latitude DECIMAL(9,6) NULL, Longitude DECIMAL(9,6) NULL, CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME());
CREATE INDEX IX_StageEvents_Booking ON BookingStageEvents(BookingId, Id);
GO
CREATE TABLE BookingStageFiles(
  Id BIGINT IDENTITY PRIMARY KEY, EventId BIGINT NOT NULL REFERENCES BookingStageEvents(Id), BookingId BIGINT NOT NULL, CompanyId INT NOT NULL,
  Kind VARCHAR(6) NOT NULL, MimeType VARCHAR(40) NOT NULL, FileName NVARCHAR(200) NOT NULL, SizeBytes INT NOT NULL, Data VARBINARY(MAX) NOT NULL);
CREATE INDEX IX_StageFiles_Event ON BookingStageFiles(EventId);
GO
