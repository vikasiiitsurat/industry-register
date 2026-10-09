import { Worker } from 'node:worker_threads';
// Keep worker dependencies in the Express function's static import graph for deployment tracing.
import 'mammoth';
import './tables.js';
import './spreadsheet.js';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { convertDoc, convertXls, findLibreOffice } from '../services/libreoffice.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
const wordWorkerUrl = new URL('./worker.js', import.meta.url);
const spreadsheetWorkerUrl = new URL('./spreadsheet-worker.js', import.meta.url);

export async function workerFilesAvailable() {
  try {
    await Promise.all([access(fileURLToPath(wordWorkerUrl)), access(fileURLToPath(spreadsheetWorkerUrl))]);
    return true;
  } catch { return false; }
}

export async function parseDocument(buffer, filename, { signal, findOffice = findLibreOffice } = {}) {
  const ext = path.extname(filename).toLowerCase();
  if (!['.doc', '.docx', '.xls', '.xlsx'].includes(ext)) throw new AppError(415, 'UNSUPPORTED_FILE', 'Only .doc, .docx, .xls, and .xlsx files are accepted.');
  const spreadsheet = ext === '.xls' || ext === '.xlsx';
  if (ext === '.doc') {
    if (buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new AppError(422, 'INVALID_DOC', 'The .doc file is not a legacy Word compound document. Use Save As in Word to create a valid .docx.');
    const executable = await findOffice();
    if (!executable) throw new AppError(422, 'LEGACY_UNAVAILABLE', 'This server cannot convert .doc files because LibreOffice is unavailable. Open the file in Word or LibreOffice and Save As .docx, then upload it again. Renaming the file is not enough.');
    buffer = await convertDoc(buffer, { signal, executable });
  }
  if (ext === '.xls') {
    if (buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new AppError(422, 'INVALID_XLS', 'This is not a legacy Excel workbook. Use Save As .xlsx in Excel; do not rename extensions.');
    const executable = await findOffice();
    if (!executable) throw new AppError(422, 'LEGACY_UNAVAILABLE', 'This server cannot convert .xls files because LibreOffice is unavailable. Open the file in Excel or LibreOffice and Save As .xlsx, then upload it again. Renaming the file is not enough.');
    buffer = await convertXls(buffer, { signal, executable });
  }
  if (buffer.subarray(0, 2).toString() !== 'PK') throw spreadsheet
    ? new AppError(422, 'INVALID_XLSX', 'This is not a valid XLSX workbook. Use Save As .xlsx in Excel; do not rename extensions.')
    : new AppError(422, 'INVALID_DOCX', 'This is not a valid DOCX package. Use Save As in Word; do not rename extensions.');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError(408, 'FILE_TIMEOUT', 'Processing timed out. Re-upload the document to retry.'));
    const worker = new Worker(spreadsheet ? spreadsheetWorkerUrl : wordWorkerUrl, { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let finished = false;
    const finish = async (error, value) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); await worker.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new AppError(408, 'FILE_TIMEOUT', 'Processing timed out. Re-upload the document to retry.'));
    const timer = setTimeout(abort, config.fileTimeout); signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', m => m.error ? finish(new AppError(m.error.status, m.error.code, m.error.message)) : finish(null, m.parsed));
    worker.once('error', () => finish(new AppError(422, 'EXTRACTION_FAILED', 'File processing failed or exceeded memory limits.')));
    worker.once('exit', code => { if (!finished) finish(new AppError(422, 'EXTRACTION_FAILED', `Document parser stopped (${code}).`)); });
  });
}
