// The game's Db interface on top of sql.js (SQLite compiled to WebAssembly), for the in-browser demo backend.
// sql.js is synchronous, so a batch can never interleave with another request: BEGIN…COMMIT runs in one go.
import type { Database } from 'sql.js';
import type { Db, Param, Stmt } from '../../server/db/types.js';

export interface DemoDb extends Db { /** true once anything was written since the last call to `saved()` */ dirty(): boolean; saved(): void; bytes(): Uint8Array }

export function openSqlJs(db: Database, schema: string): DemoDb {
  let dirty = false;
  db.exec(schema);

  const rows = <T,>(sql: string, params: Param[], first: boolean): T[] => {
    const st = db.prepare(sql), out: T[] = [];
    try { st.bind(params); while (st.step()) { out.push(st.getAsObject() as T); if (first) break; } } finally { st.free(); }
    return out;
  };

  return {
    async get<T>(sql: string, params: Param[] = []) { return rows<T>(sql, params, true)[0]; },
    async all<T>(sql: string, params: Param[] = []) { return rows<T>(sql, params, false); },
    async run(sql: string, params: Param[] = []) { db.run(sql, params); dirty = true; },
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try { for (const [sql, params] of stmts) db.run(sql, params); db.exec('COMMIT'); dirty = true; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    dirty: () => dirty,
    saved: () => { dirty = false; },
    bytes: () => db.export(),
  };
}
