-- A work team (supervisor) can have its own hours, working days and capacity per slot instead of following the company schedule.
CREATE TABLE SupervisorSchedule(
  SupervisorId INT NOT NULL PRIMARY KEY REFERENCES Supervisors(Id), CompanyId INT NOT NULL REFERENCES Companies(Id),
  OpenTime CHAR(5) NOT NULL, CloseTime CHAR(5) NOT NULL, Days VARCHAR(7) NOT NULL, MaxPerSlot INT NOT NULL DEFAULT 1);
GO
