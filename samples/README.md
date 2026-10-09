# Sample files

`Demo Industry Input.docx` is synthetic test input. `output.xlsx` has the 34 required headers but no populated data rows; it is a download template, not an Excel data file to import.

To test Excel input, fill one or more rows under the headers in a **copy** of `output.xlsx`, then upload that copy through the app. You can also upload another `.xlsx` file with recognizable headers. `EXCEL_TEMPLATE_PATH` in `server/.env` controls the downloaded file's styling; it does not specify an input file. Legacy `.doc`/`.xls` input requires LibreOffice.

`npm run fixture` produces a clearly labeled **synthetic** DOCX in `.local/fixtures/`, for trying the workflow. It does not reproduce or validate the absent Word sample.
