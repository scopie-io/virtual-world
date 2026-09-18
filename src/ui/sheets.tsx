import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import { api, ApiError } from '../net/api';
import { handleScan } from '../scan';
import { Camera, FieldPicker, Qr, Sheet, hex, useCountdown, useDeadline } from './common';
import { CATALOG, SLOTS, SLOT_LABEL, isUnlocked, unlockHint, type AvatarSpec, type Option, type Slot } from '../../shared/avatar';
import { CLASSES, CLASS_INFO, CREW_INFO, STATION_LEVELS, type ShareField } from '../../shared/rules';
import type { Booth, Contact, HostCode, HostLead, HostStation, LinkCode, LinkPeek } from '../../shared/types';
import { guideOn, guideTarget, level, me, modal, nearStation, panelStation, pendingLink, sectors, stampedSet, stationMap, stations, toast } from '../state';

type Eng = { engine: () => Engine | null };
const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, undefined, 'warn', 4500);
const refreshStations = async () => { try { stations.value = await api.stations(); } catch { /* next poll */ } };

/* ------------------------------------------------------------------ station */

export function StationSheet({ engine }: Eng) {
  const b = panelStation.value, m = me.value!;
  const [fields, setFields] = useState<ShareField[]>(m.sharePrefs), [scan, setScan] = useState(false), [digits, setDigits] = useState(''), [busy, setBusy] = useState(false);
  if (!b) return null;
  const st = stationMap.value.get(b.id), mine = m.hosting.includes(b.id), stamped = stampedSet.value.has(b.id), shared = m.shared.includes(b.id), verified = m.verified.includes(b.id);
  const near = nearStation.value?.id === b.id, title = st?.company || b.name || `Station ${b.id}`;
  const run = async (f: () => Promise<unknown>, msg: string) => { setBusy(true); try { await f(); } catch (e) { fail(e, msg); } setBusy(false); };

  return (
    <Sheet k={`Booth ${b.id} · Hall ${b.hall} · Level ${b.deck}${b.sector ? ` · ${b.sector}` : ''}`} title={title}>
      <div class="pills">
        <span class={'pill ' + (st ? (st.hosted ? 'live' : 'on') : '')}>{st ? (st.hosted ? 'Host here now' : 'Online') : 'Dark station'}</span>
        {st && <span class="pill">Level {st.level}</span>}{st?.status === 'approved' && <span class="pill on">Verified exhibitor</span>}
        {stamped && <span class="pill gold">◆ Stamped</span>}{verified && <span class="pill gold">Verified contact</span>}
      </div>
      {st?.offer && <p class="lead">{st.offer}</p>}
      {st?.link && <a class="btn" href={st.link} target="_blank" rel="noopener noreferrer nofollow">Visit their page</a>}

      {mine ? (
        <div class="stack"><button class="btn primary big" onClick={() => (modal.value = 'host')}>Open host screen</button><button class="btn big" onClick={() => (modal.value = 'claim')}>Edit station profile</button></div>
      ) : (
        <div class="stack">
          {!stamped && near && <button class="btn primary big" disabled={busy} onClick={() => run(() => engine()!.stamp(b), 'Could not stamp')}>Stamp this station</button>}
          {!near && <button class="btn big" onClick={() => { guideTarget.value = { x: b.x, y: b.y, label: title }; guideOn.value = true; modal.value = null; }}>Guide me here</button>}

          {st && !verified && (
            <div class="box">
              <strong>At the real booth?</strong><p class="fine">Ask the host for their live code. On-site stamp + Verified Contact: up to +120 XP.</p>
              {scan ? <Camera onCode={(t) => { setScan(false); void handleScan(t); }} onFail={(msg) => { setScan(false); toast(msg, undefined, 'warn', 5000); }} /> : <button class="btn big" onClick={() => setScan(true)}>Scan host code</button>}
              <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(() => api.stamp({ stationId: b.id, proof: 'host', code: digits }), 'That code did not work'); }}>
                <input inputMode="numeric" maxLength={6} placeholder="6-digit code" aria-label="6-digit host code" value={digits} onInput={(e) => setDigits((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
                <button class="btn" disabled={busy || digits.length !== 6}>Enter</button>
              </form>
            </div>
          )}

          {st && stamped && m.passport && (
            <div class="box">
              <strong>{shared ? 'You shared your Passport here' : `Share your Passport with ${st.company}?`}</strong>
              <p class="fine">They receive only what you tick. You can take it back any time from Contacts.</p>
              <FieldPicker value={fields} onChange={setFields} />
              <div class="stack">
                <button class="btn primary big" disabled={busy} onClick={() => run(() => api.share(b.id, fields), 'Could not share')}>{shared ? 'Update what I share' : 'Share my Passport · +25 XP'}</button>
                {shared && <button class="btn big" disabled={busy} onClick={() => run(() => api.unshare(b.id), 'Could not undo')}>Take it back</button>}
              </div>
            </div>
          )}
          {st && stamped && !m.passport && <p class="fine">Claim your Passport at the Launch Pad to exchange cards with exhibitors.</p>}

          {!st && (m.passport
            ? <button class="btn big" onClick={() => (modal.value = 'claim')}>This is my booth — bring it online</button>
            : <p class="fine">Exhibiting here? Claim your Passport at the Launch Pad, then bring this station online.</p>)}
        </div>
      )}
    </Sheet>
  );
}

const BRAND_COLORS = [0x17b6d6, 0x3aa8ff, 0x4d7cff, 0xb69cff, 0xff7a66, 0xffc629, 0x9be564, 0x2fd0a0, 0xf5f7fa];
export function ClaimSheet() {
  const b = panelStation.value, m = me.value!, existing = b ? stationMap.value.get(b.id) : undefined;
  const [f, setF] = useState({ company: existing?.company ?? m.passport?.company ?? '', offer: existing?.offer ?? '', link: existing?.link ?? '', color: existing?.color ?? BRAND_COLORS[0]! });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const put = (k: 'company' | 'offer' | 'link') => (e: Event) => { const v = (e.target as HTMLInputElement).value; setF((p) => ({ ...p, [k]: v })); };
  if (!b) return null;
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.claim({ stationId: b.id, ...f }); await refreshStations(); api.track('station_claim', { id: b.id }); modal.value = 'host'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save'); setBusy(false); }
  };
  return (
    <Sheet k={`Booth ${b.id}`} title={existing ? 'Station profile' : 'Bring your station online'} onClose={() => (modal.value = 'station')}>
      <form onSubmit={submit}>
        {!existing && <p class="lead">Your booth lights up for every player, becomes a stamp stop, and you get a free lead list of visitors who choose to share their card.</p>}
        <label>Company name on the booth<input required maxLength={80} value={f.company} onInput={put('company')} /></label>
        <label>One-line offer<input maxLength={120} placeholder="e.g. Free samples at 3 pm" value={f.offer} onInput={put('offer')} /></label>
        <label>Link<input maxLength={200} inputMode="url" placeholder="yourcompany.com" value={f.link} onInput={put('link')} /></label>
        <div class="swatches" role="radiogroup" aria-label="Station colour">{BRAND_COLORS.map((c) => <button type="button" key={c} role="radio" aria-checked={f.color === c} aria-label={hex(c)} class={'sw' + (f.color === c ? ' on' : '')} style={{ background: hex(c) }} onClick={() => setF((p) => ({ ...p, color: c }))} />)}</div>
        {err && <p class="err" role="alert">{err}</p>}
        <button class="btn primary big" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save profile' : 'Bring it online · +100 XP'}</button>
        {!existing && <p class="fine">Claims are checked by the Lean X Digital crew. A claim on someone else's booth is removed.</p>}
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ host */

export function HostSheet() {
  const [mine, setMine] = useState<HostStation[] | null>(null), [sel, setSel] = useState<string | null>(null);
  const [code, setCode] = useState<{ c: HostCode; until: number } | null>(null), [leads, setLeads] = useState<HostLead[]>([]);
  const left = useCountdown(code?.until ?? 0);

  useEffect(() => { api.hostStations().then((s) => { setMine(s); setSel(s[0]?.id ?? null); }, () => setMine([])); }, []);
  useEffect(() => { // the code call doubles as the "host is here" heartbeat
    if (!sel) return; let stop = false;
    const pull = async () => { try { const c = await api.hostCode(sel); if (!stop) setCode({ c, until: Date.now() + c.expiresInMs }); } catch (e) { fail(e, 'Could not load the host code'); } };
    const pullLeads = () => api.hostLeads(sel).then((l) => !stop && setLeads(l), () => {});
    void pull(); void pullLeads(); void refreshStations();
    const a = setInterval(pull, 10_000), b = setInterval(() => { void pullLeads(); api.hostStations().then((s) => !stop && setMine(s), () => {}); }, 15_000);
    return () => { stop = true; clearInterval(a); clearInterval(b); };
  }, [sel]);
  useEffect(() => { if (code && left === 0 && sel) api.hostCode(sel).then((c) => setCode({ c, until: Date.now() + c.expiresInMs }), () => {}); }, [left]);

  const s = mine?.find((x) => x.id === sel), next = s ? STATION_LEVELS[s.level + 1] : undefined;
  return (
    <Sheet k="Station Command" title={s ? s.company : 'Host screen'} gold wide>
      {!mine ? <p class="lead">Loading…</p> : !s ? <p class="lead">You do not host a station yet. Walk to your booth, open its Station panel and bring it online.</p> : (
        <>
          {mine.length > 1 && <div class="pills">{mine.map((x) => <button key={x.id} class={'chip' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>{x.id}</button>)}</div>}
          <div class="hostgrid">
            <div class="center">
              {code && <Qr text={code.c.url} label="Rotating host code" />}
              <div class="code">{code ? code.c.digits.replace(/(\d{3})/, '$1 ') : '··· ···'}</div>
              <p class="fine">New code in {left}s. Visitors scan this at your counter: they get an on-site stamp, you get a <b>verified</b> contact. Keep this screen open — it shows players that a host is here.</p>
            </div>
            <div>
              <div class="stats">
                <div><span>Level</span><strong>{s.level}</strong></div><div><span>Station XP</span><strong>{s.sxp}{next ? ` / ${next}` : ''}</strong></div>
                <div><span>Stamps</span><strong>{s.stamps}</strong></div><div><span>Cards</span><strong>{s.shares}</strong></div>
                <div><span>Verified</span><strong>{s.verifiedContacts}</strong></div><div><span>Hosted</span><strong>{s.hostMinutes}m</strong></div>
              </div>
              {s.status === 'pending' && <p class="fine">Status: awaiting crew check — your station is already live.</p>}
              <div class="rowb"><strong>Leads ({leads.length})</strong><a class="link" href={`/api/host/leads.csv?station=${encodeURIComponent(s.id)}`}>Export CSV</a></div>
              <div class="leads">
                {leads.length === 0 ? <p class="fine">Nobody has shared a card yet. Visitors are offered the exchange right after they stamp your station.</p> : leads.map((l) => (
                  <div key={l.callsign} class="leadrow"><strong>{l.name}{l.verified && <em> · verified</em>}</strong><span>{[l.role, l.company].filter(Boolean).join(' · ')}</span><span>{[l.phone, l.email].filter(Boolean).join(' · ')}</span></div>
                ))}
              </div>
              <button class="btn big" onClick={() => { panelStation.value = level.value?.booths.find((b) => b.id === s.id) ?? null; modal.value = 'claim'; }}>Edit station profile</button>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ link-up */

export function LinkSheet() {
  const m = me.value!, [mode, setMode] = useState<'show' | 'scan'>(pendingLink.value ? 'scan' : 'show');
  const [code, setCode] = useState<{ c: LinkCode; until: number } | null>(null), [prefs, setPrefs] = useState<ShareField[]>(m.sharePrefs);
  const [cam, setCam] = useState(false), [typed, setTyped] = useState(''), [peek, setPeek] = useState<{ code: string; p: LinkPeek } | null>(null), [mine, setMine] = useState<ShareField[]>(m.sharePrefs), [busy, setBusy] = useState(false);
  const left = useCountdown(code?.until ?? 0), linksAtOpen = useRef(m.links);

  const fresh = () => api.linkCode().then((c) => setCode({ c, until: Date.now() + c.expiresInMs }), (e) => fail(e, 'Could not create a Link code'));
  useEffect(() => { if (m.passport && mode === 'show') void fresh(); }, [mode]);
  useEffect(() => { if (code && left === 0 && mode === 'show') void fresh(); }, [left]);
  useEffect(() => { // someone scanned my code: the server linked us — notice it here
    if (mode !== 'show') return; const id = setInterval(() => { void api.me().catch(() => {}); }, 4000); return () => clearInterval(id);
  }, [mode]);
  useEffect(() => { if (m.links > linksAtOpen.current) { linksAtOpen.current = m.links; toast('Linked!', 'Their card is in your Contacts', 'xp'); void fresh(); } }, [m.links]);

  const look = async (raw: string) => {
    const c = (raw.match(/[?&]l=([A-Za-z0-9]{8})/)?.[1] ?? raw).trim().toUpperCase();
    try { setPeek({ code: c, p: await api.linkPeek(c) }); } catch (e) { fail(e, 'That Link code did not work'); }
  };
  useEffect(() => { const c = pendingLink.value; if (c && m.passport) { pendingLink.value = null; void look(c); } }, []);
  const doLink = async () => { if (!peek) return; setBusy(true); try { await api.link(peek.code, mine); api.track('link'); setPeek(null); modal.value = 'contacts'; } catch (e) { fail(e, 'Could not link'); } setBusy(false); };

  if (!m.passport) return <Sheet k="Link-up" title="You need a Passport first"><p class="lead">Your Passport is the card you exchange. Follow the trail to the Launch Pad — Booth 8H18B — to claim it.</p><button class="btn primary big" onClick={() => { guideTarget.value = null; guideOn.value = true; modal.value = null; }}>Guide me to the Launch Pad</button></Sheet>;

  if (peek) return (
    <Sheet k="Link-up" title={`Link with ${peek.p.callsign}?`} onClose={() => setPeek(null)}>
      <p class="lead">{peek.p.cls ? CLASS_INFO[peek.p.cls].label : 'Crew member'} · {peek.p.rank}. They are sharing: <b>{peek.p.shares.join(', ')}</b>.</p>
      {peek.p.alreadyLinked ? <p class="fine">You two are already linked — find them in Contacts.</p> : (
        <><strong>What do you share with them?</strong><FieldPicker value={mine} onChange={setMine} /><button class="btn primary big" disabled={busy} onClick={doLink}>{busy ? 'Linking…' : 'Exchange Passports · +50 XP each'}</button></>
      )}
    </Sheet>
  );

  return (
    <Sheet k="Link-up" title="Swap Passports" gold>
      <div class="seg"><button class={mode === 'show' ? 'on' : ''} onClick={() => setMode('show')}><strong>Show my code</strong><small>They scan you</small></button><button class={mode === 'scan' ? 'on' : ''} onClick={() => setMode('scan')}><strong>Scan theirs</strong><small>You scan them</small></button></div>
      {mode === 'show' ? (
        <div class="center">
          {code && <Qr text={code.c.url} label="My Link code" />}
          <div class="code small">{code?.c.code.replace(/(.{4})/, '$1 ') ?? '···· ····'}</div>
          <p class="fine">Fresh code in {left}s · works once.</p>
          <div class="box left"><strong>Whoever scans you receives</strong><FieldPicker value={prefs} onChange={(f) => { setPrefs(f); void api.linkPrefs(f).catch((e) => fail(e, 'Could not save')); }} /></div>
        </div>
      ) : (
        <div>
          {cam ? <Camera onCode={(t) => { setCam(false); void look(t); }} onFail={(msg) => { setCam(false); toast(msg, undefined, 'warn', 5000); }} /> : <button class="btn primary big" onClick={() => setCam(true)}>Open camera</button>}
          <form class="inline" onSubmit={(e) => { e.preventDefault(); void look(typed); }}>
            <input maxLength={9} placeholder="8-character code" aria-label="8-character Link code" autocapitalize="characters" autocomplete="off" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value.toUpperCase().replace(/\s/g, ''))} />
            <button class="btn" disabled={typed.length !== 8}>Look up</button>
          </form>
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ contacts */

function vcardHref(c: Contact): string {
  const v = (s: string) => s.replace(/([,;\\])/g, '\\$1'), k = c.card;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${v(k.name ?? c.title)}`, k.company && `ORG:${v(k.company)}`, k.role && `TITLE:${v(k.role)}`, k.phone && `TEL;TYPE=CELL:${v(k.phone)}`, k.email && `EMAIL:${v(k.email)}`, c.note && `NOTE:${v(c.note)}`, 'END:VCARD'].filter(Boolean);
  return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

export function ContactsSheet() {
  const [list, setList] = useState<Contact[] | null>(null);
  const load = () => api.contacts().then(setList, () => setList([]));
  useEffect(() => { void load(); }, []);
  const revoke = async (c: Contact) => { try { await (c.kind === 'station' ? api.unshare(c.key.slice(2)) : api.revokeContact(c.key)); toast(c.kind === 'station' ? 'Stopped sharing' : 'Card taken back'); void load(); } catch (e) { fail(e, 'Could not undo'); } };
  return (
    <Sheet k="Contact Log" title={list ? `${list.length} contact${list.length === 1 ? '' : 's'}` : 'Contacts'} wide>
      {!list ? <p class="lead">Loading…</p> : list.length === 0 ? <p class="lead">Nobody yet. Open <b>Link</b> to swap Passports with people you meet, or share your card at an online station.</p> : (
        <div class="contacts">{list.map((c) => (
          <div key={c.key} class="contact">
            <div class="rowb"><strong>{c.title}{c.verified && <em> · verified</em>}</strong><span class="pill">{c.kind === 'person' ? 'Person' : 'Station'}</span></div>
            <span class="sub">{c.sub}</span>
            <div class="pills">
              {c.card.phone && <a class="chip" href={`https://wa.me/${c.card.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              {c.card.email && <a class="chip" href={`mailto:${c.card.email}`}>Email</a>}
              {c.link && <a class="chip" href={c.link} target="_blank" rel="noopener noreferrer nofollow">Their page</a>}
              {c.kind === 'person' && c.card.name && <a class="chip" href={vcardHref(c)} download={`${c.card.name}.vcf`}>Save contact</a>}
              <button class="chip ghostbtn" onClick={() => revoke(c)}>{c.kind === 'station' ? 'Stop sharing' : 'Take back my card'}</button>
            </div>
            <textarea rows={2} maxLength={500} placeholder="Private note — follow up about…" aria-label={`Note about ${c.title}`} defaultValue={c.note} onBlur={(e) => { const t = (e.target as HTMLTextAreaElement).value; if (t !== c.note) { c.note = t; void api.note(c.key, t).catch((x) => fail(x, 'Note not saved')); } }} />
          </div>
        ))}</div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ avatar */

export function AvatarSheet({ engine }: Eng) {
  const m = me.value!, [draft, setDraft] = useState<AvatarSpec>(m.avatar), [slot, setSlot] = useState<Slot>('top'), [busy, setBusy] = useState(false);
  const pick = (s: Slot, i: number) => { const d = { ...draft, [s]: i }; setDraft(d); engine()?.setAvatar(d); };
  const close = () => { engine()?.setAvatar(me.value!.avatar); modal.value = null; };
  const save = async () => { setBusy(true); try { await api.avatar(draft); api.track('avatar'); modal.value = null; } catch (e) { fail(e, 'Could not save your look'); engine()?.setAvatar(m.avatar); } setBusy(false); };
  const opts = CATALOG[slot] as Option[];
  return (
    <div class="dock"><div class="sheet" role="dialog" aria-label="Suit up">
      <button class="close" aria-label="Close" onClick={close}>×</button>
      <div class="k">Suit up</div>
      <div class="pills scrollx">{SLOTS.map((s) => <button key={s} class={'chip' + (s === slot ? ' on' : '')} onClick={() => setSlot(s)}>{SLOT_LABEL[s]}</button>)}</div>
      <div class="opts">{opts.map((o, i) => {
        const open = isUnlocked(o, m.rankIndex), on = draft[slot] === i;
        return (
          <button key={i} class={'opt' + (on ? ' on' : '') + (open ? '' : ' locked')} disabled={!open} aria-pressed={on} onClick={() => pick(slot, i)}>
            {o.color != null && <span class="dot" style={{ background: hex(o.color) }} />}<span>{o.label}</span>{!open && <small>{unlockHint(o)}</small>}
          </button>
        );
      })}</div>
      <button class="btn primary big" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Wear this'}</button>
    </div></div>
  );
}

/* ------------------------------------------------------------------ find */

export function FindSheet() {
  const [q, setQ] = useState(''), lv = level.value, sm = stationMap.value;
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!lv || t.length < 2) return [] as Booth[];
    return lv.booths.filter((b) => b.id.toLowerCase().includes(t) || b.name.toLowerCase().includes(t) || (sm.get(b.id)?.company.toLowerCase().includes(t) ?? false)).slice(0, 30);
  }, [q, lv, sm]);
  const go = (b: Booth | null) => { guideTarget.value = b ? { x: b.x, y: b.y, label: sm.get(b.id)?.company || b.name || `Station ${b.id}` } : null; guideOn.value = true; modal.value = null; };
  return (
    <Sheet k="Find" title="Where to?">
      <label>Booth number or exhibitor<input autofocus value={q} placeholder="e.g. 7C17, Mamee, UOB" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
      <div class="results">
        <button class="result hero" onClick={() => go(null)}><strong>✕ Launch Pad — Lean X Digital · nexova</strong><small>Booth 8H18B · Hall 8</small></button>
        {hits.map((b) => <button key={b.id} class="result" onClick={() => go(b)}><strong>{sm.get(b.id)?.company || b.name || `Station ${b.id}`}</strong><small>Booth {b.id} · Hall {b.hall} · Level {b.deck}{b.sector ? ` · ${b.sector}` : ''}{sm.has(b.id) ? ' · online' : ''}{stampedSet.value.has(b.id) ? ' · stamped' : ''}</small></button>)}
        {q.trim().length >= 2 && hits.length === 0 && <p class="fine">No booth or exhibitor matches on any of the three levels.</p>}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ crews + menu */

export function CrewsSheet() {
  const v = sectors.value, m = me.value!, left = useCountdown(useDeadline(v?.nextTickInMs, v));
  useEffect(() => { api.sectors().then((s) => (sectors.value = s), () => {}); }, []);
  return (
    <Sheet k="Crews" title="Sector control" wide>
      <p class="lead">Your class is your crew{m.cls ? <> — you fly with the <b>{CREW_INFO[m.cls].crew}</b></> : null}. Every 30 minutes the most active crew in each hall takes it. Stamps, verified contacts and Links all count.</p>
      {!v ? <p class="fine">Loading…</p> : (
        <>
          <div class="sectors">{v.sectors.map((s) => {
            const max = Math.max(0.001, ...CLASSES.map((c) => s.scores[c]));
            return (
              <div key={s.hall} class="sector">
                <div class="rowb"><strong>Hall {s.hall}</strong><span class="pill" style={s.holder ? { background: hex(CREW_INFO[s.holder].color), color: '#06202f', borderColor: 'transparent' } : {}}>{s.holder ? `Held by ${CREW_INFO[s.holder].crew}` : 'Unclaimed'}</span></div>
                {CLASSES.map((c) => <div key={c} class="bar2" title={`${CREW_INFO[c].crew}: ${s.scores[c].toFixed(2)}`}><span>{CREW_INFO[c].crew}</span><i><b style={{ width: `${(s.scores[c] / max) * 100}%`, background: hex(CREW_INFO[c].color) }} /></i></div>)}
              </div>
            );
          })}</div>
          <p class="fine">Next tick in {Math.floor(left / 60)}m {left % 60}s · Crew sizes: {CLASSES.map((c) => `${CREW_INFO[c].crew} ${v.crewSizes[c]}`).join(' · ')} · Smaller crews get an underdog boost.</p>
        </>
      )}
    </Sheet>
  );
}

export function MenuSheet() {
  const m = me.value!, go = (x: typeof modal.value) => () => (modal.value = x);
  return (
    <Sheet k={m.callsign} title="Menu">
      <div class="menu">
        <button onClick={go('missions')}><strong>Missions</strong><small>Director offers · Signal Storms</small></button>
        <button onClick={go('gc')}><strong>Ground Control</strong><small>Remote + on-site co-op · +150 XP</small></button>
        <button onClick={go('presence')}><strong>Presence</strong><small>{m.onsite ? 'On site' : 'Remote'}{m.hidden ? ' · invisible' : ''}</small></button>
        <button onClick={go('link')}><strong>Link-up</strong><small>Swap Passports · +50 XP</small></button>
        <button onClick={go('contacts')}><strong>Contacts</strong><small>{m.links} linked · {m.shared.length} stations</small></button>
        <button onClick={go('suit')}><strong>Suit up</strong><small>Change your look</small></button>
        <button onClick={go('crews')}><strong>Crews</strong><small>Sector control</small></button>
        <button onClick={go('board')}><strong>Boards</strong><small>Today · explorers · stations · companies</small></button>
        <button onClick={go('team')}><strong>Company team</strong><small>Fly with colleagues</small></button>
        {m.hosting.length > 0 && <button onClick={go('host')}><strong>Host screen</strong><small>{m.hosting.join(', ')}</small></button>}
        {m.passport && !m.docked && <button onClick={go('ticket')}><strong>Golden Ticket</strong><small>Show at 8H18B</small></button>}
        <button onClick={() => { guideOn.value = !guideOn.value; modal.value = null; }}><strong>Trail {guideOn.value ? 'off' : 'on'}</strong><small>Guide line on the floor</small></button>
      </div>
    </Sheet>
  );
}
