import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { GameError } from './game.js';
import type { Services } from './wire.js';
import { renderPassport, renderVcard } from './passport-page.js';
import type { ApiErr, ApiOk, XpEvent } from '../shared/types.js';

export interface AppDeps extends Services { crewPin: string; publicOrigin: string; secureCookies: boolean }
type Vars = { Variables: { playerId: string } };

const YEAR = 365 * 24 * 3600;

/** Fixed-window limiter. Per-process; on Workers put Cloudflare rate-limiting rules in front as well. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 50_000) hits.clear(); return true; }
    return ++h.n <= max;
  };
}

/** Spreadsheet-safe CSV: quotes everything and neutralises formula prefixes. */
function toCsv(cols: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\r\n');
}
const csvHeaders = (name: string) => ({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` });

export function createApp({ game, stations, social, crews, venue, director, gc, ops, signer, crewPin, publicOrigin, secureCookies }: AppDeps) {
  const app = new Hono<Vars>();
  const cookieOpts = { httpOnly: true, sameSite: 'Lax' as const, secure: secureCookies, path: '/' };
  const writeLimit = limiter(40, 60_000), pingLimit = limiter(90, 60_000), loginLimit = limiter(8, 10 * 60_000), guestLimit = limiter(30, 3600_000);
  const ip = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  const ok = async <T,>(c: Context<Vars>, data: T, events: XpEvent[] = [], withMe = true) =>
    c.json<ApiOk<T>>({ ok: true, data, events, me: withMe ? await game.me(c.get('playerId')) : undefined });
  const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  app.onError((e, c) => {
    if (e instanceof GameError) return c.json<ApiErr>({ ok: false, error: e.message, code: e.code }, e.status as 400);
    console.error(e);
    return c.json<ApiErr>({ ok: false, error: 'Something went wrong on our side', code: 'server' }, 500);
  });

  /* ---- player session: signed HttpOnly cookie, guest account on first contact ---- */
  const player = new Hono<Vars>();
  player.use('*', async (c, next) => {
    let id = (await signer.verify(getCookie(c, 'mx_s')))?.replace(/^p:/, '') ?? null;
    if (id && !(await game.exists(id))) id = null;
    if (!id) {
      if (!guestLimit(ip(c))) throw new GameError('rate', 'Too many new sessions from this network', 429);
      id = await game.createGuest();
      setCookie(c, 'mx_s', await signer.sign(`p:${id}`), { ...cookieOpts, maxAge: YEAR });
    }
    c.set('playerId', id);
    if (c.req.method !== 'GET' && c.req.path !== '/api/presence' && !writeLimit(id)) throw new GameError('rate', 'Slow down a little', 429);
    if (c.req.method !== 'GET' && (await ops.isBanned(id))) throw new GameError('review', 'This account is under review — please see the crew at Booth 8H18B', 403);
    await next();
  });
  const pid = (c: Context<Vars>) => c.get('playerId');

  player.get('/me', (c) => ok(c, null));
  player.post('/suit-up', async (c) => ok(c, null, await game.suitUp(pid(c), String((await body(c)).cls))));
  player.post('/avatar', async (c) => { await game.setAvatar(pid(c), (await body(c)).spec); return ok(c, null); });
  player.post('/presence', async (c) => {
    if (!pingLimit(pid(c))) throw new GameError('rate', 'Too many updates', 429);
    const b = await body(c);
    const r = await game.ping(pid(c), { x: Number(b.x), y: Number(b.y), h: Number(b.h), deck: b.deck === true, sigma: Number(b.sigma), steps: Number(b.steps) }, b.spawn === true);
    return ok(c, { holograms: (await ops.flags()).holograms ? r.holograms : [], online: r.online, deck: r.deck }, r.events, r.events.length > 0);
  });
  player.post('/stamp', async (c) => ok(c, null, await game.stamp(pid(c), (await body(c)) as never)));
  player.post('/passport', async (c) => { await ops.require('registration'); return ok(c, null, await game.issuePassport(pid(c), (await body(c)) as never)); });
  player.get('/leaderboard', async (c) => ok(c, await game.leaderboard(pid(c)), [], false));
  player.get('/flags', async (c) => ok(c, await ops.flags(), [], false));
  player.get('/boards', async (c) => { const k = c.req.query('board') ?? 'xp'; if (!['xp', 'today', 'explorer', 'connector', 'stations', 'companies'].includes(k)) throw new GameError('bad_board', 'Unknown board'); return ok(c, await ops.board(k as never, pid(c)), [], false); });
  player.get('/trust', async (c) => ok(c, await ops.trust(pid(c)), [], false));
  player.get('/team', async (c) => ok(c, await ops.team(pid(c)), [], false));
  player.post('/team/create', async (c) => ok(c, await ops.createTeam(pid(c), (await body(c)).name), [], false));
  player.post('/team/join', async (c) => ok(c, await ops.joinTeam(pid(c), (await body(c)).code), [], false));
  player.post('/team/leave', async (c) => { await ops.leaveTeam(pid(c)); return ok(c, null, [], false); });
  player.post('/event', async (c) => { const b = await body(c); await game.track(pid(c), String(b.name), b.props); return ok(c, null, [], false); });

  /* stations: claim, host, share */
  player.get('/stations', async (c) => ok(c, await stations.list(), [], false));
  player.post('/station/claim', async (c) => { await ops.require('claims'); return ok(c, null, await stations.claim(pid(c), (await body(c)) as never)); });
  player.post('/station/share', async (c) => { const b = await body(c); return ok(c, null, await stations.share(pid(c), String(b.stationId), b.fields)); });
  player.post('/station/unshare', async (c) => { await stations.revokeShare(pid(c), String((await body(c)).stationId)); return ok(c, null); });
  player.get('/host/stations', async (c) => ok(c, await stations.mine(pid(c)), [], false));
  player.get('/host/code', async (c) => ok(c, await stations.hostCode(pid(c), c.req.query('station') ?? ''), [], false));
  player.get('/host/leads', async (c) => ok(c, await stations.leads(pid(c), c.req.query('station') ?? ''), [], false));
  player.get('/host/leads.csv', async (c) => {
    const sid = c.req.query('station') ?? '', rows = await stations.leads(pid(c), sid);
    const csv = toCsv(['name', 'company', 'role', 'phone', 'email', 'verified', 'callsign', 'shared_at'], rows.map((r) => ({ ...r, verified: r.verified ? 'yes' : 'no', shared_at: new Date(r.at).toISOString() })));
    return c.body(csv, 200, csvHeaders(`leads-${sid.replace(/[^0-9A-Za-z]/g, '')}.csv`));
  });

  /* link-up + contact log */
  player.post('/link/prefs', async (c) => { await social.setPrefs(pid(c), (await body(c)).fields); return ok(c, null); });
  player.post('/link/code', async (c) => { await ops.require('links'); return ok(c, await social.linkCode(pid(c)), [], false); });
  player.post('/link/peek', async (c) => ok(c, await social.peek(pid(c), (await body(c)).code), [], false));
  player.post('/link', async (c) => { await ops.require('links'); const b = await body(c); return ok(c, null, await social.link(pid(c), b.code, b.fields)); });
  player.get('/contacts', async (c) => ok(c, await social.contacts(pid(c)), [], false));
  player.post('/contacts/note', async (c) => { const b = await body(c); await social.setNote(pid(c), b.key, b.note); return ok(c, null, [], false); });
  player.post('/contacts/revoke', async (c) => { await social.revokePerson(pid(c), String((await body(c)).key)); return ok(c, null, [], false); });

  player.get('/sectors', async (c) => ok(c, await crews.view(), [], false));

  /* presence engine: venue gate + invisibility. The fix is used for one distance check and discarded. */
  player.post('/venue', async (c) => { const b = await body(c); return ok(c, await venue.checkIn(pid(c), { lat: Number(b.lat), lon: Number(b.lon), acc: Number(b.acc) })); });
  player.post('/hidden', async (c) => { await venue.setHidden(pid(c), (await body(c)).hidden === true); return ok(c, null); });

  /* Mission Director */
  player.get('/missions', async (c) => ok(c, { ...(await director.view(pid(c))), drop: await ops.drop(pid(c)) }, [], false));
  player.post('/missions/accept', async (c) => { await ops.require('missions'); await director.accept(pid(c), String((await body(c)).id)); return ok(c, await director.view(pid(c)), [], false); });
  player.post('/missions/abandon', async (c) => { await director.abandon(pid(c)); return ok(c, await director.view(pid(c)), [], false); });

  /* Ground Control co-op */
  player.get('/gc', async (c) => ok(c, await gc.view(pid(c)), [], false));
  player.post('/gc/join', async (c) => { await ops.require('gc'); return ok(c, await gc.join(pid(c)), [], false); });
  player.post('/gc/leave', async (c) => { await gc.leave(pid(c)); return ok(c, await gc.view(pid(c)), [], false); });
  player.post('/gc/waypoint', async (c) => { const b = await body(c); await gc.waypoint(pid(c), Number(b.x), Number(b.y)); return ok(c, await gc.view(pid(c)), [], false); });

  /* ---- crew (booth staff): PIN → signed cookie ---- */
  const crew = new Hono();
  crew.post('/login', async (c) => {
    if (!loginLimit(ip(c))) throw new GameError('rate', 'Too many attempts — wait ten minutes', 429);
    if (String((await body(c)).pin) !== crewPin) throw new GameError('pin', 'Wrong PIN', 401);
    setCookie(c, 'mx_crew', await signer.sign(`crew:${Date.now() + 14 * 3600_000}`), { ...cookieOpts, maxAge: 14 * 3600 });
    return c.json({ ok: true, data: null });
  });
  crew.use('*', async (c, next) => {
    const p = await signer.verify(getCookie(c, 'mx_crew'));
    if (!p?.startsWith('crew:') || Number(p.slice(5)) < Date.now()) throw new GameError('crew_auth', 'Crew sign-in required', 401);
    await next();
  });
  crew.get('/check', (c) => c.json({ ok: true, data: null }));
  crew.post('/logout', (c) => { setCookie(c, 'mx_crew', '', { ...cookieOpts, maxAge: 0 }); return c.json({ ok: true, data: null }); });
  crew.get('/ticket', async (c) => c.json({ ok: true, data: await game.crewTicket(c.req.query('t') ?? '') }));
  crew.post('/dock', async (c) => c.json({ ok: true, data: await game.crewDock(String((await body(c)).t ?? '')) }));
  crew.get('/beacons', async (c) => c.json({ ok: true, data: await game.beacons() }));
  crew.get('/leads', async (c) => c.json({ ok: true, data: await game.leads() }));
  crew.get('/leads.csv', async (c) => c.body(
    toCsv(['name', 'company', 'role', 'phone', 'email', 'consent_marketing', 'callsign', 'cls', 'xp', 'stamps', 'links', 'docked_at', 'created_at'], await game.leads()),
    200, csvHeaders('mission-x-leads.csv')));
  crew.get('/stations', async (c) => c.json({ ok: true, data: await stations.crewList() }));

  /* live ops: review before any prize is announced, switches for a bad afternoon, today's drop, the big screen */
  crew.get('/review', async (c) => c.json({ ok: true, data: await ops.review((c.req.query('board') ?? 'today') as never) }));
  crew.get('/ledger', async (c) => c.json({ ok: true, data: await ops.ledger(c.req.query('callsign') ?? '') }));
  crew.post('/void', async (c) => { const b = await body(c); await ops.setVoided(Number(b.id), b.voided !== false); return c.json({ ok: true, data: null }); });
  crew.post('/ban', async (c) => { const b = await body(c); await ops.setBanned(String(b.callsign), b.banned !== false, b.reason); return c.json({ ok: true, data: null }); });
  crew.get('/flags', async (c) => c.json({ ok: true, data: await ops.flags() }));
  crew.post('/flags', async (c) => { const b = await body(c); await ops.setFlag(String(b.flag), b.on === true); return c.json({ ok: true, data: await ops.flags() }); });
  crew.get('/drop', async (c) => c.json({ ok: true, data: await ops.drop(null) }));
  crew.post('/drop', async (c) => { const b = await body(c); await ops.setDrop(b.stationId, b.title, b.bonus); return c.json({ ok: true, data: await ops.drop(null) }); });
  crew.get('/screen', async (c) => {
    const t = game.now(), dots = await game.presence.all(t, venue.hidden);
    return c.json({ ok: true, data: { dots, online: dots.length, onsite: dots.filter((d) => d.deck).length, totals: await ops.totals(), board: await ops.board('today', null), sectors: await crews.view(), storm: await director.stormView(), drop: await ops.drop(null), joinUrl: publicOrigin } });
  });
  crew.post('/stations/status', async (c) => { const b = await body(c); await stations.crewSetStatus(String(b.stationId), String(b.status)); return c.json({ ok: true, data: null }); });

  app.route('/api/crew', crew);
  app.route('/api', player);

  /* ---- public Passport pages ---- */
  app.get('/p/:slug', async (c) => {
    const p = await game.publicPassport(c.req.param('slug'));
    return p ? c.html(renderPassport(p, publicOrigin)) : c.text('Passport not found', 404);
  });
  app.get('/p/:slug/vcard', async (c) => {
    const p = await game.publicPassport(c.req.param('slug'));
    if (!p) return c.text('Passport not found', 404);
    return c.body(renderVcard(p, publicOrigin), 200, { 'content-type': 'text/vcard; charset=utf-8', 'content-disposition': `attachment; filename="${p.slug}.vcf"` });
  });

  app.get('/healthz', (c) => c.text('ok'));
  return app;
}
