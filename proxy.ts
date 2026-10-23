import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "./lib/session";

// Without a valid session cookie every page goes to /login. Server actions re-check (lib/auth.ts).
export function proxy(request: NextRequest) {
  if (readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/|manifest.webmanifest|icon|favicon).*)"],
};
