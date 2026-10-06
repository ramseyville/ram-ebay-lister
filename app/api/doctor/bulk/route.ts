import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { query } from "@/lib/db";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { undoLatest } from "@/lib/ebay/doctor-apply";
import {
  applyNext,
  collectBatches,
  counts,
  page,
  readNext,
  retryErrors,
  setSkipped,
  submitBatch,
  sync,
  type QueueStatus,
} from "@/lib/ebay/doctor-bulk";

// Listing Doctor, bulk mode. One route, one action per request; each action
// does as much as fits in one function run and reports the queue's counts,
// so the page just calls it again until there's nothing left.
export const maxDuration = 280;

// Leave room under maxDuration to write the last results and answer.
const BUDGET_MS = 220_000;

const STATUSES: QueueStatus[] = ["new", "read", "queued", "ready", "nochange", "skipped", "applying", "applied", "error", "ended"];

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "status");
  const itemId = String(body?.itemId || "").trim();

  const needsToken = ["sync", "read", "apply", "undo"].includes(action);
  let token: string | null = null;
  if (needsToken) {
    try {
      token = await accessTokenFromCookie(req.cookies.get(EBAY_COOKIE)?.value);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
    if (!token) {
      return NextResponse.json({ ok: false, error: "eBay isn't connected. Connect your account and try again." }, { status: 401 });
    }
  }

  try {
    const result: Record<string, unknown> = {};
    switch (action) {
      case "status":
        break;
      case "sync":
        result.listed = await sync(token!);
        break;
      case "read":
        result.processed = await readNext(token!, deadline);
        break;
      case "submit":
        result.submitted = await submitBatch(body?.scope === "all" ? "all" : "flagged", body?.model === "sonnet" ? "sonnet" : "haiku");
        break;
      case "collect":
        result.batches = await collectBatches(deadline);
        break;
      case "apply":
        result.processed = await applyNext(token!, deadline, Math.min(Math.max(Number(body?.count) || 10, 1), 500));
        break;
      case "page": {
        const status = STATUSES.includes(body?.status) ? (body.status as QueueStatus) : "ready";
        result.rows = await page(status, Math.max(Number(body?.offset) || 0, 0), 10);
        break;
      }
      case "skip":
      case "unskip":
        if (!/^\d{6,20}$/.test(itemId)) throw new Error("Missing or invalid eBay item number.");
        await setSkipped(itemId, action === "skip");
        break;
      case "undo":
        if (!/^\d{6,20}$/.test(itemId)) throw new Error("Missing or invalid eBay item number.");
        await undoLatest(token!, itemId);
        // Restored listings are left alone by later bulk runs.
        await query(`UPDATE doctor_queue SET status = 'skipped', updated_at = now() WHERE item_id = $1`, [itemId]);
        break;
      case "retry":
        await retryErrors();
        break;
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...result, ...(await counts()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
