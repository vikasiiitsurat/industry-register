import { createHash, randomUUID } from 'node:crypto';
import { keys, PARSER_VERSION } from '@industry/shared';
import { transaction } from '../db/pool.js';
import { parseDocument } from '../parsers/document.js';
import { applySettings } from '../parsers/tables.js';
import { validateRecord } from '../validation/records.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
export async function importFile(db, file, batchId, signal, parser = parseDocument) {
  const hash = createHash('sha256').update(file.buffer).digest('hex');
  const result = await db.query(`INSERT INTO imports(id,batch_id,original_filename,content_hash,status,parser_version)
    VALUES($1,$2,$3,$4,'processing',$5) ON CONFLICT(content_hash) DO UPDATE
    SET batch_id=EXCLUDED.batch_id,original_filename=EXCLUDED.original_filename,status='processing',error_details=NULL,updated_at=now(),parser_version=EXCLUDED.parser_version
    WHERE imports.status IN ('failed','retry_required') RETURNING id`, [randomUUID(), batchId, file.originalname, hash, PARSER_VERSION]);
  if (!result.rowCount) {
    const previous = (await db.query('SELECT id,status,record_count FROM imports WHERE content_hash=$1', [hash])).rows[0];
    return { filename: file.originalname, status: 'duplicate', importId: previous.id, recordCount: previous.record_count, message: previous.status === 'processing' ? 'This file is already being processed.' : 'Identical file content has already been imported, even if the filename differs.' };
  }
  const id = result.rows[0].id;
  const check = () => { if (signal.aborted) throw new AppError(408, 'FILE_TIMEOUT', 'Processing timed out. Re-upload this document to retry.'); };
  try {
    check();
    const parsed = await parser(file.buffer, file.originalname, { signal });
    check();
    if (parsed.layoutId.startsWith('tables-v1-')) {
      const savedSettings = (await db.query('SELECT settings FROM mapping_settings WHERE layout_id=$1', [parsed.layoutId])).rows[0]?.settings || {};
      applySettings(parsed, savedSettings);
    }
    await transaction(db, async c => {
      await c.query("SET LOCAL statement_timeout = '15000ms'");
      for (const [index, record] of parsed.records.entries()) {
        check();
        const { data, source_reference, source_metadata } = record;
        const issues = validateRecord(data, source_metadata);
        const columns = ['id', 'import_id', 'status', 'source_order', ...keys, 'source_reference', 'source_metadata', 'issues'];
        const values = [randomUUID(), id, 'approved', index + 1, ...keys.map(k => data[k]), JSON.stringify(source_reference), JSON.stringify(source_metadata), JSON.stringify(issues)];
        await c.query(`INSERT INTO records(${columns.map(k => `"${k}"`).join(',')}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')})`, values);
      }
      check();
      await c.query("UPDATE imports SET status='completed',record_count=$2,layout_id=$3,error_details=NULL,updated_at=now() WHERE id=$1", [id, parsed.records.length, parsed.layoutId]);
      check();
    });
    return { filename: file.originalname, status: 'success', importId: id, recordCount: parsed.records.length, message: `${parsed.records.length} records saved and ready for Excel download.` };
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'Import failed. Check database connectivity and retry by re-uploading.';
    await db.query("UPDATE imports SET status='failed',error_details=$2,updated_at=now() WHERE id=$1 AND status='processing'", [id, message]);
    return { filename: file.originalname, status: 'failed', importId: id, recordCount: 0, code: e.code || 'IMPORT_FAILED', message };
  }
}
export async function processBatch(db, files, parser) {
  const id = randomUUID();
  await db.query('INSERT INTO import_batches(id) VALUES($1)', [id]);
  const batchController = new AbortController();
  const timer = setTimeout(() => batchController.abort(), config.batchTimeout);
  const results = new Array(files.length); let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(config.concurrency, files.length) }, async () => {
      while (next < files.length) {
        const index = next++, controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.fileTimeout);
        const abort = () => controller.abort(); batchController.signal.addEventListener('abort', abort);
        if (batchController.signal.aborted) controller.abort();
        try { results[index] = await importFile(db, files[index], id, controller.signal, parser); }
        finally { clearTimeout(timeout); batchController.signal.removeEventListener('abort', abort); }
      }
    }));
    await db.query("UPDATE import_batches SET status='completed',completed_at=now() WHERE id=$1", [id]);
    return { batchId: id, results };
  } finally { clearTimeout(timer); }
}
