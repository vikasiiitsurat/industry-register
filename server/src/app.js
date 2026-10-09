import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { fields, keys } from '@industry/shared';
import { config } from './config.js';
import { AppError } from './errors.js';
import { transaction } from './db/pool.js';
import { processBatch } from './services/imports.js';
import { parseDocument } from './parsers/document.js';
import { filterSchema, whereFilter, refreshedIssues, approveRow } from './services/records.js';
import { editSchema, settingsSchema } from './validation/records.js';
import { buildWorkbook } from './services/export.js';
import { findLibreOffice } from './services/libreoffice.js';
const uuid = value => z.uuid().parse(value);
const stationSourceOrder = `MIN(r.source_order) OVER (PARTITION BY r.import_id,
  COALESCE(NULLIF(r."stationName",''),NULLIF(r."stationId",''),r.id::text))`;
export function createApp(db, { ensureReady = async () => {}, parser } = {}) {
  const app = express(); let batchActive = false;
  app.disable('x-powered-by');
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(cors({ origin: config.origin }));
  app.use('/api', (req, res, next) => {
    if (req.headers.origin && req.headers.origin !== config.origin && req.headers.origin !== `http://${config.host}:${config.port}`) return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed. Use the configured local frontend.'));
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', async (req, res) => {
    let database = false;
    try { await db.query('SELECT 1'); database = true; } catch {}
    res.status(database ? 200 : 503).json({ status: database ? 'ok' : 'unavailable', database, libreOffice: Boolean(await findLibreOffice()), limits: { maxFiles: config.maxFiles, maxFileBytes: config.maxFileBytes }, message: database ? null : 'PostgreSQL is unavailable. Configure server/.env, start PostgreSQL, and run npm run db:migrate.' });
  });
  const singleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 1, fields: 0, parts: 1 } }).single('file');
  app.post('/api/convert', (req, res, next) => {
    singleUpload(req, res, async error => {
      try {
        if (error) throw error;
        if (!req.file) throw new AppError(400, 'NO_FILE', 'Choose one Word or Excel file.');
        const parsed = await (parser || parseDocument)(req.file.buffer, req.file.originalname);
        const groups = new Map();
        parsed.records.forEach((record, index) => {
          const station = record.data.stationName || record.data.stationId;
          const key = station || Symbol(index);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(record.data);
        });
        const workbook = await buildWorkbook([...groups.values()].flat());
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="industry-records-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx"`);
        res.setHeader('X-Record-Count', String(parsed.records.length));
        res.send(Buffer.from(buffer));
      } catch (e) { next(e); }
    });
  });
  app.use('/api', async (req, res, next) => { try { await ensureReady(); next(); } catch (e) { next(e); } });
  app.get('/api/schema', (req, res) => res.json({ fields }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: config.maxFiles, fields: 0, parts: config.maxFiles }, fileFilter: (req, file, cb) => cb(null, true) }).array('files', config.maxFiles);
  app.post('/api/imports/batch', (req, res, next) => {
    if (batchActive) return next(new AppError(409, 'BATCH_BUSY', 'A batch is already processing. Wait for it to finish.'));
    batchActive = true;
    upload(req, res, async error => {
      try {
        if (error) throw error;
        if (!req.files?.length) throw new AppError(400, 'NO_FILES', 'Choose at least one Word or Excel file.');
        res.json(await processBatch(db, req.files, parser));
      } catch (e) { next(e); } finally { batchActive = false; }
    });
  });
  app.get('/api/imports', async (req, res) => {
    const rows = (await db.query(`SELECT i.*, count(r.id) FILTER (WHERE r.status='draft')::int AS draft_count,
      count(r.id) FILTER (WHERE r.status='approved')::int AS approved_count, count(r.id) FILTER (WHERE r.status='excluded')::int AS excluded_count
      FROM imports i LEFT JOIN records r ON r.import_id=i.id GROUP BY i.id ORDER BY i.created_at DESC,i.id DESC`)).rows;
    res.json({ imports: rows });
  });
  app.get('/api/imports/:id', async (req, res) => {
    const row = (await db.query('SELECT * FROM imports WHERE id=$1', [uuid(req.params.id)])).rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Import not found.'); res.json(row);
  });
  app.get('/api/stats', async (req, res) => {
    const row = (await db.query(`SELECT count(*) FILTER(WHERE status='approved')::int approved, count(*) FILTER(WHERE status='draft')::int drafts,
      count(DISTINCT "industryName") FILTER(WHERE status<>'excluded')::int industries FROM records`)).rows[0];
    res.json({ ...row, imports: (await db.query('SELECT count(*)::int AS count FROM imports')).rows[0].count });
  });
  app.get('/api/records/options', async (req, res) => {
    const rows = (await db.query('SELECT DISTINCT "industryName","stationName" FROM records ORDER BY "industryName","stationName"')).rows;
    res.json({ industries: [...new Set(rows.map(r => r.industryName).filter(Boolean))], stations: [...new Set(rows.map(r => r.stationName).filter(Boolean))] });
  });
  app.get('/api/records', async (req, res) => {
    const filter = filterSchema.parse(req.query), { sql, values } = whereFilter(filter);
    const total = (await db.query(`SELECT count(*)::int AS count FROM records r WHERE ${sql}`, values)).rows[0].count;
    const rows = (await db.query(`SELECT r.*,i.original_filename FROM records r JOIN imports i ON i.id=r.import_id WHERE ${sql}
      ORDER BY i.created_at DESC,i.id DESC,${stationSourceOrder},r.source_order,r.id
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, filter.pageSize, (filter.page - 1) * filter.pageSize])).rows;
    res.json({ records: rows, total, page: filter.page, pageSize: filter.pageSize });
  });
  app.put('/api/records/:id', async (req, res) => {
    const input = editSchema.parse(req.body), id = uuid(req.params.id);
    res.json(await transaction(db, async c => {
      const row = (await c.query('SELECT * FROM records WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Record not found.');
      if (row.version !== input.version) throw new AppError(409, 'STALE_RECORD', 'This record changed since you opened it. Reopen it before saving.');
      Object.assign(row, input.data, { review_decisions: input.decisions });
      const { metadata, issues } = await refreshedIssues(c, row);
      // Edits to approved records return to draft if they introduce unresolved issues.
      const status = row.status === 'approved' && issues.length ? 'draft' : row.status;
      const columns = [...keys, 'review_decisions', 'issues', 'source_metadata', 'status'];
      const values = [...keys.map(k => input.data[k]), JSON.stringify(input.decisions), JSON.stringify(issues), JSON.stringify(metadata), status, id];
      return (await c.query(`UPDATE records SET ${columns.map((k, i) => `"${k}"=$${i + 1}`).join(',')},version=version+1,updated_at=now() WHERE id=$${values.length} RETURNING *`, values)).rows[0];
    }));
  });
  app.post('/api/records/approve-valid', async (req, res) => {
    const { importId } = z.object({ importId: z.uuid().optional() }).strict().parse(req.body);
    const result = await transaction(db, async c => {
      const rows = (await c.query(`SELECT * FROM records WHERE status='draft'${importId ? ' AND import_id=$1' : ''} ORDER BY id FOR UPDATE`, importId ? [importId] : [])).rows;
      let approved = 0;
      for (const row of rows) { const check = await refreshedIssues(c, row); if (!check.issues.length) { await approveRow(c, row); approved++; } }
      return { approved, remaining: rows.length - approved };
    }); res.json(result);
  });
  app.post('/api/records/:id/status', async (req, res) => {
    const id = uuid(req.params.id), input = z.object({ status: z.enum(['draft','approved','excluded']), version: z.number().int().positive() }).strict().parse(req.body);
    res.json(await transaction(db, async c => {
      const row = (await c.query('SELECT * FROM records WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Record not found.');
      if (row.version !== input.version) throw new AppError(409, 'STALE_RECORD', 'This record has changed. Reload it.');
      if (input.status === 'approved') return approveRow(c, row);
      return (await c.query('UPDATE records SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [id, input.status])).rows[0];
    }));
  });
  app.delete('/api/records/:id', async (req, res) => {
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const result = await db.query('DELETE FROM records WHERE id=$1 AND version=$2', [uuid(req.params.id), version]);
    if (!result.rowCount) throw new AppError(409, 'STALE_RECORD', 'Record was changed or deleted. Reload the dataset.');
    res.status(204).end();
  });
  app.get('/api/mapping-settings', async (req, res) => {
    const rows = (await db.query('SELECT DISTINCT layout_id FROM imports WHERE layout_id IS NOT NULL ORDER BY layout_id')).rows;
    const settings = (await db.query('SELECT * FROM mapping_settings ORDER BY layout_id')).rows;
    res.json({ layouts: rows.map(r => r.layout_id), settings });
  });
  app.put('/api/mapping-settings/:layout', async (req, res) => {
    const settings = settingsSchema.parse(req.body), layout = z.string().regex(/^tables-v1-[a-f0-9]{16}$/).parse(req.params.layout);
    if (!(await db.query('SELECT 1 FROM imports WHERE layout_id=$1 LIMIT 1', [layout])).rowCount) throw new AppError(404, 'UNKNOWN_LAYOUT', 'Import a document with this layout first.');
    const row = (await db.query(`INSERT INTO mapping_settings(layout_id,settings) VALUES($1,$2) ON CONFLICT(layout_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now() RETURNING *`, [layout, JSON.stringify(settings)])).rows[0]; res.json(row);
  });
  app.get('/api/export', async (req, res) => {
    const filter = filterSchema.parse(req.query), { sql, values } = whereFilter(filter, true);
    const rows = (await db.query(`SELECT r.* FROM records r JOIN imports i ON i.id=r.import_id WHERE ${sql}
      ORDER BY i.created_at,i.id,${stationSourceOrder},r.source_order,r.id`, values)).rows;
    const workbook = await buildWorkbook(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="industry-records-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx"`);
    res.send(Buffer.from(buffer));
  });
  app.delete('/api/data', async (req, res, next) => {
    let eraseActive = false;
    try {
      z.object({ confirmation: z.literal('ERASE') }).strict().parse(req.body);
      if (batchActive) throw new AppError(409, 'BATCH_BUSY', 'Wait for the current upload to finish before erasing data.');
      batchActive = true; eraseActive = true;
      const deleted = await transaction(db, async c => {
        const records = await c.query('DELETE FROM records');
        const imports = await c.query('DELETE FROM imports');
        await c.query('DELETE FROM import_batches');
        await c.query('DELETE FROM mapping_settings');
        return { records: records.rowCount, imports: imports.rowCount };
      });
      res.json({ deleted });
    } catch (e) { next(e); } finally { if (eraseActive) batchActive = false; }
  });
  app.use('/api', (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'API endpoint not found.')));
  const clientDir = fileURLToPath(new URL('../../client/dist', import.meta.url));
  app.use(express.static(clientDir));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', details: error.issues } });
    if (error instanceof multer.MulterError) return res.status(413).json({ error: { code: error.code, message: `Upload limit exceeded. Choose at most ${config.maxFiles} files, each no larger than ${config.maxFileBytes / 1024 / 1024} MB.` } });
    const unavailable = ['ECONNREFUSED','ENOTFOUND','28P01','3D000','42P01'].includes(error.code) || error instanceof AggregateError;
    const status = error.status || (unavailable ? 503 : 500);
    res.status(status).json({ error: { code: error instanceof AppError ? error.code : unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : unavailable ? 'Database unavailable or migrations missing. Check server/.env, start PostgreSQL and run npm run db:migrate.' : 'Request failed. Check the local server and retry.', ...(error instanceof AppError && error.details ? { details: error.details } : {}) } });
  });
  return app;
}
