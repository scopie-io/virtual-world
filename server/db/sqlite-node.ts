import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db, Param, Stmt } from './types.js';

export function openNodeDb(file: string, schema: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(schema);

  return {
    async get<T>(sql: string, params: Param[] = []) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async all<T>(sql: string, params: Param[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: Param[] = []) {
      db.prepare(sql).run(...params);
    },
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [sql, params] of stmts) db.prepare(sql).run(...params);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
