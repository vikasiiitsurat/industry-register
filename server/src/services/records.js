import { z } from 'zod';
import { keys } from '@industry/shared';
import { validateRecord } from '../validation/records.js';
import { AppError } from '../errors.js';
export const filterSchema = z.object({
  status: z.enum(['all','draft','approved','excluded']).default('all'),
  importId: z.uuid().optional(), industry: z.string().max(300).optional(), station: z.string().max(300).optional(),
  search: z.string().max(300).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).strict().refine(f => !f.from || !f.to || f.from <= f.to, { message: 'Start date must precede end date.' });
export function whereFilter(filter, approvedOnly = false) {
  const values = [], clauses = [];
  if (approvedOnly || filter.status === 'all') clauses.push("r.status<>'excluded'");
  else { values.push(filter.status); clauses.push('r.status=$1'); }
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (filter.importId) add('r.import_id=?', filter.importId);
  if (filter.industry) add('r."industryName"=?', filter.industry);
  if (filter.station) add('r."stationName"=?', filter.station);
  if (filter.search) add(`concat_ws(' ',r."industryName",r."stationName",r.parameter,r."serialNo",r."industryId") ILIKE ?`, `%${filter.search.replace(/[\\%_]/g, '\\$&')}%`);
  if (filter.from) add('r.created_at >= ?::date', filter.from);
  if (filter.to) add("r.created_at < (?::date + interval '1 day')", filter.to);
  return { sql: clauses.join(' AND '), values };
}
export const recordData = row => Object.fromEntries(keys.map(k => [k, row[k]]));
export async function refreshedIssues(c, row) {
  const metadata = { ...row.source_metadata, warnings: (row.source_metadata.warnings || []).filter(w => w.code !== 'business:duplicate') };
  if (row.industryName && row.stationName && (row.serialNo || row.deviceId) && row.parameter) {
    const duplicate = await c.query(`SELECT id FROM records WHERE id<>$1 AND import_id<>$2 AND status<>'excluded'
      AND "industryName"=$3 AND "stationName"=$4 AND "serialNo"=$5 AND "deviceId"=$6 AND parameter=$7 LIMIT 1`,
      [row.id, row.import_id, row.industryName, row.stationName, row.serialNo, row.deviceId, row.parameter]);
    if (duplicate.rowCount) metadata.warnings.push({ code: 'business:duplicate', message: 'Another import has the same industry, station, device/serial and parameter. Review and acknowledge this possible duplicate; records are not merged.' });
  }
  return { metadata, issues: validateRecord(recordData(row), metadata, row.review_decisions) };
}
export async function approveRow(c, row) {
  const { metadata, issues } = await refreshedIssues(c, row);
  if (issues.length) throw new AppError(422, 'REVIEW_REQUIRED', 'Resolve validation issues or explicitly accept permitted blanks before approval.', issues);
  return (await c.query("UPDATE records SET status='approved',issues='[]',source_metadata=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *", [row.id, JSON.stringify(metadata)])).rows[0];
}
