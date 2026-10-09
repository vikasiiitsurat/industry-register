import { parentPort, workerData } from 'node:worker_threads';
import { parseWord } from './parse-word.js';
try {
  parentPort.postMessage({ parsed: await parseWord(Buffer.from(workerData)) });
} catch (e) { parentPort.postMessage({ error: { status: e.status || 422, code: e.code || 'EXTRACTION_FAILED', message: e.status ? e.message : 'Cannot read this Word document. It may be damaged, encrypted, or unsupported.' } }); }
