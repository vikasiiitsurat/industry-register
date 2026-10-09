CREATE TABLE import_batches (
  id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','retry_required')),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE imports (
  id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES import_batches(id),
  original_filename text NOT NULL, content_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('processing','completed','failed','retry_required')),
  record_count integer NOT NULL DEFAULT 0, error_details text, parser_version text NOT NULL,
  layout_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE records (
  id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES imports(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','excluded')),
  "industryCategory" text NOT NULL DEFAULT '', "industryCode" text NOT NULL DEFAULT '', "industryId" text NOT NULL DEFAULT '',
  "industryName" text NOT NULL DEFAULT '', "industryContactName" text NOT NULL DEFAULT '', "industryContactDesignation" text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', "zipCode" text NOT NULL DEFAULT '',
  latitude text NOT NULL DEFAULT '', longitude text NOT NULL DEFAULT '', "spcbRegionalOffice" text NOT NULL DEFAULT '',
  "gangaBasin" text NOT NULL DEFAULT '', "industryUsers" text NOT NULL DEFAULT '', "industryEmail" text NOT NULL DEFAULT '', "industryMobile" text NOT NULL DEFAULT '',
  "stationId" text NOT NULL DEFAULT '', "stationName" text NOT NULL DEFAULT '', "stationContactName" text NOT NULL DEFAULT '',
  "stationContactDesignation" text NOT NULL DEFAULT '', "stationMobile" text NOT NULL DEFAULT '', "stationEmail" text NOT NULL DEFAULT '',
  "monitoringType" text NOT NULL DEFAULT '', "deviceId" text NOT NULL DEFAULT '', "serialNo" text NOT NULL DEFAULT '',
  vendor text NOT NULL DEFAULT '', make text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', "certificationSystemType" text NOT NULL DEFAULT '',
  parameter text NOT NULL DEFAULT '', "unitOfMeasurement" text NOT NULL DEFAULT '', "dataBroadcastFrequency" text NOT NULL DEFAULT '', "acceptableMeasurementRange" text NOT NULL DEFAULT '',
  source_reference jsonb NOT NULL DEFAULT '{}', source_metadata jsonb NOT NULL DEFAULT '{}', issues jsonb NOT NULL DEFAULT '[]',
  review_decisions jsonb NOT NULL DEFAULT '{"acceptedBlanks":[],"acknowledged":[]}',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_status_date ON records(status, created_at, id);
CREATE INDEX records_import ON records(import_id);
CREATE INDEX records_business_identity ON records("industryName", "stationName", "serialNo", parameter);
CREATE TABLE mapping_settings (
  layout_id text PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
