-- A complaint can point at one stage of the job (depart, arrive, start, progress, finish, cash).
ALTER TABLE Complaints ADD Stage VARCHAR(12) NULL;
GO
