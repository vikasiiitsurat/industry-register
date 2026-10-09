import { pool } from '../db/pool.js';
import { upgradeExistingParameterRows } from '../services/parameter-upgrade.js';

const lockClient = await pool.connect();
try {
  const locked = (await lockClient.query('SELECT pg_try_advisory_lock(72834012) AS locked')).rows[0].locked;
  if (!locked) throw new Error('Stop the application server before upgrading saved parameter rows.');
  try { console.log(JSON.stringify(await upgradeExistingParameterRows(pool))); }
  finally { await lockClient.query('SELECT pg_advisory_unlock(72834012)'); }
} finally { lockClient.release(); await pool.end(); }
