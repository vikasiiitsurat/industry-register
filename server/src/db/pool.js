import pg from 'pg';
import { config } from '../config.js';
export const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3000, max: 8 });
pool.on('error', error => console.error('Database connection error:', error.code || 'unavailable'));
export async function transaction(db, fn) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
