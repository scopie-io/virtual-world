// Local / single-server entry. Serves the API, and the built client from dist/ when present.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { openNodeDb } from './db/sqlite-node.js';
import { SCHEMA } from './db/schema.js';
import { VENUE_DEFAULT } from '../shared/rules.js';
import type { LevelData } from '../shared/types.js';

const root = resolve(import.meta.dirname, '..');
const prod = process.env.NODE_ENV === 'production';
// Dev tools often export PORT for the *web* server, so the API only honours PORT in production.
const PORT = Number(process.env.API_PORT ?? (prod ? process.env.PORT : undefined) ?? 8787);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173';

const secret = process.env.MX_SECRET ?? 'dev-only-secret-change-me';
const crewPin = process.env.CREW_PIN ?? '2026';
if (prod && (!process.env.MX_SECRET || !process.env.CREW_PIN)) throw new Error('MX_SECRET and CREW_PIN must be set in production');
if (!prod) console.warn(`[mission-x] dev mode — default secret, crew PIN ${crewPin}`);

const level = JSON.parse(readFileSync(resolve(root, 'public/data/floor.json'), 'utf8')) as LevelData;
const db = openNodeDb(process.env.DB_FILE ?? resolve(root, 'data/mission-x.db'), SCHEMA);
const env = (k: string, d: number) => (Number.isFinite(Number(process.env[k])) && process.env[k] ? Number(process.env[k]) : d);
const venue = { lat: env('VENUE_LAT', VENUE_DEFAULT.lat), lon: env('VENUE_LON', VENUE_DEFAULT.lon), radiusM: env('VENUE_RADIUS_M', VENUE_DEFAULT.radiusM) };
const app = createApp({ ...buildServices({ db, secret, level, publicOrigin: PUBLIC_ORIGIN, venue }), crewPin, publicOrigin: PUBLIC_ORIGIN, secureCookies: prod });

if (existsSync(resolve(root, 'dist/index.html'))) {
  app.use('/*', serveStatic({ root: './dist' }));
}

serve({ fetch: app.fetch, port: PORT }, (i) => console.log(`[mission-x] api on http://localhost:${i.port} · ${level.booths.length} stations · origin ${PUBLIC_ORIGIN}`));
