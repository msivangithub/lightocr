# plan.md — RetailCLIQ DocAI Wizard (Sarvam + MSSQL + FastAPI Proxy + React)

## 1. Objectives
- Deliver a **100% working** DocAI application implementing the full 10-step pipeline: **SOURCE → DETECT → EXTRACT → REVIEW → MAP → VALIDATE → CONVERT → RECONCILE → POST → RESULT**.
- Use **Sarvam AI** for OCR + LLM structuring (default **digitise+llm**, with optional **extract (schema-based)** mode).
- Connect to **RetailCLIQ MSSQL** at `120.138.9.33:58842` using the correct ERP database (`RC26erp_dev`) and schema for **master lookups + posting hooks**.
- Provide **reliable backend routing** by running the Node DocAI service on `4010` and proxying via FastAPI (`/api/docai/*`, `/api/docai/intake/*`).
- Provide a **production-grade UI** (React) that fully implements the wizard, Inbox, diagnostics, and ERP payload screens.
- Hardening goals (Phase 3+): bulk intake robustness, ERP screen drop-in integration, supplier profiles, export formats, and operational monitoring.

**Current live deployment (completed):**
- App: https://sarvam-ocr-engine.preview.emergentagent.com
- API Health: `/api/docai/health` → `{ ok:true, db:true, sarvam:"configured" }`

## 2. Implementation Steps (phased)

### Phase 1 — Core POC (isolation: prove the hard parts before building UI) ✅ **COMPLETED**
**Goal:** Sarvam OCR + detect + extract + MSSQL master query + Mongo batch persistence works end-to-end for 1 document.

**Results / Evidence**
- **Sarvam AI:** Connected; `sarvam-105b` chat works; Document AI endpoints reachable ✅
- **MSSQL:** Connected; verified `RC26erp_dev` and discovered correct master tables/columns ✅
  - Supplier/Vendor: `VendorMaster (Vend_uid, Vend_name, Desc1 ...)`
  - Items: `ItemMaster (Itemcode, ItemDesc, OEM_code, HSNCode ...)`
  - UOM: `UOMMaster`
  - Warehouse: `Warehouse`
  - Customer: `CustomerMaster`
- **MongoDB:** Working for batch storage ✅

**Key Learnings captured into implementation**
- Sarvam chat often needs **max_tokens ≥ 2000** (reasoning model emits `reasoning_content`; small token caps can yield `content:null`).
- `RC26MASTERDB` didn’t contain expected masters; correct database for masters is `RC26erp_dev`.

**Exit criteria achieved**
- POC returned structured data and validated all connectivity requirements.

---

### Phase 2 — V1 App Development (MVP end-to-end wizard) ✅ **COMPLETED**
**Goal:** Users can complete the 10-step flow in browser; FastAPI routes everything via `/api/docai/*`.

**Delivered (what exists now)**
- **Node DocAI service** installed at `/app/services/docai-node` and running under **supervisor** on **port 4010** ✅
- **FastAPI proxy** routes:
  - `/api/docai/*` → Node `/api/docai/*` ✅
  - `/api/docai/intake/*` → Node intake service incl. SSE ✅
- **React UI** implements the full wizard experience (stepper + all step screens) ✅
- **MSSQL integration fixed** (MASTER_SQL updated to RC26erp_dev schema) ✅
- **Sarvam integration hardened** (max token guard in Sarvam client) ✅
- **Poppler tools installed** (`pdftoppm`, `pdftotext`, `pdfinfo`) for previews/thumbnails and local PDF tooling ✅

**Testing status (completed)**
- **Backend:** 10/10 tests passed ✅
- **Frontend:** 15/15 feature verification passed ✅
- End-to-end text flow (SOURCE→DETECT) validated; UI renders and interacts as expected.

**Architecture (as-built)**
- Browser (React) → FastAPI (`:8001`) → Node DocAI (`:4010`) → Sarvam AI + MSSQL.
- Bulk intake uses Node’s SSE endpoint proxied through FastAPI.

**Note (remaining gap vs original plan)**
- The initial plan stated MongoDB would be the authoritative batch store. In the current implementation, batches are persisted by the Node service (in-memory + optional MSSQL DocAI tables). Phase 3 includes deciding and implementing the final persistence strategy (Mongo authoritative vs MSSQL DocAI tables) and implementing retention/backup.

---

### Phase 3 — Secondary features + hardening (Inbox, ERP integration, supplier profiles) 🔄 **NEXT**
**Goal:** Make the solution production-robust for real multi-file intake and ERP screen workflows, with stable persistence and operational safety.

**User stories (Phase 3)**
1. As a user, I can bulk-upload many files/archives (PDF/image/ZIP/RAR) and watch live **SSE** progress reliably.
2. As a user, I can open any inbox document directly into the wizard at the correct step and continue processing.
3. As a user, I can export intake results to **Excel/JSON/CSV** consistently.
4. As a user, I can generate RetailCLIQ screen payloads (`/batches/:id/erp`) and **download/copy/send** them.
5. As a user, I can configure and reuse **supplier profile defaults** (division/dept/category, GST incl/excl, pay mode, purchase a/c).
6. As an admin, I can run “Check setup” diagnostics and immediately see what needs fixing.

**Work items**
- **Bulk intake hardening**
  - Confirm SSE proxy behavior under long jobs (no buffering / timeouts); validate heartbeat.
  - Validate grouping heuristics on multi-invoice PDFs (invoice no + page x of y).
  - Add intake job persistence (optional): store job snapshots so jobs survive Node restarts.

- **ERP screen integration (drop-in)**
  - Verify `/api/docai/grc/extract` in a realistic RetailCLIQ screen environment.
  - Validate `public/docai-bridge.js` workflow (postMessage + localStorage handoff).
  - Confirm import field mapping for target screens: PI / GRN_PO / GRN_PI / PIR / GRNR.

- **Supplier Profiles + HSN mapping**
  - Decide persistence (Mongo/MSSQL) for supplier profiles and HSN map overrides.
  - Add admin UI or endpoints for editing HSN classification rules.

- **Persistence strategy finalization**
  - Choose authoritative store for batches:
    - Option A: Mongo authoritative (recommended for flexible JSON payloads)
    - Option B: MSSQL DocAI tables authoritative (tight ERP coupling)
  - Implement backup/retention and basic indexing.

**Conclude Phase 3 with E2E tests**
- Bulk intake job completes successfully and produces multiple batches.
- At least 1 document posts successfully end-to-end (including mapping/validation/reconcile/post).
- Exports download correctly and match extracted data.

---

### Phase 4 — Production readiness (posting integration, security, observability) ⏳
**Goal:** Make posting transactional and safe; lock down secrets and access; ensure monitoring and regression coverage.

**User stories (Phase 4)**
1. As an admin, I can configure which posting procedure runs per DocType and ensure it is transactional.
2. As an auditor, I can view immutable audit logs for edits/overrides/posting.
3. As a security owner, I can restrict CORS/origins and protect keys/secrets.
4. As a manager, I can approve and post documents above threshold.
5. As a developer, I can run regression tests ensuring the 10-step flow never breaks.

**Work items**
- Implement real MSSQL posting stored procedure integration (transactional, rollback on error).
- Harden secrets management:
  - Remove secrets from checked-in files; use env injection / secrets manager.
  - Lock down CORS from `*` to allowed domains.
  - Add file scanning/limits and content-type enforcement.
- Add observability:
  - structured logging for OCR jobs, failures, performance timings.
  - metrics for Sarvam requests/minute, failures, average OCR latency.
- Add test suite:
  - API tests per step, plus a smoke E2E run with mock mode.

## 3. Next Actions (immediate)
1. **Phase 3 kickoff:** run at least one real multi-file bulk intake job (ZIP/RAR + multi-page PDFs) and verify SSE stability.
2. Validate and refine **master queries** for accuracy (supplier GSTIN field mapping, UOM codes, tax mapping).
3. Confirm **ERP payload** correctness against a real RetailCLIQ Purchase Invoice screen import (rows + header fill).
4. Decide **authoritative persistence** (Mongo vs MSSQL DocAI tables) and implement persistence for batches + intake jobs.
5. Add supplier profile persistence + editing endpoints.

## 4. Success Criteria
- **Core:** Upload/text/manual → detect → extract produces structured header/lines with Sarvam; progress endpoint robust; errors actionable.
- **Data:** Batches persist across restarts; list/open batch works reliably; intake jobs optionally persist.
- **ERP:** MSSQL masters resolve correctly; mapping suggestions are relevant; ERP payload matches screen import fields.
- **UX:** Full 10-step wizard completes without manual intervention; retries work; mobile responsive.
- **Ops:** Node service supervised; FastAPI proxy stable; SSE works end-to-end; poppler tools available for previews.
