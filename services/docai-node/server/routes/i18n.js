"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureI18nTables = ensureI18nTables;
/**
 * i18n Route — Manchala Translation Registry
 * Self-hosted translations stored in RC26MASTERDB.WebApp.tbl_translations
 * and WebApp.tbl_locale_formats.
 *
 * Public endpoints:
 *   GET /api/i18n/locales
 *   GET /api/i18n/dict?lang=X&project=Y&screen=Z
 *   GET /api/i18n/formats
 *   GET /api/i18n/formats/:lang
 *   GET /api/i18n/by-control?control_id=X&lang=Y
 *
 * Admin endpoints (auth required):
 *   GET    /api/i18n/admin/matrix
 *   GET    /api/i18n/admin/scopes
 *   POST   /api/i18n/admin/upsert
 *   POST   /api/i18n/admin/bulk
 *   POST   /api/i18n/admin/formats/upsert
 *   DELETE /api/i18n/admin/key
 *   POST   /api/i18n/admin/auto-suggest  (Sarvam AI)
 */
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const master_db_1 = require("../db/master-db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── 18 locales, grouped for the selector: India (primary 5) -> India (Others) -> International (top 5) ──
const LOCALES = [
    // India — primary (English default, then Hindi, Telugu, Tamil, Kannada)
    { code: 'en-IN', label: 'English', rtl: false, group: 'india' },
    { code: 'hi-IN', label: 'हिन्दी', rtl: false, group: 'india' },
    { code: 'te-IN', label: 'తెలుగు', rtl: false, group: 'india' },
    { code: 'ta-IN', label: 'தமிழ்', rtl: false, group: 'india' },
    { code: 'kn-IN', label: 'ಕನ್ನಡ', rtl: false, group: 'india' },
    // India — others
    { code: 'mr-IN', label: 'मराठी', rtl: false, group: 'india-other' },
    { code: 'bn-IN', label: 'বাংলা', rtl: false, group: 'india-other' },
    { code: 'gu-IN', label: 'ગુજરાતી', rtl: false, group: 'india-other' },
    { code: 'ml-IN', label: 'മലയാളം', rtl: false, group: 'india-other' },
    { code: 'pa-IN', label: 'ਪੰਜਾਬੀ', rtl: false, group: 'india-other' },
    { code: 'or-IN', label: 'ଓଡ଼ିଆ', rtl: false, group: 'india-other' },
    { code: 'ur-IN', label: 'اردو', rtl: true, group: 'india-other' },
    // International — top 5
    { code: 'ar-AE', label: 'العربية', rtl: true, group: 'international' },
    { code: 'fr-FR', label: 'Français', rtl: false, group: 'international' },
    { code: 'es-ES', label: 'Español', rtl: false, group: 'international' },
    { code: 'de-DE', label: 'Deutsch', rtl: false, group: 'international' },
    { code: 'it-IT', label: 'Italiano', rtl: false, group: 'international' },
    // International — others
    { code: 'el-GR', label: 'Ελληνικά', rtl: false, group: 'international-other' },
];
// Sarvam-supported target languages for auto-translate
const SARVAM_SUPPORTED = new Set(['hi-IN', 'ta-IN', 'te-IN', 'mr-IN', 'bn-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN', 'or-IN']);
// Default locale format seeds
const DEFAULT_FORMATS = [
    { lang_code: 'en-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'hi-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'ta-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'te-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'mr-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'bn-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'gu-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'kn-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'ml-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'pa-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'or-IN', currency_code: 'INR', currency_symbol: '₹', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'ur-IN', currency_code: 'PKR', currency_symbol: '₨', currency_position: 'prefix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'ar-AE', currency_code: 'AED', currency_symbol: 'د.إ', currency_position: 'suffix', thousands_sep: ',', decimal_sep: '.', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 6 },
    { lang_code: 'de-DE', currency_code: 'EUR', currency_symbol: '€', currency_position: 'suffix', thousands_sep: '.', decimal_sep: ',', decimal_places: 2, date_format: 'DD.MM.YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'fr-FR', currency_code: 'EUR', currency_symbol: '€', currency_position: 'suffix', thousands_sep: ' ', decimal_sep: ',', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'it-IT', currency_code: 'EUR', currency_symbol: '€', currency_position: 'suffix', thousands_sep: '.', decimal_sep: ',', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'es-ES', currency_code: 'EUR', currency_symbol: '€', currency_position: 'suffix', thousands_sep: '.', decimal_sep: ',', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
    { lang_code: 'el-GR', currency_code: 'EUR', currency_symbol: '€', currency_position: 'suffix', thousands_sep: '.', decimal_sep: ',', decimal_places: 2, date_format: 'DD/MM/YYYY', time_format: 'HH:mm', first_day_of_week: 1 },
];
// ── Table bootstrap ───────────────────────────────────────────────────────────
let _tablesReady = false;
async function ensureI18nTables() {
    if (_tablesReady)
        return;
    try {
        await (0, master_db_1.executeMasterQuery)(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='tbl_translations' AND TABLE_SCHEMA='WebApp')
      BEGIN
        CREATE TABLE WebApp.tbl_translations (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          scope       NVARCHAR(120) NOT NULL,
          [key]       NVARCHAR(200) NOT NULL,
          lang_code   NVARCHAR(10)  NOT NULL,
          value       NVARCHAR(MAX),
          source      NVARCHAR(20)  DEFAULT 'manual',
          project_name NVARCHAR(80),
          screen_name  NVARCHAR(120),
          control_id   NVARCHAR(160),
          created_at  DATETIME2     DEFAULT GETDATE(),
          updated_at  DATETIME2     DEFAULT GETDATE(),
          CONSTRAINT UQ_i18n UNIQUE (scope, [key], lang_code)
        )
      END
    `, {});
        await (0, master_db_1.executeMasterQuery)(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='tbl_locale_formats' AND TABLE_SCHEMA='WebApp')
      BEGIN
        CREATE TABLE WebApp.tbl_locale_formats (
          lang_code         NVARCHAR(10)  PRIMARY KEY,
          currency_code     NVARCHAR(10)  DEFAULT 'INR',
          currency_symbol   NVARCHAR(10)  DEFAULT N'₹',
          currency_position NVARCHAR(10)  DEFAULT 'prefix',
          thousands_sep     NVARCHAR(5)   DEFAULT ',',
          decimal_sep       NVARCHAR(5)   DEFAULT '.',
          decimal_places    INT           DEFAULT 2,
          date_format       NVARCHAR(20)  DEFAULT 'DD/MM/YYYY',
          time_format       NVARCHAR(20)  DEFAULT 'HH:mm',
          first_day_of_week INT           DEFAULT 1,
          updated_at        DATETIME2     DEFAULT GETDATE()
        )
      END
    `, {});
        // Seed locale formats if table is empty
        const existing = await (0, master_db_1.executeMasterQuery)('SELECT COUNT(*) AS cnt FROM WebApp.tbl_locale_formats', {});
        if (!existing?.[0]?.cnt) {
            for (const f of DEFAULT_FORMATS) {
                try {
                    await (0, master_db_1.executeMasterQuery)(`
            IF NOT EXISTS (SELECT 1 FROM WebApp.tbl_locale_formats WHERE lang_code=@lc)
            INSERT INTO WebApp.tbl_locale_formats
              (lang_code,currency_code,currency_symbol,currency_position,thousands_sep,decimal_sep,decimal_places,date_format,time_format,first_day_of_week)
            VALUES (@lc,@cc,@cs,@cp,@ts,@ds,@dp,@df,@tf,@fd)
          `, {
                        lc: f.lang_code, cc: f.currency_code, cs: f.currency_symbol, cp: f.currency_position,
                        ts: f.thousands_sep, ds: f.decimal_sep, dp: f.decimal_places,
                        df: f.date_format, tf: f.time_format, fd: f.first_day_of_week
                    });
                }
                catch { /* continue */ }
            }
        }
        _tablesReady = true;
        console.log('[i18n] Tables ready');
        // Auto-seed translation registry on startup (background, non-blocking)
        setTimeout(() => seedTranslationRegistry().catch(e => console.warn('[i18n] Registry seed error:', e.message)), 5000);
    }
    catch (e) {
        console.warn('[i18n] Table bootstrap failed:', e.message);
    }
}

// Seed the translation-registry.json + screen labels into tbl_translations on first run
const _SCREEN_LABELS = [
    // --- Party Bill screen ---
    { scope:'partyBill', key:'title', 'en-IN':'Party Bill', 'hi-IN':'पार्टी बिल' },
    { scope:'partyBill', key:'supplier', 'en-IN':'Supplier', 'hi-IN':'आपूर्तिकर्ता' },
    { scope:'partyBill', key:'purchase_account', 'en-IN':'Purchase A/C', 'hi-IN':'खरीद खाता' },
    { scope:'partyBill', key:'ref_no', 'en-IN':'Ref No', 'hi-IN':'संदर्भ संख्या' },
    { scope:'partyBill', key:'bill_type', 'en-IN':'Bill Type', 'hi-IN':'बिल प्रकार' },
    { scope:'partyBill', key:'supplier_inv_no', 'en-IN':'Supplier Inv No', 'hi-IN':'आपूर्तिकर्ता चालान संख्या' },
    { scope:'partyBill', key:'inv_date', 'en-IN':'Inv Date', 'hi-IN':'चालान तिथि' },
    { scope:'partyBill', key:'due_date', 'en-IN':'Due Date', 'hi-IN':'देय तिथि' },
    { scope:'partyBill', key:'remarks', 'en-IN':'Remarks', 'hi-IN':'टिप्पणी' },
    { scope:'partyBill', key:'freight', 'en-IN':'Freight', 'hi-IN':'भाड़ा' },
    { scope:'partyBill', key:'round_off', 'en-IN':'Round Off', 'hi-IN':'राउंड ऑफ' },
    { scope:'partyBill', key:'tax_type', 'en-IN':'Tax Type', 'hi-IN':'कर प्रकार' },
    { scope:'partyBill', key:'item_code', 'en-IN':'Item Code', 'hi-IN':'आइटम कोड' },
    { scope:'partyBill', key:'item_name', 'en-IN':'Item Name', 'hi-IN':'आइटम नाम' },
    { scope:'partyBill', key:'qty', 'en-IN':'Qty', 'hi-IN':'मात्रा' },
    { scope:'partyBill', key:'rate', 'en-IN':'Rate', 'hi-IN':'दर' },
    { scope:'partyBill', key:'mrp', 'en-IN':'MRP', 'hi-IN':'एमआरपी' },
    { scope:'partyBill', key:'markup_per', 'en-IN':'Markup %', 'hi-IN':'मार्कअप %' },
    { scope:'partyBill', key:'disc_val', 'en-IN':'Disc Val', 'hi-IN':'छूट मूल्य' },
    { scope:'partyBill', key:'gst_per', 'en-IN':'GST %', 'hi-IN':'जीएसटी %' },
    { scope:'partyBill', key:'value', 'en-IN':'Value', 'hi-IN':'मूल्य' },
    { scope:'partyBill', key:'gross_amount', 'en-IN':'Gross Amount', 'hi-IN':'सकल राशि' },
    { scope:'partyBill', key:'net_amount', 'en-IN':'Net Amount', 'hi-IN':'शुद्ध राशि' },
    { scope:'partyBill', key:'item_info', 'en-IN':'Item Info', 'hi-IN':'आइटम जानकारी' },
    // --- Item Master screen ---
    { scope:'itemMaster', key:'title', 'en-IN':'Item Master', 'hi-IN':'आइटम मास्टर' },
    { scope:'itemMaster', key:'item_code', 'en-IN':'Item Code', 'hi-IN':'आइटम कोड' },
    { scope:'itemMaster', key:'barcode', 'en-IN':'Barcode', 'hi-IN':'बारकोड' },
    { scope:'itemMaster', key:'item_name', 'en-IN':'Item Name', 'hi-IN':'आइटम नाम' },
    { scope:'itemMaster', key:'short_name', 'en-IN':'Short Name', 'hi-IN':'संक्षिप्त नाम' },
    { scope:'itemMaster', key:'hsn_code', 'en-IN':'HSN Code', 'hi-IN':'एचएसएन कोड' },
    { scope:'itemMaster', key:'status', 'en-IN':'Status', 'hi-IN':'स्थिति' },
    { scope:'itemMaster', key:'allow_discount', 'en-IN':'Allow Discount', 'hi-IN':'छूट की अनुमति दें' },
    { scope:'itemMaster', key:'tab_basic', 'en-IN':'Basic Info', 'hi-IN':'मूल जानकारी' },
    { scope:'itemMaster', key:'tab_classification', 'en-IN':'Classification', 'hi-IN':'वर्गीकरण' },
    { scope:'itemMaster', key:'tab_price', 'en-IN':'Price Info', 'hi-IN':'मूल्य जानकारी' },
    { scope:'itemMaster', key:'tab_tax', 'en-IN':'Tax Info', 'hi-IN':'कर जानकारी' },
    { scope:'itemMaster', key:'tab_stock', 'en-IN':'Stock Info', 'hi-IN':'स्टॉक जानकारी' },
    { scope:'itemMaster', key:'tab_images', 'en-IN':'Images', 'hi-IN':'छवियाँ' },
    { scope:'itemMaster', key:'cost_price', 'en-IN':'Cost Price', 'hi-IN':'लागत मूल्य' },
    { scope:'itemMaster', key:'selling_price', 'en-IN':'Selling Price', 'hi-IN':'विक्रय मूल्य' },
    { scope:'itemMaster', key:'min_selling', 'en-IN':'Min Sell Price', 'hi-IN':'न्यूनतम विक्रय मूल्य' },
    { scope:'itemMaster', key:'margin', 'en-IN':'Margin %', 'hi-IN':'मार्जिन %' },
    { scope:'itemMaster', key:'uom', 'en-IN':'UOM', 'hi-IN':'माप इकाई' },
    { scope:'itemMaster', key:'reorder_level', 'en-IN':'Reorder Level', 'hi-IN':'पुनर्ऑर्डर स्तर' },
    { scope:'itemMaster', key:'min_order_qty', 'en-IN':'Min Order Qty', 'hi-IN':'न्यूनतम ऑर्डर मात्रा' },
    // --- Attribute labels (mirrors AE_Attributes.Label) ---
    { scope:'attr', key:'division', 'en-IN':'Division', 'hi-IN':'विभाजन' },
    { scope:'attr', key:'department', 'en-IN':'Department', 'hi-IN':'विभाग' },
    { scope:'attr', key:'category', 'en-IN':'Category', 'hi-IN':'श्रेणी' },
    { scope:'attr', key:'subcategory', 'en-IN':'Sub Category', 'hi-IN':'उप श्रेणी' },
    { scope:'attr', key:'brand', 'en-IN':'Brand', 'hi-IN':'ब्रांड' },
    { scope:'attr', key:'style', 'en-IN':'Style', 'hi-IN':'स्टाइल' },
    { scope:'attr', key:'design', 'en-IN':'Design', 'hi-IN':'डिजाइन' },
    { scope:'attr', key:'color', 'en-IN':'Colour', 'hi-IN':'रंग' },
    { scope:'attr', key:'size', 'en-IN':'Size', 'hi-IN':'आकार' },
    { scope:'attr', key:'uom', 'en-IN':'UOM', 'hi-IN':'माप इकाई' },
    { scope:'attr', key:'fabricType', 'en-IN':'Fabric Type', 'hi-IN':'कपड़े का प्रकार' },
    { scope:'attr', key:'fit', 'en-IN':'Fit', 'hi-IN':'फिट' },
    { scope:'attr', key:'collarType', 'en-IN':'Collar Type', 'hi-IN':'कॉलर प्रकार' },
    { scope:'attr', key:'washType', 'en-IN':'Wash Type', 'hi-IN':'वॉश प्रकार' },
    { scope:'attr', key:'styleDetail', 'en-IN':'Style Detail', 'hi-IN':'स्टाइल विवरण' },
    { scope:'attr', key:'hsn', 'en-IN':'HSN Code', 'hi-IN':'एचएसएन कोड' },
    { scope:'attr', key:'batchNumber', 'en-IN':'Batch Number', 'hi-IN':'बैच नंबर' },
    { scope:'attr', key:'expiryDate', 'en-IN':'Expiry Date', 'hi-IN':'समाप्ति तिथि' },
    { scope:'attr', key:'mrp', 'en-IN':'MRP', 'hi-IN':'एमआरपी' },
    { scope:'attr', key:'costRate', 'en-IN':'Cost / Purchase Rate', 'hi-IN':'लागत / खरीद दर' },
    { scope:'attr', key:'wholesaleRate', 'en-IN':'Wholesale Rate', 'hi-IN':'थोक दर' },
    { scope:'attr', key:'sellingWspPrice', 'en-IN':'Selling WSP Price', 'hi-IN':'बिक्री WSP मूल्य' },
    { scope:'attr', key:'discountType', 'en-IN':'Discount Type', 'hi-IN':'छूट प्रकार' },
    { scope:'attr', key:'discountValue', 'en-IN':'Discount Value', 'hi-IN':'छूट मूल्य' },
    // ─── common (shared by all screens) ─────────────────────────────────────
    { scope:'common', key:'save', 'en-IN':'Save', 'hi-IN':'सहेजें' },
    { scope:'common', key:'cancel', 'en-IN':'Cancel', 'hi-IN':'रद्द करें' },
    { scope:'common', key:'clear', 'en-IN':'Clear', 'hi-IN':'साफ करें' },
    { scope:'common', key:'search', 'en-IN':'Search', 'hi-IN':'खोजें' },
    { scope:'common', key:'add', 'en-IN':'Add', 'hi-IN':'जोड़ें' },
    { scope:'common', key:'edit', 'en-IN':'Edit', 'hi-IN':'संपादित करें' },
    { scope:'common', key:'delete', 'en-IN':'Delete', 'hi-IN':'हटाएं' },
    { scope:'common', key:'print', 'en-IN':'Print', 'hi-IN':'प्रिंट करें' },
    { scope:'common', key:'export', 'en-IN':'Export', 'hi-IN':'निर्यात करें' },
    { scope:'common', key:'gridview', 'en-IN':'Gridview', 'hi-IN':'ग्रिड दृश्य' },
    { scope:'common', key:'refresh', 'en-IN':'Refresh', 'hi-IN':'रीफ्रेश करें' },
    { scope:'common', key:'close', 'en-IN':'Close', 'hi-IN':'बंद करें' },
    { scope:'common', key:'new', 'en-IN':'New', 'hi-IN':'नया' },
    { scope:'common', key:'status', 'en-IN':'Status', 'hi-IN':'स्थिति' },
    { scope:'common', key:'actions', 'en-IN':'Actions', 'hi-IN':'कार्रवाई' },
    { scope:'common', key:'select', 'en-IN':'Select', 'hi-IN':'चुनें' },
    { scope:'common', key:'loading', 'en-IN':'Loading...', 'hi-IN':'लोड हो रहा है...' },
    { scope:'common', key:'nodata', 'en-IN':'No data found', 'hi-IN':'कोई डेटा नहीं मिला' },
    { scope:'common', key:'total', 'en-IN':'Total', 'hi-IN':'कुल' },
    { scope:'common', key:'amount', 'en-IN':'Amount', 'hi-IN':'राशि' },
    { scope:'common', key:'date', 'en-IN':'Date', 'hi-IN':'तिथि' },
    { scope:'common', key:'code', 'en-IN':'Code', 'hi-IN':'कोड' },
    { scope:'common', key:'name', 'en-IN':'Name', 'hi-IN':'नाम' },
    { scope:'common', key:'description', 'en-IN':'Description', 'hi-IN':'विवरण' },
    { scope:'common', key:'remarks', 'en-IN':'Remarks', 'hi-IN':'टिप्पणी' },
    { scope:'common', key:'add_row', 'en-IN':'+ Add Row', 'hi-IN':'+ पंक्ति जोड़ें' },
    // ─── Purchase Order ──────────────────────────────────────────────────────
    { scope:'purchaseOrder', key:'title', 'en-IN':'Purchase Order', 'hi-IN':'क्रय आदेश' },
    { scope:'purchaseOrder', key:'po_no', 'en-IN':'PO No', 'hi-IN':'पीओ संख्या' },
    { scope:'purchaseOrder', key:'po_date', 'en-IN':'PO Date', 'hi-IN':'पीओ तिथि' },
    { scope:'purchaseOrder', key:'supplier', 'en-IN':'Supplier', 'hi-IN':'आपूर्तिकर्ता' },
    { scope:'purchaseOrder', key:'delivery_date', 'en-IN':'Delivery Date', 'hi-IN':'डिलीवरी तिथि' },
    { scope:'purchaseOrder', key:'payment_terms', 'en-IN':'Payment Terms', 'hi-IN':'भुगतान शर्तें' },
    { scope:'purchaseOrder', key:'ship_to', 'en-IN':'Ship To', 'hi-IN':'भेजें इसे' },
    { scope:'purchaseOrder', key:'item_info', 'en-IN':'Item Info', 'hi-IN':'आइटम जानकारी' },
    { scope:'purchaseOrder', key:'item_desc', 'en-IN':'Item Description', 'hi-IN':'आइटम विवरण' },
    { scope:'purchaseOrder', key:'hsn', 'en-IN':'HSN', 'hi-IN':'एचएसएन' },
    { scope:'purchaseOrder', key:'qty', 'en-IN':'Qty', 'hi-IN':'मात्रा' },
    { scope:'purchaseOrder', key:'uom', 'en-IN':'UOM', 'hi-IN':'माप इकाई' },
    { scope:'purchaseOrder', key:'rate', 'en-IN':'Rate', 'hi-IN':'दर' },
    { scope:'purchaseOrder', key:'gst_per', 'en-IN':'GST %', 'hi-IN':'जीएसटी %' },
    { scope:'purchaseOrder', key:'value', 'en-IN':'Value', 'hi-IN':'मूल्य' },
    { scope:'purchaseOrder', key:'billing_address', 'en-IN':'Billing Address', 'hi-IN':'बिलिंग पता' },
    { scope:'purchaseOrder', key:'shipping_address', 'en-IN':'Shipping Address', 'hi-IN':'शिपिंग पता' },
    { scope:'purchaseOrder', key:'terms_conditions', 'en-IN':'Terms & Conditions', 'hi-IN':'नियम एवं शर्तें' },
    // ─── GRC / Goods Receipt Note ────────────────────────────────────────────
    { scope:'grc', key:'title', 'en-IN':'Goods Receipt', 'hi-IN':'माल प्राप्ति' },
    { scope:'grc', key:'grc_no', 'en-IN':'GRC No', 'hi-IN':'जीआरसी संख्या' },
    { scope:'grc', key:'grc_date', 'en-IN':'GRC Date', 'hi-IN':'जीआरसी तिथि' },
    { scope:'grc', key:'supplier', 'en-IN':'Supplier', 'hi-IN':'आपूर्तिकर्ता' },
    { scope:'grc', key:'dc_no', 'en-IN':'DC No', 'hi-IN':'डीसी संख्या' },
    { scope:'grc', key:'po_ref', 'en-IN':'PO Reference', 'hi-IN':'पीओ संदर्भ' },
    { scope:'grc', key:'received_by', 'en-IN':'Received By', 'hi-IN':'प्राप्तकर्ता' },
    { scope:'grc', key:'qty_received', 'en-IN':'Qty Received', 'hi-IN':'प्राप्त मात्रा' },
    { scope:'grc', key:'qty_rejected', 'en-IN':'Qty Rejected', 'hi-IN':'अस्वीकृत मात्रा' },
    { scope:'grc', key:'batch_no', 'en-IN':'Batch No', 'hi-IN':'बैच संख्या' },
    { scope:'grc', key:'expiry_date', 'en-IN':'Expiry Date', 'hi-IN':'समाप्ति तिथि' },
    // ─── Purchase Invoice ────────────────────────────────────────────────────
    { scope:'purchaseInvoice', key:'title', 'en-IN':'Purchase Invoice', 'hi-IN':'खरीद चालान' },
    { scope:'purchaseInvoice', key:'invoice_no', 'en-IN':'Invoice No', 'hi-IN':'चालान संख्या' },
    { scope:'purchaseInvoice', key:'invoice_date', 'en-IN':'Invoice Date', 'hi-IN':'चालान तिथि' },
    { scope:'purchaseInvoice', key:'supplier', 'en-IN':'Supplier', 'hi-IN':'आपूर्तिकर्ता' },
    { scope:'purchaseInvoice', key:'po_ref', 'en-IN':'PO Ref', 'hi-IN':'पीओ संदर्भ' },
    { scope:'purchaseInvoice', key:'grc_ref', 'en-IN':'GRC Ref', 'hi-IN':'जीआरसी संदर्भ' },
    { scope:'purchaseInvoice', key:'total_amount', 'en-IN':'Total Amount', 'hi-IN':'कुल राशि' },
    { scope:'purchaseInvoice', key:'tax_amount', 'en-IN':'Tax Amount', 'hi-IN':'कर राशि' },
    { scope:'purchaseInvoice', key:'net_amount', 'en-IN':'Net Amount', 'hi-IN':'शुद्ध राशि' },
    // ─── Stock Transfer ──────────────────────────────────────────────────────
    { scope:'stockTransfer', key:'title', 'en-IN':'Stock Transfer', 'hi-IN':'स्टॉक स्थानांतरण' },
    { scope:'stockTransfer', key:'st_no', 'en-IN':'ST No', 'hi-IN':'एसटी संख्या' },
    { scope:'stockTransfer', key:'st_date', 'en-IN':'Transfer Date', 'hi-IN':'स्थानांतरण तिथि' },
    { scope:'stockTransfer', key:'transfer_type', 'en-IN':'Transfer Type', 'hi-IN':'स्थानांतरण प्रकार' },
    { scope:'stockTransfer', key:'from_branch', 'en-IN':'From Branch', 'hi-IN':'स्रोत शाखा' },
    { scope:'stockTransfer', key:'to_branch', 'en-IN':'To Branch', 'hi-IN':'गंतव्य शाखा' },
    { scope:'stockTransfer', key:'qty', 'en-IN':'Qty', 'hi-IN':'मात्रा' },
    { scope:'stockTransfer', key:'uom', 'en-IN':'UOM', 'hi-IN':'माप इकाई' },
    { scope:'stockTransfer', key:'item_details', 'en-IN':'Item Details', 'hi-IN':'आइटम विवरण' },
    // ─── Sales Invoice ───────────────────────────────────────────────────────
    { scope:'salesInvoice', key:'title', 'en-IN':'Sales Invoice', 'hi-IN':'विक्रय चालान' },
    { scope:'salesInvoice', key:'invoice_no', 'en-IN':'Invoice No', 'hi-IN':'चालान संख्या' },
    { scope:'salesInvoice', key:'invoice_date', 'en-IN':'Invoice Date', 'hi-IN':'चालान तिथि' },
    { scope:'salesInvoice', key:'customer', 'en-IN':'Customer', 'hi-IN':'ग्राहक' },
    { scope:'salesInvoice', key:'salesman', 'en-IN':'Salesman', 'hi-IN':'विक्रेता' },
    { scope:'salesInvoice', key:'payment_mode', 'en-IN':'Payment Mode', 'hi-IN':'भुगतान मोड' },
    { scope:'salesInvoice', key:'total', 'en-IN':'Total', 'hi-IN':'कुल' },
    { scope:'salesInvoice', key:'discount', 'en-IN':'Discount', 'hi-IN':'छूट' },
    { scope:'salesInvoice', key:'net_amount', 'en-IN':'Net Amount', 'hi-IN':'शुद्ध राशि' },
    // ─── Journal Entry ───────────────────────────────────────────────────────
    { scope:'journalEntry', key:'title', 'en-IN':'Journal Entry', 'hi-IN':'जर्नल प्रविष्टि' },
    { scope:'journalEntry', key:'voucher_no', 'en-IN':'Voucher No', 'hi-IN':'वाउचर संख्या' },
    { scope:'journalEntry', key:'voucher_date', 'en-IN':'Voucher Date', 'hi-IN':'वाउचर तिथि' },
    { scope:'journalEntry', key:'narration', 'en-IN':'Narration', 'hi-IN':'विवरण' },
    { scope:'journalEntry', key:'debit', 'en-IN':'Debit', 'hi-IN':'डेबिट' },
    { scope:'journalEntry', key:'credit', 'en-IN':'Credit', 'hi-IN':'क्रेडिट' },
    { scope:'journalEntry', key:'ledger', 'en-IN':'Ledger', 'hi-IN':'खाता' },
    { scope:'journalEntry', key:'amount', 'en-IN':'Amount', 'hi-IN':'राशि' },
    { scope:'journalEntry', key:'reference', 'en-IN':'Reference', 'hi-IN':'संदर्भ' },
    // ─── Opening Balance ─────────────────────────────────────────────────────
    { scope:'openingBalance', key:'title', 'en-IN':'Opening Balance', 'hi-IN':'प्रारंभिक शेष' },
    { scope:'openingBalance', key:'ledger', 'en-IN':'Ledger', 'hi-IN':'खाता' },
    { scope:'openingBalance', key:'dr_amount', 'en-IN':'Dr Amount', 'hi-IN':'डेबिट राशि' },
    { scope:'openingBalance', key:'cr_amount', 'en-IN':'Cr Amount', 'hi-IN':'क्रेडिट राशि' },
    { scope:'openingBalance', key:'balance_type', 'en-IN':'Balance Type', 'hi-IN':'शेष प्रकार' },
    { scope:'openingBalance', key:'financial_year', 'en-IN':'Financial Year', 'hi-IN':'वित्त वर्ष' },
    // ─── Finance — shared finance labels ─────────────────────────────────────
    { scope:'finance', key:'chart_of_accounts', 'en-IN':'Chart of Accounts', 'hi-IN':'खाता चार्ट' },
    { scope:'finance', key:'trial_balance', 'en-IN':'Trial Balance', 'hi-IN':'परीक्षण शेष' },
    { scope:'finance', key:'general_ledger', 'en-IN':'General Ledger', 'hi-IN':'सामान्य खाता' },
    { scope:'finance', key:'balance_sheet', 'en-IN':'Balance Sheet', 'hi-IN':'तुलन पत्र' },
    { scope:'finance', key:'profit_loss', 'en-IN':'Profit & Loss', 'hi-IN':'लाभ एवं हानि' },
    { scope:'finance', key:'cash_flow', 'en-IN':'Cash Flow', 'hi-IN':'नकदी प्रवाह' },
    { scope:'finance', key:'ledger_name', 'en-IN':'Ledger Name', 'hi-IN':'खाता नाम' },
    { scope:'finance', key:'ledger_group', 'en-IN':'Ledger Group', 'hi-IN':'खाता समूह' },
    { scope:'finance', key:'opening_balance', 'en-IN':'Opening Balance', 'hi-IN':'प्रारंभिक शेष' },
    { scope:'finance', key:'closing_balance', 'en-IN':'Closing Balance', 'hi-IN':'समापन शेष' },
    { scope:'finance', key:'debit', 'en-IN':'Debit', 'hi-IN':'डेबिट' },
    { scope:'finance', key:'credit', 'en-IN':'Credit', 'hi-IN':'क्रेडिट' },
    { scope:'finance', key:'narration', 'en-IN':'Narration', 'hi-IN':'विवरण' },
    // ─── POS Billing ─────────────────────────────────────────────────────────
    { scope:'posBilling', key:'title', 'en-IN':'POS Billing', 'hi-IN':'पीओएस बिलिंग' },
    { scope:'posBilling', key:'customer', 'en-IN':'Customer', 'hi-IN':'ग्राहक' },
    { scope:'posBilling', key:'invoice_no', 'en-IN':'Invoice No', 'hi-IN':'चालान संख्या' },
    { scope:'posBilling', key:'cashier', 'en-IN':'Cashier', 'hi-IN':'कैशियर' },
    { scope:'posBilling', key:'item_code', 'en-IN':'Item Code', 'hi-IN':'आइटम कोड' },
    { scope:'posBilling', key:'item_name', 'en-IN':'Item Name', 'hi-IN':'आइटम नाम' },
    { scope:'posBilling', key:'qty', 'en-IN':'Qty', 'hi-IN':'मात्रा' },
    { scope:'posBilling', key:'price', 'en-IN':'Price', 'hi-IN':'मूल्य' },
    { scope:'posBilling', key:'discount', 'en-IN':'Discount', 'hi-IN':'छूट' },
    { scope:'posBilling', key:'total', 'en-IN':'Total', 'hi-IN':'कुल' },
    { scope:'posBilling', key:'payment_mode', 'en-IN':'Payment Mode', 'hi-IN':'भुगतान मोड' },
    { scope:'posBilling', key:'change', 'en-IN':'Change', 'hi-IN':'वापसी' },
    { scope:'posBilling', key:'grand_total', 'en-IN':'Grand Total', 'hi-IN':'कुल योग' },
    // ─── Masters — Company/Branch/Warehouse ──────────────────────────────────
    { scope:'masters', key:'company_name', 'en-IN':'Company Name', 'hi-IN':'कंपनी का नाम' },
    { scope:'masters', key:'branch_code', 'en-IN':'Branch Code', 'hi-IN':'शाखा कोड' },
    { scope:'masters', key:'branch_name', 'en-IN':'Branch Name', 'hi-IN':'शाखा नाम' },
    { scope:'masters', key:'warehouse', 'en-IN':'Warehouse', 'hi-IN':'गोदाम' },
    { scope:'masters', key:'currency', 'en-IN':'Currency', 'hi-IN':'मुद्रा' },
    { scope:'masters', key:'address', 'en-IN':'Address', 'hi-IN':'पता' },
    { scope:'masters', key:'city', 'en-IN':'City', 'hi-IN':'शहर' },
    { scope:'masters', key:'state', 'en-IN':'State', 'hi-IN':'राज्य' },
    { scope:'masters', key:'gstin', 'en-IN':'GSTIN', 'hi-IN':'जीएसटीआईएन' },
    { scope:'masters', key:'pan', 'en-IN':'PAN', 'hi-IN':'पैन' },
    { scope:'masters', key:'phone', 'en-IN':'Phone', 'hi-IN':'फ़ोन' },
    { scope:'masters', key:'email', 'en-IN':'Email', 'hi-IN':'ईमेल' },
    // ─── User Management ─────────────────────────────────────────────────────
    { scope:'userMgmt', key:'title', 'en-IN':'User Management', 'hi-IN':'उपयोगकर्ता प्रबंधन' },
    { scope:'userMgmt', key:'username', 'en-IN':'Username', 'hi-IN':'उपयोगकर्ता नाम' },
    { scope:'userMgmt', key:'full_name', 'en-IN':'Full Name', 'hi-IN':'पूरा नाम' },
    { scope:'userMgmt', key:'role', 'en-IN':'Role', 'hi-IN':'भूमिका' },
    { scope:'userMgmt', key:'branch', 'en-IN':'Branch', 'hi-IN':'शाखा' },
    { scope:'userMgmt', key:'password', 'en-IN':'Password', 'hi-IN':'पासवर्ड' },
    { scope:'userMgmt', key:'confirm_password', 'en-IN':'Confirm Password', 'hi-IN':'पासवर्ड की पुष्टि करें' },
    { scope:'userMgmt', key:'active', 'en-IN':'Active', 'hi-IN':'सक्रिय' },
    { scope:'userMgmt', key:'last_login', 'en-IN':'Last Login', 'hi-IN':'अंतिम लॉगिन' },
    // ─── Reports — shared report labels ──────────────────────────────────────
    { scope:'report', key:'from_date', 'en-IN':'From Date', 'hi-IN':'प्रारंभ तिथि' },
    { scope:'report', key:'to_date', 'en-IN':'To Date', 'hi-IN':'अंत तिथि' },
    { scope:'report', key:'generate', 'en-IN':'Generate Report', 'hi-IN':'रिपोर्ट बनाएं' },
    { scope:'report', key:'branch', 'en-IN':'Branch', 'hi-IN':'शाखा' },
    { scope:'report', key:'supplier', 'en-IN':'Supplier', 'hi-IN':'आपूर्तिकर्ता' },
    { scope:'report', key:'customer', 'en-IN':'Customer', 'hi-IN':'ग्राहक' },
    { scope:'report', key:'download', 'en-IN':'Download', 'hi-IN':'डाउनलोड करें' },
    { scope:'report', key:'sl_no', 'en-IN':'Sl.No', 'hi-IN':'क्रमांक' },
    { scope:'report', key:'subtotal', 'en-IN':'Sub Total', 'hi-IN':'उप योग' },
    { scope:'report', key:'tax', 'en-IN':'Tax', 'hi-IN':'कर' },
    { scope:'report', key:'total', 'en-IN':'Total', 'hi-IN':'कुल' },
];

async function seedTranslationRegistry() {
    // Only seed if tbl_translations is essentially empty (< 50 rows)
    const cnt = await (0, master_db_1.executeMasterQuery)('SELECT COUNT(*) AS cnt FROM WebApp.tbl_translations', {});
    if ((cnt?.[0]?.cnt || 0) >= 50) return; // already seeded
    // 1. Seed screen labels (en-IN + hi-IN per row)
    for (const row of _SCREEN_LABELS) {
        for (const lc of Object.keys(row).filter(k => k !== 'scope' && k !== 'key')) {
            try {
                await (0, master_db_1.executeMasterQuery)(`
          MERGE WebApp.tbl_translations AS tgt
          USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
            ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
          WHEN NOT MATCHED THEN INSERT (scope,[key],lang_code,value,source) VALUES (@sc,@k,@lc,@val,'seed');
        `, { sc: row.scope, k: row.key, lc, val: row[lc] });
            } catch { /* continue */ }
        }
    }
    // 2. Seed from bundled translation-registry.json (if available)
    try {
        const registry = require('../data/translation-registry.json');
        const reg = registry.registry || {};
        let count = 0;
        for (const [scope, keys] of Object.entries(reg)) {
            for (const [key, langs] of Object.entries(keys)) {
                for (const [lang_code, value] of Object.entries(langs)) {
                    try {
                        await (0, master_db_1.executeMasterQuery)(`
              MERGE WebApp.tbl_translations AS tgt
              USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
                ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
              WHEN NOT MATCHED THEN INSERT (scope,[key],lang_code,value,source) VALUES (@sc,@k,@lc,@val,'imported');
            `, { sc: scope, k: key, lc: lang_code, val: String(value) });
                        count++;
                    } catch { /* continue */ }
                }
            }
        }
        console.log(`[i18n] Registry seeded: ${count} rows`);
    } catch (e) { console.warn('[i18n] Registry seed from JSON skipped:', e.message); }
    console.log('[i18n] Translation seed complete');
}
// ── Dict builder — flat rows → nested + flat + byControl ─────────────────────
function buildDictResponse(rows) {
    const nested = {};
    const flat = {};
    const byControl = {};
    for (const row of rows) {
        const fullKey = `${row.scope}.${row.key}`;
        flat[fullKey] = row.value || '';
        if (row.control_id)
            byControl[row.control_id] = row.value || '';
        // Build nested structure
        const parts = fullKey.split('.');
        let node = nested;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!node[parts[i]] || typeof node[parts[i]] !== 'object')
                node[parts[i]] = {};
            node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = row.value || '';
    }
    return { nested, flat, byControl };
}
// ── Sarvam translate helper ────────────────────────────────────────────────
async function sarvamTranslate(text, targetLang) {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey || !SARVAM_SUPPORTED.has(targetLang))
        return null;
    try {
        const res = await axios_1.default.post('https://api.sarvam.ai/translate', { input: text, source_language_code: 'en-IN', target_language_code: targetLang, speaker_gender: 'Female', mode: 'formal', enable_preprocessing: true }, { headers: { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 });
        return res.data?.translated_text || null;
    }
    catch (e) {
        console.warn('[i18n] Sarvam translate error:', e.message);
        return null;
    }
}
// ── Google Translate helper ────────────────────────────────────────────────
// Maps app locale codes to Google Translate language codes
const GOOGLE_LOCALE_MAP = {
    'ur-IN': 'ur', 'ar-AE': 'ar', 'de-DE': 'de', 'fr-FR': 'fr',
    'it-IT': 'it', 'es-ES': 'es', 'el-GR': 'el', 'hi-IN': 'hi',
    'ta-IN': 'ta', 'te-IN': 'te', 'mr-IN': 'mr', 'bn-IN': 'bn',
    'gu-IN': 'gu', 'kn-IN': 'kn', 'ml-IN': 'ml', 'pa-IN': 'pa',
    'or-IN': 'or',
};
async function googleTranslate(text, targetLang) {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey)
        return null;
    const gLang = GOOGLE_LOCALE_MAP[targetLang];
    if (!gLang)
        return null;
    try {
        const res = await axios_1.default.post(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, { q: text, source: 'en', target: gLang, format: 'text' }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        return res.data?.data?.translations?.[0]?.translatedText || null;
    }
    catch (e) {
        console.warn('[i18n] Google Translate error:', e.message);
        return null;
    }
}
// ── Auto-translate a single text to all non-en locales ─────────────────────
async function autoTranslateToAll(scope, key, englishText, skipExisting = true) {
    const targetLocales = LOCALES.filter(l => l.code !== 'en-IN');
    let translated = 0;
    for (const loc of targetLocales) {
        try {
            // Skip if translation already exists (unless force)
            if (skipExisting) {
                const existing = await (0, master_db_1.executeMasterQuery)(`SELECT TOP 1 id FROM WebApp.tbl_translations WHERE scope=@sc AND [key]=@k AND lang_code=@lc`, { sc: scope, k: key, lc: loc.code });
                if (existing?.length > 0)
                    continue;
            }
            // Try Sarvam first for supported languages, then Google, then fall back to English
            let translatedText = null;
            if (SARVAM_SUPPORTED.has(loc.code)) {
                translatedText = await sarvamTranslate(englishText, loc.code);
            }
            if (!translatedText) {
                translatedText = await googleTranslate(englishText, loc.code);
            }
            // Use English as placeholder if both fail
            const finalValue = translatedText || englishText;
            const source = translatedText ? (SARVAM_SUPPORTED.has(loc.code) && !await googleTranslate('test', loc.code).then(() => false).catch(() => true) ? 'sarvam' : 'google') : 'en-fallback';
            await (0, master_db_1.executeMasterQuery)(`
        MERGE WebApp.tbl_translations AS tgt
        USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
          ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
        WHEN MATCHED THEN
          UPDATE SET value=@val, source=@src, updated_at=GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (scope,[key],lang_code,value,source)
          VALUES (@sc,@k,@lc,@val,@src);
      `, { sc: scope, k: key, lc: loc.code, val: finalValue, src: source });
            translated++;
        }
        catch (e) {
            console.warn(`[i18n] Auto-translate failed for ${loc.code}:`, e.message);
        }
    }
    return translated;
}
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/i18n/locales
router.get('/locales', (_req, res) => {
    res.json({ locales: LOCALES });
});
// GET /api/i18n/formats
router.get('/formats', async (_req, res) => {
    await ensureI18nTables();
    try {
        const rows = await (0, master_db_1.executeMasterQuery)('SELECT * FROM WebApp.tbl_locale_formats ORDER BY lang_code', {});
        res.json({ formats: rows && rows.length ? rows : DEFAULT_FORMATS });
    }
    catch {
        res.json({ formats: DEFAULT_FORMATS });
    }
});
// GET /api/i18n/formats/:lang
router.get('/formats/:lang', async (req, res) => {
    await ensureI18nTables();
    const { lang } = req.params;
    try {
        const rows = await (0, master_db_1.executeMasterQuery)('SELECT * FROM WebApp.tbl_locale_formats WHERE lang_code=@lc', { lc: lang });
        const fmt = rows?.[0] || DEFAULT_FORMATS.find(f => f.lang_code === lang) || DEFAULT_FORMATS[0];
        res.json({ format: fmt });
    }
    catch {
        res.json({ format: DEFAULT_FORMATS.find(f => f.lang_code === lang) || DEFAULT_FORMATS[0] });
    }
});
// GET /api/i18n/dict?lang=X&project=Y&screen=Z
router.get('/dict', async (req, res) => {
    await ensureI18nTables();
    const lang = String(req.query.lang || req.query.locale || 'en-IN');
    const project = req.query.project;
    const screen = req.query.screen;
    const format = String(req.query.format || 'nested'); // 'nested' | 'flat-array'
    try {
        let query = 'SELECT scope,[key],value,control_id FROM WebApp.tbl_translations WHERE lang_code=@lc';
        const params = { lc: lang };
        if (project) {
            query += ' AND (project_name=@proj OR project_name IS NULL)';
            params.proj = project;
        }
        if (screen) {
            query += ' AND (screen_name=@scr  OR screen_name IS NULL)';
            params.scr = screen;
        }
        query += ' ORDER BY scope,[key]';
        const rows = await (0, master_db_1.executeMasterQuery)(query, params);
        const safeRows = rows || [];
        // For the i18n Translation Editor and admin consumers, return flat [{key, value, locale}]
        if (format === 'flat-array') {
            return res.json(safeRows.map((r) => ({
                key: r.key || r.KEY || '',
                value: r.value || r.VALUE || '',
                locale: lang,
                scope: r.scope || '',
                control_id: r.control_id || null,
            })));
        }
        res.json(buildDictResponse(safeRows));
    }
    catch (e) {
        if (format === 'flat-array')
            return res.json([]);
        res.json({ nested: {}, flat: {}, byControl: {} });
    }
});
// GET /api/i18n/by-control?control_id=X&lang=Y&screen=S&project=P
router.get('/by-control', async (req, res) => {
    await ensureI18nTables();
    const { control_id, lang = 'en-IN', screen, project } = req.query;
    if (!control_id)
        return res.status(400).json({ found: false, reason: 'control_id required' });
    try {
        let q = 'SELECT TOP 1 value FROM WebApp.tbl_translations WHERE control_id=@cid AND lang_code=@lc';
        const p = { cid: control_id, lc: lang };
        if (screen) {
            q += ' AND screen_name=@scr';
            p.scr = screen;
        }
        if (project) {
            q += ' AND project_name=@proj';
            p.proj = project;
        }
        const rows = await (0, master_db_1.executeMasterQuery)(q, p);
        if (rows?.[0])
            return res.json({ found: true, value: rows[0].value });
        return res.json({ found: false });
    }
    catch {
        return res.json({ found: false });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS (authenticated)
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/i18n/admin/matrix — all translations grouped
router.get('/admin/matrix', auth_1.authenticateToken, async (_req, res) => {
    await ensureI18nTables();
    try {
        const rows = await (0, master_db_1.executeMasterQuery)(`
      SELECT scope,[key],lang_code,value,source,project_name,screen_name,control_id,updated_at
      FROM WebApp.tbl_translations ORDER BY scope,[key],lang_code
    `, {});
        res.json({ matrix: rows || [], total: rows?.length || 0 });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// GET /api/i18n/admin/scopes
router.get('/admin/scopes', auth_1.authenticateToken, async (_req, res) => {
    await ensureI18nTables();
    try {
        const rows = await (0, master_db_1.executeMasterQuery)(`
      SELECT DISTINCT scope, COUNT(*) AS key_count FROM WebApp.tbl_translations GROUP BY scope ORDER BY scope
    `, {});
        res.json({ scopes: rows || [] });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/i18n/admin/upsert
router.post('/admin/upsert', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    const { scope, key, lang_code, value, source = 'manual', project_name, screen_name, control_id } = req.body;
    if (!scope || !key || !lang_code) {
        return res.status(400).json({ error: 'scope, key, lang_code required' });
    }
    try {
        await (0, master_db_1.executeMasterQuery)(`
      MERGE WebApp.tbl_translations AS tgt
      USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
        ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
      WHEN MATCHED THEN
        UPDATE SET value=@val, source=@src, project_name=@pn, screen_name=@sn, control_id=@cid, updated_at=GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (scope,[key],lang_code,value,source,project_name,screen_name,control_id)
        VALUES (@sc,@k,@lc,@val,@src,@pn,@sn,@cid);
    `, { sc: scope, k: key, lc: lang_code, val: value, src: source, pn: project_name || null, sn: screen_name || null, cid: control_id || null });
        // Auto-translate to all other locales when saving en-IN
        let auto_translated = 0;
        if (lang_code === 'en-IN' && value) {
            // Fire and await (background, don't block response)
            autoTranslateToAll(scope, key, value, true)
                .then(n => { console.log(`[i18n] Auto-translated "${key}" to ${n} locales`); })
                .catch(e => { console.warn('[i18n] Auto-translate error:', e.message); });
            auto_translated = 1; // signal to frontend that translation started
        }
        res.json({ success: true, scope, key, lang_code, auto_translated });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/i18n/admin/bulk — bulk upsert array of translation rows
router.post('/admin/bulk', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    // Accept both { rows: [...] } and legacy { locale, items: [...] } formats
    let rows = req.body.rows || [];
    if (!rows.length && req.body.items) {
        const { locale, items } = req.body;
        rows = items.map((item) => ({
            scope: item.scope || 'app',
            key: item.key,
            lang_code: locale || item.lang_code || 'en-IN',
            value: item.value,
        }));
    }
    if (!Array.isArray(rows) || !rows.length) {
        return res.status(400).json({ error: 'rows array required' });
    }
    let imported = 0;
    let failed = 0;
    let auto_translated = 0;
    for (const r of rows) {
        if (!r.scope || !r.key || !r.lang_code) {
            failed++;
            continue;
        }
        try {
            await (0, master_db_1.executeMasterQuery)(`
        MERGE WebApp.tbl_translations AS tgt
        USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
          ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
        WHEN MATCHED THEN
          UPDATE SET value=@val,source=@src,project_name=@pn,screen_name=@sn,control_id=@cid,updated_at=GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (scope,[key],lang_code,value,source,project_name,screen_name,control_id)
          VALUES (@sc,@k,@lc,@val,@src,@pn,@sn,@cid);
      `, {
                sc: r.scope, k: r.key, lc: r.lang_code, val: r.value,
                src: r.source || 'imported', pn: r.project_name || null,
                sn: r.screen_name || null, cid: r.control_id || null
            });
            imported++;
            // Auto-translate en-IN bulk saves too
            if (r.lang_code === 'en-IN' && r.value) {
                autoTranslateToAll(r.scope, r.key, r.value, true)
                    .then(n => { if (n > 0)
                    console.log(`[i18n] Bulk auto-translated "${r.key}" to ${n} locales`); })
                    .catch(() => { });
                auto_translated++;
            }
        }
        catch {
            failed++;
        }
    }
    res.json({ success: true, imported, failed, total: rows.length, auto_translated });
});
// POST /api/i18n/admin/formats/upsert
router.post('/admin/formats/upsert', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    const f = req.body;
    if (!f.lang_code)
        return res.status(400).json({ error: 'lang_code required' });
    try {
        await (0, master_db_1.executeMasterQuery)(`
      MERGE WebApp.tbl_locale_formats AS tgt
      USING (SELECT @lc AS lang_code) AS src ON tgt.lang_code=src.lang_code
      WHEN MATCHED THEN UPDATE SET
        currency_code=@cc,currency_symbol=@cs,currency_position=@cp,
        thousands_sep=@ts,decimal_sep=@ds,decimal_places=@dp,
        date_format=@df,time_format=@tf,first_day_of_week=@fd,updated_at=GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (lang_code,currency_code,currency_symbol,currency_position,thousands_sep,decimal_sep,decimal_places,date_format,time_format,first_day_of_week)
        VALUES (@lc,@cc,@cs,@cp,@ts,@ds,@dp,@df,@tf,@fd);
    `, {
            lc: f.lang_code, cc: f.currency_code || 'INR', cs: f.currency_symbol || '₹',
            cp: f.currency_position || 'prefix', ts: f.thousands_sep || ',', ds: f.decimal_sep || '.',
            dp: f.decimal_places || 2, df: f.date_format || 'DD/MM/YYYY',
            tf: f.time_format || 'HH:mm', fd: f.first_day_of_week || 1
        });
        res.json({ success: true, lang_code: f.lang_code });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// DELETE /api/i18n/admin/key
router.delete('/admin/key', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    const { scope, key, lang_code } = req.body;
    if (!scope || !key)
        return res.status(400).json({ error: 'scope and key required' });
    try {
        const q = lang_code
            ? 'DELETE FROM WebApp.tbl_translations WHERE scope=@sc AND [key]=@k AND lang_code=@lc'
            : 'DELETE FROM WebApp.tbl_translations WHERE scope=@sc AND [key]=@k';
        await (0, master_db_1.executeMasterQuery)(q, { sc: scope, k: key, lc: lang_code || null });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// GET /api/i18n/admin/coverage — per-locale translation counts
router.get('/admin/coverage', auth_1.authenticateToken, async (_req, res) => {
    await ensureI18nTables();
    try {
        const rows = await (0, master_db_1.executeMasterQuery)(`SELECT lang_code, COUNT(*) AS cnt FROM WebApp.tbl_translations GROUP BY lang_code`, {});
        const totalRow = await (0, master_db_1.executeMasterQuery)(`SELECT COUNT(*) AS total FROM WebApp.tbl_translations WHERE lang_code='en-IN'`, {});
        const totalKeys = totalRow?.[0]?.total || 0;
        const coverage = {};
        (rows || []).forEach((r) => { coverage[r.lang_code] = r.cnt; });
        res.json({ success: true, coverage, totalKeys });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/i18n/admin/auto-translate-all — translate all en-IN keys to all other locales
router.post('/admin/auto-translate-all', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    const force = req.body?.force === true;
    try {
        const enRows = await (0, master_db_1.executeMasterQuery)(`SELECT scope,[key],value FROM WebApp.tbl_translations WHERE lang_code='en-IN' AND value IS NOT NULL AND LEN(value)>0`, {});
        if (!enRows?.length) {
            return res.json({ success: true, processed: 0, translated: 0, message: 'No en-IN entries found' });
        }
        // Fire background job
        let totalTranslated = 0;
        (async () => {
            for (const row of enRows) {
                try {
                    const n = await autoTranslateToAll(row.scope || row.SCOPE, row.key || row.KEY, row.value || row.VALUE, !force);
                    totalTranslated += n;
                }
                catch { }
            }
            console.log(`[i18n] auto-translate-all: processed ${enRows.length} keys, translated ${totalTranslated} entries`);
        })();
        res.json({ success: true, processed: enRows.length, message: 'Background translation started', note: 'Check /admin/coverage for progress' });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// POST /api/i18n/admin/import-registry — accepts translation-registry.json nested format
// { registry: { scope: { key: { lang_code: value } } } } and bulk imports into tbl_translations
router.post('/admin/import-registry', auth_1.authenticateToken, async (req, res) => {
    await ensureI18nTables();
    const { registry } = req.body;
    if (!registry || typeof registry !== 'object') {
        return res.status(400).json({ error: 'registry object required ({ scope: { key: { lang: value } } })' });
    }
    let imported = 0, failed = 0;
    for (const [scope, keys] of Object.entries(registry)) {
        for (const [key, langs] of Object.entries(keys)) {
            for (const [lang_code, value] of Object.entries(langs)) {
                if (!lang_code || value == null) { failed++; continue; }
                try {
                    await (0, master_db_1.executeMasterQuery)(`
            MERGE WebApp.tbl_translations AS tgt
            USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
              ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
            WHEN MATCHED THEN UPDATE SET value=@val,source='imported',updated_at=GETDATE()
            WHEN NOT MATCHED THEN INSERT (scope,[key],lang_code,value,source) VALUES (@sc,@k,@lc,@val,'imported');
          `, { sc: scope, k: key, lc: lang_code, val: String(value) });
                    imported++;
                } catch { failed++; }
            }
        }
    }
    res.json({ success: true, imported, failed });
});

// POST /api/i18n/admin/seed-registry — imports translation-registry.json from disk (no payload needed)
// Runs asynchronously — returns immediately with 202 and seeds in background
router.post('/admin/seed-registry', auth_1.authenticateToken, async (req, res) => {
    // Respond immediately — seed runs in background
    res.status(202).json({ success: true, message: 'Seeding started in background. Check /api/i18n/admin/stats for progress.' });
    // Fire-and-forget background seed
    setImmediate(async () => {
        await ensureI18nTables();
        try {
            const registryData = require('../data/translation-registry.json');
            const reg = registryData.registry || {};
            let imported = 0, failed = 0;
            for (const [scope, keys] of Object.entries(reg)) {
                for (const [key, langs] of Object.entries(keys)) {
                    for (const [lang_code, value] of Object.entries(langs)) {
                        try {
                            await (0, master_db_1.executeMasterQuery)(`
                MERGE WebApp.tbl_translations AS tgt
                USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
                  ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
                WHEN MATCHED THEN UPDATE SET value=@val,source='imported',updated_at=GETDATE()
                WHEN NOT MATCHED THEN INSERT (scope,[key],lang_code,value,source) VALUES (@sc,@k,@lc,@val,'imported');
              `, { sc: scope, k: key, lc: lang_code, val: String(value) });
                            imported++;
                        } catch { failed++; }
                    }
                }
            }
            // Also seed screen labels
            for (const row of _SCREEN_LABELS) {
                for (const lc of Object.keys(row).filter(k => k !== 'scope' && k !== 'key')) {
                    try {
                        await (0, master_db_1.executeMasterQuery)(`
              MERGE WebApp.tbl_translations AS tgt
              USING (SELECT @sc AS scope, @k AS [key], @lc AS lang_code) AS src
                ON tgt.scope=src.scope AND tgt.[key]=src.[key] AND tgt.lang_code=src.lang_code
              WHEN MATCHED THEN UPDATE SET value=@val,source='seed',updated_at=GETDATE()
              WHEN NOT MATCHED THEN INSERT (scope,[key],lang_code,value,source) VALUES (@sc,@k,@lc,@val,'seed');
            `, { sc: row.scope, k: row.key, lc, val: row[lc] });
                        imported++;
                    } catch { failed++; }
                }
            }
            console.log(`[i18n] Background seed complete: ${imported} imported, ${failed} failed`);
        } catch (e) {
            console.error('[i18n] Background seed error:', e.message);
        }
    });
});

// POST /api/i18n/admin/auto-suggest — Sarvam AI auto-translate
router.post('/admin/auto-suggest', auth_1.authenticateToken, async (req, res) => {
    const { text, target_lang } = req.body;
    if (!text || !target_lang)
        return res.status(400).json({ error: 'text and target_lang required' });
    if (!SARVAM_SUPPORTED.has(target_lang)) {
        return res.status(422).json({ error: `Auto-translate not supported for ${target_lang}. Supported: ${[...SARVAM_SUPPORTED].join(', ')}` });
    }
    const translated = await sarvamTranslate(text, target_lang);
    if (!translated) {
        return res.status(503).json({ error: 'Sarvam translate failed or API key not configured' });
    }
    res.json({ success: true, text, target_lang, translated, source: 'sarvam' });
});
exports.default = router;
//# sourceMappingURL=i18n.js.map