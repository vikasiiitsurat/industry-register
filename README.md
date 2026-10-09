# Industry Register

A local web app that turns a Word document or Excel workbook directly into a 34-column Excel download. The default **One file → Excel** mode does not need a database. The optional **Saved dataset** mode combines repeated uploads in PostgreSQL and lets you download or erase the saved records. No review or approval step is needed.

## Run on Windows

Install Node.js 22.12+. LibreOffice is needed only for older `.doc` and `.xls` files; `.docx` and `.xlsx` work without it. PostgreSQL is only needed for **Saved dataset** mode.

1. From this project folder run:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

2. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). In **One file → Excel**, choose one file and click **Convert & download Excel**. The file is processed in memory and is not saved.

The API runs at `http://127.0.0.1:3001`. Keep the terminal open while using the app.

For **Saved dataset**, create a PostgreSQL database named `industry_register`, copy `server/.env.example` to `server/.env`, set `DATABASE_URL`, run `npm.cmd run db:migrate`, and restart `npm.cmd run dev`. Leave `LIBREOFFICE_PATH=` blank for DOCX/XLSX use. Leave `EXCEL_TEMPLATE_PATH=` blank to generate the download automatically. **Excel input is uploaded in the browser; it does not use `EXCEL_TEMPLATE_PATH`.** If you set a download template, its first row must contain exactly the 34 required headers.

## Use

In **One file → Excel**, choose one `.docx`, `.xlsx`, `.doc`, or `.xls` file and click **Convert & download Excel**. No PostgreSQL connection is required. Word input uses labeled tables; Excel input uses recognizable column headers (for example **Industry Name**, **Parameter**, and **Unit of Measurement**). The exact 34-column output format is accepted, including its repeated contact headers. A Parameter cell containing `SO2, NOX, PM2.5, PM10` creates four rows, each with one parameter and the shared row details. Rows are grouped by station in first-appearance order. Missing values stay blank.

In **Saved dataset**, choose one or more files and click **Upload & save**. A later upload adds records. Uploading identical file content twice reports a duplicate so rows are not doubled.

Click **Download Excel** for every saved record in the requested 34-column order. The list on screen shows a few key columns for quick checking; Excel contains all 34. Parameters are grouped by station in the station's first source appearance, with parameters in their original order. Records created by the earlier review workflow are included.

Click **Erase all data** and type `ERASE` to delete saved records, import history, and mapping settings. This cannot be undone. The database tables remain ready for another upload.

If you already imported files before parameter splitting was added, stop the app and run `npm.cmd run db:expand-parameters` once. It creates one active record per parameter, retains the original combined rows as excluded history, and can be rerun safely. The current local database has already been upgraded.

For legacy `.doc` or `.xls`, install LibreOffice and, if the app cannot find it, set `LIBREOFFICE_PATH` to the actual `soffice.exe` path. You can also use **Save As** in Word or Excel to make a `.docx` or `.xlsx`. Changing the filename extension does not convert the file.

Word documents must contain editable tables with an industry/company name and at least one parameter. Excel files must have recognizable headers and at least one populated data row. An empty output template is not input data. Scanned images need OCR first. See [mapping notes](docs/mapping.md) for label behavior and [API](docs/api.md) for endpoints.

## Checks

```powershell
npm.cmd test
npm.cmd run build
```

The integration test runs in a separate temporary PostgreSQL schema when `TEST_DATABASE_URL` is set; it never clears your application tables. Uploads and downloads are processed in memory. Source file bytes are not permanently stored.

