# Local API

Base URL: `http://127.0.0.1:3001/api`. The browser uses the configured local origin. No login is provided, so keep the server bound to loopback.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Database, LibreOffice, and upload limit status |
| POST | `/convert` | Multipart single `file`; returns a 34-column Excel attachment without using PostgreSQL |
| GET | `/schema` | Ordered 34 business fields |
| GET | `/stats` | Record, industry, and import counts |
| POST | `/imports/batch` | Multipart `files` containing Word `.doc`/`.docx` or Excel `.xls`/`.xlsx` files; automatically saves mapped records |
| GET | `/records` | Paginated saved records, including older drafts; `page` and `pageSize` are optional |
| GET | `/export` | Excel attachment containing all saved records and exactly 34 business columns |
| DELETE | `/data` | JSON `{ "confirmation": "ERASE" }`; deletes records, imports, batches, and mapping settings |

`/convert` accepts one Word or Excel file and responds with the workbook plus an `X-Record-Count` header. It works even when the database is unavailable. Rows are grouped by station in first-appearance order, and a cell with several parameters creates one row per parameter. A successful saved upload result has `status: "success"` and a record count. Identical content returns `duplicate`; an unsupported or damaged file returns `failed` with a message. Files are processed temporarily and source bytes are not saved. Legacy `.doc` and `.xls` require LibreOffice; `.docx` and `.xlsx` do not.

The older per-record review and mapping endpoints remain available for compatibility, but the current app does not use them. Excel includes saved draft and approved rows and excludes rows explicitly marked excluded by the older workflow. Erase returns counts of deleted records and imports. Requests from other browser origins are rejected.

