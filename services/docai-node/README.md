# RetailCLIQ · Universal AI Document Processing Wizard

One document-type-agnostic wizard that turns any document (file, scan, photo, pasted text, manual entry, API payload) into a validated, posted RetailCLIQ transaction. Sarvam AI does the *reading*; RetailCLIQ rules do everything that matters.

```
SOURCE → DETECT → EXTRACT → REVIEW → MAP → VALIDATE → CONVERT → RECONCILE → POST → RESULT
```

## What's new in v2 — bulk intake + RetailCLIQ screen integration

* **Inbox / bulk intake** (`📥 Inbox` button or the *Bulk intake* source tile): drop any number of PDFs, scans, photos, ZIP or RAR.
  Each file is unpacked → classified (digital PDF / garbled-font PDF / scanned PDF / image) → pre-processed (EXIF orient, optional
  rotate, grayscale+normalise, page render at 170 dpi, >10-page PDFs chunked for Sarvam's 10-page limit) → OCR'd → **pages grouped
  into documents** (invoice-number + "page x of y" heuristics; or force one-per-page / one-per-file) → each document goes through
  detect → structure → auto master-mapping → validation and waits in the Inbox. Progress streams live (SSE). Tested on your 63-file
  INVOICES.rar: 63/63 files, 0 failures, 86 documents, 961 lines (local OCR, ~10 min; Sarvam is rate-limited to 10 jobs/min).
* **Three reading engines**, same pipeline: `OCR_ENGINE=sarvam` (production), `local` (tesseract, offline testing/fallback), `mock`.
* **RetailCLIQ transaction mapper** (`server/services/erpMapper.js`): every document converts to the exact shapes of your
  Purchase Invoice / GRN screens – `rows` = the screens' `IMPORT_TARGET_FIELDS` + grid columns (code, artCode, oemCode, uom, qty,
  rate, price, mrp, wsp, disc, pn, cgst, sgst, igst, amount, division, dept, category, subcatg, brand, style, size, color, design,
  hsn, batchNo, mfgDate, expiryDate), `header` = Document / Supplier / Bill / Tax breakup / Amount details (+ `invoiceDateHBS`),
  `staging` = `Stock_Import_Export` rows. New items get classification from matched Itemproperties → supplier profile → HSN map →
  description (size / colour tokens); inter-state (IGST) is detected from the two GSTIN state codes.
* **Drop-in backend for the screens' 📕 PDF / 🖨 Scan import**: point the screen's *Backend URL* at
  `http://<host>:4010/api/docai/grc/extract`. Verified with Playwright against your `Purchase_Invoice.html`: the screen's own
  `tryRealScanExtraction()` → preview → `submitImportedItems()` path adds the rows to the grid (`usedRealBackend = true`).
* **`public/docai-bridge.js`** – one `<script>` tag for the five GRC screens: pre-fills the backend URL, fills the header fields
  (invoice date/ref, supplier, GSTIN, tax breakup, amounts) from the response, and accepts documents pushed from the Inbox
  (`→ PI screen` → *Send to open RetailCLIQ screen*, via postMessage / `localStorage['retailcliq.docai.pending']`).
* Review screen now shows the validation issues inline (bad cells highlighted) and a *→ RetailCLIQ screen payload* button.
* Apparel/GST fields added to every trading document: style/design, colour, size, pcs, MRP, taxable, CGST/SGST/IGST/TCS, IRN,
  e-way bill, transporter, LR no/date, due date, cases, bank/IFSC, amount in words.
* Sarvam path: `sarvam-105b` with JSON mode + an optional second **verify pass** (`SARVAM_VERIFY=1`) that re-checks totals,
  line sums and missing header fields against the OCR text before the data reaches you.

## v2.1 — robustness fixes (reported: "identify document not going further")

* **Detect / Extract now run in the background** (`POST …/detect` → 202, UI polls `GET …/progress`) with a live step log
  (PDF read → Sarvam job id/status/pages → classification). No single long HTTP request, so proxies/IIS timeouts and
  multi-minute Sarvam jobs no longer strand the browser.
* **Errors are a screen, not a 5-second toast**: exact message (e.g. `Sarvam digitise job start failed (401): invalid api key`),
  progress log, **Retry**, Start over, and **🩺 Check setup**.
* **🩺 Check setup** (`GET /api/docai/diag`, also a button on the first screen): key present, Sarvam chat + Document AI reachability
  with the real key, poppler/tesseract/sharp availability, engines in use, DB status, and plain-language fixes.
* **PDFs go to Sarvam directly** (no poppler needed): >10-page PDFs are split with pdf-lib; digital PDFs use their text layer
  (pdftotext, or pdf-parse when poppler is absent). Poppler is now only needed for page previews/thumbnails and `OCR_ENGINE=local`.
* Every Sarvam HTTP call has a 90 s timeout (`SARVAM_REQUEST_TIMEOUT_MS`) and is logged (`[sarvam] …`) in the server console.

## Quick start

```bash
npm install
cp .env.example .env            # put your SARVAM_API_KEY in .env (never commit it)
npm run mock                    # offline demo: DOCAI_MOCK=1, no network / DB needed
# or
npm start                       # live Sarvam + MSSQL (DB optional – falls back to in-memory masters)
```
Open http://localhost:4010 — drop `samples/purchase_invoice_scan.jpg` on the first screen.

## Folder layout

| Path | What it is |
|---|---|
| `public/index.html` | The whole wizard UI – single self-contained file, responsive (tested at 390 px). Same stepper style as the Universal Import wizard. |
| `server/index.js` | Express entry (`/api/docai/*` + static UI) |
| `server/services/sarvam.js` | Sarvam client – Doc-AI digitise / extract jobs with polling, `sarvam-105b` chat with JSON mode. Endpoints verified against the official `sarvamai` SDK. |
| `server/services/documentTypes.js` | **Configurable document-type framework (spec §15)** – 16 built-in types; add more via `upsert()` or `POST /api/docai/doc-types` |
| `server/services/pipeline.js` | The 10 steps: detection, extraction + coercion, review audit, master suggestion/scoring, validation, relationships, reconciliation, posting plan, post, audit |
| `server/services/db.js` | MSSQL masters + `DocAI_Batch` persistence, HBS date helpers (`toHBS` = `dbo.englishHBS`), in-memory fallback |
| `server/services/mock.js` | Deterministic stand-in for Sarvam (`DOCAI_MOCK=1`) |
| `server/services/preprocess.js` | ZIP/RAR unpack, PDF classify/render/split, image orient/enhance, thumbnails |
| `server/services/ocrEngine.js` | OCR + structuring engines (sarvam / local / mock), 10 req/min limiter, page grouping, verify pass, offline heuristic parser |
| `server/services/intake.js` | Bulk intake orchestration, SSE events, bulk post, export |
| `server/services/erpMapper.js` | DocAI batch → RetailCLIQ screen rows/header + Stock_Import_Export staging; HSN map; supplier profiles |
| `server/routes/intake.js` | `/api/docai/intake/*` |
| `public/docai-bridge.js` | Script tag for the GRC screens (backend URL, header fill, Inbox hand-off) |
| `sql/docai_schema.sql` | `DocAI_Batch`, `DocAI_Staging`, `DocAI_DocTypeConfig`, `DocAI_FormatLearning`, `proc_DocAI_Post` stub |
| `samples/` | Test image + screenshots of every step |

## Sarvam AI usage

| Setting | Effect |
|---|---|
| `SARVAM_MODE=digitise+llm` (default) | `POST /doc-ai/v1/job/digitise` (OCR → markdown pages) then `sarvam-105b` classifies the type and structures header/lines per the doc-type's AI instructions. Works for any doc type without pre-registering a schema. |
| `SARVAM_MODE=extract` | `POST /doc-ai/v1/job/extract` with the JSON schema generated from the doc-type config (`schemaFor(code)`), results carry per-field confidence in `annotations`. |
| Digital PDFs / XLSX / CSV / pasted text | Read locally (pdf-parse / xlsx) – **no Sarvam OCR call**, only the chat call. Saves quota (10 req/min). |
| API / manual JSON payloads | If the payload already has `header`/`lines`, AI is skipped entirely. |

Limits per Sarvam docs: PDF ≤ 10 pages, ZIP ≤ 10 images, 200 MB, 10 requests/min. Jobs are polled every `SARVAM_POLL_INTERVAL_MS` until `completed | partially_completed | failed | rejected`.

Sarvam also ships an MCP server (`uvx sarvam-mcp`, tools `sarvam_vision_extract`, `sarvam_vision_job_status`, `sarvam_llm_complete`) – useful for trying prompts from Claude Desktop / Cursor; the wizard calls the REST API directly.

## Bulk intake API (`/api/docai/intake`)

| Call | Purpose |
|---|---|
| `POST /` multipart `files[]` (+ `split=auto|page|file`, `contentType`, `rotate`, `forceOcr=1`) | start a job (ZIP/RAR expanded server-side) |
| `GET /:id` · `GET /:id/events` (SSE) | status / live progress |
| `POST /:id/docs/:docId/reprocess {rotate}` | rotate pages and re-read |
| `POST /:id/post {onlyClean:true}` | post every validated + reconciled document |
| `GET /:id/export.xlsx` · `.json` · `.csv` | Documents + Lines export |
| `GET /engine` | which OCR / LLM engine is active |

## RetailCLIQ screen integration

| Call | Purpose |
|---|---|
| `POST /api/docai/grc/extract` (multipart `file`, optional `docType`, `screen`, `contentType`, `rotate`) | **Backend URL for the screens' PDF/Scan import.** Returns `{ ok, rows, header, staging, warnings, unmapped, batchId }` |
| `GET /api/docai/batches/:id/erp?screen=PI` | same payload for any batch (Inbox → screen) |
| `GET/PUT /api/docai/supplier-profile/:code` | per-supplier defaults (division/dept/category, GST incl/excl, pay mode, purchase A/c) |
| `GET /api/docai/hsn-map` | HSN → classification table |

Add to each GRC screen (`Purchase_Invoice.html`, `GRN_Against_PO.html`, `GRN_Against_PI.html`, `Purchase_Invoice_Return.html`, `GRN_Return.html`):
```html
<script src="http://localhost:4010/docai-bridge.js" data-docai="http://localhost:4010"></script>
```

## REST API (all under `/api/docai`)

| Step | Call |
|---|---|
| – | `GET /health`, `GET /doc-types`, `POST /doc-types`, `GET /masters/:master?q=`, `POST /masters/:master` |
| 1 SOURCE | `POST /batches` – multipart `file` (+`kind`,`contentType`) **or** JSON `{text}` **or** `{payload}` |
| 2 DETECT | `POST /batches/:id/detect` → `{detection:{documentType,confidence,reasons,alternatives}}` · `PUT /batches/:id/doc-type {code}` |
| 3 EXTRACT | `POST /batches/:id/extract` → `{header, lines, extraction}` |
| 4 REVIEW | `PUT /batches/:id/review {header, lines}` – diff is stored as corrections (audit + format learning) |
| 5 MAP | `POST /batches/:id/map/suggest` → candidates with scores · `PUT /batches/:id/map {decisions:[{id,action:map/create/skip/later,selected}]}` |
| 6 VALIDATE | `POST /batches/:id/validate` → `{issues:[{level:error/warning/new-master/info,...}], summary, canContinue}` |
| 7 CONVERT | `GET /batches/:id/relationships` · `PUT /batches/:id/relationships {mode:standalone/against/creates, target, linkedDocNo}` |
| 8 RECONCILE | `POST /batches/:id/reconcile` → checks (totals, tax, Dr=Cr, qty vs linked doc) · `POST /batches/:id/reconcile/override {key, reason}` |
| 9 POST | `GET /batches/:id/plan` (exact transactions) · `POST /batches/:id/post {approve}` – auto-routes to *pending-approval* when the type's approval rule applies |
| 10 RESULT | `GET /batches/:id`, `GET /batches/:id/audit`, `GET /batches` |

## Wiring to the real RetailCLIQ database

1. Run `sql/docai_schema.sql` on `SMART_NEWDB`.
2. In `server/services/db.js` adjust `MASTER_SQL` to your actual master tables/columns (SupplierMaster, CustomerMaster, Itemmaster, UOMMaster, TaxMaster, WarehouseMaster, BranchMaster, AccountMaster…).
3. Implement `proc_DocAI_Post` per `@DocType` – read `DocAI_Staging.HeaderJson/LinesJson` with `OPENJSON`, convert dates with `dbo.englishHBS` (`docDateHBS` is already pre-computed in the header JSON) and call the existing posting procs (purchase invoice, `proc_StockImportwithSupplier`, voucher posting…) **inside the same transaction**; return the created DocNo. `db.postDocument()` wraps the call in a transaction and rolls back on any error.
4. `createMaster()` – replace the in-memory insert with your "quick add" procs.

## Adding a document type (no new wizard)

```js
// server/services/documentTypes.js  (or POST /api/docai/doc-types with the same JSON)
upsert({
  code: 'RET', name: 'Sales Return',
  headerFields: [...], lineFields: [...], requiredFields: ['party','docNo','docDate'],
  masterMappings: ['customer','item','uom','tax','warehouse'],
  relationships: [{ against: 'SI' }], inventoryImpact: 'in', accountingImpact: 'customer-ledger', taxImpact: 'output-reversal',
  approval: { required: true, threshold: 50000 }, posting: ['Customer Ledger (credit)', 'Stock Ledger (+qty)'],
  aiInstructions: 'Document type: Sales Return. Identify ...'
});
```
The AI schema, mapping list, validation, reconciliation and posting plan all derive from this one object.

## Testing done

* Bulk intake on `INVOICES.rar` (63 real supplier invoices – scanned multi-invoice PDFs, digital PDFs incl. two with broken font
  encoding, phone photos, handwritten) with `OCR_ENGINE=local`: 63/63 processed, 0 failed, 86 documents, 961 lines, Excel export OK.
  Page grouping: 8-page Grasim PDF → 4 invoices, 3-page Wow Colors → 3, 10-page ACN batch → 9.
* `Purchase_Invoice.html` (your prototype) driven by Playwright: PDF import with Backend URL = `/api/docai/grc/extract` → rows land
  in the grid; `docai-bridge.js` postMessage path → header filled + rows added (3 → 18 rows).
* Reading-layer unit checks: Indian date forms (`19-7-2022`, `05.08.24`, `12-Jul-24`, OCR garbage like `590-01-21` → rejected),
  layout line parsing (`30 SET  3,400.00  1,02,000.00` → qty 30, UOM SET, rate 3400, amount 102000).

* Mock mode: Playwright walkthrough of all 10 steps at 1366 px and 390 px (no JS errors, no horizontal overflow). Screenshots in `samples/`.
* Live code path: run against a fake Sarvam server implementing the documented job lifecycle – both `digitise+llm` and `extract` modes make the correct call sequence (`job → status polling → results → chat`).
* The real `api.sarvam.ai` could not be reached from the build sandbox, so the first live run on your machine is the real smoke test – watch the server log; errors from Sarvam are surfaced verbatim in the UI toast.
