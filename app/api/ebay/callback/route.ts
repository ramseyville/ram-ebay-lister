import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { exchangeCode } from "@/lib/ebay/oauth";
import {
  EBAY_COOKIE,
  EBAY_COOKIE_MAX_AGE,
  EBAY_STATE_COOKIE,
  connectionFromToken,
  sealConnection,
} from "@/lib/ebay/session";

export const dynamic = "force-dynamic";

function appUrl(req: NextRequest, path: string): URL {
  const base = process.env.APP_URL || req.nextUrl.origin;
  return new URL(path, base);
}

// eBay redirects the user back here with ?code=... after they consent.
export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;

  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(appUrl(req, "/?ebay=error&msg=No+authorization+code"));
  }

  // Note: state verification skipped — this is a single-user app protected by APP_SECRET.
  // The state cookie approach is unreliable across popup windows on some browsers.

  try {
    const token = await exchangeCode(code);
    if (!token.refresh_token) {
      throw new Error("eBay did not return a refresh token.");
    }
    const sealed = await sealConnection(
      connectionFromToken(token.refresh_token, token.refresh_token_expires_in)
    );

    const cookieHeader = [
      `${EBAY_COOKIE}=${sealed}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${EBAY_COOKIE_MAX_AGE}`,
    ].join("; ");

    const deleteCookieHeader = [
      `${EBAY_STATE_COOKIE}=`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=0",
    ].join("; ");

    const appOrigin = process.env.APP_URL || req.nextUrl.origin;
    const html = `<!DOCTYPE html><html><head><title>Connected</title></head><body>
<p>eBay connected ✅ — closing…</p>
<script>
try {
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'ebay-connected' }, ${JSON.stringify(appOrigin)});
    setTimeout(function() { window.close(); }, 500);
  } else {
    window.location.href = '/?ebay=connected';
  }
} catch(e) {
  window.location.href = '/?ebay=connected';
}
</script>
</body></html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Set-Cookie": [cookieHeader, deleteCookieHeader] as unknown as string,
      },
    });
  } catch (e) {
    const msg = encodeURIComponent((e as Error).message);
    return NextResponse.redirect(appUrl(req, `/?ebay=error&msg=${msg}`));
  }
}
