import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { fields } from '@industry/shared';
import deployedApp from '../src/index.js';
import { createApp } from '../src/app.js';
import { allowedOrigins } from '../src/origins.js';
import { parseDocument, workerFilesAvailable } from '../src/parsers/document.js';
import { findLibreOffice } from '../src/services/libreoffice.js';
import { fixtureDocx } from './fixtures.js';

const binary = (res, done) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};
const uploadFile = (app, buffer, name) => request(app).post('/api/convert').attach('file', buffer, name).buffer(true).parse(binary);

test('deployed entrypoint health is ready without DATABASE_URL and finds worker files', async () => {
  assert.equal(await workerFilesAvailable(), true);
  const response = await request(deployedApp).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'conversion');
  assert.equal(response.body.processingMode, 'in-process');
  assert.equal(response.body.workerFilesAvailable, true);
  assert.equal(response.body.limits.maxFileBytes, 4_000_000);
  assert.equal(response.body.limits.maxOutputBytes, 4_000_000);
  assert.equal((await request(deployedApp).get('/api/stats')).status, 404);
});

test('one Word file returns the 34-column Excel output from deployed entrypoint', async () => {
  const response = await uploadFile(deployedApp, await fixtureDocx(), 'input.docx');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-record-count'], '2');
  assert.match(response.headers['content-disposition'], /attachment; filename="industry-records-.*\.xlsx"/);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(response.body);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), fields.map(field => field.label));
  assert.equal(sheet.rowCount, 3);
  assert.deepEqual([sheet.getCell('AE2').value, sheet.getCell('AE3').value], ['Inlet Flow', 'Outlet Flow']);
});

test('one Excel file splits parameters and keeps stations grouped in source order', async () => {
  const input = new ExcelJS.Workbook(), sheet = input.addWorksheet('Input');
  sheet.addRow(fields.map(field => field.label));
  for (const data of [
    { industryName: 'Example Works', stationName: 'Station B', parameter: 'SO2,NOX' },
    { industryName: 'Example Works', stationName: 'Station A', parameter: 'pH' },
    { industryName: 'Example Works', stationName: 'Station B', parameter: 'PM10' }
  ]) sheet.addRow(fields.map(field => data[field.key] || ''));
  const response = await uploadFile(deployedApp, Buffer.from(await input.xlsx.writeBuffer()), 'input.xlsx');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-record-count'], '4');
  const output = new ExcelJS.Workbook(); await output.xlsx.load(response.body);
  const result = output.worksheets[0];
  assert.deepEqual([2, 3, 4, 5].map(row => [result.getRow(row).getCell(19).value, result.getRow(row).getCell(31).value]), [
    ['Station B', 'SO2'], ['Station B', 'NOX'], ['Station B', 'PM10'], ['Station A', 'pH']
  ]);
});

test('production, preview, and local origins work; arbitrary forwarded hosts do not', async () => {
  const origins = allowedOrigins({ CLIENT_ORIGIN: 'https://industry.example', VERCEL_URL: 'preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'industry.vercel.app' });
  const app = createApp({ origins, officeFinder: async () => null });
  for (const origin of ['https://industry.example', 'https://preview.vercel.app', 'https://industry.vercel.app', 'http://127.0.0.1:5173', 'http://localhost:3000']) {
    const response = await request(app).get('/api/health').set('Origin', origin);
    assert.equal(response.status, 200);
    assert.equal(response.headers['access-control-allow-origin'], origin);
  }
  const rejected = await request(app).post('/api/convert').set('Origin', 'https://evil.example').set('X-Forwarded-Host', 'industry.example');
  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error.code, 'ORIGIN_NOT_ALLOWED');
});

test('legacy files give a Save As instruction when no compatible LibreOffice is available', async () => {
  assert.equal(await findLibreOffice({ candidates: [], searchPath: '' }), null);
  const compoundHeader = Buffer.from('d0cf11e0a1b11ae10000000000000000', 'hex');
  await assert.rejects(parseDocument(compoundHeader, 'old.doc', { findOffice: async () => null }), { code: 'LEGACY_UNAVAILABLE', message: /Save As \.docx/ });
  const app = createApp({ officeFinder: async () => null });
  const health = await request(app).get('/api/health');
  assert.equal(health.body.libreOffice, false);
  const response = await request(app).post('/api/convert').attach('file', compoundHeader, 'old.xls');
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'LEGACY_UNAVAILABLE');
  assert.match(response.body.error.message, /Save As \.xlsx/);
});

test('oversized output and invalid input return useful errors', async () => {
  const missing = await request(deployedApp).post('/api/convert');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'NO_FILE');
  const invalid = await request(deployedApp).post('/api/convert').attach('file', Buffer.from('not a document'), 'fake.docx');
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'INVALID_DOCX');
  const largeInput = await request(deployedApp).post('/api/convert').attach('file', Buffer.alloc(4_000_001), 'large.docx');
  assert.equal(largeInput.status, 413);
  assert.equal(largeInput.body.error.code, 'LIMIT_FILE_SIZE');
  const app = createApp({ parser: async () => ({ records: [] }), workbookBuilder: async () => ({ xlsx: { writeBuffer: async () => Buffer.alloc(4_000_001) } }) });
  const oversized = await request(app).post('/api/convert').attach('file', Buffer.from('input'), 'input.docx');
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'OUTPUT_TOO_LARGE');
});
