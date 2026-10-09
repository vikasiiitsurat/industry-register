import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { fields, blankRecord } from '@industry/shared';
import { AppError } from '../errors.js';
import { keyFor, normalize } from './tables.js';
import { expandParameterRecords } from './parameters.js';

const duplicateKeys = {
  name: ['industryContactName', 'stationContactName'],
  designation: ['industryContactDesignation', 'stationContactDesignation'],
  mobile: ['industryMobile', 'stationMobile'],
  email: ['industryEmail', 'stationEmail']
};

function headerColumns(row) {
  if (fields.every((field, index) => normalize(row.getCell(index + 1).text) === normalize(field.label)))
    return fields.map((field, index) => ({ key: field.key, column: index + 1 }));

  const seen = {}, mapped = [];
  for (let column = 1; column <= Math.min(row.cellCount, 256); column++) {
    const label = normalize(row.getCell(column).text);
    const alias = keyFor(label);
    if (!alias) continue;
    let key = alias;
    if (duplicateKeys[alias]) {
      const index = seen[alias] || 0;
      key = duplicateKeys[alias][Math.min(index, 1)];
      if (alias === 'email' && label === 'email id') key = 'stationEmail';
      if (alias === 'mobile' && /^mobile no\.?$/.test(label)) key = 'stationMobile';
      seen[alias] = index + 1;
    }
    if (!mapped.some(entry => entry.key === key)) mapped.push({ key, column });
  }
  return mapped;
}

function cellText(cell) {
  let value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().replace(/T00:00:00\.000Z$/, '');
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) value = value.result;
    else if ('richText' in value) value = value.richText.map(part => part.text).join('');
    else if ('text' in value) value = value.text;
    else return '';
  }
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isInteger(value) && /^0{2,}$/.test(cell.numFmt || ''))
    return String(value).padStart(cell.numFmt.length, '0');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).trim();
}

export async function parseSpreadsheet(buffer, { signal } = {}) {
  if (signal?.aborted) throw new AppError(408, 'FILE_TIMEOUT', 'Spreadsheet processing timed out. Re-upload to retry.');
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new AppError(422, 'INVALID_XLSX', 'Cannot read this Excel workbook. Use a valid, unprotected .xlsx file.'); }

  const records = [], signatures = [];
  for (const [index, sheet] of workbook.worksheets.entries()) {
    if (sheet.state !== 'visible') continue;
    let header = null;
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber++) {
      const columns = headerColumns(sheet.getRow(rowNumber));
      if (columns.length >= 2 && columns.some(entry => entry.key === 'industryName' || entry.key === 'parameter') && (!header || columns.length > header.columns.length))
        header = { rowNumber, columns };
    }
    if (!header) continue;
    signatures.push(header.columns.map(entry => entry.key).join(','));
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= header.rowNumber) return;
      if (signal?.aborted) throw new AppError(408, 'FILE_TIMEOUT', 'Spreadsheet processing timed out. Re-upload to retry.');
      const data = blankRecord(), sourceFields = {};
      for (const { key, column } of header.columns) {
        const value = cellText(row.getCell(column));
        if (value && !data[key]) {
          data[key] = value;
          sourceFields[key] = { sheet: sheet.name, row: rowNumber, column };
        }
      }
      if (!Object.values(data).some(Boolean)) return;
      // Skip a repeated header in the middle of a worksheet.
      if (header.columns.filter(({ key }) => normalize(data[key]) === normalize(fields.find(field => field.key === key)?.label)).length >= 2) return;
      records.push({ data, source_reference: { sheet: sheet.name, sheetIndex: index + 1, row: rowNumber, fields: sourceFields },
        source_metadata: { sheet: sheet.name, headerRow: header.rowNumber, warnings: [] } });
    });
  }
  if (!signatures.length) throw new AppError(422, 'UNSUPPORTED_SPREADSHEET', 'No worksheet has recognizable column headers. Add a header row such as Industry Name, Parameter, and Unit of Measurement.');
  if (!records.length) throw new AppError(422, 'EMPTY_SPREADSHEET', 'The Excel workbook has recognizable headers but no populated data rows.');
  const layoutId = `excel-v1-${createHash('sha256').update([...new Set(signatures)].sort().join('|')).digest('hex').slice(0, 16)}`;
  for (const record of records) record.source_metadata.layoutId = layoutId;
  return { layoutId, records: expandParameterRecords(records) };
}
