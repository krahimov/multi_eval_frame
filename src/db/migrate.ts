import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, getDbConfigFromEnv } from "./pool.js";

async function ensureSchemaMigrationsTable(pool: import("pg").Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(pool: import("pg").Pool): Promise<Set<string>> {
  const res = await pool.query<{ migration_name: string }>(
    `SELECT migration_name FROM schema_migrations ORDER BY migration_name ASC`
  );
  return new Set(res.rows.map((r) => r.migration_name));
}

async function applyMigration(pool: import("pg").Pool, name: string, sql: string): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (migration_name) VALUES ($1)`, [name]);
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

export async function runMigrations(): Promise<void> {
  const pool = createPool(getDbConfigFromEnv());
  try {
    await ensureSchemaMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);

    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(here, "../../migrations");
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const migrationFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".sql"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    for (const name of migrationFiles) {
      if (applied.has(name)) continue;
      const fullPath = path.join(migrationsDir, name);
      const sql = await fs.readFile(fullPath, "utf8");
      await applyMigration(pool, name, sql);
      // eslint-disable-next-line no-console
      console.log(`Applied migration: ${name}`);
    }
  } finally {
    await pool.end();
  }
}



