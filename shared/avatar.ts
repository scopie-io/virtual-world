// What the astronaut wears. The simple game has one suit per role (defaultAvatar); the editor behind this catalog is
// switched off (FEATURES.avatars). Shared: the client renders from it, the server validates against it.
// A spec is nine small integers, sent over presence as "h.v.s.e.t.b.sh.c.tr".
import type { Role } from './rules.js';

export interface AvatarSpec { helmet: number; visor: number; smile: number; ear: number; top: number; bottom: number; shoes: number; carry: number; trail: number }
export const SLOTS = ['helmet', 'visor', 'smile', 'ear', 'top', 'bottom', 'shoes', 'carry', 'trail'] as const;
export type Slot = (typeof SLOTS)[number];

/** How an option is earned. rank = index into RANKS. 'later' = systems that arrive after M2 (constellations, missions). */
export type Unlock = { rank: number } | { later: 'constellation' | 'mission' } | null;

export interface Option { label: string; color?: number; unlock?: Unlock }
export interface TopOption extends Option { color: number; accent?: number; pattern?: 'batik' | 'hivis' | 'buttons' | 'collar' | 'sampin'; long?: boolean }
export type CarryKind = 'none' | 'laptop' | 'camera' | 'coffee' | 'tablet' | 'box' | 'briefcase' | 'clipboard' | 'bag' | 'mic' | 'toolkit';
export interface CarryOption extends Option { kind: CarryKind }
export type SmileKind = 'smile' | 'grin' | 'wink' | 'heart' | 'zigzag' | 'dots' | 'x' | 'star';
export interface SmileOption extends Option { kind: SmileKind }

const swatch = (label: string, color: number): Option => ({ label, color });

export const CATALOG = {
  helmet: [swatch('Classic white', 0xf5f7fa), swatch('Cloud grey', 0xcfd6de), swatch('Sky', 0xa9dcf5), swatch('Mint', 0xb9ead4), swatch('Sand', 0xeadbbd), swatch('Blush', 0xf3c9d2)],
  visor: [swatch('Midnight', 0x05070c), swatch('Deep teal', 0x063340), swatch('Indigo', 0x14124a), swatch('Bronze', 0x3a2410), swatch('Plum', 0x2c0f2e)],
  smile: [
    { label: 'Smile', kind: 'smile' }, { label: 'Grin', kind: 'grin' }, { label: 'Wink', kind: 'wink' }, { label: 'Dots', kind: 'dots' },
    { label: 'Heart', kind: 'heart', unlock: { rank: 1 } }, { label: 'Zigzag', kind: 'zigzag', unlock: { rank: 2 } },
    { label: 'The X', kind: 'x', unlock: { rank: 3 } }, { label: 'Star', kind: 'star', unlock: { rank: 4 } },
  ] as SmileOption[],
  ear: [swatch('Signal yellow', 0xffb21e), swatch('Cyan', 0x3fd8ff), swatch('Coral', 0xff7a66), swatch('Lime', 0x9be564), swatch('Violet', 0xb69cff), swatch('White', 0xffffff)],
  top: [
    { label: 'Hoodie', color: 0xd5d9de }, { label: 'Denim jacket', color: 0x22395c, pattern: 'buttons' }, { label: 'Tan jacket', color: 0xc9a27a, pattern: 'buttons' },
    { label: 'Black jacket', color: 0x1b1b1f }, { label: 'Blazer', color: 0x1d2a44, accent: 0xf5f7fa, pattern: 'collar' }, { label: 'Polo', color: 0xf2f4f6, accent: 0x17b6d6, pattern: 'collar' },
    { label: 'Batik shirt', color: 0x7a3b1d, accent: 0xe8b04a, pattern: 'batik' }, { label: 'Baju Melayu style', color: 0x1f7a6d, accent: 0xd9b45a, pattern: 'sampin' },
    { label: 'Kurung style', color: 0x8a4f7d, accent: 0xe9c6dc, long: true, unlock: { later: 'constellation' } },
    { label: 'Lab coat', color: 0xffffff, accent: 0xcfd6de, long: true, pattern: 'buttons', unlock: { later: 'constellation' } },
    { label: 'Chef jacket', color: 0xfafafa, accent: 0x1b1b1f, pattern: 'buttons', unlock: { later: 'constellation' } },
    { label: 'Hi-vis vest', color: 0xe6f03c, accent: 0xc9ccd1, pattern: 'hivis', unlock: { later: 'constellation' } },
  ] as TopOption[],
  bottom: [swatch('Navy', 0x1f3558), swatch('Khaki', 0xc9a27a), swatch('Black', 0x1b1b1f), swatch('Grey', 0x6b7480), swatch('White', 0xf2f4f6), swatch('Forest', 0x24523f)],
  shoes: [swatch('White', 0xf5f7fa), swatch('Black', 0x16181c), swatch('Signal yellow', 0xffc629), swatch('Cyan', 0x3fd8ff), swatch('Red', 0xe24a3b), swatch('Tan', 0xb98a5a)],
  carry: [
    { label: 'Nothing', kind: 'none' }, { label: 'Laptop', kind: 'laptop' }, { label: 'Camera', kind: 'camera' }, { label: 'Coffee', kind: 'coffee' },
    { label: 'Tablet', kind: 'tablet' }, { label: 'Sample box', kind: 'box' }, { label: 'Briefcase', kind: 'briefcase' },
    { label: 'Clipboard', kind: 'clipboard', unlock: { later: 'mission' } }, { label: 'Shopping bag', kind: 'bag', unlock: { later: 'mission' } },
    { label: 'Microphone', kind: 'mic', unlock: { later: 'mission' } }, { label: 'Toolkit', kind: 'toolkit', unlock: { later: 'mission' } },
  ] as CarryOption[],
  trail: [{ label: 'None' }, { label: 'Spark', unlock: { rank: 2 } }, { label: 'Comet', unlock: { rank: 3 } }, { label: 'X-dust', unlock: { rank: 4 } }] as Option[],
} satisfies Record<Slot, Option[]>;

export const SLOT_LABEL: Record<Slot, string> = { helmet: 'Helmet', visor: 'Visor', smile: 'LED smile', ear: 'Ear ring', top: 'Top', bottom: 'Bottoms', shoes: 'Shoes', carry: 'Carry', trail: 'Trail' };

/** One astronaut, one suit. Who they are is said by the jacket colour alone (ROLE_INFO), which the renderer applies. */
export function defaultAvatar(_role: Role | null): AvatarSpec {
  return { helmet: 0, visor: 0, smile: 0, ear: 5, top: 0, bottom: 0, shoes: 0, carry: 0, trail: 0 };
}

/** Options with an unlock were rewards of systems that are switched off; they stay locked. */
export const isUnlocked = (o: Option): boolean => !o.unlock;
export const unlockHint = (o: Option): string => (o.unlock ? 'Not available' : '');

/** Returns a clean spec, or null if any value is out of range or locked. */
export function validateAvatar(input: unknown): AvatarSpec | null {
  if (!input || typeof input !== 'object') return null;
  const out = {} as AvatarSpec;
  for (const s of SLOTS) {
    const v = (input as Record<string, unknown>)[s];
    if (!Number.isInteger(v)) return null;
    const opt = (CATALOG[s] as Option[])[v as number];
    if (!opt || !isUnlocked(opt)) return null;
    out[s] = v as number;
  }
  return out;
}

export const encodeAvatar = (a: AvatarSpec) => SLOTS.map((s) => a[s]).join('.');
export function decodeAvatar(code: string | null | undefined): AvatarSpec | null {
  if (!code) return null;
  const n = code.split('.').map(Number);
  if (n.length !== SLOTS.length || n.some((v) => !Number.isInteger(v))) return null;
  const a = {} as AvatarSpec;
  SLOTS.forEach((s, i) => { a[s] = (CATALOG[s] as Option[])[n[i]!] ? n[i]! : 0; });
  return a;
}

export const COMBINATIONS = SLOTS.filter((s) => s !== 'trail').reduce((n, s) => n * (s === 'carry' ? CATALOG.carry.length - 1 : CATALOG[s].length), 1);
