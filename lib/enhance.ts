// Standalone Sharp photo enhancement — imported directly by the publish
// pipeline so it runs in-process rather than via HTTP (which fails in
// serverless because the function can't call itself via localhost).
export async function enhanceMainPhoto(
  data: string,
  mediaType: string
): Promise<{ data: string; mediaType: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const inputBuffer = Buffer.from(data, "base64");

    const processed = await sharp(inputBuffer)
      // 1. Auto-rotate from EXIF so phone photos aren't sideways.
      .rotate()
      // 2. Trim near-white borders (threshold 20/255).
      .trim({ threshold: 20 })
      // 3. Place on a square white canvas — eBay recommends square main photos.
      .resize(1600, 1600, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
      })
      // 4. Modest sharpening to counter softening from resize.
      .sharpen({ sigma: 0.6 })
      // 5. High-quality JPEG output.
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    return {
      data: processed.toString("base64"),
      mediaType: "image/jpeg",
    };
  } catch {
    // Sharp unavailable or failed — return original unchanged.
    return { data, mediaType };
  }
}
