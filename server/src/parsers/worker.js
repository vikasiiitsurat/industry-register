import { parentPort, workerData } from 'node:worker_threads';
import mammoth from 'mammoth';
import { parseTables } from './tables.js';
try {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(workerData) }, { externalFileAccess: false, convertImage: mammoth.images.imgElement(() => ({ src: '' })) });
  const parsed = parseTables(result.value);
  parentPort.postMessage({ parsed });
} catch (e) { parentPort.postMessage({ error: { status: e.status || 422, code: e.code || 'EXTRACTION_FAILED', message: e.status ? e.message : 'Cannot read this Word document. It may be damaged, encrypted, or unsupported.' } }); }
