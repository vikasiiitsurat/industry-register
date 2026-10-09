import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { blankRecord, keys } from '@industry/shared';
import { AppError } from '../errors.js';
import { expandParameterRecords } from './parameters.js';
export const normalize = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s*:：]+$/g, '').toLowerCase();
const aliases = {
  industryCategory: ['industry category'],
  industryCode: ['industry code', 'industry code (as assigned by cpcb)', 'cpcb industry code'],
  industryId: ['industry id', 'industry id (as maintained in your system)'],
  industryName: ['company name', 'name of company', 'industry name', 'name of industry'],
  address: ['address', 'company address'], city: ['city'], state: ['state'], zipCode: ['zip code', 'pin code', 'pincode', 'postal code'],
  latitude: ['latitude'], longitude: ['longitude'], spcbRegionalOffice: ['spcb regional office', 'regional office'],
  gangaBasin: ['falling under ganga basin', 'falling under ganga basin (yes/no)', 'ganga basin'],
  industryUsers: ['industry users'],
  industryContactName: ['industry contact name'], industryContactDesignation: ['industry contact designation'],
  industryMobile: ['industry mobile'], industryEmail: ['industry email'],
  name: ['contact person name', 'contact name', 'name of contact person'], designation: ['contact designation', 'contact person designation', 'designation'],
  mobile: ['contact (mobile number)', 'mobile no.', 'mobile no', 'mobile number', 'contact number', 'contact mobile'],
  email: ['email', 'email id', 'e-mail', 'email address'],
  stationId: ['station id', 'station id (as maintained in your system)'],
  stationName: ['station name', 'station names', 'name of station'],
  stationContactName: ['station contact name'], stationContactDesignation: ['station contact designation'],
  stationMobile: ['station mobile'], stationEmail: ['station email'],
  monitoringType: ['type (effluent/emission)', 'effluent/emission', 'monitoring type'],
  deviceId: ['device id'], vendor: ['vendor'],
  parameter: ['parameter full name', 'parameter name', 'parameter'], unitOfMeasurement: ['unit', 'unit of measurement', 'units'],
  serialNo: ['serial no.', 'serial no', 'serial number', 'serial no (as maintained in your system)', 'analyzer serial no.', 'analyser serial number'],
  make: ['make'], model: ['model'], certificationSystemType: ['certification system type', 'certification'],
  dataBroadcastFrequency: ['data broadcast frequency', 'broadcast frequency'],
  acceptableMeasurementRange: ['acceptable measurement range', 'acceptable measurement range (lower and upper bound with unit)'],
  permissibleStandard: ['permissible standard', 'permissible limit'], deviceRange: ['device range', 'measurement range'],
  analyzerTechnology: ['analyzer technology', 'analyser technology'], district: ['district'],
  classification: ['industry classification', 'classification', 'industry size'], colourCategory: ['industry colour category', 'industry color category', 'colour category', 'color category'],
  industryType: ['industry type', 'type of industry'], consentNumber: ['consent number', 'consent no.', 'consent no'],
  dataLoggerSerial: ['data logger serial number', 'data logger serial no.', 'data logger serial no']
};
const lookup = new Map(Object.entries(aliases).flatMap(([key, labels]) => labels.map(label => [normalize(label), key])));
export const keyFor = text => lookup.get(normalize(text).replace(/\s*\(?(?:1st|2nd|first|second|1|2)\)?$/i, '').trim());
const headingSection = text => {
  const s = normalize(text);
  if (s.length > 100) return null;
  if (/^(?:\d+[.\s):-]*)?(?:measurement )?parameter(?:s)?(?: details| information| section)?$/.test(s)) return 'parameter';
  if (/^(?:\d+[.\s):-]*)?station(?:s)?(?: details| information| section)?$/.test(s)) return 'station';
  if (/^(?:\d+[.\s):-]*)?(?:company|industry)(?: details| information| section)$/.test(s)) return 'company';
  return null;
};
export function parseTables(html, settings = {}) {
  const $ = cheerio.load(html);
  const company = {}, contacts = [], stationContacts = [], stations = [], parameters = [], rawTables = [], fieldSources = {};
  const extra = {}, warnings = [], signatures = [];
  let section = 'company', contact = null, stationContact = null, tableIndex = 0, currentParameter = null;
  function newParameter(source) { const p = { values: {}, source, fields: {} }; parameters.push(p); return p; }
  function assign(key, value, ref) {
    if (!value) return;
    if (['name', 'designation', 'mobile', 'email'].includes(key)) {
      const list = section === 'station' ? stationContacts : contacts;
      let c = section === 'station' ? stationContact : contact;
      if (!c || c[key]) { c = { source: ref }; list.push(c); }
      c[key] = value;
      if (section === 'station') stationContact = c; else contact = c;
    } else if (key === 'stationName') {
      for (const name of value.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) if (!stations.includes(name)) stations.push(name);
    } else if (key === 'parameter' || (section === 'parameter' && ['unitOfMeasurement', 'serialNo', 'vendor', 'make', 'model', 'certificationSystemType', 'deviceId', 'dataBroadcastFrequency', 'acceptableMeasurementRange', 'deviceRange', 'permissibleStandard', 'analyzerTechnology'].includes(key))) {
      if (!currentParameter || (key === 'parameter' && currentParameter.values.parameter)) currentParameter = newParameter(ref);
      currentParameter.values[key] = value; currentParameter.fields[key] = ref;
    } else if (['district', 'classification', 'colourCategory', 'industryType', 'consentNumber', 'dataLoggerSerial'].includes(key)) {
      extra[key] = value;
    } else {
      if (company[key] && company[key] !== value) warnings.push({ code: `conflict:${key}`, field: key, message: `More than one source value for ${key}. Verify the selected value against the source tables.` });
      else { company[key] = value; fieldSources[key] = ref; }
    }
  }
  $('body').find('h1,h2,h3,h4,p,table').each((_, element) => {
    if ($(element).parents('table').length) return;
    if (element.tagName !== 'table') { section = headingSection($(element).text()) || section; return; }
    const table = ++tableIndex;
    const rows = $(element).find('tr').filter((_, tr) => $(tr).closest('table')[0] === element).toArray().map(tr =>
      $(tr).children('td,th').toArray().map(cell => {
        const clone = $(cell).clone(); clone.find('br').replaceWith('\n'); clone.find('p').append('\n');
        return clone.text().replace(/\u00a0/g, ' ').trim();
      }));
    rawTables.push({ table, rows });
    let header = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], ref = { table, row: i + 1 };
      const heading = row.filter(Boolean).length === 1 ? headingSection(row.find(Boolean)) : null;
      if (heading) { section = heading; header = null; continue; }
      const mapped = row.map(keyFor);
      if (mapped.includes('parameter') && mapped.filter(Boolean).length >= 2 && mapped.includes('unitOfMeasurement')) {
        section = 'parameter'; header = mapped; signatures.push(`parameter:${mapped.join(',')}`); continue;
      }
      if (header) {
        if (row.every(v => !v.trim())) continue;
        const p = newParameter(ref);
        header.forEach((key, j) => { if (key) { p.values[key] = row[j] || ''; p.fields[key] = { ...ref, column: j + 1 }; } });
        if (!p.values.parameter) warnings.push({ code: `parameter:missing:${table}:${i}`, message: `Parameter table ${table}, row ${i + 1} has no parameter name. Complete or exclude it.` });
        continue;
      }
      for (let j = 0; j < row.length - 1; j++) {
        const key = keyFor(row[j]);
        if (!key) continue;
        // Only adjacent label/value pairs; never match values by global document order.
        assign(key, row[j + 1], { ...ref, column: j + 2 }); signatures.push(`${section}:${key}`); j++;
      }
    }
  });
  if (!parameters.length || !company.industryName) {
    const imageOnly = !$('body').text().trim() && $('img').length;
    throw new AppError(422, imageOnly ? 'IMAGE_ONLY_DOCUMENT' : 'UNSUPPORTED_LAYOUT', imageOnly ? 'This document contains only images. OCR is not supported; provide a Word document with editable tables.' : 'Unsupported document layout. Expected a company name and a parameter table (parameter name and unit columns), or labeled parameter blocks. No records were imported.');
  }
  const layoutId = `tables-v1-${createHash('sha256').update([...new Set(signatures)].sort().join('|')).digest('hex').slice(0, 16)}`;
  return { layoutId, records: expandParameterRecords(parameters.map(p => {
    const data = { ...blankRecord(), ...company };
    const primary = contacts[0];
    if (primary) Object.assign(data, { industryContactName: primary.name || '', industryContactDesignation: primary.designation || '', industryMobile: primary.mobile || '', industryEmail: primary.email || '' });
    for (const key of keys) if (p.values[key] !== undefined) data[key] = p.values[key] || '';
    const stationContact = stationContacts[0];
    if (stationContact) Object.assign(data, { stationContactName: stationContact.name || '', stationContactDesignation: stationContact.designation || '', stationMobile: stationContact.mobile || '', stationEmail: stationContact.email || '' });
    if (!data.acceptableMeasurementRange) data.acceptableMeasurementRange = p.values.deviceRange || '';
    const token = /\binlet\b/i.test(data.parameter) ? 'inlet' : /\boutlet\b/i.test(data.parameter) ? 'outlet' : '';
    const candidates = token ? stations.filter(s => normalize(s).replace(/_/g, ' ').split(/\W+/).includes(token)) : [];
    if (!data.stationName) data.stationName = stations.length === 1 ? stations[0] : candidates.length === 1 ? candidates[0] : '';
    const sourceWarnings = [...warnings];
    contacts.forEach((c, index) => { if (c.email && /\s/.test(c.email)) sourceWarnings.push({ code: `source:email:${index}`, message: `Source company contact ${index + 1} email contains whitespace: ${c.email}. Correct it if selected, or acknowledge that this unused source value was reviewed.` }); });
    return { data, source_reference: { ...p.source, fields: { ...fieldSources, ...p.fields } }, source_metadata: {
      layoutId, companyExtras: extra, contacts, stationContacts, stations,
      stationSuggestion: candidates.length === 1 ? candidates[0] : '', parameterExtras: p.values,
      tables: rawTables, warnings: sourceWarnings
    } };
  })) };
}
export function applySettings(parsed, settings) {
  for (const record of parsed.records) {
    const { data, source_metadata: m } = record;
    if (settings.categorySource) data.industryCategory = m.companyExtras[settings.categorySource] || '';
    if (settings.rangeSource) data.acceptableMeasurementRange = m.parameterExtras[settings.rangeSource] || '';
    const c = m.contacts[settings.stationContact === 'first' ? 0 : settings.stationContact === 'second' ? 1 : -1];
    if (c) Object.assign(data, { stationContactName: c.name || '', stationContactDesignation: c.designation || '', stationMobile: c.mobile || '', stationEmail: c.email || '' });
    const station = settings.stationByParameter?.[data.parameter];
    if (station && m.stations.includes(station)) data.stationName = station;
    m.appliedSettings = settings;
  }
  return parsed;
}
