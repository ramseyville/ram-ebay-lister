// Postgres (Neon) over HTTPS — the same "SQL over HTTP" endpoint Neon's own
// serverless driver uses (https://api.<region host>/sql), called with fetch so
// the app needs no new dependency. Server-only.
//
// The connection string comes from the Vercel ↔ Neon integration
// (DATABASE_URL or DATABASE_POSTGRES_URL, set automatically).

function connectionString(): string {
  const url = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!url) throw new Error("The database isn't connected (DATABASE_URL is not set in Vercel).");
  return url;
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = connectionString();
  const host = new URL(conn).hostname.replace(/^[^.]+\./, "api.");
  const resp = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": conn,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(`Database error: ${data?.message || resp.status}`);
  return (data?.rows ?? []) as T[];
}

let ready: Promise<void> | null = null;

/** Listing Doctor tables, created on first use. */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = query(
      `CREATE TABLE IF NOT EXISTS doctor_backups (
         id          SERIAL PRIMARY KEY,
         item_id     TEXT NOT NULL,
         sku         TEXT,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
         backup      JSONB NOT NULL,
         applied     JSONB,
         applied_at  TIMESTAMPTZ,
         restored_at TIMESTAMPTZ
       )`
    )
      .then(() => query(`CREATE INDEX IF NOT EXISTS doctor_backups_item ON doctor_backups (item_id)`))
      // Bulk Doctor: one row per active listing, so a run picks up where the
      // last one stopped instead of starting from the oldest 20 again.
      .then(() =>
        query(
          `CREATE TABLE IF NOT EXISTS doctor_queue (
             item_id        TEXT PRIMARY KEY,
             sku            TEXT,
             title          TEXT,
             sku_order      INTEGER NOT NULL DEFAULT 0,
             status         TEXT NOT NULL DEFAULT 'new',
             needs_ai       BOOLEAN NOT NULL DEFAULT false,
             item           JSONB,
             proposal       JSONB,
             ai_description TEXT,
             ai_cost        NUMERIC,
             batch_id       TEXT,
             error          TEXT,
             updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
           )`
        )
      )
      .then(() => query(`CREATE INDEX IF NOT EXISTS doctor_queue_status ON doctor_queue (status, sku_order)`))
      .then(() => undefined)
      .catch((e) => {
        ready = null; // retry next time
        throw e;
      });
  }
  return ready;
}
