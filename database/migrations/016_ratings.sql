-- One rating per finished booking, reached by the customer through a private link.
CREATE TABLE Ratings(
  Id INT IDENTITY PRIMARY KEY, BookingId BIGINT NOT NULL REFERENCES Bookings(Id), CompanyId INT NOT NULL REFERENCES Companies(Id),
  Token CHAR(32) NOT NULL, Stars TINYINT NULL CHECK (Stars BETWEEN 1 AND 5), Comment NVARCHAR(500) NULL,
  RequestedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), SubmittedAt DATETIME2 NULL);
CREATE UNIQUE INDEX UX_Ratings_Booking ON Ratings(BookingId);
CREATE UNIQUE INDEX UX_Ratings_Token ON Ratings(Token);
CREATE INDEX IX_Ratings_Company ON Ratings(CompanyId, SubmittedAt DESC);
GO
