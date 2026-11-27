-- Customer accounts (phone + password) and orders with line items. Card payment is not enabled yet: PaymentMethod 'card' is rejected by the API.
ALTER TABLE MarketplaceCustomers ADD PasswordHash VARCHAR(100) NULL;
ALTER TABLE BookingRequests ADD
  CustomerId INT NULL REFERENCES MarketplaceCustomers(Id),
  PaymentMethod VARCHAR(10) NOT NULL CONSTRAINT DF_BR_PayMethod DEFAULT 'cash',
  PaymentStatus VARCHAR(10) NOT NULL CONSTRAINT DF_BR_PayStatus DEFAULT 'unpaid',
  Total DECIMAL(18,2) NULL;
GO
CREATE TABLE BookingRequestItems(
  Id INT IDENTITY PRIMARY KEY, RequestId INT NOT NULL REFERENCES BookingRequests(Id),
  ServiceId INT NOT NULL REFERENCES Services(Id), Name NVARCHAR(200) NOT NULL,
  UnitPrice DECIMAL(18,2) NOT NULL, Qty INT NOT NULL);
CREATE INDEX IX_BRItems_Request ON BookingRequestItems(RequestId);
CREATE INDEX IX_BR_Customer ON BookingRequests(CustomerId, CreatedAt DESC);
GO
