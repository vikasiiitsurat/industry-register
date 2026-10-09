const localOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://localhost:3000'];

export function allowedOrigins(env = process.env) {
  const origins = new Set(localOrigins);
  for (const configured of (env.CLIENT_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('CLIENT_ORIGIN must contain an HTTP(S) origin.');
    origins.add(url.origin);
  }
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = env[key];
    if (host && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) && !host.includes('..')) origins.add(`https://${host}`);
  }
  return origins;
}
