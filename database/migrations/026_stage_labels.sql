-- The company can rename each field stage and switch the optional ones off.
ALTER TABLE FieldStageSettings ADD Label NVARCHAR(60) NULL;
GO
ALTER TABLE FieldStageSettings ADD Enabled BIT NOT NULL CONSTRAINT DF_FieldStage_Enabled DEFAULT 1;
GO
