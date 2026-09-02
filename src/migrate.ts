import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

async function ensureTrackingTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function main(): Promise<void> {
  await ensureTrackingTable();

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  // Legacy support: databases migrated before tracking existed have no rows
  // in schema_migrations. If the tracked set is empty but tables exist
  // (001's artifacts present), record 001 as applied rather than re-running it.
  const applied = new Set(
    (
      await pool.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations",
      )
    ).rows.map((row) => row.filename),
  );
  if (applied.size === 0 && files.includes("001_init.sql")) {
    const probe = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'asset_thresholds'
       ) AS exists`,
    );
    if (probe.rows[0]?.exists === true) {
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        ["001_init.sql"],
      );
      console.log("Legacy database detected — recorded 001_init.sql as already applied");
      applied.add("001_init.sql");
    }
  }

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
      ran += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (ran === 0) console.log("Migrations up to date");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
