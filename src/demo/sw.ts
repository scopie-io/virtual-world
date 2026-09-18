// Demo backend: the real Mission X server (server/app.ts + every service) running inside a service worker, on SQLite
// compiled to WebAssembly. It answers /api/* and /p/* for every tab of this origin — the game, the crew console and the
// Mission Control screen all talk to the same world — and keeps that world in IndexedDB so a reload does not lose it.
//
// It exists so a static deployment with no database can still be walked through end to end. The pages only start it when
// /api/healthz does not answer like a real backend (see boot.ts); once a backend is configured it is unregistered.
// Built separately from the app bundle by the plugin in vite.config.ts → /demo-sw.js.
import initSqlJs from 'sql.js';
import { SCHEMA } from '../../server/db/schema';
import { buildServices, type Services } from '../../server/wire';
import { createApp, type CookieIO } from '../../server/app';
import type { LevelData } from '../../shared/types';
import { openSqlJs, type DemoDb } from './sqljs-db';
import { DEMO_CREW_PIN, DemoSim } from './sim';
import { DEMO_VERSION } from './version';

const VERSION = DEMO_VERSION;

interface WaitEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEv extends WaitEvent { request: Request; respondWith(r: Promise<Response>): void }
const sw = self as unknown as { addEventListener(type: string, fn: (e: never) => void): void; skipWaiting(): Promise<void>; clients: { claim(): Promise<void> }; location: { origin: string } };

/* ---------------- tiny IndexedDB key-value store ---------------- */

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => { const r = indexedDB.open('mission-x-demo', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
}
async function kv<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  try { return await new Promise<T>((ok, no) => { const tx = db.transaction('kv', mode), rq = f(tx.objectStore('kv')); tx.oncomplete = () => ok(rq.result); tx.onerror = tx.onabort = () => no(tx.error); }); }
  finally { db.close(); }
}
const kvGet = <T,>(k: string) => kv<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>);
const kvPut = (k: string, v: unknown) => kv('readwrite', (s) => s.put(v, k));
const kvClear = () => kv('readwrite', (s) => s.clear());

/* ---------------- the backend ---------------- */

type Jar = Record<string, { v: string; exp: number }>;
interface Backend { app: ReturnType<typeof createApp>; services: Services; sim: DemoSim; db: DemoDb; jar: Jar; alive: boolean; heartbeat?: ReturnType<typeof setInterval> }
let backend: Promise<Backend> | null = null, jarDirty = false, saving: Promise<void> | null = null, saveTimer: ReturnType<typeof setTimeout> | undefined;

async function boot(): Promise<Backend> {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const level = (await (await fetch('/data/floor.json')).json()) as LevelData;
  const fresh = (await kvGet<number>('version')) !== VERSION;
  if (fresh) await kvClear();
  const bytes = fresh ? undefined : await kvGet<Uint8Array>('db'), jar: Jar = (fresh ? undefined : await kvGet<Jar>('jar')) ?? {};
  let secret = fresh ? undefined : await kvGet<string>('secret');
  if (!secret) { secret = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join(''); await kvPut('secret', secret); }

  const db = openSqlJs(new SQL.Database(bytes), SCHEMA), clock = { offset: 0 };
  const build = () => buildServices({ db, secret: secret!, level, publicOrigin: sw.location.origin, now: () => Date.now() + clock.offset });
  let services = build();
  if (!(await DemoSim.isSeeded(services, VERSION))) {
    await new DemoSim(services, level, VERSION).seed(clock);
    clock.offset = 0; services = build(); // drop every cache that saw the simulated clock
  }
  const sim = new DemoSim(services, level, VERSION);
  await sim.start();

  const cookies: CookieIO = {
    get: (_c, name) => { const e = jar[name]; return e && e.exp > Date.now() ? e.v : undefined; },
    set: (_c, name, value, maxAgeS) => { if (maxAgeS <= 0 || !value) delete jar[name]; else jar[name] = { v: value, exp: Date.now() + maxAgeS * 1000 }; jarDirty = true; },
  };
  const app = createApp({ ...services, crewPin: DEMO_CREW_PIN, publicOrigin: sw.location.origin, secureCookies: false, cookies });
  const b: Backend = { app, services, sim, db, jar, alive: true };
  await kvPut('version', VERSION); db.saved(); await kvPut('db', db.bytes());
  b.heartbeat = setInterval(() => { void sim.tick().then(() => scheduleSave(b)); }, 1000); // only runs while the worker is awake; requests keep it awake
  return b;
}

function ready(): Promise<Backend> {
  backend ??= boot().catch((e) => { backend = null; throw e; });
  return backend;
}

function scheduleSave(b: Backend): Promise<void> {
  if (!b.alive || (!b.db.dirty() && !jarDirty)) return saving ?? Promise.resolve();
  saving ??= new Promise<void>((done) => {
    saveTimer = setTimeout(async () => {
      try { if (!b.alive) return; if (jarDirty) { jarDirty = false; await kvPut('jar', b.jar); } if (b.db.dirty()) { b.db.saved(); await kvPut('db', b.db.bytes()); } }
      catch (e) { console.warn('[demo] could not save', e); }
      finally { saving = null; done(); }
    }, 1500);
  });
  return saving;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** Helpers for the Demo tour — the things that normally need a second person, a booth crew, or being at MITEC. */
async function demoRoute(b: Backend, path: string, req: Request): Promise<Response> {
  const pid = (await b.services.signer.verify(b.jar.mx_s && b.jar.mx_s.exp > Date.now() ? b.jar.mx_s.v : null))?.replace(/^p:/, '') ?? null;
  const need = () => { if (!pid) throw new Error('Start the game first'); return pid; };
  const url = new URL(req.url);
  switch (`${req.method} ${path}`) {
    case 'GET /api/demo/state': return json({ ok: true, data: await b.sim.state() });
    case 'GET /api/demo/hint': return json({ ok: true, data: await b.sim.hint(url.searchParams.get('station') ?? '') });
    case 'POST /api/demo/partner-code': return json({ ok: true, data: await b.sim.partnerCode(need()) });
    case 'POST /api/demo/partner-scan': return json({ ok: true, data: await b.sim.partnerScan(need()) });
    case 'POST /api/demo/visitor': return json({ ok: true, data: await b.sim.visitNow(need()) });
    case 'POST /api/demo/dock': return json({ ok: true, data: await b.sim.dock(need()) });
    case 'POST /api/demo/boost': await b.sim.boost(need(), 1500); return json({ ok: true, data: null });
    case 'POST /api/demo/reset': b.alive = false; clearInterval(b.heartbeat); clearTimeout(saveTimer); saving = null; jarDirty = false; backend = null; await kvClear(); return json({ ok: true, data: null });
    default: return json({ ok: false, error: 'Unknown demo helper', code: 'demo' }, 404);
  }
}

async function handle(e: FetchEv, path: string): Promise<Response> {
  let b: Backend;
  try { b = await ready(); }
  catch (err) { console.error('[demo] backend failed to start', err); return json({ ok: false, error: `The demo backend could not start in this browser (${err instanceof Error ? err.message : 'unknown error'})`, code: 'demo' }, 500); }
  try {
    await b.sim.tick();
    const res = path.startsWith('/api/demo/') ? await demoRoute(b, path, e.request) : await b.app.fetch(e.request);
    e.waitUntil(scheduleSave(b));
    return res;
  } catch (err) { return json({ ok: false, error: err instanceof Error ? err.message : 'Demo helper failed', code: 'demo' }, 400); }
}

sw.addEventListener('install', () => { void sw.skipWaiting(); });
sw.addEventListener('activate', (e: WaitEvent) => e.waitUntil(sw.clients.claim()));
sw.addEventListener('fetch', (e: FetchEv) => {
  const url = new URL(e.request.url);
  if (url.origin !== sw.location.origin || url.pathname === '/api/healthz') return; // the pages' "is there a real backend?" probe must reach the network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/')) e.respondWith(handle(e, url.pathname));
});
