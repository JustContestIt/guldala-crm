import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

// "scrypt$<salt>$<hash>": stdlib scrypt instead of bcrypt from spec §4, same purpose without a dependency
export async function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await scryptAsync(pw, salt, 64)).toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const got = await scryptAsync(pw, salt, 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
