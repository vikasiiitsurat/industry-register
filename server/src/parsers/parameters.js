import { AppError } from '../errors.js';

function splitValues(value, comma = true) {
  const parts = [];
  let current = '', depth = 0, quote = '';
  for (const character of String(value || '')) {
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && (character === ';' || character === '\n' || character === '\r' || (comma && character === ','))) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stationFor(parameter, stations) {
  const token = /\binlet\b/i.test(parameter) ? 'inlet' : /\boutlet\b/i.test(parameter) ? 'outlet' : '';
  const matches = token ? stations.filter(station => station.toLowerCase().replace(/_/g, ' ').split(/\W+/).includes(token)) : [];
  return matches.length === 1 ? matches[0] : '';
}

export function expandParameterRecords(records) {
  return records.flatMap(record => {
    const parameters = splitValues(record.data.parameter);
    if (parameters.length < 2) return [record];

    const parallel = {};
    for (const key of ['unitOfMeasurement', 'dataBroadcastFrequency', 'acceptableMeasurementRange', 'serialNo', 'deviceId']) {
      const value = record.data[key];
      if (!value) continue;
      // Commas are common inside numeric and descriptive values; use semicolons/newlines for paired columns.
      const parts = splitValues(value, false);
      if (parts.length === parameters.length) parallel[key] = parts;
      else if (parts.length > 1 && /[;\r\n]/.test(value)) {
        const location = record.source_reference.sheet ? `${record.source_reference.sheet}, row ${record.source_reference.row}` : `table ${record.source_reference.table}, row ${record.source_reference.row}`;
        throw new AppError(422, 'MISMATCHED_PARAMETER_VALUES', `${key} has ${parts.length} values but Parameter has ${parameters.length} at ${location}. Provide one shared value or one value per parameter.`);
      }
    }

    return parameters.map((parameter, index) => {
      const data = { ...record.data, parameter };
      for (const [key, values] of Object.entries(parallel)) data[key] = values[index];
      const metadata = { ...record.source_metadata, parameterExpansion: { original: record.data.parameter, index: index + 1, count: parameters.length } };
      if (Array.isArray(metadata.stations) && metadata.stations.length > 1 && !metadata.parameterExtras?.stationName && data.stationName === metadata.stationSuggestion) {
        metadata.stationSuggestion = stationFor(parameter, metadata.stations);
        data.stationName = metadata.stationSuggestion;
      }
      return { ...record, data, source_reference: { ...record.source_reference, parameterItem: index + 1, parameterCount: parameters.length }, source_metadata: metadata };
    });
  });
}
