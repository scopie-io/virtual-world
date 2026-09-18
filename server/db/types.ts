export type Param = string | number | null;
export type Stmt = [sql: string, params: Param[]];

/** Minimal async DB surface implemented by both node:sqlite and Cloudflare D1. */
export interface Db {
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  run(sql: string, params?: Param[]): Promise<void>;
  /** All statements commit together or not at all. */
  batch(stmts: Stmt[]): Promise<void>;
}
