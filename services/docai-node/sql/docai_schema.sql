-- RetailCLIQ Universal AI Document Processing – batch, staging & audit tables
-- Dates inside payloads are ISO; convert with dbo.englishHBS when posting into transaction tables.
IF OBJECT_ID('DocAI_Batch') IS NULL
CREATE TABLE DocAI_Batch (
  BatchId      UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  DocType      NVARCHAR(20)  NULL,
  Status       NVARCHAR(30)  NOT NULL DEFAULT 'draft',   -- draft | pending-approval | posted | failed
  SourceKind   NVARCHAR(20)  NULL,                       -- file | camera | text | manual | api
  SourceFile   NVARCHAR(400) NULL,
  SourceDocNo  NVARCHAR(100) NULL,
  PartyCode    NVARCHAR(50)  NULL,
  CreatedDocNo NVARCHAR(50)  NULL,
  Payload      NVARCHAR(MAX) NULL,                       -- full wizard state (extraction, corrections, validation, audit)
  CreatedBy    NVARCHAR(50)  NULL, CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  UpdatedBy    NVARCHAR(50)  NULL, UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
);
IF OBJECT_ID('DocAI_Staging') IS NULL
CREATE TABLE DocAI_Staging (
  StagingId  BIGINT IDENTITY PRIMARY KEY,
  BatchId    UNIQUEIDENTIFIER NOT NULL,
  DocType    NVARCHAR(20) NOT NULL,
  HeaderJson NVARCHAR(MAX) NOT NULL,
  LinesJson  NVARCHAR(MAX) NOT NULL,
  CreatedBy  NVARCHAR(50) NULL, CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);
IF OBJECT_ID('DocAI_DocTypeConfig') IS NULL
CREATE TABLE DocAI_DocTypeConfig (            -- §15 configurable document types (optional DB override of documentTypes.js)
  Code NVARCHAR(20) PRIMARY KEY, Name NVARCHAR(100) NOT NULL, ConfigJson NVARCHAR(MAX) NOT NULL, IsActive BIT NOT NULL DEFAULT 1
);
IF OBJECT_ID('DocAI_FormatLearning') IS NULL
CREATE TABLE DocAI_FormatLearning (           -- §17 supplier-specific format learning: user corrections per party
  Id BIGINT IDENTITY PRIMARY KEY, PartyCode NVARCHAR(50), DocType NVARCHAR(20), FieldKey NVARCHAR(50), FromValue NVARCHAR(400), ToValue NVARCHAR(400), CreatedAt DATETIME DEFAULT GETDATE()
);
CREATE INDEX IX_DocAI_Batch_Dup ON DocAI_Batch (DocType, SourceDocNo, PartyCode, Status);
GO
-- Posting entry point: wire to your real procs (proc_PostPurchaseInvoice, proc_StockImportwithSupplier, ...)
IF OBJECT_ID('proc_DocAI_Post') IS NULL
EXEC('CREATE PROCEDURE proc_DocAI_Post @BatchId UNIQUEIDENTIFIER AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @DocType NVARCHAR(20), @Header NVARCHAR(MAX), @Lines NVARCHAR(MAX);
  SELECT TOP 1 @DocType = DocType, @Header = HeaderJson, @Lines = LinesJson FROM DocAI_Staging WHERE BatchId = @BatchId ORDER BY StagingId DESC;
  -- TODO: per @DocType, OPENJSON(@Header)/(@Lines) → call the RetailCLIQ posting procedures inside this transaction.
  SELECT CAST(@DocType AS NVARCHAR(20)) + ''-'' + FORMAT(GETDATE(), ''yyMMddHHmmss'') AS DocNo;
END');
GO

-- Supplier profile: defaults learned per supplier (classification, GST type, pay mode) used when the invoice
-- does not say – populated from what the user saves in the Purchase Invoice screen.
IF OBJECT_ID('DocAI_SupplierProfile') IS NULL
CREATE TABLE DocAI_SupplierProfile (
  SupplierCode NVARCHAR(50) PRIMARY KEY, Division NVARCHAR(50), Department NVARCHAR(50), Category NVARCHAR(50), SubCategory NVARCHAR(50),
  Brand NVARCHAR(50), UOM NVARCHAR(10), GstType CHAR(4) DEFAULT 'excl', DisType CHAR(1) DEFAULT 'P', PayMode NVARCHAR(10) DEFAULT 'Credit',
  PurchaseAc NVARCHAR(50), UpdatedAt DATETIME DEFAULT GETDATE()
);
-- HSN → classification map (seed from server/services/erpMapper.js HSN_MAP; extend per business)
IF OBJECT_ID('DocAI_HsnMap') IS NULL
CREATE TABLE DocAI_HsnMap ( HsnPrefix NVARCHAR(8) PRIMARY KEY, Division NVARCHAR(50), Department NVARCHAR(50), Category NVARCHAR(50), SubCategory NVARCHAR(50), InTax DECIMAL(5,2) NULL );
GO
-- Posting path for Purchase Invoice: stage rows in Stock_Import_Export then call the existing proc.
-- DocAI_Staging.LinesJson already carries the exact Stock_Import_Export column names (see erpMapper.staging):
--   INSERT INTO Stock_Import_Export (SupplierName, InvoiceNo, InvoiceDate, OEMCode, ItemDescription, Qty, PurchasePrice, MRP, Discount, DisType,
--     DiscountPrice, Division, Department, Category, SubCategory, Style, Design, Size, Color, Brand, Verticle1, Verticle2, Verticle3,
--     InTax, InTaxType, OutTax, OutTaxType, BatchNo, PackedDate, ExpiryDate, WSPPrice, BatchId)
--   SELECT ... FROM OPENJSON(@Lines) WITH (...);
--   EXEC proc_StockImportwithSupplier @BatchId;
