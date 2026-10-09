ALTER TABLE records ADD COLUMN source_order integer;

WITH ordered AS (
  SELECT id, row_number() OVER (
    PARTITION BY import_id
    ORDER BY CASE WHEN status='excluded' THEN 1 ELSE 0 END,
      COALESCE((source_reference->>'sheetIndex')::integer, 0),
      COALESCE((source_reference->>'table')::integer, 0),
      COALESCE((source_reference->>'row')::integer, 0),
      COALESCE((source_reference->>'parameterItem')::integer, 0),
      created_at, id
  )::integer AS position
  FROM records
)
UPDATE records r SET source_order=ordered.position FROM ordered WHERE r.id=ordered.id;

ALTER TABLE records ALTER COLUMN source_order SET NOT NULL;
CREATE INDEX records_import_source_order ON records(import_id,source_order);
