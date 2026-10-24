// Рассылка (Nikita 24.10.2026): one text to many clients, {имя} / {магазин} filled per client (lib/templates.ts).
// Every message is a `messages` row with template_key = broadcast:<id>: all queued at once, then sent one by one
// with a pause — WhatsApp bans a personal number for a burst of identical messages (spec §12).
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, conversations, messages } from "@/db/schema";
import { messaging, type MessagingProvider } from "@/integrations/messaging";
import { fillBroadcast } from "@/lib/templates";
import { sendQueued, whatsappConversation } from "./messages";

export const MAX_RECIPIENTS = 300;
export const PAUSE_S = [30, 60] as const;
const PREFIX = "broadcast:";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pauseBetween = () => sleep((PAUSE_S[0] + Math.random() * (PAUSE_S[1] - PAUSE_S[0])) * 1000);

// shortcut: one CRM process — a restart stops a running broadcast; the page then offers «Продолжить»
const running = new Set<string>();

export async function startBroadcast(text: string, clientIds: string[]) {
  const body = text.trim();
  const ids = [...new Set(clientIds)];
  if (!body) return { ok: false as const, error: "Пустое сообщение" };
  if (!ids.length) return { ok: false as const, error: "Выберите хотя бы одного клиента" };
  if (ids.length > MAX_RECIPIENTS) return { ok: false as const, error: `За один раз — не больше ${MAX_RECIPIENTS} клиентов` };
  const list = await db
    .select({ id: clients.id, phone: clients.phone, name: clients.name, company: clients.company })
    .from(clients)
    .where(inArray(clients.id, ids))
    .orderBy(asc(sql`coalesce(nullif(${clients.company}, ''), nullif(${clients.name}, ''), ${clients.phone})`));
  const key = `${PREFIX}${crypto.randomUUID()}`;
  for (const c of list) {
    const { conversationId } = await whatsappConversation(c.phone);
    await db.insert(messages).values({ conversationId, direction: "out", author: "operator", text: fillBroadcast(body, c), status: "queued", templateKey: key });
  }
  return { ok: true as const, key, count: list.length };
}

// Sends what is still queued, oldest first; ends when nothing is left (sent, failed or stopped)
export async function runBroadcast(key: string, provider: MessagingProvider = messaging(), pause = pauseBetween) {
  if (!key.startsWith(PREFIX) || running.has(key)) return;
  running.add(key);
  try {
    for (;;) {
      const [next] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.templateKey, key), eq(messages.status, "queued")))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(1);
      if (!next) return;
      const r = await sendQueued(next.id, provider);
      if (r.ok) await pause(); // a refused send (test whitelist, no WhatsApp) never reached the number: no wait
    }
  } catch (e) {
    console.error(`[broadcast] ${key} stopped:`, e);
  } finally {
    running.delete(key);
  }
}

// «Остановить»: what hasn't gone out yet is dropped; sent messages stay in the dialogs
export async function stopBroadcast(key: string) {
  if (!key.startsWith(PREFIX)) return { ok: false as const, error: "Рассылка не найдена" };
  const r = await db
    .delete(messages)
    .where(and(eq(messages.templateKey, key), eq(messages.status, "queued")))
    .returning({ id: messages.id });
  return { ok: true as const, removed: r.length };
}

export async function broadcastList(limit = 10) {
  const rows = await db
    .select({
      key: messages.templateKey,
      at: sql<string>`min(${messages.createdAt})`,
      total: sql<number>`count(*)::int`,
      queued: sql<number>`(count(*) filter (where ${messages.status} = 'queued'))::int`,
      sent: sql<number>`(count(*) filter (where ${messages.status} in ('sent', 'delivered', 'read')))::int`,
      read: sql<number>`(count(*) filter (where ${messages.status} = 'read'))::int`,
      failed: sql<number>`(count(*) filter (where ${messages.status} = 'error'))::int`,
      sample: sql<string>`(array_agg(${messages.text} order by ${messages.createdAt}))[1]`,
    })
    .from(messages)
    .where(like(messages.templateKey, `${PREFIX}%`))
    .groupBy(messages.templateKey)
    .orderBy(desc(sql`min(${messages.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({ ...r, key: r.key!, running: running.has(r.key!) }));
}

// Who didn't get it and why — the client card opens from here
export async function broadcastFailures(key: string) {
  return db
    .select({ id: clients.id, name: clients.name, company: clients.company, phone: clients.phone, error: messages.error })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .where(and(eq(messages.templateKey, key), eq(messages.status, "error")));
}
