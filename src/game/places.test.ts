// The places are generated from whatever rectangles the organiser drew, so the rules they must obey are tested, not eyeballed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { LevelData } from '../../shared/types';
import { buildPlaces, placeAt, taken } from './places';
import { NavGrid } from './nav';
import { facts, hallCards } from './facts';

const level = JSON.parse(readFileSync('public/data/floor.json', 'utf8')) as LevelData;
const places = buildPlaces(level), nav = new NavGrid(level);

test('every named area of the floor plan becomes a place, on all three levels', () => {
  assert.equal(places.length, level.areas.length);
  assert.deepEqual([...new Set(places.filter((p) => p.open).map((p) => p.deck))].sort(), [1, 2, 3]);
  for (const p of places) {
    for (const s of p.solids) assert.ok(s.x - s.w / 2 >= p.rect.x0 - 0.3 && s.x + s.w / 2 <= p.rect.x1 + 0.3 && s.y - s.d / 2 >= p.rect.y0 - 0.3 && s.y + s.d / 2 <= p.rect.y1 + 0.3, `${p.name}: furniture stays inside its footprint`);
    if (p.verb === 'sit' || p.verb === 'watch') assert.ok(p.seats.some((_, i) => !taken(p, i)), `${p.name}: a free seat`);
    if (p.verb === 'photo') assert.ok(p.spot && nav.walkable(p.spot.x, p.spot.y), `${p.name}: the photo mark can be stood on`);
  }
  assert.ok(places.filter((p) => p.verb).length >= 14, 'most places have something to do');
});

test('you can walk into every open place, stand up from every seat, and nothing is built over the things that matter', () => {
  const spawn = level.spawns.short;
  for (const p of places.filter((k) => k.open && k.deck === 2)) assert.ok(nav.path(spawn, { x: (p.rect.x0 + p.rect.x1) / 2, y: (p.rect.y0 + p.rect.y1) / 2 }), `${p.name}: reachable from the entrance`);
  for (const p of places) for (const s of p.seats) assert.ok(nav.nearestWalkable(s.x, s.y, 4), `${p.name}: somewhere to stand up to`);
  for (const at of [level.hero.dock, spawn, level.spawns.epic, ...level.lifts]) assert.ok(nav.walkable(at.x, at.y) || nav.nearestWalkable(at.x, at.y, 1), 'the X, the entrances and the lifts stay clear');
  assert.equal(placeAt(places, level.hero.dock.x, level.hero.dock.y), null, 'the X is not inside another place');
});

test('what the game says about the show is counted from the data', () => {
  const cards = hallCards(level);
  assert.equal(cards.length, 9); assert.equal(cards.reduce((n, c) => n + c.booths, 0), level.booths.length);
  const lines = facts(level);
  assert.ok(lines.length >= 6 && lines.every((l) => l.length < 140 && !/undefined|NaN/.test(l)), lines.join('\n'));
  assert.ok(lines[0]!.includes(level.booths.length.toLocaleString()));
});
