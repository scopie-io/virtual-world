// The demo world, exercised the way the service worker does it — but in Node, on the same WebAssembly SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { SCHEMA } from '../../server/db/schema';
import { buildServices } from '../../server/wire';
import { createApp, type CookieIO } from '../../server/app';
import type { LevelData } from '../../shared/types';
import { openSqlJs } from './sqljs-db';
import { DEMO_CREW_PIN, DemoSim } from './sim';

const level = JSON.parse(readFileSync('public/data/floor.json', 'utf8')) as LevelData;

async function world() {
  const SQL = await initSqlJs(), db = openSqlJs(new SQL.Database(), SCHEMA), clock = { offset: 0 };
  const build = () => buildServices({ db, secret: 'demo-test-secret-demo-test-secret', level, publicOrigin: 'https://demo.test', now: () => Date.now() + clock.offset });
  const t0 = Date.now();
  await new DemoSim(build(), level, 1).seed(clock);
  const seedMs = Date.now() - t0, services = build(), sim = new DemoSim(services, level, 1);
  await sim.start();
  const jar: Record<string, string> = {};
  const cookies: CookieIO = { get: (_c, n) => jar[n], set: (_c, n, v, age) => { if (age <= 0) delete jar[n]; else jar[n] = v; } };
  const app = createApp({ ...services, crewPin: DEMO_CREW_PIN, publicOrigin: 'https://demo.test', secureCookies: false, cookies });
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const r = await app.fetch(new Request(`https://demo.test${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }));
    const j = (await r.json()) as { ok: boolean; data: T; error?: string; me?: { id: string } };
    if (!j.ok) throw new Error(`${path}: ${j.error}`);
    return j;
  };
  return { db, services, sim, call, jar, seedMs };
}

test('demo world: seeded, consistent, and every helper works through the real API', async () => {
  const w = await world(), { services: s, sim, call } = w;
  console.log(`  seeded in ${w.seedMs} ms · database ${(w.db.bytes().length / 1024).toFixed(0)} KB`);
  assert.ok(await DemoSim.isSeeded(s, 1));
  const st = (await sim.state())!;
  assert.ok(st.bots >= 35 && st.pendingStation && st.drop);

  // history looks like a show day
  const totals = await s.ops.totals();
  assert.ok(totals.stamps > 150, `stamps ${totals.stamps}`); assert.ok(totals.links >= 10, `links ${totals.links}`); assert.ok(totals.docked >= 5); assert.ok(totals.stations >= 10, `stations ${totals.stations}`);
  for (const k of ['today', 'xp', 'stations'] as const) assert.ok((await s.ops.board(k, null)).length >= 3, `board ${k}`);
  assert.ok((await s.ops.board('xp', null)).every((r) => /^[A-Z][a-z]+ [A-Z]\.( \d+)?$|^(Visitor|Exhibitor) \d+$/.test(r.title)), 'plain names on the board');
  assert.equal(await s.director.stormView(), null, 'no Signal Storms in the simple game');
  assert.ok((await s.ops.review('today')).some((r) => r.flags > 0), 'someone to review');
  // the cached XP total always equals the ledger
  const drift = await s.game.db.all('SELECT p.id FROM players p WHERE p.xp != (SELECT COALESCE(SUM(xp),0) FROM xp_ledger l WHERE l.player_id = p.id AND l.voided = 0)');
  assert.equal(drift.length, 0, 'xp cache == ledger');

  // a visitor arrives: session through the cookie seam, suit up, passport
  await call('GET', '/api/me');
  assert.ok(w.jar.mx_s, 'session cookie stored in the jar');
  await call('POST', '/api/start', { role: 'visitor' });
  await call('POST', '/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });
  await call('POST', '/api/passport', { name: 'Demo Tester', company: 'Lean X Digital', role: 'QA', phone: '+60123456789', email: 'qa@example.com', showContact: true, consentMarketing: false, consentNotice: true });
  const pid = (await s.game.db.get<{ id: string }>("SELECT player_id AS id FROM passports WHERE email = 'qa@example.com'"))!.id;
  assert.equal(sim.isBot(pid), false);

  // the world moves and other people are visible
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 950)); await sim.tick(); }
  const ping = await call<{ holograms: unknown[]; online: number }>('POST', '/api/presence', { x: level.hero.dock.x, y: level.hero.dock.y, h: 0, spawn: true });
  assert.ok(ping.data.online >= 35, `online ${ping.data.online}`); assert.ok(ping.data.holograms.length > 0, 'holograms near the Launch Pad');

  // crew docking (helper) — and the crew console's own path stays PIN-protected
  assert.equal(await sim.dock(pid), true);
  await assert.rejects(call('GET', '/api/crew/leads'), /sign-in/i);
  await call('POST', '/api/crew/login', { pin: DEMO_CREW_PIN });
  assert.ok((await call<unknown[]>('GET', '/api/crew/leads')).data.length > 30);
  const screen = (await call<{ dots: { deck: boolean }[]; onsite: number; board: unknown[]; joinUrl: string }>('GET', '/api/crew/screen')).data; // Mission Control feed
  assert.ok(screen.dots.length >= 35 && screen.onsite >= 15 && screen.board.length > 5, JSON.stringify({ dots: screen.dots.length, onsite: screen.onsite }));
  assert.ok((await call<unknown[]>('GET', '/api/crew/stations')).data.length === totals.stations && (await call<unknown[]>('GET', '/api/crew/beacons')).data.length === level.booths.length);

  // simulated venue check-in, then the host code shown by the hint → on-site stamp, verified contact, Daily Drop
  await call('POST', '/api/venue', { lat: 3.17811, lon: 101.66864, acc: 10 });
  const hint = (await sim.hint(st.drop!))!;
  assert.ok(hint.claimed && hint.digits);
  const stamped = await call<null>('POST', '/api/stamp', { stationId: st.drop, proof: 'host', code: hint.digits });
  assert.ok(JSON.stringify(stamped).includes('daily_drop') && JSON.stringify(stamped).includes('"scan","xp":50'), JSON.stringify(stamped));

  // Link-up, both directions
  const theirs = (await sim.partnerCode(pid))!;
  await call('POST', '/api/link', { code: theirs.code, fields: ['name', 'company'] });
  await call('POST', '/api/link/code', {});
  assert.ok(await sim.partnerScan(pid));
  assert.equal((await call<unknown[]>('GET', '/api/contacts')).data.filter((c) => (c as { kind: string }).kind === 'person').length, 2);

  // hosting: claim a booth, a visitor walks in on request and leaves a card
  const mine = level.booths.find((b) => b.deck === 2 && !b.name && b.id !== level.hero.id)!;
  await call('POST', '/api/station/claim', { stationId: mine.id, company: 'Lean X Test Stand', offer: 'Hello', link: '', color: 0x17b6d6 });
  const v = await sim.visitNow(pid);
  assert.equal(v?.station, mine.id);
  assert.equal((await call<unknown[]>('GET', `/api/host/leads?station=${mine.id}`)).data.length, 1);

  const me = (await call<null>('GET', '/api/me')).me as unknown as { xp: number; cls: string; docked: boolean; links: number; verified: string[]; hosting: string[] };
  assert.ok(me.docked && me.links === 2 && me.verified.length === 1 && me.hosting.length === 1 && me.xp === 200 + 500 + 50 + 150 + 50 + 50 + 100, JSON.stringify(me));
  assert.equal(me.cls, 'exhibitor', 'bringing a booth online makes you an exhibitor');
});
