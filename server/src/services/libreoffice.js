import { access, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { AppError } from '../errors.js';
export async function findLibreOffice() {
  const candidates = [config.libreOfficePath, 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe', '/usr/bin/libreoffice', '/usr/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(path.join(dir, process.platform === 'win32' ? 'soffice.exe' : 'soffice'));
  for (const candidate of candidates.filter(Boolean)) { try { await access(candidate); return candidate; } catch {} }
  return null;
}
async function convertLegacy(buffer, { executable, timeout = config.conversionTimeout, root = tmpdir(), signal, source, target } = {}) {
  executable ||= await findLibreOffice();
  if (!executable) throw new AppError(422, 'LIBREOFFICE_MISSING', `Legacy .${source} needs LibreOffice. Install it and set LIBREOFFICE_PATH to soffice.exe, or use Save As .${target} in Office. Changing the filename extension does not convert the file.`);
  const dir = await mkdtemp(path.join(root, 'industry-import-'));
  try {
    if (signal?.aborted) throw new AppError(408, 'CONVERSION_TIMEOUT', 'Document conversion was cancelled. Re-upload to retry.');
    const input = path.join(dir, `input.${source}`); await writeFile(input, buffer);
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [`-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`, '--headless', '--convert-to', target, '--outdir', dir, input], { shell: false, windowsHide: true, stdio: 'ignore' });
      let timedOut = false;
      const stop = () => {
        if (timedOut) return;
        timedOut = true;
        // soffice.exe can launch soffice.bin; terminate its process tree before removing the profile.
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => child.kill());
          killer.once('close', code => { if (code) child.kill(); });
        } else child.kill('SIGKILL');
      };
      const timer = setTimeout(stop, timeout);
      signal?.addEventListener('abort', stop, { once: true });
      const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
      child.once('error', e => { clear(); reject(new AppError(422, 'CONVERSION_FAILED', `LibreOffice could not run (${e.code || 'error'}). Check LIBREOFFICE_PATH.`)); });
      child.once('close', code => { clear(); if (timedOut || signal?.aborted) reject(new AppError(408, 'CONVERSION_TIMEOUT', `File conversion timed out. Try saving it as .${target} in Office.`)); else if (code !== 0) reject(new AppError(422, 'CONVERSION_FAILED', 'LibreOffice could not convert this file.')); else resolve(); });
      if (signal?.aborted) stop();
    });
    try { return await readFile(path.join(dir, `input.${target}`)); }
    catch { throw new AppError(422, 'CONVERSION_FAILED', `LibreOffice did not produce a ${target.toUpperCase()} file. The source may be damaged or password protected.`); }
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
export const convertDoc = (buffer, options = {}) => convertLegacy(buffer, { ...options, source: 'doc', target: 'docx' });
export const convertXls = (buffer, options = {}) => convertLegacy(buffer, { ...options, source: 'xls', target: 'xlsx' });
