import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const number = (key, fallback, min, max) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}: expected ${min}–${max}`);
  return n;
};
export const config = {
  host: process.env.HOST || '127.0.0.1', port: number('PORT', 3001, 1, 65535),
  // Leave room for multipart headers and response headers under Vercel's 4.5 MB payload limit.
  maxFileBytes: Math.min(number('MAX_FILE_MB', 4, 1, 50) * 1_000_000, 4_000_000),
  maxOutputBytes: 4_000_000,
  conversionTimeout: number('CONVERSION_TIMEOUT_MS', 45000, 100, 300000),
  fileTimeout: number('FILE_TIMEOUT_MS', 90000, 100, 600000),
  libreOfficePath: process.env.LIBREOFFICE_PATH, templatePath: process.env.EXCEL_TEMPLATE_PATH
};
