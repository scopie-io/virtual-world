// Serverless entry (Vercel). No disk, no shared memory: the database is Turso/libSQL over HTTP and presence lives in it.
// Built once per warm instance; every misconfiguration turns into a readable JSON error instead of a blank 500.
import { createClient } from '@libsql/client/web';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { DbPresence } from './presence.js';
import { openLibsql, type LibsqlLike } from './db/libsql.js';
import { SCHEMA } from './db/schema.js';
import { VENUE_DEFAULT } from '../shared/rules.js';
import type { LevelData } from '../shared/types.js';

export class ConfigError extends Error {}
const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, d: number) => (env(k) && Number.isFinite(Number(env(k))) ? Number(env(k)) : d);

function publicOrigin(): string {
  if (env('PUBLIC_ORIGIN')) return env('PUBLIC_ORIGIN')!.replace(/\/$/, '');
  // production → the project's stable domain; previews → that deployment's own URL, so QR codes stay inside the preview
  const host = env('VERCEL_ENV') === 'production' ? env('VERCEL_PROJECT_PRODUCTION_URL') ?? env('VERCEL_URL') : env('VERCEL_URL');
  if (!host) throw new ConfigError('PUBLIC_ORIGIN is not set');
  return `https://${host}`;
}

const REQUIRED = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'MX_SECRET', 'CREW_PIN'];

async function init(): Promise<Hono<never>> {
  const missing = REQUIRED.filter((k) => !env(k));
  if (missing.length) throw new ConfigError(`Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Add them in Vercel → Project → Settings → Environment Variables, then redeploy.`);
  if (env('MX_SECRET')!.length < 24) throw new ConfigError('MX_SECRET must be at least 24 random characters');

  const db = openLibsql(createClient({ url: env('TURSO_DATABASE_URL')!, authToken: env('TURSO_AUTH_TOKEN')! }) as unknown as LibsqlLike);
  if (env('MX_SKIP_MIGRATE') !== '1') await db.migrate(SCHEMA); // idempotent; one round trip per cold start
  const level = JSON.parse(readFileSync(join(process.cwd(), 'public/data/floor.json'), 'utf8')) as LevelData;
  const origin = publicOrigin();
  const services = buildServices({
    db, secret: env('MX_SECRET')!, level, publicOrigin: origin, presence: new DbPresence(db),
    venue: { lat: num('VENUE_LAT', VENUE_DEFAULT.lat), lon: num('VENUE_LON', VENUE_DEFAULT.lon), radiusM: num('VENUE_RADIUS_M', VENUE_DEFAULT.radiusM) },
  });
  return createApp({ ...services, crewPin: env('CREW_PIN')!, publicOrigin: origin, secureCookies: true }) as unknown as Hono<never>;
}

let app: Promise<Hono<never>> | null = null;

export async function handle(req: Request): Promise<Response> {
  // The pages ask this before anything else. No database configured yet → say so calmly (no error, no log noise):
  // they start the in-browser demo instead (src/demo). With the variables set, the real app answers 'live'.
  if (new URL(req.url).pathname === '/api/healthz') { const missing = REQUIRED.filter((k) => !env(k)); if (missing.length) return Response.json({ ok: true, data: 'demo', missing }); }
  try {
    app ??= init();
    return await (await app).fetch(req);
  } catch (e) {
    app = null; // let the next request try again (e.g. after the env vars were added)
    console.error(e);
    const message = e instanceof ConfigError ? e.message : 'The station could not start. Check the function logs.';
    return Response.json({ ok: false, error: message, code: e instanceof ConfigError ? 'config' : 'server' }, { status: 500 });
  }
}
