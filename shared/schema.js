// The only ordered definition of the business schema. Display headers intentionally repeat.
export const fields = [
  ['industryCategory', 'Industry Category', 'Industry'],
  ['industryCode', 'Industry Code (as assigned by CPCB)', 'Industry'],
  ['industryId', 'Industry Id (as maintained in your system)', 'Industry'],
  ['industryName', 'Industry Name', 'Industry'],
  ['industryContactName', 'Contact Person Name', 'Industry contact'],
  ['industryContactDesignation', 'Contact Person Designation', 'Industry contact'],
  ['address', 'Address', 'Industry'], ['city', 'City', 'Industry'], ['state', 'State', 'Industry'],
  ['zipCode', 'Zip Code', 'Industry'], ['latitude', 'Latitude', 'Industry'], ['longitude', 'Longitude', 'Industry'],
  ['spcbRegionalOffice', 'SPCB Regional Office', 'Station'],
  ['gangaBasin', 'Falling under Ganga Basin (Yes/No)', 'Station'],
  ['industryUsers', 'Industry Users', 'Industry contact'], ['industryEmail', 'Email', 'Industry contact'],
  ['industryMobile', 'Contact (mobile number)', 'Industry contact'],
  ['stationId', 'Station ID (as maintained in your system)', 'Station'], ['stationName', 'Station Name', 'Station'],
  ['stationContactName', 'Contact Person Name', 'Station contact'],
  ['stationContactDesignation', 'Contact Person Designation', 'Station contact'],
  ['stationMobile', 'Mobile No.', 'Station contact'], ['stationEmail', 'Email Id', 'Station contact'],
  ['monitoringType', 'Type (Effluent/Emission)', 'Station'], ['deviceId', 'Device ID', 'Device'],
  ['serialNo', 'Serial No (as maintained in your system)', 'Device'], ['vendor', 'Vendor', 'Device'],
  ['make', 'Make', 'Device'], ['model', 'Model', 'Device'],
  ['certificationSystemType', 'Certification System Type', 'Device'], ['parameter', 'Parameter', 'Measurement'],
  ['unitOfMeasurement', 'Unit of Measurement', 'Measurement'],
  ['dataBroadcastFrequency', 'Data Broadcast Frequency', 'Measurement'],
  ['acceptableMeasurementRange', 'Acceptable measurement range (Lower and Upper bound with unit)', 'Measurement']
].map(([key, label, group]) => ({ key, label, group }));
export const keys = fields.map(f => f.key);
export const groups = [...new Set(fields.map(f => f.group))];
export const blankRecord = () => Object.fromEntries(keys.map(k => [k, '']));
export const PARSER_VERSION = '1.2.0';
