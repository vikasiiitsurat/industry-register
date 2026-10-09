import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from './config.js';
import { AppError } from './errors.js';
import { parseDocument, workerFilesAvailable } from './parsers/document.js';
import { buildWorkbook } from './services/export.js';
import { findLibreOffice } from './services/libreoffice.js';
import { allowedOrigins } from './origins.js';

const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createApp({ parser = parseDocument, workbookBuilder = buildWorkbook, officeFinder = findLibreOffice, origins = allowedOrigins() } = {}) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxFileBytes, files: 1, fields: 0, parts: 1 }
  }).single('file');

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !origins.has(origin)) return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This frontend origin is not allowed.'));
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, origin && origins.has(origin) ? origin : false) }));

  app.get('/api/health', async (req, res) => {
    const workers = await workerFilesAvailable();
    res.status(workers ? 200 : 503).json({
      status: workers ? 'ok' : 'unavailable',
      service: 'conversion',
      workerFilesAvailable: workers,
      libreOffice: Boolean(await officeFinder()),
      limits: { maxFileBytes: config.maxFileBytes, maxOutputBytes: config.maxOutputBytes },
      ...(workers ? {} : { message: 'Parser worker files are missing from the server deployment.' })
    });
  });

  app.post('/api/convert', (req, res, next) => {
    upload(req, res, async error => {
      try {
        if (error) throw error;
        if (!req.file) throw new AppError(400, 'NO_FILE', 'Choose one Word or Excel file.');
        const parsed = await parser(req.file.buffer, req.file.originalname, { findOffice: officeFinder });
        const groups = new Map();
        parsed.records.forEach((record, index) => {
          const station = record.data.stationName || record.data.stationId;
          const key = station || Symbol(index);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(record.data);
        });
        const workbook = await workbookBuilder([...groups.values()].flat());
        const output = Buffer.from(await workbook.xlsx.writeBuffer());
        if (output.byteLength > config.maxOutputBytes) throw new AppError(413, 'OUTPUT_TOO_LARGE', 'The generated Excel file exceeds the download limit. Split the input into smaller files.');
        res.setHeader('Content-Type', excelType);
        res.setHeader('Content-Disposition', `attachment; filename="industry-records-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx"`);
        res.setHeader('X-Record-Count', String(parsed.records.length));
        res.send(output);
      } catch (e) { next(e); }
    });
  });

  app.use('/api', (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'API endpoint not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      return res.status(413).json({ error: { code: error.code, message: `Choose one file smaller than ${config.maxFileBytes / 1_000_000} MB.` } });
    }
    res.status(error instanceof AppError ? error.status : 500).json({
      error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : 'Conversion failed. Check the server logs and retry.' }
    });
  });
  return app;
}
