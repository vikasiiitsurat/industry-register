import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fields, blankRecord } from '@industry/shared';
import { buildWorkbook } from '../src/services/export.js';
import { whereFilter, filterSchema } from '../src/services/records.js';
test('XLSX round trip preserves all headers, identifiers, literal text and numeric coordinates', async () => {
  const record = { ...blankRecord(), industryName: '=HYPERLINK("https://example.com")', serialNo: '0029723', zipCode: '001234', industryMobile: '00123456789', industryContactName: 'First', stationContactName: 'Second', latitude: '0', longitude: '73.8' };
  const source = await buildWorkbook([record], '');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await source.xlsx.writeBuffer());
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), fields.map(f => f.label));
  assert.equal(sheet.columnCount, 34); assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('D2').type, ExcelJS.ValueType.String); assert.equal(sheet.getCell('D2').value, record.industryName);
  assert.equal(sheet.getCell('Z2').value, '0029723'); assert.equal(sheet.getCell('J2').value, '001234');
  assert.equal(sheet.getCell('Q2').value, '00123456789'); assert.equal(sheet.getCell('K2').value, 0);
  assert.equal(sheet.getCell('E2').value, 'First'); assert.equal(sheet.getCell('T2').value, 'Second');
  assert.equal(sheet.views[0].ySplit, 1); assert.equal(sheet.autoFilter, 'A1:AH1');
});
test('exports include saved draft and approved rows with parameterized filters independent of pagination', () => {
  const parsed = filterSchema.parse({ status: 'draft', search: "x' OR 1=1--", industry: 'Acme', page: '3', pageSize: '1' });
  const filter = whereFilter(parsed, true);
  assert.ok(filter.sql.includes("r.status<>'excluded'")); assert.ok(!filter.sql.includes("x'")); assert.ok(!filter.sql.includes('LIMIT'));
  assert.ok(filter.values.includes("%x' OR 1=1--%"));
  assert.ok(whereFilter(filterSchema.parse({})).sql.includes("r.status<>'excluded'"));
  assert.equal(filterSchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success, false);
});
test('template formatting and old rows cannot displace or leak into exported data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'industry-export-'));
  try {
    const templatePath = path.join(directory, 'template.xlsx');
    const template = new ExcelJS.Workbook(), sheet = template.addWorksheet('Records');
    sheet.addRow(fields.map(f => f.label));
    sheet.getRow(10).getCell(4).value = 'OLD RECORD';
    sheet.getRow(100).height = 20;
    await template.xlsx.writeFile(templatePath);
    const output = await buildWorkbook([{ ...blankRecord(), industryName: 'NEW RECORD' }], templatePath);
    const roundTrip = new ExcelJS.Workbook(); await roundTrip.xlsx.load(await output.xlsx.writeBuffer());
    assert.equal(roundTrip.worksheets[0].rowCount, 2);
    assert.equal(roundTrip.worksheets[0].getRow(2).getCell(4).value, 'NEW RECORD');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
