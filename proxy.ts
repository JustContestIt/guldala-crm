import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "./lib/session";

// Without a valid session cookie every page goes to /login. Server actions re-check (lib/auth.ts).
// /public/* is the site's API (site/docs/crm-contract.md): no session, but the shared secret in a header.
// /webhooks/wazzup/<secret> is Wazzup's: no session, the route checks the secret in the path.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/webhooks/wazzup/")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/public/")) {
    const secret = process.env.CRM_PUBLIC_SECRET;
    if (secret && request.headers.get("x-public-secret") === secret) return NextResponse.next();
    return NextResponse.json({ error: "Доступ закрыт" }, { status: 401 });
  }
  if (readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/|manifest.webmanifest|icon|favicon).*)"],
};
