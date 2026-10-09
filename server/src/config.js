import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const number = (key, fallback, min, max) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
  return n;
};
export const config = {
  databaseUrl: process.env.DATABASE_URL, host: process.env.HOST || '127.0.0.1',
  port: number('PORT', 3001, 1, 65535), origin: process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173',
  maxFileBytes: number('MAX_FILE_MB', 10, 1, 50) * 1024 * 1024,
  maxFiles: number('MAX_BATCH_FILES', 10, 1, 30), concurrency: number('PROCESS_CONCURRENCY', 2, 1, 4),
  conversionTimeout: number('CONVERSION_TIMEOUT_MS', 45000, 100, 300000),
  fileTimeout: number('FILE_TIMEOUT_MS', 90000, 100, 600000), batchTimeout: number('BATCH_TIMEOUT_MS', 300000, 100, 1800000),
  libreOfficePath: process.env.LIBREOFFICE_PATH, templatePath: process.env.EXCEL_TEMPLATE_PATH
};
