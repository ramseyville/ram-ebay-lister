import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";

// Sharp is a native module — import dynamically so Next.js doesn't try to
// bundle it for the browser, and so missing-binary errors surface clearly.
async function getSharp() {
  const sharp = (await import("sharp")).default;
  return sharp;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { data?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const { data, mediaType = "image/jpeg" } = body;
  if (!data) {
    return NextResponse.json({ success: false, error: "No image data provided." }, { status: 400 });
  }

  try {
    const sharp = await getSharp();
    const inputBuffer = Buffer.from(data, "base64");

    const processed = await sharp(inputBuffer)
      // 1. Auto-rotate based on EXIF orientation so phone photos aren't sideways.
      .rotate()
      // 2. Trim near-white borders (threshold 20/255 — keeps detail, cuts dead space).
      .trim({ threshold: 20 })
      // 3. Add a clean white border around the subject (3% of longest side).
      .extend({
        top: 0, bottom: 0, left: 0, right: 0,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      // 4. Place on a square white canvas (eBay recommends square for main photo).
      .resize(1600, 1600, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
      })
      // 5. Modest sharpening to counter any softening from resize.
      .sharpen({ sigma: 0.6 })
      // 6. Output as JPEG at high quality.
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    return NextResponse.json({
      success: true,
      data: processed.toString("base64"),
      mediaType: "image/jpeg",
    });
  } catch (e) {
    // If Sharp isn't available (e.g. native binary missing), fail gracefully
    // so the publish pipeline can continue with the original photo.
    console.error("Sharp processing failed:", e);
    return NextResponse.json(
      { success: false, error: `Image processing failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
