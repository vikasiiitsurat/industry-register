# Industry Register

This app converts one Word document or Excel workbook into a downloadable XLSX file with the [34 requested columns](shared/schema.js). It is stateless: each request parses its uploaded file, groups parameters by station, builds the workbook, and returns it. The active app has no database routes, credentials, or setup.

## Run locally

Install Node.js 22.12 or later. From the repository root, run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the local Express listener at `http://127.0.0.1:3001`. Choose one `.docx` or `.xlsx` file and click **Convert & download Excel**. A parameter list such as `SO2, NOX, PM2.5, PM10` becomes four rows; rows for each station stay together in source order. Source files and output bytes are not persisted between requests.

Older `.doc` and `.xls` files need a working LibreOffice executable **on the machine running Express**. Local users may set `LIBREOFFICE_PATH` in `server/.env` to the actual `soffice.exe` path. If the server cannot run LibreOffice, save the file as DOCX or XLSX in Word, Excel, or LibreOffice before uploading. Renaming the extension does not convert it. Scanned documents need OCR and are not supported by the table parser.

## Deploy with Vercel Services

The root [vercel.json](vercel.json) defines a Vite `client` service and an Express `server` service. It routes `/api/(.*)` to the server and all other paths to the client. The frontend keeps its relative `/api/convert` request; no service binding is needed.

In the Vercel dashboard:

1. Import this repository as **one project**, with the **Root Directory set to the repository root**.
2. Under **Settings → Build and Deployment**, choose **Services** as the Framework Preset. Keep the service roots and frameworks from `vercel.json`; do not override the project root with `client` or `server`. Use a supported Node.js version meeting the repository's `>=22.12` requirement.
3. Keep **Include source files outside the Root Directory** enabled if the setting is shown. Both services use the root npm workspaces and `@industry/shared` from `shared/`. Use the repository's root `package-lock.json` for installation.
4. Under **Settings → Environment Variables**, enable **Automatically expose System Environment Variables** if it is off. The server accepts the exact origins supplied by `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL`, plus local development origins on ports 5173 and 3000. For any additional frontend domain or a custom local dev port, set `CLIENT_ORIGIN` to its full origin, such as `https://example.com`. Comma-separated exact origins are supported. Do not include a path.
5. Deploy, then open `/api/health` on the deployment. It must return `status: "ok"` and `workerFilesAvailable: true`. Upload a sample DOCX and XLSX through the site and confirm each downloaded workbook has 34 headers. Test both a Preview URL and the production/custom domain you will use.

**No environment variables are required for DOCX/XLSX conversion.** Do not set `DATABASE_URL`. Leave `LIBREOFFICE_PATH` and `EXCEL_TEMPLATE_PATH` unset on Vercel unless their files truly exist in the deployed server runtime. The generated 34-column workbook needs no template. `MAX_FILE_MB` can lower the upload limit; it cannot raise it above 4 MB. The server also rejects output over 4 MB, leaving room below [Vercel's 4.5 MB request and response limit](https://vercel.com/docs/functions/limitations). Large files must be split before upload.

LibreOffice on a developer laptop is not available to the Vercel service. `/api/health` reports whether a runnable LibreOffice executable was found on the deployed server. If absent, DOC/XLS uploads return a Save As DOCX/XLSX instruction; legacy conversion on Vercel is **not claimed as supported**. Local LibreOffice conversion remains available.

See [API details](docs/api.md) and [mapping notes](docs/mapping.md). Vercel's [Services setup guide](https://vercel.com/kb/guide/vercel-services) describes the required Services framework setting and routing behavior.

## Verify

```powershell
npm.cmd test
npm.cmd run build
```

These checks exercise the exported Vercel entrypoint, health without a database, both parser workers, DOCX/XLSX conversion, the 34 headers, origin handling, and legacy-file errors. A real Vercel build and Preview deployment are still needed to validate Vercel's bundle tracing and hosted runtime.
