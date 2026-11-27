-- A confirmed storefront request becomes a real booking (with its customer) inside the company's own system.
ALTER TABLE BookingRequests ADD BookingId BIGINT NULL REFERENCES Bookings(Id);
GO
