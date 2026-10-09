import { randomUUID } from 'node:crypto';
import { keys } from '@industry/shared';
import { transaction } from '../db/pool.js';
import { expandParameterRecords } from '../parsers/parameters.js';
import { recordData } from './records.js';
import { validateRecord } from '../validation/records.js';

export async function upgradeExistingParameterRows(db) {
  return transaction(db, async client => {
    const rows = (await client.query(`SELECT * FROM records WHERE status<>'excluded'
      AND (strpos(parameter, ',')>0 OR strpos(parameter, ';')>0 OR strpos(parameter, chr(10))>0)
      ORDER BY created_at,id FOR UPDATE`)).rows;
    const affectedImports = new Set();
    let sourceRows = 0, createdRecords = 0;
    for (const row of rows) {
      const expanded = expandParameterRecords([{ data: recordData(row), source_reference: row.source_reference, source_metadata: row.source_metadata }]);
      if (expanded.length < 2) continue;
      sourceRows++;
      affectedImports.add(row.import_id);
      for (const [index, record] of expanded.entries()) {
        const columns = ['id', 'import_id', 'status', 'source_order', ...keys, 'source_reference', 'source_metadata', 'issues', 'review_decisions', 'created_at'];
        const values = [randomUUID(), row.import_id, row.status, row.source_order, ...keys.map(key => record.data[key]),
          JSON.stringify(record.source_reference), JSON.stringify(record.source_metadata),
          JSON.stringify(validateRecord(record.data, record.source_metadata, row.review_decisions)),
          JSON.stringify(row.review_decisions), new Date(row.created_at.getTime() + index)];
        await client.query(`INSERT INTO records(${columns.map(key => `"${key}"`).join(',')}) VALUES(${values.map((_, i) => `$${i + 1}`).join(',')})`, values);
        createdRecords++;
      }
      await client.query("UPDATE records SET status='excluded',source_metadata=$2,version=version+1,updated_at=now() WHERE id=$1",
        [row.id, JSON.stringify({ ...row.source_metadata, supersededByParameterExpansion: true })]);
    }
    if (affectedImports.size) {
      const ids = [...affectedImports];
      await client.query(`WITH ordered AS (
        SELECT id,row_number() OVER (PARTITION BY import_id ORDER BY
          COALESCE((source_reference->>'sheetIndex')::integer,0),
          COALESCE((source_reference->>'table')::integer,0),
          COALESCE((source_reference->>'row')::integer,0),
          COALESCE((source_reference->>'parameterItem')::integer,0),source_order,created_at,id)::integer AS position
        FROM records WHERE import_id=ANY($1::uuid[]) AND status<>'excluded'
      ) UPDATE records r SET source_order=ordered.position FROM ordered WHERE r.id=ordered.id`, [ids]);
      await client.query(`UPDATE imports SET record_count=(SELECT count(*)::int FROM records r WHERE r.import_id=imports.id AND r.status<>'excluded'),updated_at=now()
        WHERE id=ANY($1::uuid[])`, [ids]);
    }
    return { sourceRows, createdRecords, affectedImports: affectedImports.size };
  });
}
