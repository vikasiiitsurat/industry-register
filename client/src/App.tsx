import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, UploadCloud, X } from 'lucide-react';
import './simple.css';
import './quick.css';

type Health = {
  status: 'ok' | 'unavailable';
  libreOffice: boolean;
  message?: string;
  limits: { maxFileBytes: number; maxOutputBytes: number };
};
const maxFileBytes = 4_000_000;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Conversion failed. Please try again.';

export default function App() {
  const picker = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/health').then(response => response.json()).then((data: Health) => { if (live) setHealth(data); })
      .catch(() => { if (live) setError('The conversion server is unavailable. Start the project with npm run dev.'); });
    return () => { live = false; };
  }, []);

  function choose(list: FileList | null) {
    setError(''); setNotice('');
    if (!list?.length) return;
    if (list.length !== 1) { setFile(null); setError('Choose exactly one file.'); return; }
    setFile(list[0]);
  }

  async function convert() {
    if (!file) return;
    const limit = health?.limits.maxFileBytes ?? maxFileBytes;
    if (file.size > limit) { setError(`The file must be smaller than ${limit / 1_000_000} MB.`); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/convert', { method: 'POST', body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || 'Conversion failed. Check the server and retry.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'industry-records.xlsx';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const count = response.headers.get('X-Record-Count');
      setNotice(`Excel downloaded${count ? ` with ${count} record${count === '1' ? '' : 's'}` : ''}.`);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  const legacy = file && /\.(doc|xls)$/i.test(file.name);
  return <div className="simple-page">
    <header className="simple-header"><div className="simple-brand"><span className="simple-brand-mark"><FileText size={20}/></span>Industry Register</div><span className={'simple-connection ' + (health?.status === 'ok' ? 'connected' : '')}><span/> {health?.status === 'ok' ? 'Converter ready' : health ? 'Converter unavailable' : 'Checking converter…'}</span></header>
    <main className="simple-main">
      <div className="simple-intro"><div><div className="simple-eyebrow">WORD & EXCEL INPUT</div><h1>Convert one file to Excel</h1><p>Upload one document or workbook and download its mapped data in the 34-column Excel format. Files are processed for this request and are not stored.</p></div></div>
      {health?.status === 'unavailable' && <div className="simple-alert simple-error" role="alert">{health.message || 'The conversion service is unavailable.'}</div>}
      {error && <div className="simple-alert simple-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={17}/></button></div>}
      {notice && <div className="simple-alert simple-success" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={17}/></button></div>}
      <section className="simple-card simple-quick-card">
        <div className="simple-card-heading"><div><h2>Choose one Word or Excel file</h2><p>DOCX and XLSX work directly. Older DOC and XLS files require LibreOffice on the server.</p></div></div>
        <div className="simple-dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files); }}>
          <UploadCloud size={34}/><strong>{file ? file.name : 'Choose a file or drop it here'}</strong>
          <span>One file, up to {(health?.limits.maxFileBytes ?? maxFileBytes) / 1_000_000} MB</span>
          <input ref={picker} type="file" accept=".doc,.docx,.xls,.xlsx" onChange={event => choose(event.target.files)} aria-label="Choose one Word or Excel file"/>
          <button className="simple-button simple-outline" type="button" disabled={busy} onClick={() => picker.current?.click()}>Browse file</button>
        </div>
        {legacy && health && !health.libreOffice && <div className="simple-legacy-note" role="status">LibreOffice is unavailable on this server. Save the file as {file.name.toLowerCase().endsWith('.doc') ? 'DOCX' : 'XLSX'} in Word or Excel, then upload that file.</div>}
        <div className="simple-actions"><span>Each parameter becomes its own row, grouped by station.</span><button className="simple-button simple-primary" disabled={!file || busy || health?.status === 'unavailable'} onClick={convert}><ArrowDownToLine size={18}/>{busy ? 'Converting…' : 'Convert & download Excel'}</button></div>
      </section>
    </main>
  </div>;
}
