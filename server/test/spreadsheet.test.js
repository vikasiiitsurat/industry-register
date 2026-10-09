import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fields } from '@industry/shared';
import { parseSpreadsheet } from '../src/parsers/spreadsheet.js';
import { parseDocument } from '../src/parsers/document.js';
import { findLibreOffice } from '../src/services/libreoffice.js';
const run = promisify(execFile);

async function workbookBuffer(setup) {
  const book = new ExcelJS.Workbook();
  setup(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('34-column Excel input preserves repeated contact headers, leading zeros, and row locations', async () => {
  const buffer = await workbookBuffer(book => {
    const sheet = book.addWorksheet('Industry data');
    sheet.addRow(fields.map(field => field.label));
    const row = sheet.getRow(2);
    row.getCell(2).value = '00042'; row.getCell(4).value = 'Excel Works';
    row.getCell(5).value = 'Industry Person'; row.getCell(16).value = 'industry@example.com';
    row.getCell(19).value = 'Station A'; row.getCell(20).value = 'Station Person';
    row.getCell(23).value = 'station@example.com'; row.getCell(26).value = 123;
    row.getCell(26).numFmt = '000000'; row.getCell(31).value = 'Flow'; row.getCell(32).value = 'm3/hr';
    row.commit(); sheet.getRow(100).height = 20;
  });
  const parsed = await parseSpreadsheet(buffer);
  assert.equal(parsed.records.length, 1);
  const { data, source_reference } = parsed.records[0];
  assert.equal(data.industryCode, '00042'); assert.equal(data.industryName, 'Excel Works');
  assert.equal(data.industryContactName, 'Industry Person'); assert.equal(data.stationContactName, 'Station Person');
  assert.equal(data.industryEmail, 'industry@example.com'); assert.equal(data.stationEmail, 'station@example.com');
  assert.equal(data.serialNo, '000123'); assert.equal(data.parameter, 'Flow');
  assert.deepEqual(source_reference.fields.serialNo, { sheet: 'Industry data', row: 2, column: 26 });
  assert.equal((await parseDocument(buffer, 'input.xlsx')).records.length, 1);
});

test('Excel aliases map reordered columns and multiple worksheets without saving empty rows', async () => {
  const buffer = await workbookBuffer(book => {
    const first = book.addWorksheet('Instructions'); first.addRow(['How to use this workbook']);
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Company Name', 'Parameter Full Name', 'Unit', 'Contact Person Name', 'Email', 'Station Name', 'Device ID', 'Mobile No.']);
    sheet.addRow(['Reordered Ltd', 'pH', 'pH', 'Alice', 'a@example.com', 'Outlet', 'DEV-1', '001234567890']);
    sheet.addRow([]);
  });
  const parsed = await parseSpreadsheet(buffer);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].data.industryName, 'Reordered Ltd');
  assert.equal(parsed.records[0].data.parameter, 'pH');
  assert.equal(parsed.records[0].data.industryContactName, 'Alice');
  assert.equal(parsed.records[0].data.stationMobile, '001234567890');
  assert.equal(parsed.records[0].data.deviceId, 'DEV-1');
});

test('one Excel row with four parameters becomes four records with shared station and measurement details', async () => {
  const buffer = await workbookBuffer(book => {
    const sheet = book.addWorksheet('Metadata'); sheet.addRow(fields.map(field => field.label));
    const input = { industryName: 'Example Works', stationName: 'Main Gate', serialNo: 'YWM00717',
      parameter: 'SO2,NOX,PM2.5,PM10', unitOfMeasurement: 'μg/m3', dataBroadcastFrequency: '1 Min',
      acceptableMeasurementRange: '0-1000μg/m3' };
    sheet.addRow(fields.map(field => input[field.key] || ''));
  });
  const records = (await parseDocument(buffer, 'metadata.xlsx')).records;
  assert.deepEqual(records.map(record => record.data.parameter), ['SO2', 'NOX', 'PM2.5', 'PM10']);
  assert.deepEqual(records.map(record => record.source_reference.parameterItem), [1, 2, 3, 4]);
  assert.ok(records.every(record => record.data.stationName === 'Main Gate' && record.data.serialNo === 'YWM00717'));
  assert.ok(records.every(record => record.data.unitOfMeasurement === 'μg/m3' && record.data.dataBroadcastFrequency === '1 Min' && record.data.acceptableMeasurementRange === '0-1000μg/m3'));
});

test('parallel per-parameter units and ranges align by position, while commas inside names stay together', async () => {
  const buffer = await workbookBuffer(book => {
    const sheet = book.addWorksheet('Data'); sheet.addRow(fields.map(field => field.label));
    const input = { industryName: 'Example Works', parameter: 'NOx (NO, NO2); SO2',
      unitOfMeasurement: 'ppm; μg/m3', acceptableMeasurementRange: '0-50 ppm; 0-100 μg/m3' };
    sheet.addRow(fields.map(field => input[field.key] || ''));
  });
  const records = (await parseSpreadsheet(buffer)).records;
  assert.deepEqual(records.map(record => record.data.parameter), ['NOx (NO, NO2)', 'SO2']);
  assert.deepEqual(records.map(record => record.data.unitOfMeasurement), ['ppm', 'μg/m3']);
  assert.deepEqual(records.map(record => record.data.acceptableMeasurementRange), ['0-50 ppm', '0-100 μg/m3']);
});

test('Excel input rejects empty templates, unknown headers, and fake extensions', async () => {
  const empty = await workbookBuffer(book => book.addWorksheet('Data').addRow(fields.map(field => field.label)));
  await assert.rejects(parseSpreadsheet(empty), { code: 'EMPTY_SPREADSHEET' });
  const unknown = await workbookBuffer(book => { const sheet = book.addWorksheet('Data'); sheet.addRow(['Column A', 'Column B']); sheet.addRow(['a', 'b']); });
  await assert.rejects(parseSpreadsheet(unknown), { code: 'UNSUPPORTED_SPREADSHEET' });
  await assert.rejects(parseDocument(Buffer.from('hello'), 'fake.xlsx'), { code: 'INVALID_XLSX' });
  await assert.rejects(parseDocument(Buffer.from('hello'), 'fake.xls'), { code: 'INVALID_XLS' });
  await assert.rejects(parseDocument(Buffer.from('hello'), 'fake.csv'), { code: 'UNSUPPORTED_FILE' });
});

test('legacy XLS converts through LibreOffice and imports the same mapped rows', { timeout: 60000 }, async t => {
  const office = await findLibreOffice();
  if (!office) return t.skip('LibreOffice is not installed.');
  const directory = await mkdtemp(path.join(tmpdir(), 'industry-xls-test-'));
  try {
    const xlsx = await workbookBuffer(book => {
      const sheet = book.addWorksheet('Data'); sheet.addRow(fields.map(field => field.label));
      sheet.addRow(fields.map(field => ({ industryName: 'Legacy Excel Ltd', parameter: 'Flow', stationName: 'S1', serialNo: '0005' })[field.key] || ''));
    });
    const input = path.join(directory, 'legacy.xlsx'); await writeFile(input, xlsx);
    await run(office, [`-env:UserInstallation=${pathToFileURL(path.join(directory, 'profile')).href}`, '--headless', '--convert-to', 'xls', '--outdir', directory, input], { timeout: 30000, windowsHide: true });
    const legacy = await readFile(path.join(directory, 'legacy.xls'));
    assert.equal(legacy.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
    const parsed = await parseDocument(legacy, 'legacy.xls');
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].data.industryName, 'Legacy Excel Ltd');
    assert.equal(parsed.records[0].data.serialNo, '0005');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
