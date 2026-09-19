import { Pool } from "pg";

const globalForDb = globalThis as unknown as { pool: Pool | undefined };

export function getDb(): Pool {
  if (!globalForDb.pool) {
    globalForDb.pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://localhost:5432/localscan",
    });
  }
  return globalForDb.pool;
}
