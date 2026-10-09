# Verification

Run `npm.cmd test` and `npm.cmd run build` from the repository root. The automated tests use synthetic documents and do not contact or change a database.

The conversion tests check the Express deployment entrypoint and health without `DATABASE_URL`, worker file availability, a DOCX-to-XLSX round trip with all 34 ordered headers, XLSX parameter splitting and station ordering, exact production/preview/local origin handling, rejection of a forged forwarded host, an unavailable-LibreOffice Save As response, invalid input, and oversized output. Parser tests cover table extraction, labels, identifiers, and workbook conversion locally.

After deployment, check `/api/health` and run a real DOCX and XLSX upload through a Vercel Preview URL. Local tests cannot prove how the Vercel service bundles worker dependencies or whether LibreOffice exists in its runtime. `/api/health` reports missing worker files as unavailable. Treat DOC/XLS as unsupported on Vercel until conversion succeeds there with an actual legacy file.
