-- Where the job is (GPS pin the customer shared) and a photo of the place.
ALTER TABLE BookingRequests ADD Latitude DECIMAL(9,6) NULL, Longitude DECIMAL(9,6) NULL, PhotoUrl NVARCHAR(500) NULL;
GO
