import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseTables, applySettings, normalize } from '../src/parsers/tables.js';
import { parseDocument } from '../src/parsers/document.js';
import { convertDoc, findLibreOffice } from '../src/services/libreoffice.js';
import { validateRecord, dataSchema } from '../src/validation/records.js';
import { fields, keys } from '@industry/shared';
import { fixtureHtml, fixtureDocx } from './fixtures.js';

test('shared schema has exactly 34 ordered, unique internal keys and repeated display headers', () => {
  assert.equal(keys.length, 34); assert.equal(new Set(keys).size, 34);
  assert.equal(fields[4].label, fields[19].label); assert.notEqual(fields[4].key, fields[19].key);
  assert.equal(fields[33].key, 'acceptableMeasurementRange');
});
test('table extraction preserves company, two parameters, separate contacts and source positions', () => {
  const { records } = parseTables(fixtureHtml());
  assert.equal(records.length, 2);
  assert.equal(records[0].data.industryName, 'Fixture Industries (synthetic)');
  assert.equal(records[0].data.zipCode, '001234'); assert.equal(records[0].data.latitude, '0');
  assert.equal(records[0].data.industryContactDesignation, 'Manager');
  assert.equal(records[0].source_metadata.contacts[1].designation, 'Engineer');
  assert.equal(records[0].source_metadata.contacts[1].email, 'second @example.com');
  assert.deepEqual(records.map(r => [r.data.parameter, r.data.serialNo, r.data.make, r.data.unitOfMeasurement]), [['Inlet Flow','29723','Deewan','m3/hr'],['Outlet Flow','31423','Deewan','m3/hr']]);
  assert.equal(records[0].source_reference.table, 3); assert.equal(records[0].source_reference.row, 2);
  assert.equal(records[1].source_reference.row, 3);
});
test('station names and device ranges map automatically when the source is unambiguous', () => {
  const parsed = parseTables(fixtureHtml());
  assert.deepEqual(parsed.records.map(r => r.source_metadata.stationSuggestion), ['ETP_Inlet','ETP_Outlet']);
  assert.deepEqual(parsed.records.map(r => r.data.stationName), ['ETP_Inlet','ETP_Outlet']);
  assert.deepEqual(parsed.records.map(r => r.data.acceptableMeasurementRange), ['0 to 500 m3/hr','0 to 300 m3/hr']);
  for (const { data, source_metadata } of parsed.records) {
    for (const key of ['stationContactName','industryCategory','industryCode','industryId','stationId','deviceId','vendor','industryUsers','dataBroadcastFrequency','monitoringType']) assert.equal(data[key], '', key);
    assert.ok(source_metadata.parameterExtras.deviceRange); assert.ok(source_metadata.parameterExtras.permissibleStandard);
    assert.equal(source_metadata.companyExtras.classification, 'Micro'); assert.equal(source_metadata.companyExtras.colourCategory, 'RED');
  }
});
test('explicit mapping settings apply source choices and validate selected contact email', () => {
  const parsed = applySettings(parseTables(fixtureHtml()), { categorySource: 'colourCategory', stationContact: 'second', rangeSource: 'deviceRange', stationByParameter: { 'Inlet Flow': 'ETP_Inlet', 'Outlet Flow': 'MissingStation' } });
  assert.equal(parsed.records[0].data.industryCategory, 'RED');
  assert.equal(parsed.records[0].data.stationName, 'ETP_Inlet'); assert.equal(parsed.records[1].data.stationName, 'ETP_Outlet');
  assert.equal(parsed.records[0].data.stationEmail, 'second @example.com');
  assert.ok(validateRecord(parsed.records[0].data).some(i => i.code === 'invalid:stationEmail'));
});
test('requested Word labels map into distinct industry, station, device and measurement columns', () => {
  const html = `<h2>Industry Details</h2><table>
    <tr><td>Industry Category</td><td>Red</td></tr><tr><td>Industry Code (as assigned by CPCB)</td><td>0009</td></tr>
    <tr><td>Industry Id (as maintained in your system)</td><td>IND-01</td></tr><tr><td>Industry Name</td><td>Demo Works</td></tr>
    <tr><td>Contact Person Name</td><td>Industry Contact</td></tr><tr><td>Email</td><td>industry@example.com</td></tr>
    <tr><td>Industry Users</td><td>2</td></tr></table>
    <h2>Station Details</h2><table><tr><td>Station ID (as maintained in your system)</td><td>ST-01</td></tr>
    <tr><td>Station Name</td><td>Main outlet</td></tr><tr><td>Contact Person Name</td><td>Station Contact</td></tr>
    <tr><td>Email Id</td><td>station@example.com</td></tr><tr><td>Type (Effluent/Emission)</td><td>Effluent</td></tr>
    <tr><td>Device ID</td><td>DEV-01</td></tr><tr><td>Vendor</td><td>Vendor A</td></tr></table>
    <h2>Parameter Details</h2><table><tr><td>Parameter</td><td>Flow</td></tr><tr><td>Unit of Measurement</td><td>m3/hr</td></tr>
    <tr><td>Serial No (as maintained in your system)</td><td>000123</td></tr><tr><td>Data Broadcast Frequency</td><td>15 min</td></tr>
    <tr><td>Acceptable measurement range (Lower and Upper bound with unit)</td><td>0 to 100 m3/hr</td></tr></table>`;
  const [record] = parseTables(html).records;
  assert.equal(record.data.industryCategory, 'Red'); assert.equal(record.data.industryCode, '0009');
  assert.equal(record.data.industryId, 'IND-01'); assert.equal(record.data.industryContactName, 'Industry Contact');
  assert.equal(record.data.industryEmail, 'industry@example.com'); assert.equal(record.data.industryUsers, '2');
  assert.equal(record.data.stationId, 'ST-01'); assert.equal(record.data.stationName, 'Main outlet');
  assert.equal(record.data.stationContactName, 'Station Contact'); assert.equal(record.data.stationEmail, 'station@example.com');
  assert.equal(record.data.monitoringType, 'Effluent'); assert.equal(record.data.deviceId, 'DEV-01');
  assert.equal(record.data.vendor, 'Vendor A'); assert.equal(record.data.serialNo, '000123');
  assert.equal(record.data.dataBroadcastFrequency, '15 min'); assert.equal(record.data.acceptableMeasurementRange, '0 to 100 m3/hr');
});
test('normalizes label whitespace, case, line breaks and trailing stars', () => {
  assert.equal(normalize('  Contact\n Designation *  '), 'contact designation');
  assert.equal(parseTables(fixtureHtml().replace('Company Name *', '  COMPANY\n NAME ***  ')).records[0].data.industryName, 'Fixture Industries (synthetic)');
});
test('unsupported and image-only documents report actionable errors', () => {
  assert.throws(() => parseTables('<p>Hello</p>'), { code: 'UNSUPPORTED_LAYOUT' });
  assert.throws(() => parseTables('<img src=""/>'), { code: 'IMAGE_ONLY_DOCUMENT' });
});
test('multiple parameters may have the same serial without collapsing rows', () => {
  const parsed = parseTables(fixtureHtml().replace('31423','29723'));
  assert.equal(parsed.records.length, 2); assert.equal(parsed.records[1].data.serialNo, '29723');
});
test('one Word parameter cell with a list creates one record per parameter', () => {
  const parsed = parseTables(fixtureHtml().replace('Inlet Flow', 'Inlet Flow, Outlet Flow'));
  assert.equal(parsed.records.length, 3);
  assert.deepEqual(parsed.records.slice(0, 2).map(record => [record.data.parameter, record.data.stationName]),
    [['Inlet Flow', 'ETP_Inlet'], ['Outlet Flow', 'ETP_Outlet']]);
});
test('actual DOCX buffer travels through Mammoth and extraction', async () => {
  const parsed = await parseDocument(await fixtureDocx(), 'test.docx');
  assert.equal(parsed.records.length, 2); assert.equal(parsed.records[0].data.serialNo, '29723');
  assert.equal(parsed.records[0].source_metadata.stations.length, 2);
});
test('optional local parser worker remains usable', async () => {
  const parsed = await parseDocument(await fixtureDocx(), 'test.docx', { inProcess: false });
  assert.equal(parsed.records.length, 2);
});
test('fake extensions, encrypted/damaged packages and aborted work are rejected', async () => {
  await assert.rejects(parseDocument(Buffer.from('hello'), 'bad.doc'), { code: 'INVALID_DOC' });
  await assert.rejects(parseDocument(Buffer.from('hello'), 'bad.docx'), { code: 'INVALID_DOCX' });
  await assert.rejects(parseDocument(Buffer.from('PKbad'), 'bad.docx'), { code: 'EXTRACTION_FAILED' });
  await assert.rejects(parseDocument(await fixtureDocx(), 'test.docx', { signal: AbortSignal.abort() }), { code: 'FILE_TIMEOUT' });
});
test('conversion failures remove unique temporary directory even for executable paths with spaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'industry-test-'));
  try {
    await assert.rejects(convertDoc(Buffer.from('fixture'), { root, executable: path.join(root, 'Missing Office', 'soffice.exe') }), { code: 'CONVERSION_FAILED' });
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('legacy DOC without LibreOffice returns a specific, actionable error', async t => {
  if (await findLibreOffice()) return t.skip('LibreOffice is installed; missing-installation check is not applicable.');
  await assert.rejects(parseDocument(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'legacy.doc'), e => e.code === 'LIBREOFFICE_MISSING' && e.message.includes('Save As .docx'));
});
test('in-flight worker cancellation terminates extraction', async () => {
  const controller = new AbortController(), buffer = await fixtureDocx();
  const pending = parseDocument(buffer, 'cancel.docx', { signal: controller.signal, inProcess: false });
  controller.abort(); await assert.rejects(pending, { code: 'FILE_TIMEOUT' });
});
test('approval distinguishes zero/missing, validates ranges and cannot waive core identity or invalid emails', () => {
  const record = parseTables(fixtureHtml()).records[0];
  const d = { ...record.data, stationName: 'ETP_Inlet', acceptableMeasurementRange: '100 to 0 m3/hr', latitude: '91', longitude: '-181', gangaBasin: 'maybe' };
  let issues = validateRecord(d, record.source_metadata, { acceptedBlanks: keys, acknowledged: ['source:email:1'] });
  for (const code of ['invalid:range','invalid:latitude','invalid:longitude','invalid:gangaBasin']) assert.ok(issues.some(i => i.code === code));
  Object.assign(d, { acceptableMeasurementRange: '0 to 100 m3/hr', latitude: '0', longitude: '0', gangaBasin: 'No' });
  assert.equal(validateRecord(d, record.source_metadata, { acceptedBlanks: keys, acknowledged: ['source:email:1'] }).length, 0);
  d.industryName = ''; assert.ok(validateRecord(d, {}, { acceptedBlanks: keys }).some(i => i.code === 'identity:industry'));
  assert.equal(dataSchema.safeParse({ ...d, zipCode: 123 }).success, false);
});
