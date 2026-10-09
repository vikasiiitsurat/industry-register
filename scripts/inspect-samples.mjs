import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { fields } from '@industry/shared';
import { parseDocument } from '../server/src/parsers/document.js';
const directory = new URL('../samples/', import.meta.url);
const names = (await readdir(directory)).filter(name => /\.(docx?|xlsx)$/i.test(name));
if (!names.length) { console.error('No Word sample or Excel template supplied in samples/. Add the original files; suffixes in filenames are supported.'); process.exitCode = 1; }
for (const filename of names) {
  const data = await readFile(new URL(filename, directory));
  console.log(`\n${filename} (${data.length} bytes)`);
  if (/\.xlsx$/i.test(filename)) {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(data);
    for (const sheet of book.worksheets) {
      const headers = sheet.getRow(1).values.slice(1);
      let populatedRows = 0; sheet.eachRow(row => { if (row.number > 1 && row.actualCellCount) populatedRows++; });
      console.log(JSON.stringify({ sheet: sheet.name, headers, populatedRows, matchesRequiredSchema: headers.length === 34 && headers.every((h, i) => h === fields[i].label) }, null, 2));
    }
  } else {
    console.log(`Legacy compound file signature: ${data.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'}`);
    try { const parsed = await parseDocument(data, filename); console.log(JSON.stringify({ layoutId: parsed.layoutId, records: parsed.records.map(r => ({ industry: r.data.industryName, parameter: r.data.parameter, serial: r.data.serialNo, make: r.data.make, unit: r.data.unitOfMeasurement, stations: r.source_metadata.stations, suggestedStation: r.source_metadata.stationSuggestion })) }, null, 2)); }
    catch (e) { console.error(`${e.code}: ${e.message}`); process.exitCode = 1; }
  }
}
