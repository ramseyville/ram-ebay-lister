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
      .then(() => undefined)
      .catch((e) => {
        ready = null; // retry next time
        throw e;
      });
  }
  return ready;
}
