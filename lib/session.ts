// Session cookie = "<userId>.<expiresMs>.<hmac>". No sessions table: changing SESSION_SECRET logs everyone out.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "crm_session";
export const SESSION_DAYS = 30;

function sign(data: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not set (32+ chars)");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function makeSession(userId: string) {
  const data = `${userId}.${Date.now() + SESSION_DAYS * 86_400_000}`;
  return `${data}.${sign(data)}`;
}

// userId of a valid, unexpired cookie; null otherwise
export function readSession(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const data = value.slice(0, i);
  const got = Buffer.from(value.slice(i + 1));
  const want = Buffer.from(sign(data));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [userId, exp] = data.split(".");
  return Number(exp) > Date.now() ? userId : null;
}
