import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { config } from './config.js';
import { AppError } from './errors.js';
let lockClient, readyPromise;
async function initialize() {
  if (!config.databaseUrl) throw new AppError(503, 'DATABASE_NOT_CONFIGURED', 'Set DATABASE_URL in server/.env, start PostgreSQL and run npm run db:migrate.');
  if (lockClient) return;
  if (!readyPromise) readyPromise = (async () => {
    const c = await pool.connect();
    try {
      const locked = (await c.query('SELECT pg_try_advisory_lock(72834012) AS locked')).rows[0].locked;
      if (!locked) throw new AppError(409, 'SERVER_ALREADY_RUNNING', 'Another application server is using this database. Stop that instance first.');
      await c.query("UPDATE imports SET status='retry_required',error_details='Processing was interrupted. Original files are not retained; re-upload to retry.',updated_at=now() WHERE status='processing'");
      await c.query("UPDATE import_batches SET status='retry_required' WHERE status='processing'");
      lockClient = c;
      c.on('error', () => { console.error('Database session lost. Restart the server.'); process.exit(1); });
    } catch (e) { c.release(true); throw e; }
  })().finally(() => { readyPromise = null; });
  return readyPromise;
}
try { await initialize(); } catch (e) { console.error('Database setup needed:', e.code || e.message); }
const server = createApp(pool, { ensureReady: initialize }).listen(config.port, config.host, () => console.log(`Industry Register: http://${config.host}:${config.port}`));
server.requestTimeout = config.batchTimeout + config.fileTimeout + 30000;
async function shutdown() {
  server.close(async () => { if (lockClient) lockClient.release(true); await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
