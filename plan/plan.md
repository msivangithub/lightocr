# RetailCLIQ DocAI — 4-Tier OCR Engine with Offline-First Priority

The system upgrades the existing OCR chain to lead with two fully offline, zero-cost local engines before reaching any cloud provider. Documents are extracted at 90–99% quality even without internet, with cloud services acting as escalation tiers only when local engines fall short.

**Audience:** RetailCLIQ operators processing invoices, bank statements, and ERP documents in environments where internet may be unavailable or cloud API budgets must be conserved.

---

## Priority Chain

| Tier | Engine | Mode | Offline | Cost |
|------|--------|------|---------|------|
| 1 | **light_OCR** (`@arcships/light-ocr` npm) | Local, in-process | ✅ Yes | Zero |
| 2 | **Tesseract 5.3** (system binary) | Local, in-process | ✅ Yes | Zero |
| 3 | **Sarvam AI** (sarvam-105b, Doc-AI jobs) | Cloud | ❌ Needs internet | Pay-per-use |
| 4 | **Google Gemini** (gemini-2.5-flash Vision) | Cloud | ❌ Needs internet | Pay-per-use |
| — | **User error message** | — | — | — |

The chain is sequential and lazy: a provider is tried only if the previous one hard-failed (exception/crash) **or** returned an average confidence score below the threshold (default 60%, configurable via `.env` `OCR_MIN_CONFIDENCE`). The first result that clears the threshold is used immediately; subsequent tiers are not called.

---

## Core Features

### 1. light_OCR Integration (new Tier 1)
- Install `@arcships/light-ocr` as an npm dependency inside the existing `docai-node` server — no separate process, no additional port.
- For **images** (JPEG, PNG, WebP): call `ocrEngine.recognizeEncoded(buffer)`.
- For **PDFs**: call `recognizeDocument(filePath, { dpi: 200 })`, which yields results page by page.
- Extract average per-line confidence from the returned token stream.
- Apply the server.js `analyzeLayout` logic (key-value, table, list, identifier, text classification) to produce structured JSON matching the existing DocAI batch schema.
- Result tagged `engine: 'light-ocr'`.

### 2. Confidence Threshold Gate
- After each provider returns, compute `avgConfidence = mean(line.confidence for all lines)`.
- If `avgConfidence >= OCR_MIN_CONFIDENCE` (default 0.60): accept result, stop chain.
- If below threshold or exception: log the failure, advance to next tier.
- Threshold is set per-document at call time if the caller passes `minConfidence` override; otherwise the `.env` default applies.

### 3. End-of-Chain User Error
When all four tiers fail or return below-threshold confidence, the batch detect step returns a structured error response:
- Batch status set to `'ocr-failed'`.
- Error card shown in the wizard UI: **"Document could not be read clearly. Please check the file quality (blur, low contrast, password-protected PDF) or try a re-scan at higher resolution."**
- The batch remains in the system so the user can re-upload a corrected file or manually enter data.

### 4. Engine Visibility
- `GET /api/docai/health` and `/api/docai/fallback-status` updated to include `lightOcr` status.
- `GET /api/docai/diag` runs `light-ocr` self-test (recognise a 1-pixel white image) and reports version + availability.
- The wizard **Check Setup** (🩺) modal gains a new row showing light_OCR status.
- Each processed batch records `ocrEngine` in its MSSQL `DocAI_Batch` row (already has this field — just needs the new value).
- Dashboard **Document Types** breakdown gains an **OCR Engines Used** mini-chart showing how many documents came from each tier this month.

### 5. Offline Guarantee
Tiers 1 (light_OCR) and 2 (Tesseract) never make network calls. Any document can be processed end-to-end with zero internet if those two engines succeed. The system does not block, delay, or error on cloud provider unavailability before attempting local tiers.

### 6. FastAPI Startup Auto-Install
The FastAPI `ensure_system_tools()` already installs Tesseract. It will also run `npm install @arcships/light-ocr --prefix /app/services/docai-node` if the package is absent, so Tier 1 self-heals on pod restart.

---

## User Flow

1. User uploads a document (any source: file, camera, bank statement, EDI).
2. DocAI server passes the file to **light_OCR** first.
   - Success + confidence ≥ 60%: extraction result returned immediately, engine badge shows **⚡ light_OCR**.
   - Failure or low confidence: move to Tesseract.
3. **Tesseract** runs locally.
   - Success + confidence ≥ 60%: result returned, badge shows **🔡 Tesseract**.
   - Failure or low confidence: move to Sarvam (requires internet).
4. **Sarvam AI** digitise + structuring job.
   - Success + confidence ≥ 60%: result returned, badge shows **🤖 Sarvam AI**.
   - Failure or low confidence: move to Gemini.
5. **Gemini Vision** OCR.
   - Success + confidence ≥ 60%: result returned, badge shows **✨ Gemini**.
   - Failure or low confidence: display error card to user.
6. User sees the engine badge on the Detect screen. Engine name also stored in batch audit trail.

---

## UI / UX

- **Engine badge on Detect screen**: small coloured chip alongside the Sarvam AI chip already there — shows which tier produced the result.
  - ⚡ light_OCR (blue), 🔡 Tesseract (grey), 🤖 Sarvam AI (green), ✨ Gemini (purple).
- **Check Setup modal**: new Tier 1 row `light_OCR: ok — v1.x.x` or `not installed — run npm install`.
- **Error card**: replaces progress card when all tiers fail; instructs user on improving file quality; includes a **Re-upload** button and a **Manual Entry** button to bypass OCR entirely.
- **Dashboard mini-chart** (Phase 2): a small horizontal bar showing % of documents handled by each tier this week — helps operators see if cloud usage is creeping up.

---

## Implementation Phases

### Phase 1 — MVP (built now)
- Install `@arcships/light-ocr` in `docai-node`.
- Create `lightOcrService.js` wrapping `recognizeEncoded` / `recognizeDocument`, computing avgConfidence, returning `{ text, pages, engine, confidence }`.
- Port the `analyzeLayout` helper from the uploaded `server.js` into the DocAI pipeline (deduplicated with the existing heuristic structuring).
- Update `ocrEngine.js` `withFallback` to insert light_OCR as Tier 1 before Tesseract in all image/PDF OCR paths.
- Update `ocrPages()` and `ocrPdf()` with the new 4-tier signature.
- Update `detect()` and `structure()` — Tier 1 produces OCR text that feeds the same Sarvam/Gemini/heuristic LLM structuring chain (light_OCR is a text extractor, not a classifier).
- Add `OCR_MIN_CONFIDENCE=0.60` to `docai-node/.env`.
- Update `/health`, `/diag`, `/fallback-status` endpoints to include light_OCR status.
- Add the engine badge chip to the Detect step in `DocAIWizard.js`.
- Add the user-facing OCR failure error card.
- Auto-install in `server.py` `ensure_system_tools()`.

### Phase 2 — Quality Tuning and Observability
- Per-document confidence threshold override via API (`minConfidence` param on batch create).
- Dashboard **OCR Engine Usage** chart (7-day breakdown by engine).
- MSSQL query to `DocAI_Batch` for engine stats exposed on `/api/docai/dashboard/stats`.
- Threshold tuning UI in Dashboard settings (slider 40%–80%, saved to `.env`-like config).
- Per-engine timing metrics stored so operators can see which engine is slow.

### Phase 3 — Advanced Routing and Bulk Intelligence
- Document-type-aware routing: bank statements and digital PDFs skip Tier 1/2 (they already have direct parsers) and only use cloud tiers if the direct parser fails.
- Bulk intake inherits the same 4-tier chain per document.
- A/B confidence history: track which tier actually succeeded per document type over time and surface recommendations ("Tesseract works well for your invoices — consider making it Tier 1 for cost saving").

---

## Assumptions

- `@arcships/light-ocr` is installable via npm in the ARM64 Debian 12 environment the docai-node server runs in; if it is not available for that architecture, Phase 1 will substitute a pure-JS OCR library as Tier 1 fallback.
- The confidence threshold of 60% is a sensible default; the user may need to tune it downward (e.g., 40%) for low-quality scans where even a partial extraction is better than escalating to a paid cloud tier.
- light_OCR's `analyzeLayout` output (key-value, table, list blocks) is used only for heuristic structuring in Tier 1; when Sarvam or Gemini is reached, their full LLM structuring replaces it.
- The existing `analyzeLayout` code from the uploaded `server.js` is ported as-is — it is not redesigned.
- Sarvam and Gemini remain tiers 3 and 4 as cloud escalation; the offline claim applies only to tiers 1 and 2.
- A result is "accepted" when its average confidence crosses the threshold; partial-page failures are not treated as full-document failures.
- The user-facing error message is shown only after all 4 tiers are exhausted; partial results with low confidence are never silently returned.
- Bank statements detected as digital PDFs continue to use the dedicated `bankParser.js` direct-parse path, bypassing all OCR tiers entirely — no change to that flow.
