export class ApiError extends Error { constructor(message: string, public details?: unknown) { super(message); } }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.error?.message || body.message || 'The server is unavailable. Start the backend and try again.', body.error?.details); }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
export type Issue = { field: string; code: string; message: string; severity: string };
export type RecordRow = Record<string, any> & { id: string; import_id: string; version: number; status: string; issues: Issue[]; review_decisions: { acceptedBlanks: string[]; acknowledged: string[] } };
