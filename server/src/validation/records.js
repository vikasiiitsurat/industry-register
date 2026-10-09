import { z } from 'zod';
import { fields, keys } from '@industry/shared';
export const dataSchema = z.object(Object.fromEntries(keys.map(k => [k, z.string().max(10000)]))).strict();
export const decisionsSchema = z.object({
  acceptedBlanks: z.array(z.enum(keys)).max(34).default([]),
  acknowledged: z.array(z.string().max(100)).max(100).default([])
}).strict();
export const editSchema = z.object({ data: dataSchema, decisions: decisionsSchema, version: z.number().int().positive() }).strict();
export const settingsSchema = z.object({
  categorySource: z.enum(['', 'classification', 'colourCategory', 'industryType']).default(''),
  stationContact: z.enum(['', 'first', 'second']).default(''),
  rangeSource: z.enum(['', 'permissibleStandard', 'deviceRange']).default(''),
  stationByParameter: z.record(z.string().min(1).max(200), z.string().min(1).max(200)).default({})
}).strict();
export function validateRecord(data, metadata = {}, decisions = {}) {
  const issues = [];
  const accepted = decisions.acceptedBlanks || [], acknowledged = decisions.acknowledged || [];
  const issue = (field, code, message, severity = 'review') => issues.push({ field, code, message, severity });
  for (const { key, label } of fields) {
    if (!data[key]?.trim() && !accepted.includes(key)) issue(key, `missing:${key}`, `${label} is blank. Enter a value or explicitly accept the blank.`);
  }
  if (!data.industryName?.trim()) issue('industryName', 'identity:industry', 'Industry name is required for approval.', 'error');
  if (!data.parameter?.trim()) issue('parameter', 'identity:parameter', 'Parameter is required for approval.', 'error');
  if (!data.stationName?.trim() && !data.stationId?.trim()) issue('stationName', 'identity:station', 'Confirm a station name or enter a station ID.', 'error');
  if (!data.serialNo?.trim() && !data.deviceId?.trim()) issue('serialNo', 'identity:device', 'A device serial number or device ID is required.', 'error');
  for (const field of ['industryEmail', 'stationEmail']) {
    if (data[field] && !z.email().safeParse(data[field]).success) issue(field, `invalid:${field}`, 'Enter a valid email address; internal spaces are not removed automatically.', 'error');
  }
  for (const [field, bound] of [['latitude', 90], ['longitude', 180]]) {
    if (data[field] && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(data[field]) || Math.abs(Number(data[field])) > bound)) issue(field, `invalid:${field}`, `${field} must be a number between -${bound} and ${bound}.`, 'error');
  }
  if (data.gangaBasin && !['Yes', 'No'].includes(data.gangaBasin)) issue('gangaBasin', 'invalid:gangaBasin', 'Use Yes or No.', 'error');
  if (data.monitoringType && !['Effluent', 'Emission'].includes(data.monitoringType)) issue('monitoringType', 'invalid:monitoringType', 'Use Effluent or Emission.', 'error');
  const match = data.acceptableMeasurementRange?.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:to|–|—|-)\s*(-?\d+(?:\.\d+)?)(?:\s+.*)?$/i);
  if (match && Number(match[1]) > Number(match[2])) issue('acceptableMeasurementRange', 'invalid:range', 'Lower bound must not exceed upper bound.', 'error');
  if (data.acceptableMeasurementRange && !match && !acknowledged.includes('range:unparsed')) issue('acceptableMeasurementRange', 'range:unparsed', 'Range bounds could not be parsed. Confirm this literal range is correct.');
  for (const warning of metadata.warnings || []) {
    if (!acknowledged.includes(warning.code)) issue(warning.field || '', warning.code, warning.message);
  }
  return issues;
}
