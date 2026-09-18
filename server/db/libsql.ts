// libSQL / Turso adapter: hosted SQLite over HTTP — what the game runs on when it is deployed to Vercel, where there is
// no disk to keep a database file on. Same SQL as the local node:sqlite adapter; the test suite runs against both.
import type { Db, Param, Stmt } from './types.js';

/** The slice of @libsql/client we use — satisfied by both `@libsql/client` (Node) and `@libsql/client/web` (fetch only). */
export interface LibsqlLike {
  execute(stmt: { sql: string; args: Param[] }): Promise<{ columns: string[]; rows: ArrayLike<unknown>[] }>;
  batch(stmts: { sql: string; args: Param[] }[], mode: 'write'): Promise<unknown>;
  executeMultiple(sql: string): Promise<void>;
}

export function openLibsql(client: LibsqlLike): Db & { migrate(schema: string): Promise<void> } {
  const rows = async <T,>(sql: string, args: Param[]) => {
    const r = await client.execute({ sql, args });
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as T);
  };
  return {
    async get<T>(sql: string, params: Param[] = []) { return (await rows<T>(sql, params))[0]; },
    all: <T,>(sql: string, params: Param[] = []) => rows<T>(sql, params),
    async run(sql: string, params: Param[] = []) { await client.execute({ sql, args: params }); },
    /** One transaction: all statements commit together or not at all. */
    async batch(stmts: Stmt[]) { if (stmts.length) await client.batch(stmts.map(([sql, args]) => ({ sql, args })), 'write'); },
    migrate: (schema: string) => client.executeMultiple(schema),
  };
}
