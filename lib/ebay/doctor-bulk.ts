// Listing Doctor, bulk mode: works through EVERY active listing using a
// queue in the database, so each run carries on where the last one stopped.
//
//   new      → listed by sync, not read yet
//   read     → read + free fixes planned; waiting for an AI description
//   queued   → in an overnight Message Batch (half price)
//   ready    → planned change waiting for Apply
//   nochange → nothing to fix
//   skipped  → seller chose to leave it alone
//   applying → being written to eBay right now
//   applied  → changed on eBay (backed up; Undo on the Doctor page)
//   error    → something failed; "Retry" sends it back to new
//   ended    → no longer an active listing

import { getClient } from "@/lib/anthropic";
import { compareSkus } from "@/lib/doctor-sku";
import { ensureSchema, query } from "@/lib/db";
import { proposeFixes, type DoctorProposal } from "./doctor";
import { applyVersion, latestApplied } from "./doctor-apply";
import { describeCost, describeParams, finishDescription, type DescribeModel } from "./doctor-describe";
import { getItem, listActiveListings, type TradingItem } from "./trading";

export type QueueStatus =
  | "new" | "read" | "queued" | "ready" | "nochange" | "skipped" | "applying" | "applied" | "error" | "ended";

export interface QueueCounts {
  counts: Partial<Record<QueueStatus, number>>;
  aiCost: number;
  batches: { id: string; status: string; done: number; total: number }[];
}

export interface QueueRow {
  item_id: string;
  sku: string;
  title: string;
  status: QueueStatus;
  item: TradingItem | null;
  proposal: DoctorProposal | null;
  ai_description: string | null;
  ai_cost: number | null;
  error: string | null;
}

// Rough sizes so each database round trip stays well under Neon's HTTP limits.
const WRITE_CHUNK = 500;
const READ_CHUNK = 100;

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function parseJson<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

/** Problems a description-only rewrite can actually fix. */
export function needsAiDescription(p: Pick<DoctorProposal, "needsRewrite">): boolean {
  return p.needsRewrite.some((r) => /description|measurement/i.test(r));
}

export async function counts(): Promise<QueueCounts> {
  await ensureSchema();
  const rows = await query<{ status: QueueStatus; n: string | number; cost: string | number | null }>(
    `SELECT status, count(*) AS n, sum(ai_cost) AS cost FROM doctor_queue GROUP BY status`
  );
  const out: QueueCounts = { counts: {}, aiCost: 0, batches: [] };
  for (const r of rows) {
    out.counts[r.status] = Number(r.n);
    out.aiCost += Number(r.cost) || 0;
  }
  return out;
}

/** Add every active listing to the queue (oldest SKU first); mark sold/ended ones. */
export async function sync(token: string): Promise<number> {
  await ensureSchema();
  const all = await listActiveListings(token);
  all.sort((a, b) => compareSkus(a.sku, b.sku));
  const rows = all.map((s, i) => ({ item_id: s.itemId, sku: s.sku, title: s.title, sku_order: i }));
  // An empty answer is far more likely an eBay hiccup than a sold-out store.
  if (!rows.length) throw new Error("eBay returned no active listings — nothing was changed. Try again in a minute.");
  for (const part of chunks(rows, WRITE_CHUNK)) {
    await query(
      `INSERT INTO doctor_queue (item_id, sku, title, sku_order)
       SELECT item_id, sku, title, sku_order
         FROM jsonb_to_recordset($1::jsonb) AS x(item_id text, sku text, title text, sku_order int)
       ON CONFLICT (item_id) DO UPDATE SET
         sku = EXCLUDED.sku, title = EXCLUDED.title, sku_order = EXCLUDED.sku_order,
         status = CASE WHEN doctor_queue.status = 'ended' THEN 'new' ELSE doctor_queue.status END`,
      [JSON.stringify(part)]
    );
  }
  await query(
    `UPDATE doctor_queue SET status = 'ended', updated_at = now()
      WHERE status NOT IN ('applied', 'ended')
        AND item_id NOT IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(rows.map((r) => r.item_id))]
  );
  return rows.length;
}

/** Read the next unread listings and plan their free fixes, until the deadline. */
export async function readNext(token: string, deadline: number, max = 80): Promise<number> {
  await ensureSchema();
  const todo = await query<{ item_id: string }>(
    `SELECT item_id FROM doctor_queue WHERE status = 'new' ORDER BY sku_order LIMIT $1`,
    [max]
  );
  let done = 0;
  const queue = todo.map((r) => r.item_id);
  // A few at a time — each listing is one eBay GetItem plus a cached category lookup.
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length && Date.now() < deadline) {
      const id = queue.shift()!;
      try {
        const item = await getItem(token, id);
        const proposal = await proposeFixes(item);
        const before = await latestApplied(id).catch(() => null);
        const needsAi = needsAiDescription(proposal);
        const status: QueueStatus = before ? "applied" : needsAi ? "read" : proposal.changes.length ? "ready" : "nochange";
        await query(
          `UPDATE doctor_queue SET status = $2, needs_ai = $3, item = $4::jsonb, proposal = $5::jsonb,
                  ai_description = NULL, ai_cost = NULL, batch_id = NULL, error = NULL, updated_at = now()
            WHERE item_id = $1`,
          [id, status, needsAi, JSON.stringify(item), JSON.stringify(proposal)]
        );
      } catch (e) {
        await query(`UPDATE doctor_queue SET status = 'error', error = $2, updated_at = now() WHERE item_id = $1`, [
          id,
          (e as Error).message.slice(0, 1000),
        ]).catch(() => undefined);
      }
      done++;
    }
  });
  await Promise.all(workers);
  return done;
}

/**
 * Send the listings that need an AI description to an overnight Message Batch
 * (half price; usually finishes within an hour, always within 24).
 * scope "flagged": only listings whose description has a problem.
 * scope "all": every scanned listing that doesn't have an AI description yet.
 */
export async function submitBatch(scope: "flagged" | "all", model: DescribeModel, max = 1000): Promise<number> {
  await ensureSchema();
  const where =
    scope === "all"
      ? `status IN ('read', 'ready', 'nochange') AND ai_description IS NULL`
      : `status = 'read' AND needs_ai`;
  const rows: { item_id: string; item: unknown }[] = [];
  let after = -1;
  while (rows.length < max) {
    const page = await query<{ item_id: string; item: unknown; sku_order: number }>(
      `SELECT item_id, item, sku_order FROM doctor_queue
        WHERE ${where} AND item IS NOT NULL AND sku_order > $1
        ORDER BY sku_order LIMIT $2`,
      [after, Math.min(READ_CHUNK, max - rows.length)]
    );
    if (!page.length) break;
    rows.push(...page);
    after = Number(page[page.length - 1].sku_order);
  }
  if (!rows.length) return 0;

  const batch = await getClient().messages.batches.create({
    requests: rows.map((r) => ({
      custom_id: `${model}_${r.item_id}`,
      params: describeParams(parseJson<TradingItem>(r.item), model),
    })),
  });
  for (const part of chunks(rows.map((r) => r.item_id), WRITE_CHUNK)) {
    await query(
      `UPDATE doctor_queue SET status = 'queued', needs_ai = true, batch_id = $2, error = NULL, updated_at = now()
        WHERE item_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
      [JSON.stringify(part), batch.id]
    );
  }
  return rows.length;
}

/** Pick up finished batches: save each description and mark it ready to apply. */
export async function collectBatches(deadline: number): Promise<QueueCounts["batches"]> {
  await ensureSchema();
  const ids = await query<{ batch_id: string }>(
    `SELECT DISTINCT batch_id FROM doctor_queue WHERE status = 'queued' AND batch_id IS NOT NULL`
  );
  const client = getClient();
  const report: QueueCounts["batches"] = [];
  for (const { batch_id } of ids) {
    const b = await client.messages.batches.retrieve(batch_id);
    const c = b.request_counts;
    const total = c.processing + c.succeeded + c.errored + c.canceled + c.expired;
    report.push({ id: batch_id, status: b.processing_status, done: total - c.processing, total });
    if (b.processing_status !== "ended" || Date.now() > deadline) continue;

    const ct = await query<{ item_id: string; ct: string | null }>(
      `SELECT item_id, proposal->>'conditionText' AS ct FROM doctor_queue WHERE batch_id = $1 AND status = 'queued'`,
      [batch_id]
    );
    const conditionText = new Map(ct.map((r) => [r.item_id, r.ct || ""]));
    const updates: { item_id: string; status: QueueStatus; ai_description: string | null; ai_cost: number | null; error: string | null }[] = [];
    for await (const r of await client.messages.batches.results(batch_id)) {
      const [model, itemId] = r.custom_id.split("_") as [DescribeModel, string];
      if (!conditionText.has(itemId)) continue;
      if (r.result.type === "succeeded") {
        try {
          updates.push({
            item_id: itemId,
            status: "ready",
            ai_description: finishDescription(r.result.message, conditionText.get(itemId) || ""),
            ai_cost: describeCost(r.result.message.usage, model, true),
            error: null,
          });
        } catch (e) {
          updates.push({ item_id: itemId, status: "error", ai_description: null, ai_cost: null, error: (e as Error).message });
        }
      } else if (r.result.type === "errored") {
        updates.push({
          item_id: itemId,
          status: "error",
          ai_description: null,
          ai_cost: null,
          error: `AI description failed: ${r.result.error?.error?.message || "unknown error"}`,
        });
      } else {
        // Expired or canceled: back in line for the next batch.
        updates.push({ item_id: itemId, status: "read", ai_description: null, ai_cost: null, error: null });
      }
    }
    for (const part of chunks(updates, READ_CHUNK)) {
      await query(
        `UPDATE doctor_queue q SET status = x.status, ai_description = x.ai_description, ai_cost = x.ai_cost,
                error = x.error, batch_id = CASE WHEN x.status = 'read' THEN NULL ELSE q.batch_id END, updated_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS x(item_id text, status text, ai_description text, ai_cost numeric, error text)
          WHERE q.item_id = x.item_id AND q.status = 'queued'`,
        [JSON.stringify(part)]
      );
    }
  }
  return report;
}

export async function page(status: QueueStatus, offset: number, limit: number): Promise<QueueRow[]> {
  await ensureSchema();
  const rows = await query<QueueRow>(
    `SELECT item_id, sku, title, status, item, proposal, ai_description, ai_cost, error
       FROM doctor_queue WHERE status = $1 ORDER BY sku_order OFFSET $2 LIMIT $3`,
    [status, offset, limit]
  );
  return rows.map((r) => ({
    ...r,
    item: r.item ? parseJson<TradingItem>(r.item) : null,
    proposal: r.proposal ? parseJson<DoctorProposal>(r.proposal) : null,
    ai_cost: r.ai_cost === null ? null : Number(r.ai_cost),
  }));
}

/** Skip a planned change, or put a skipped one back. */
export async function setSkipped(itemId: string, skipped: boolean): Promise<void> {
  await ensureSchema();
  await query(`UPDATE doctor_queue SET status = $2, updated_at = now() WHERE item_id = $1 AND status = $3`, [
    itemId,
    skipped ? "skipped" : "ready",
    skipped ? "ready" : "skipped",
  ]);
}

/** Failed listings go back to the start, to be read fresh. */
export async function retryErrors(): Promise<void> {
  await ensureSchema();
  await query(`UPDATE doctor_queue SET status = 'new', error = NULL, batch_id = NULL, updated_at = now() WHERE status = 'error'`);
}

/** Apply the next ready listings to eBay, one at a time, until the deadline. */
export async function applyNext(token: string, deadline: number, max: number): Promise<number> {
  await ensureSchema();
  // A run that died mid-write: say so rather than leave it stuck.
  await query(
    `UPDATE doctor_queue SET status = 'error', error = 'Interrupted while applying — check this listing on eBay, then Retry.'
      WHERE status = 'applying' AND updated_at < now() - interval '10 minutes'`
  );
  let done = 0;
  while (done < max && Date.now() < deadline) {
    // Claim one row so two open tabs can never apply the same listing twice.
    const [row] = await query<{ item_id: string; item: unknown; proposal: unknown; ai_description: string | null }>(
      `UPDATE doctor_queue SET status = 'applying', updated_at = now()
        WHERE item_id = (SELECT item_id FROM doctor_queue WHERE status = 'ready' ORDER BY sku_order LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING item_id, item, proposal, ai_description`
    );
    if (!row) break;
    try {
      const p = parseJson<DoctorProposal>(row.proposal);
      const item = parseJson<TradingItem>(row.item);
      await applyVersion(
        token,
        row.item_id,
        {
          title: p.title,
          description: row.ai_description || p.description,
          price: p.price,
          categoryId: p.categoryId,
          specifics: p.specifics,
        },
        { onlyIfPrice: item.price }
      );
      await query(`UPDATE doctor_queue SET status = 'applied', error = NULL, updated_at = now() WHERE item_id = $1`, [row.item_id]);
    } catch (e) {
      await query(`UPDATE doctor_queue SET status = 'error', error = $2, updated_at = now() WHERE item_id = $1`, [
        row.item_id,
        (e as Error).message.slice(0, 1000),
      ]);
    }
    done++;
  }
  return done;
}
