import { Document, Packer, Paragraph, Table, TableRow, TableCell } from 'docx';
export const companyRows = [
  ['Company Name *', 'Fixture Industries (synthetic)'], ['Address', '12 Test Lane'], ['City', 'Pune'], ['State', 'Maharashtra'],
  ['Zip Code', '001234'], ['Latitude', '0'], ['Longitude', '73.8567'], ['Industry Classification', 'Micro'], ['Industry Colour Category', 'RED'],
  ['Industry Type', 'Manufacturing'], ['District', 'Pune'], ['Consent Number', '00089'],
  ['Contact Person Name', 'First Contact'], ['Contact Designation', 'Manager'], ['Mobile No.', '001234567890'], ['Email', 'first@example.com'],
  ['Contact Person Name', 'Second Contact'], ['Contact Designation', 'Engineer'], ['Mobile No.', '009876543210'], ['Email', 'second @example.com']
];
export const stationRows = [['Station Names', 'ETP_Outlet\nETP_Inlet'], ['SPCB Regional Office', 'Pune'], ['Falling under Ganga Basin', 'No'], ['Data logger serial number', '000045']];
export const parameterRows = [
  ['Parameter Full Name', 'Unit', 'Serial No.', 'Make', 'Model', 'Certification System Type', 'Permissible Standard', 'Device Range', 'Analyzer Technology'],
  ['Inlet Flow', 'm3/hr', '29723', 'Deewan', '', '', '0 to 100 m3/hr', '0 to 500 m3/hr', 'Ultrasonic'],
  ['Outlet Flow', 'm3/hr', '31423', 'Deewan', '', '', '0 to 80 m3/hr', '0 to 300 m3/hr', 'Ultrasonic']
];
export const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const htmlTable = rows => `<table>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value).replaceAll('\n','<br>')}</td>`).join('')}</tr>`).join('')}</table>`;
export function fixtureHtml(companyName) {
  const companies = companyRows.map(r => [...r]); if (companyName) companies[0][1] = companyName;
  return `<h2>Company Details</h2>${htmlTable(companies)}<h2>Station Details</h2>${htmlTable(stationRows)}<h2>Parameter Details</h2>${htmlTable(parameterRows)}`;
}
export async function fixtureDocx(companyName, revision = '') {
  const companies = companyRows.map(r => [...r]); if (companyName) companies[0][1] = companyName;
  const table = rows => new Table({ rows: rows.map(values => new TableRow({ children: values.map(value => new TableCell({ children: value.split('\n').map(text => new Paragraph(text)) })) })) });
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Company Details'), table(companies), new Paragraph('Station Details'), table(stationRows), new Paragraph('Parameter Details'), table(parameterRows), ...(revision ? [new Paragraph(revision)] : [])] }] }));
}
