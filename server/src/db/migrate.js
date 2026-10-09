import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, transaction } from './pool.js';
export async function migrate(db = pool) {
  const dir = new URL('./migrations/', import.meta.url);
  await transaction(db, async c => {
    await c.query('SELECT pg_advisory_xact_lock(72834011)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await c.query(await readFile(new URL(name, dir), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await migrate(); console.log('Database migrations applied.'); }
  catch (e) { console.error('Migration failed. Check DATABASE_URL and that PostgreSQL is running.', e.code || e.message); process.exitCode = 1; }
  finally { await pool.end(); }
}
