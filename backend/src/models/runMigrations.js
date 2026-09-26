/**
 * Minimal, dependency-free migration runner.
 * Applies every .sql file in ./migrations, in filename order, that isn't already recorded
 * in schema_migrations. Safe to run repeatedly (idempotent).
 *
 * Usage: npm run migrate
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  const client = await pool.connect();
  try {
    // Bootstrap: schema_migrations itself is created by 001_init.sql, but we need somewhere
    // to check *before* running it too — CREATE TABLE IF NOT EXISTS makes this safe either way.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    const { rows: applied } = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.filename));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ranAny = false;
    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`⏭  Skipping ${file} (already applied)`);
        continue;
      }
      console.log(`→ Applying ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ranAny = true;
        console.log(`✔ Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log(ranAny ? '\n✔ Migrations complete.' : '\n✔ Already up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
