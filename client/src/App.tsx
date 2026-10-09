import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Database, FileText, Trash2, UploadCloud, X } from 'lucide-react';
import { api, json, type RecordRow } from './api';
import './simple.css';
import './quick.css';

type Health = { database: boolean; libreOffice: boolean; message?: string; limits?: { maxFiles: number; maxFileBytes: number } };
type Stats = { approved: number; drafts: number; imports: number; industries: number };
type ImportResult = { filename: string; status: string; recordCount: number; message: string };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.';

function ModeSwitch({ mode, onChange }: { mode: 'quick' | 'saved'; onChange: (mode: 'quick' | 'saved') => void }) {
  return <div className="simple-mode-tabs" aria-label="Conversion mode">
    <button type="button" className={mode === 'quick' ? 'active' : ''} aria-pressed={mode === 'quick'} onClick={() => onChange('quick')}>One file → Excel</button>
    <button type="button" className={mode === 'saved' ? 'active' : ''} aria-pressed={mode === 'saved'} onClick={() => onChange('saved')}>Saved dataset</button>
  </div>;
}

function QuickConvert({ health }: { health: Health | null }) {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function choose(list: FileList | null) {
    setError(''); setNotice('');
    if (!list?.length) return;
    if (list.length !== 1) { setFile(null); setError('Choose exactly one file for direct conversion.'); return; }
    setFile(list[0]);
  }
  async function convert() {
    if (!file) return;
    const maxBytes = health?.limits?.maxFileBytes ?? 10485760;
    if (file.size > maxBytes) { setError('The file must be at most ' + Math.round(maxBytes / 1048576) + ' MB.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/convert', { method: 'POST', body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || 'Conversion failed. Check the local server and retry.');
      }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'industry-records.xlsx';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = response.headers.get('X-Record-Count');
      setNotice('Excel downloaded' + (count ? ' with ' + count + ' record' + (count === '1' ? '' : 's') : '') + '.');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <>
    {error && <div className="simple-alert simple-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}
    {notice && <div className="simple-alert simple-success" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={17}/></button></div>}
    <section className="simple-card simple-quick-card">
      <div className="simple-card-heading"><div><h2>Choose one Word or Excel file</h2><p>Upload a .docx or .xlsx file. Older .doc and .xls files need LibreOffice.</p></div></div>
      <div className="simple-dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files); }}>
        <UploadCloud size={34}/><strong>{file ? file.name : 'Choose a file or drop it here'}</strong>
        <span>One file, up to {Math.round((health?.limits?.maxFileBytes ?? 10485760) / 1048576)} MB</span>
        <input ref={picker} type="file" accept=".doc,.docx,.xls,.xlsx" onChange={e => choose(e.target.files)} aria-label="Choose one Word or Excel file"/>
        <button className="simple-button simple-outline" type="button" disabled={busy} onClick={() => picker.current?.click()}>Browse file</button>
      </div>
      <div className="simple-actions"><span>Each parameter becomes its own row, grouped by station. Nothing is saved to the database.</span><button className="simple-button simple-primary" disabled={!file || busy} onClick={convert}><ArrowDownToLine size={18}/>{busy ? 'Converting…' : 'Convert & download Excel'}</button></div>
    </section>
  </>;
}

export default function App() {
  const [mode, setMode] = useState<'quick' | 'saved'>('quick');
  const picker = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseText, setEraseText] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let live = true;
    fetch('/api/health').then(r => r.json()).then(h => { if (live) setHealth(h); })
      .catch(() => { if (live) setHealth({ database: false, libreOffice: false, message: 'The server is offline. Run npm run dev from the project folder.' }); });
    if (mode === 'saved') Promise.all([api<Stats>('/stats'), api<{ records: RecordRow[]; total: number }>('/records?status=all&page=' + page + '&pageSize=25')])
      .then(([s, data]) => { if (live) { setStats(s); setRows(data.records); setTotal(data.total); } })
      .catch(e => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [mode, page, revision]);

  function choose(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list)); setResults([]); setError(''); setNotice('');
  }
  async function upload() {
    if (!files.length) return;
    const maxFiles = health?.limits?.maxFiles ?? 10, maxBytes = health?.limits?.maxFileBytes ?? 10485760;
    if (files.length > maxFiles) { setError('Choose at most ' + maxFiles + ' files per upload.'); return; }
    if (files.some(f => f.size > maxBytes)) { setError('Each file must be at most ' + Math.round(maxBytes / 1048576) + ' MB.'); return; }
    setBusy('upload'); setError(''); setNotice('');
    try {
      const form = new FormData(); files.forEach(file => form.append('files', file));
      const data = await api<{ results: ImportResult[] }>('/imports/batch', { method: 'POST', body: form });
      setResults(data.results); setFiles([]); if (picker.current) picker.current.value = '';
      const count = data.results.reduce((n, item) => n + (item.status === 'success' ? item.recordCount : 0), 0);
      if (count) setNotice(count + ' records saved. You can download the Excel file now.');
      setPage(1); setRevision(n => n + 1);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function download() {
    setBusy('download'); setError('');
    try {
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error((await response.json()).error?.message || 'Excel download failed.');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'industry-records.xlsx';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  async function erase() {
    if (eraseText !== 'ERASE') return;
    setBusy('erase'); setError('');
    try {
      const data = await api<{ deleted: { records: number; imports: number } }>('/data', json('DELETE', { confirmation: 'ERASE' }));
      setEraseOpen(false); setEraseText(''); setResults([]); setFiles([]); if (picker.current) picker.current.value = '';
      setNotice(data.deleted.records + ' saved records erased.');
      setPage(1); setRevision(n => n + 1);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  }
  const count = (stats?.approved ?? 0) + (stats?.drafts ?? 0);
  function changeMode(next: 'quick' | 'saved') {
    setMode(next); setError(''); setNotice('');
  }
  if (mode === 'quick') return <div className="simple-page">
    <header className="simple-header"><div className="simple-brand"><span className="simple-brand-mark"><Database size={20}/></span>Industry Register</div><span className="simple-connection connected"><span/> No database needed</span></header>
    <main className="simple-main">
      <ModeSwitch mode={mode} onChange={changeMode}/>
      <div className="simple-intro"><div><div className="simple-eyebrow">WORD & EXCEL INPUT</div><h1>Convert one file to Excel</h1><p>Upload one Word document or Excel workbook and download its mapped data as a 34-column Excel file. No database setup is needed.</p></div></div>
      <QuickConvert health={health}/>
    </main>
  </div>;
  return <div className="simple-page">
    <header className="simple-header"><div className="simple-brand"><span className="simple-brand-mark"><Database size={20}/></span>Industry Register</div><span className={'simple-connection ' + (health?.database ? 'connected' : '')}><span/> {health === null ? 'Connecting…' : health.database ? 'Database connected' : 'Database offline'}</span></header>
    <main className="simple-main">
      <ModeSwitch mode={mode} onChange={changeMode}/>
      <div className="simple-intro"><div><div className="simple-eyebrow">WORD & EXCEL INPUT</div><h1>Build your industry dataset</h1><p>Upload Word documents or Excel workbooks, one at a time or in batches. Each upload adds its mapped values to the database. Download everything as one Excel file.</p></div><button className="simple-button simple-primary" disabled={!count || !!busy} onClick={download}><ArrowDownToLine size={18}/>{busy === 'download' ? 'Preparing Excel…' : 'Download Excel'}</button></div>
      {error && <div className="simple-alert simple-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}
      {notice && <div className="simple-alert simple-success" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={17}/></button></div>}
      {health && !health.database && <div className="simple-alert simple-error" role="alert">{health.message || 'PostgreSQL is unavailable. Check server/.env and run npm run db:migrate.'}</div>}
      <div className="simple-stats"><div><span>Saved records</span><strong>{count}</strong></div><div><span>Industries</span><strong>{stats?.industries ?? 0}</strong></div><div><span>Upload attempts</span><strong>{stats?.imports ?? 0}</strong></div></div>
      <section className="simple-card"><div className="simple-card-heading"><div><h2>Upload Word or Excel files</h2><p>Use .docx or .xlsx. Older .doc and .xls files need LibreOffice installed.</p></div></div>
        <div className="simple-dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files); }}><UploadCloud size={34}/><strong>{files.length ? files.length + ' file(s) selected' : 'Choose files or drop them here'}</strong><span>Up to {health?.limits?.maxFiles ?? 10} files, {Math.round((health?.limits?.maxFileBytes ?? 10485760) / 1048576)} MB each</span><input ref={picker} type="file" accept=".doc,.docx,.xls,.xlsx" multiple onChange={e => choose(e.target.files)} aria-label="Choose Word or Excel files"/><button className="simple-button simple-outline" type="button" disabled={!!busy} onClick={() => picker.current?.click()}>Browse files</button></div>
        {!!files.length && <div className="simple-file-list">{files.map((f, i) => <div key={f.name + i}><FileText size={16}/><span>{f.name}</span><small>{Math.round(f.size / 1024)} KB</small></div>)}</div>}
        <div className="simple-actions"><span>Multiple parameters in one cell become separate records. Missing fields stay blank.</span><button className="simple-button simple-primary" disabled={!files.length || !health?.database || !!busy} onClick={upload}><UploadCloud size={18}/>{busy === 'upload' ? 'Processing…' : 'Upload & save'}</button></div>
        {!!results.length && <div className="simple-results" aria-live="polite"><h3>Upload results</h3>{results.map((r, i) => <div key={r.filename + i} className="simple-result"><FileText size={17}/><div><strong>{r.filename}</strong><span>{r.message}</span></div><em className={r.status}>{r.status}</em></div>)}</div>}
      </section>
      <section className="simple-card"><div className="simple-card-heading"><div><h2>Saved records</h2><p>{total} records, grouped by station in source order. The Excel file includes all 34 requested columns.</p></div><button className="simple-button simple-outline" disabled={!count || !!busy} onClick={download}><ArrowDownToLine size={17}/>Download Excel</button></div><div className="simple-table-wrap"><table><thead><tr><th>Industry name</th><th>Station name</th><th>Parameter</th><th>Serial no.</th><th>Unit</th><th>Source file</th></tr></thead><tbody>{rows.length ? rows.map(r => <tr key={r.id}><td>{r.industryName || '—'}</td><td>{r.stationName || '—'}</td><td>{r.parameter || '—'}</td><td>{r.serialNo || '—'}</td><td>{r.unitOfMeasurement || '—'}</td><td>{r.original_filename || '—'}</td></tr>) : <tr><td colSpan={6} className="simple-empty">No records yet. Upload a Word or Excel file to get started.</td></tr>}</tbody></table></div>
        {total > 25 && <div className="simple-pages"><span>{(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}</span><div><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button></div></div>}
      </section>
      <div className="simple-danger"><div><h2>Erase all saved data</h2><p>Remove every saved record, document import entry, and mapping setting from this database.</p></div><button className="simple-button simple-erase" disabled={!stats?.imports || !!busy} onClick={() => { setEraseText(''); setEraseOpen(true); }}><Trash2 size={17}/>Erase all data</button></div>
    </main>
    {eraseOpen && <div className="simple-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setEraseOpen(false); }}><div className="simple-dialog" role="dialog" aria-modal="true" aria-labelledby="erase-title"><h2 id="erase-title">Erase all saved data?</h2><p>This permanently deletes all records and import history. Type <strong>ERASE</strong> to confirm.</p><input autoFocus value={eraseText} onChange={e => setEraseText(e.target.value)} aria-label="Type ERASE to confirm" placeholder="ERASE"/><div className="simple-dialog-actions"><button className="simple-button simple-outline" disabled={!!busy} onClick={() => setEraseOpen(false)}>Cancel</button><button className="simple-button simple-erase" disabled={eraseText !== 'ERASE' || !!busy} onClick={erase}>{busy === 'erase' ? 'Erasing…' : 'Erase everything'}</button></div></div></div>}
  </div>;
}
