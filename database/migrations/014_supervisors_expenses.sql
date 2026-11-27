-- The supervisor in charge of a booking (can differ from the technicians' usual supervisor) and the company's expenses.
ALTER TABLE Bookings ADD SupervisorId INT NULL REFERENCES Supervisors(Id);
GO
CREATE TABLE Expenses(
  Id INT IDENTITY PRIMARY KEY, CompanyId INT NOT NULL REFERENCES Companies(Id),
  ExpenseDate DATE NOT NULL, Category NVARCHAR(60) NOT NULL, Description NVARCHAR(300) NULL,
  Amount DECIMAL(18,2) NOT NULL CHECK (Amount > 0),
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), IsDeleted BIT NOT NULL DEFAULT 0);
CREATE INDEX IX_Expenses_Company_Date ON Expenses(CompanyId, ExpenseDate) WHERE IsDeleted=0;
GO
