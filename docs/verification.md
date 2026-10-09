# Verification

The current workflow was checked with unit tests and an isolated real PostgreSQL schema. The integration test covers iterative Word and Excel uploads into one dataset, including an Excel row with four parameters expanding to four saved records; it also covers duplicate detection, 34-column export, older draft rows, erase confirmation, and re-uploading the same file after erase. The configured Excel download template was checked to ensure records start on row 2 even when it contains formatted blank rows. A real legacy XLS conversion through LibreOffice was also tested.

The parameter upgrade was tested against an isolated older combined row for idempotence and preservation of its original as excluded history. The provided local workbook was parsed without importing it again: its four populated source rows produced 16 records. The existing four combined rows in the local application database were then upgraded to 16 active rows, and the in-memory Excel export was checked for one parameter per row.

Ordering was tested with interleaved station rows in an isolated PostgreSQL schema. The list, pagination, and export group each station's parameters in first source appearance order. The new source-order migration was applied to the local database, and its existing 16 records were checked in both the API list and Excel export.

Run `npm.cmd test` and `npm.cmd run build` from the project root. To run the isolated database test, set `TEST_DATABASE_URL` to a PostgreSQL connection whose user can create and drop schemas, then run `npm.cmd run test:integration`. The test creates and drops only its random schema.

Generated synthetic Word documents and Excel workbooks were used for automated tests. A different real-world layout may need an additional label alias or parser rule. Legacy `.doc` and `.xls` need LibreOffice, and image-only documents need OCR before upload.

