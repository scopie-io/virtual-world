// What the game can truthfully say about the show: everything here is counted from floor.json (the organiser's floor
// plan and official exhibitor list), never written by hand. Shown when you walk into a hall, and while you sit.
import type { LevelData } from '../../shared/types';

export interface HallCard { hall: number; level: number; booths: number; named: number; top: string | null }

const tally = <T extends string | number>(list: T[]) => { const m = new Map<T, number>(); for (const k of list) m.set(k, (m.get(k) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

export function hallCards(level: LevelData): HallCard[] {
  return level.halls.map((h) => {
    const booths = level.booths.filter((b) => b.hall === h.id), sectors = tally(booths.flatMap((b) => (b.sector ? [b.sector] : [])));
    return { hall: h.id, level: h.deck, booths: booths.length, named: booths.filter((b) => b.name).length, top: sectors[0]?.[0] ?? null };
  });
}
export const hallLine = (c: HallCard) => `${c.booths} booths${c.top ? ` · mostly ${c.top}` : ''}`;

/** Short, checkable sentences for the "while you sit" card. */
export function facts(level: LevelData): string[] {
  const booths = level.booths, named = booths.filter((b) => b.name), halls = hallCards(level);
  const companies = tally(named.map((b) => b.name)), sectors = tally(booths.flatMap((b) => (b.sector ? [b.sector] : [])));
  const biggest = [...halls].sort((a, b) => b.booths - a.booths)[0]!, multi = companies.filter(([, n]) => n > 1);
  const out = [
    `MIHAS 2026 fills three levels of MITEC: ${booths.length.toLocaleString()} booths in ${halls.length} halls.`,
    `${companies.length} exhibitors are on the official list so far.`,
    `Hall ${biggest.hall}, on Level ${biggest.level}, is the biggest: ${biggest.booths} booths.`,
    `Level 2 is where you came in: Halls 6, 7 and 8. Level 1 has Halls 2, 3 and 4; Level 3 has Halls 9, 10 and 11.`,
  ];
  if (sectors[0]) out.push(`The biggest category on the floor is ${sectors[0][0]}: ${sectors[0][1]} booths.`);
  if (multi[0]) out.push(`${multi.length} exhibitors took more than one booth. The largest stand is ${multi[0][0]}, with ${multi[0][1]}.`);
  for (const [sector] of sectors.slice(1, 4)) {
    const where = tally(booths.filter((b) => b.sector === sector).map((b) => b.hall))[0];
    if (where) out.push(`Looking for ${sector}? Most of it is in Hall ${where[0]}.`);
  }
  return out;
}
