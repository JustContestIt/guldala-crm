"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { str, type FormState } from "@/lib/form";
import { verifyPassword } from "@/lib/password";
import { makeSession, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

// shortcut: brute-force guard lives in process memory and resets on restart; fine for one server and two users
const failures = new Map<string, { n: number; until: number }>();
const MAX_TRIES = 5;
const LOCK_MS = 15 * 60_000;

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const login = str(fd, "login", 100).toLowerCase();
  const f = failures.get(login);
  if (f && f.n >= MAX_TRIES && f.until > Date.now()) return { error: "Слишком много попыток. Попробуйте через 15 минут." };

  const [u] = await db.select().from(users).where(eq(users.login, login));
  if (!u || !(await verifyPassword(str(fd, "password", 200), u.passwordHash))) {
    failures.set(login, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + LOCK_MS });
    return { error: "Неверный логин или пароль" };
  }
  failures.delete(login);
  (await cookies()).set(SESSION_COOKIE, makeSession(u.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86_400,
    path: "/",
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
