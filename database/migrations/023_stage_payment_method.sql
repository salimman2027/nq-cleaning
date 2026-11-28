-- The supervisor records how the money was received when finishing the job: cash or bank transfer (with a proof photo).
ALTER TABLE BookingStageEvents ADD Method VARCHAR(8) NULL;
GO
