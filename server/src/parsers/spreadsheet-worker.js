import { parentPort, workerData } from 'node:worker_threads';
import { parseSpreadsheet } from './spreadsheet.js';

try { parentPort.postMessage({ parsed: await parseSpreadsheet(Buffer.from(workerData)) }); }
catch (e) { parentPort.postMessage({ error: { status: e.status || 422, code: e.code || 'EXTRACTION_FAILED', message: e.status ? e.message : 'Cannot read this Excel workbook. It may be damaged, protected, or unsupported.' } }); }
