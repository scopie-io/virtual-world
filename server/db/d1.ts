// Cloudflare D1 adapter. Same SQL as the local node:sqlite adapter.
// NOT yet exercised against a real D1 database — verify with `wrangler dev` before the first deploy.
import type { Db, Param, Stmt } from './types.js';

interface D1Prepared { bind(...p: Param[]): D1Prepared; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
export interface D1Like { prepare(sql: string): D1Prepared; batch(stmts: D1Prepared[]): Promise<unknown> }

export function openD1(d1: D1Like): Db {
  return {
    async get<T>(sql: string, params: Param[] = []) {
      return (await d1.prepare(sql).bind(...params).first<T>()) ?? undefined;
    },
    async all<T>(sql: string, params: Param[] = []) {
      return (await d1.prepare(sql).bind(...params).all<T>()).results;
    },
    async run(sql: string, params: Param[] = []) {
      await d1.prepare(sql).bind(...params).run();
    },
    async batch(stmts: Stmt[]) {
      await d1.batch(stmts.map(([sql, params]) => d1.prepare(sql).bind(...params)));
    },
  };
}
