import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/anthropic";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import { sortPhotos, SortAuthError } from "@/lib/sortPipeline";
import type { WireImage } from "@/lib/images";

// Sorting makes several model calls across grouping/verify/merge stages.
export const maxDuration = 120;

const MAX_PHOTOS = 120;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { images?: WireImage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_PHOTOS) : [];
  if (images.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Please add some photos first." },
      { status: 400 }
    );
  }

  let client;
  try {
    client = getClient();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }

  try {
    const result = await sortPhotos(client, images);
    if (result.groups.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Couldn't sort these photos. Try fewer at a time." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof SortAuthError) {
      console.error("[sort] auth/billing failure:", e.message);
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return safeErrorResponse("sort", e, "Sorting failed — please try again.");
  }
}
