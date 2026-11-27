-- Lets the customer see an in-app notice when the company changes the status of an order.
ALTER TABLE BookingRequests ADD CustomerSeenStatus VARCHAR(12) NULL;
GO
