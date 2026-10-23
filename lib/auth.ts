import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { users } from "@/db/schema";
import { readSession, SESSION_COOKIE } from "./session";

export type User = typeof users.$inferSelect;

export const currentUser = cache(async (): Promise<User | null> => {
  const id = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u ?? null;
});

// Every page and server action calls one of these: proxy.ts alone doesn't cover server actions
export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireOwner() {
  const u = await requireUser();
  if (u.role !== "owner") redirect("/");
  return u;
}
