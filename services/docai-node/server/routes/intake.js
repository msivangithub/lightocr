const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const intake = require('../services/intake');
const engine = require('../services/ocrEngine');

const router = express.Router();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const upload = multer({
  storage: multer.diskStorage({ destination: path.join(UPLOAD_DIR, 'intake-in'), filename: (_, f, cb) => cb(null, `${Date.now()}-${f.originalname.replace(/[^\w.\-() ]+/g, '_')}`) }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024, files: 500 },
});
fs.mkdirSync(path.join(UPLOAD_DIR, 'intake-in'), { recursive: true });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(e.status || 400).json({ error: e.message }); });
const getJob = (req) => { const j = intake.jobs.get(req.params.id); if (!j) { const e = new Error('Intake job not found'); e.status = 404; throw e; } return j; };

/** Serve pre-processed page images / thumbnails (restricted to the intake work dir) */
router.get('/file', (req, res) => { const p = path.resolve(String(req.query.p || '')); if (!p.startsWith(intake.WORK) && !p.startsWith(UPLOAD_DIR)) return res.status(403).end(); res.sendFile(p); });


router.get('/engine', (_, res) => res.json({ ocr: engine.OCR_ENGINE, llm: engine.LLM_ENGINE, pageLimit: 10, rpm: Number(process.env.SARVAM_RPM || 10) }));
router.get('/', (_, res) => res.json([...intake.jobs.values()].map(intake.publicJob).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))));

/** Upload: multipart field `files` (many) + options: split=auto|page|file, contentType, rotate, forceOcr */
router.post('/', upload.array('files', 500), wrap(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  const job = await intake.createJob({ user: req.body.user || 'admin', files: req.files, options: { split: req.body.split || 'auto', contentType: req.body.contentType || 'mixed', rotate: Number(req.body.rotate || 0), forceOcr: req.body.forceOcr === '1' } });
  res.json(intake.publicJob(job));
}));
router.get('/:id', wrap(async (req, res) => res.json(intake.publicJob(getJob(req)))));

/** Server-Sent Events: live progress */
router.get('/:id/events', (req, res) => {
  const job = intake.jobs.get(req.params.id); if (!job) return res.status(404).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'snapshot', job: intake.publicJob(job) })}\n\n`);
  const h = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  intake.bus.on(job.id, h);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { intake.bus.off(job.id, h); clearInterval(ping); });
});

router.post('/:id/docs/:docId/reprocess', wrap(async (req, res) => { const u = await intake.reprocessDoc(getJob(req), req.params.docId, req.body || {}); res.json({ ok: true, unitId: u.id }); }));
router.post('/:id/post', wrap(async (req, res) => res.json(await intake.bulkPost(getJob(req), { onlyClean: req.body.onlyClean !== false, approve: !!req.body.approve }))));

/** Export extracted data (headers + lines) */
router.get('/:id/export.:fmt', wrap(async (req, res) => {
  const job = getJob(req); const { headers, lines } = await intake.exportRows(job);
  if (req.params.fmt === 'json') return res.json({ headers, lines });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(headers), 'Documents');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), 'Lines');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: req.params.fmt === 'csv' ? 'csv' : 'xlsx' });
  res.set('Content-Disposition', `attachment; filename="intake-${job.id.slice(0, 8)}.${req.params.fmt === 'csv' ? 'csv' : 'xlsx'}"`); res.send(buf);
}));

module.exports = router;
