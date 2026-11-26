-- NQ Cleaning: Phase 1 operations schema (sequences, staff, leaves, teams, vehicles, overlap trigger).
SET XACT_ABORT ON;
BEGIN TRAN;

CREATE SEQUENCE CustomerCodeSeq AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE TechnicianCodeSeq AS BIGINT START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE BookingNoSeq AS BIGINT START WITH 1 INCREMENT BY 1;

ALTER TABLE Bookings ADD
  Source VARCHAR(30) NULL,
  Priority VARCHAR(10) NOT NULL CONSTRAINT DF_Bookings_Priority DEFAULT 'normal',
  Notes NVARCHAR(2000) NULL;

CREATE INDEX IX_Bookings_Company_Start ON Bookings(CompanyId, StartAt) INCLUDE (Status, BranchId, CustomerId);

CREATE TABLE Supervisors(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  BranchId INT NOT NULL REFERENCES Branches(Id), UserId INT NULL REFERENCES Users(Id),
  FullName NVARCHAR(200) NOT NULL, Mobile VARCHAR(20) NULL,
  MaxBookingsPerDay INT NOT NULL DEFAULT 10, IsDeleted BIT NOT NULL DEFAULT 0);

ALTER TABLE Technicians ADD SupervisorId INT NULL CONSTRAINT FK_Tech_Supervisor REFERENCES Supervisors(Id);

CREATE TABLE TechnicianLeaves(
  Id INT IDENTITY PRIMARY KEY, TechnicianId INT NOT NULL REFERENCES Technicians(Id),
  FromAt DATETIME2 NOT NULL, ToAt DATETIME2 NOT NULL, Reason NVARCHAR(300) NULL,
  CONSTRAINT CK_Leave_Time CHECK (ToAt > FromAt));
CREATE INDEX IX_Leaves_Tech ON TechnicianLeaves(TechnicianId, FromAt, ToAt);

CREATE TABLE Vehicles(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id), BranchId INT NOT NULL REFERENCES Branches(Id),
  PlateNo NVARCHAR(30) NOT NULL, Model NVARCHAR(100) NULL, IsActive BIT NOT NULL DEFAULT 1, IsDeleted BIT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_Vehicle_Plate UNIQUE(CompanyId, PlateNo));

CREATE TABLE Teams(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id), BranchId INT NOT NULL REFERENCES Branches(Id),
  Name NVARCHAR(100) NOT NULL, LeaderTechnicianId INT NULL REFERENCES Technicians(Id), SupervisorId INT NULL REFERENCES Supervisors(Id),
  VehicleId INT NULL REFERENCES Vehicles(Id), IsTemporary BIT NOT NULL DEFAULT 0, IsDeleted BIT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_Team_Name UNIQUE(CompanyId, Name));
CREATE TABLE TeamMembers(
  TeamId INT NOT NULL REFERENCES Teams(Id), TechnicianId INT NOT NULL REFERENCES Technicians(Id), PRIMARY KEY(TeamId, TechnicianId));

COMMIT;
GO

-- Database-level backstop: a technician can never hold two overlapping active assignments,
-- even if application code is bypassed. (Travel buffer is enforced in the API layer.)
CREATE TRIGGER TR_BookingAssignments_NoOverlap ON BookingAssignments AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1 FROM inserted i
    JOIN BookingAssignments a ON a.TechnicianId = i.TechnicianId AND a.Id <> i.Id AND a.IsActive = 1
    WHERE i.IsActive = 1 AND a.StartAt < i.EndAt AND a.EndAt > i.StartAt)
  BEGIN
    RAISERROR('TECHNICIAN_OVERLAP', 16, 1);
    ROLLBACK TRANSACTION;
  END
END;
GO
