import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { fields } from '@industry/shared';
import { migrate } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';
import { fixtureDocx } from '../fixtures.js';
import { upgradeExistingParameterRows } from '../../src/services/parameter-upgrade.js';
const databaseUrl = process.env.TEST_DATABASE_URL;

test('real PostgreSQL: iterative upload, automatic save, full Excel, erase, and re-upload', { skip: !databaseUrl }, async t => {
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const db = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  t.after(async () => { await db.end(); await admin.query('DROP SCHEMA "' + schema + '" CASCADE'); await admin.end(); });
  await migrate(db);
  const app = createApp(db);
  const first = await fixtureDocx();
  let response = await request(app).post('/api/imports/batch').attach('files', first, 'first.docx');
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].status, 'success');
  assert.equal(response.body.results[0].recordCount, 2);
  const firstId = response.body.results[0].importId;
  let saved = (await request(app).get('/api/records')).body;
  assert.equal(saved.total, 2);
  assert.ok(saved.records.every(r => r.status === 'approved'));
  assert.equal(saved.records.find(r => r.parameter === 'Inlet Flow').stationName, 'ETP_Inlet');

  const exportSheet = async () => {
    const result = await request(app).get('/api/export').buffer(true).parse((res, done) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    assert.equal(result.status, 200);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(result.body); return book.worksheets[0];
  };
  let sheet = await exportSheet();
  assert.equal(sheet.rowCount, 3);
  assert.deepEqual(sheet.getRow(1).values.slice(1), fields.map(f => f.label));
  assert.equal(sheet.getRow(2).getCell(4).value, 'Fixture Industries (synthetic)');

  const excelBook = new ExcelJS.Workbook(), excelSheet = excelBook.addWorksheet('Input');
  excelSheet.addRow(fields.map(field => field.label));
  const excelData = { industryName: 'Excel Source Ltd', industryCode: '00077', stationName: 'Excel Station',
    serialNo: '0000123', parameter: 'SO2,NOX,PM2.5,PM10', unitOfMeasurement: 'μg/m3' };
  excelSheet.addRow(fields.map(field => excelData[field.key] || ''));
  const excelBuffer = Buffer.from(await excelBook.xlsx.writeBuffer());
  response = await request(app).post('/api/imports/batch').attach('files', excelBuffer, 'input.xlsx');
  assert.equal(response.status, 200);
  assert.equal(response.body.results[0].status, 'success');
  assert.equal(response.body.results[0].recordCount, 4);
  saved = (await request(app).get('/api/records')).body;
  assert.equal(saved.total, 6);
  assert.deepEqual(saved.records.filter(row => row.industryName === 'Excel Source Ltd').map(row => row.parameter), ['SO2', 'NOX', 'PM2.5', 'PM10']);
  assert.ok(saved.records.filter(row => row.industryName === 'Excel Source Ltd').every(row => row.industryCode === '00077' && row.stationName === 'Excel Station'));
  sheet = await exportSheet(); assert.equal(sheet.rowCount, 7);
  assert.deepEqual([4, 5, 6, 7].map(row => sheet.getRow(row).getCell(31).value), ['SO2', 'NOX', 'PM2.5', 'PM10']);
  response = await request(app).post('/api/imports/batch').attach('files', excelBuffer, 'renamed.xlsx');
  assert.equal(response.body.results[0].status, 'duplicate');

  response = await request(app).post('/api/imports/batch').attach('files', first, 'renamed.docx');
  assert.equal(response.body.results[0].status, 'duplicate');
  response = await request(app).post('/api/imports/batch').attach('files', await fixtureDocx('Second Industry'), 'second.docx');
  assert.equal(response.body.results[0].status, 'success');
  assert.equal((await request(app).get('/api/records')).body.total, 8);
  sheet = await exportSheet(); assert.equal(sheet.rowCount, 9);

  // Older rows saved by the former review workflow are also included in the simple export.
  await db.query("UPDATE records SET status='draft' WHERE import_id=$1", [firstId]);
  assert.equal((await request(app).get('/api/records')).body.total, 8);
  sheet = await exportSheet(); assert.equal(sheet.rowCount, 9);

  response = await request(app).delete('/api/data').send({ confirmation: 'wrong' });
  assert.equal(response.status, 400);
  assert.equal((await request(app).get('/api/records')).body.total, 8);
  response = await request(app).delete('/api/data').send({ confirmation: 'ERASE' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.deleted, { records: 8, imports: 3 });
  assert.equal((await request(app).get('/api/records')).body.total, 0);
  assert.equal((await request(app).get('/api/stats')).body.imports, 0);
  sheet = await exportSheet(); assert.equal(sheet.rowCount, 1);

  response = await request(app).post('/api/imports/batch').attach('files', first, 'first-again.docx').attach('files', excelBuffer, 'excel-again.xlsx');
  assert.deepEqual(response.body.results.map(result => result.status), ['success', 'success']);
  assert.equal((await request(app).get('/api/records')).body.total, 6);
});

test('real PostgreSQL: station groups follow first source appearance and keep parameter order', { skip: !databaseUrl }, async t => {
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const db = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  t.after(async () => { await db.end(); await admin.query('DROP SCHEMA "' + schema + '" CASCADE'); await admin.end(); });
  await migrate(db);
  const app = createApp(db), book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Input');
  sheet.addRow(fields.map(field => field.label));
  for (const [stationName, parameter] of [['Station B', 'SO2,NOX'], ['Station A', 'PM10,PM2.5'], ['Station B', 'CO']]) {
    const data = { industryName: 'Example', stationName, parameter, unitOfMeasurement: 'μg/m3' };
    sheet.addRow(fields.map(field => data[field.key] || ''));
  }
  const uploaded = await request(app).post('/api/imports/batch').attach('files', Buffer.from(await book.xlsx.writeBuffer()), 'stations.xlsx');
  assert.equal(uploaded.body.results[0].recordCount, 5);
  const expected = [['Station B', 'SO2'], ['Station B', 'NOX'], ['Station B', 'CO'], ['Station A', 'PM10'], ['Station A', 'PM2.5']];
  const listed = (await request(app).get('/api/records')).body.records;
  assert.deepEqual(listed.map(row => [row.stationName, row.parameter]), expected);
  const pageTwo = (await request(app).get('/api/records?page=2&pageSize=2')).body.records;
  assert.deepEqual(pageTwo.map(row => [row.stationName, row.parameter]), expected.slice(2, 4));
  const exported = await request(app).get('/api/export').buffer(true).parse((res, done) => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(null, Buffer.concat(chunks)));
  });
  const output = new ExcelJS.Workbook(); await output.xlsx.load(exported.body);
  assert.deepEqual([2, 3, 4, 5, 6].map(row => [output.worksheets[0].getRow(row).getCell(19).value, output.worksheets[0].getRow(row).getCell(31).value]), expected);
});

test('real PostgreSQL: previously saved combined rows expand once while originals remain excluded', { skip: !databaseUrl }, async t => {
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const db = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  t.after(async () => { await db.end(); await admin.query('DROP SCHEMA "' + schema + '" CASCADE'); await admin.end(); });
  await migrate(db);
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Input');
  sheet.addRow(fields.map(field => field.label));
  sheet.addRow(fields.map(field => ({ industryName: 'Older Import', stationName: 'Main Gate', parameter: 'Single', unitOfMeasurement: 'μg/m3' })[field.key] || ''));
  const app = createApp(db);
  const uploaded = await request(app).post('/api/imports/batch').attach('files', Buffer.from(await workbook.xlsx.writeBuffer()), 'old.xlsx');
  const importId = uploaded.body.results[0].importId;
  const oldId = (await db.query('SELECT id FROM records WHERE import_id=$1', [importId])).rows[0].id;
  await db.query("UPDATE records SET parameter='SO2,NOX,PM2.5,PM10' WHERE id=$1", [oldId]);

  assert.deepEqual(await upgradeExistingParameterRows(db), { sourceRows: 1, createdRecords: 4, affectedImports: 1 });
  assert.equal((await db.query('SELECT status FROM records WHERE id=$1', [oldId])).rows[0].status, 'excluded');
  const current = (await request(app).get('/api/records')).body.records;
  assert.deepEqual(current.map(row => row.parameter).sort(), ['NOX', 'PM10', 'PM2.5', 'SO2']);
  assert.equal((await db.query('SELECT record_count FROM imports WHERE id=$1', [importId])).rows[0].record_count, 4);
  assert.deepEqual(await upgradeExistingParameterRows(db), { sourceRows: 0, createdRecords: 0, affectedImports: 0 });
  assert.equal((await db.query('SELECT count(*)::int AS count FROM records')).rows[0].count, 5);
});
