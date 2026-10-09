import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { fields } from '@industry/shared';
import { createApp } from '../src/app.js';
import { fixtureDocx } from './fixtures.js';

const unavailableDb = { query: async () => { throw new Error('Database must not be queried'); } };
const app = createApp(unavailableDb, { ensureReady: async () => { throw new Error('Database must not be initialized'); } });
const binary = (res, done) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

async function uploadFile(buffer, name) {
  return request(app).post('/api/convert').attach('file', buffer, name).buffer(true).parse(binary);
}

test('one Word file downloads the 34-column Excel output without database access', async () => {
  const response = await uploadFile(await fixtureDocx(), 'input.docx');
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
  const response = await uploadFile(Buffer.from(await input.xlsx.writeBuffer()), 'input.xlsx');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-record-count'], '4');
  const output = new ExcelJS.Workbook(); await output.xlsx.load(response.body);
  const result = output.worksheets[0];
  assert.deepEqual([2, 3, 4, 5].map(row => [result.getRow(row).getCell(19).value, result.getRow(row).getCell(31).value]), [
    ['Station B', 'SO2'], ['Station B', 'NOX'], ['Station B', 'PM10'], ['Station A', 'pH']
  ]);
});

test('direct conversion reports missing and invalid input clearly', async () => {
  const missing = await request(app).post('/api/convert');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'NO_FILE');
  const invalid = await request(app).post('/api/convert').attach('file', Buffer.from('not a document'), 'fake.docx');
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'INVALID_DOCX');
});
