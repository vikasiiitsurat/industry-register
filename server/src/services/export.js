import ExcelJS from 'exceljs';
import { fields } from '@industry/shared';
import { config } from '../config.js';
import { AppError } from '../errors.js';
export async function buildWorkbook(records, templatePath = config.templatePath) {
  const workbook = new ExcelJS.Workbook();
  let sheet;
  if (templatePath) {
    try { await workbook.xlsx.readFile(templatePath); } catch { throw new AppError(500, 'TEMPLATE_UNAVAILABLE', 'Cannot read EXCEL_TEMPLATE_PATH. Check the configured template file.'); }
    sheet = workbook.worksheets[0];
    if (!sheet || fields.some((f, i) => sheet.getRow(1).getCell(i + 1).text !== f.label) || sheet.columnCount !== 34) throw new AppError(422, 'TEMPLATE_SCHEMA_MISMATCH', 'The Excel template must have the exact 34 headers in its first row.');
    // Create a clean worksheet because templates can contain formatted or populated rows far below the header.
    const name = sheet.name;
    const widths = fields.map((_, i) => sheet.getColumn(i + 1).width);
    const styles = fields.map((_, i) => structuredClone(sheet.getRow(1).getCell(i + 1).style));
    const headerHeight = sheet.getRow(1).height;
    for (const existing of [...workbook.worksheets]) workbook.removeWorksheet(existing.id);
    sheet = workbook.addWorksheet(name);
    sheet.addRow(fields.map(f => f.label));
    sheet.getRow(1).height = headerHeight;
    fields.forEach((_, i) => { sheet.getColumn(i + 1).width = widths[i]; sheet.getRow(1).getCell(i + 1).style = styles[i]; });
  } else {
    sheet = workbook.addWorksheet('Industry records'); sheet.addRow(fields.map(f => f.label));
    sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F3B' } }; });
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.autoFilter = 'A1:AH1';
  sheet.getRow(1).height = Math.max(sheet.getRow(1).height || 0, 64);
  fields.forEach((f, i) => {
    sheet.getColumn(i + 1).width = sheet.getColumn(i + 1).width || (f.key === 'acceptableMeasurementRange' ? 38 : 24);
    sheet.getRow(1).getCell(i + 1).alignment = { vertical: 'middle', wrapText: true };
  });
  for (const record of records) {
    const row = sheet.addRow(fields.map(f => {
      const value = record[f.key] || '';
      return ['latitude','longitude'].includes(f.key) && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
    }));
    row.eachCell({ includeEmpty: true }, (cell, index) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      if (!['latitude','longitude'].includes(fields[index - 1].key)) cell.numFmt = '@';
    });
  }
  return workbook;
}
