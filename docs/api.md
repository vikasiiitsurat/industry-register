# Conversion API

The browser uses same-origin relative URLs. Local development serves the API at `http://127.0.0.1:3001/api`; Vercel Services routes `/api/(.*)` to the Express service.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Conversion readiness, parser worker availability, LibreOffice availability, and byte limits |
| POST | `/api/convert` | Multipart form with one `file`; returns a 34-column XLSX attachment |

`/api/convert` accepts `.docx` and `.xlsx` directly. Its `X-Record-Count` header reports the number of output rows. Multiple parameters become separate rows, grouped by station in first-appearance order. Errors are JSON with `error.code` and `error.message`. DOC/XLS work only when the server's LibreOffice executable passes a version probe; otherwise the API returns `LEGACY_UNAVAILABLE` with Save As instructions. Empty or damaged input receives a format-specific error.

The upload and generated XLSX are each capped at 4,000,000 bytes so multipart overhead and response headers stay below Vercel's 4.5 MB payload limit. `OUTPUT_TOO_LARGE` asks the user to split the input. The server keeps no records or files between requests. Browser `Origin` values must match an exact configured, current Vercel, or local development origin; request-supplied forwarded host headers are ignored.
