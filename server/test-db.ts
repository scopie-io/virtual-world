// Test database: node:sqlite in memory by default; MX_TEST_DB=libsql runs the same suite through the libSQL adapter
// (a temp file — libSQL opens a new connection per transaction, which would lose an in-memory database).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeDb } from './db/sqlite-node.js';
import { openLibsql, type LibsqlLike } from './db/libsql.js';
import { SCHEMA } from './db/schema.js';
import type { Db } from './db/types.js';
import { DbPresence, type Presence } from './presence.js';

export async function testDb(): Promise<Db> {
  if (process.env.MX_TEST_DB !== 'libsql') return openNodeDb(':memory:', SCHEMA);
  const { createClient } = await import('@libsql/client');
  const db = openLibsql(createClient({ url: 'file:' + join(tmpdir(), `mx-test-${crypto.randomUUID()}.db`) }) as unknown as LibsqlLike);
  await db.migrate(SCHEMA);
  return db;
}

/** MX_TEST_PRESENCE=db swaps the in-memory presence store for the database-backed one used on serverless. */
export async function testStores(): Promise<{ db: Db; presence?: Presence }> {
  const db = await testDb();
  return process.env.MX_TEST_PRESENCE === 'db' ? { db, presence: new DbPresence(db) } : { db };
}
