// WhatsApp dialog (spec §3.5, §12): Tatiana previews, edits and sends one message at a time; webhooks bring the rest
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appState, clients, conversations, messages, orderEvents } from "@/db/schema";
import { normalizePhone } from "@/lib/format";
import { chatAllowed, messaging, type InMessage, type MessagingProvider, type Webhook } from "@/integrations/messaging";
import type { Actor } from "./orders";
import { saveState } from "./settings";

export type SendInput = { phone: string; text: string; templateKey: string | null; orderId?: string | null };

// The client and their WhatsApp dialog for a normalized phone, created on first use:
// whoever is written to is a client from now on (they wrote to Tatiana's WhatsApp first)
export async function whatsappConversation(phone: string, patch: Partial<typeof conversations.$inferInsert> = {}) {
  const chatId = phone.slice(1); // Wazzup wants digits only
  const [client] = await db
    .insert(clients)
    .values({ phone, source: "inbound_message" })
    .onConflictDoUpdate({ target: clients.phone, set: { phone } })
    .returning({ id: clients.id });
  const [conv] = await db
    .insert(conversations)
    .values({ clientId: client.id, channel: "whatsapp", externalId: chatId, providerChannelId: process.env.WAZZUP_CHANNEL_ID || null, ...patch })
    .onConflictDoUpdate({ target: [conversations.channel, conversations.externalId], set: { clientId: client.id, ...patch } })
    .returning({ id: conversations.id });
  return { clientId: client.id, conversationId: conv.id, chatId };
}

type Outgoing = { id: string; conversationId: string; chatId: string; text: string; templateKey: string | null; orderId: string | null };

// One attempt through the provider: the message row tells how it went, and the order journal when there is an order
async function deliver(m: Outgoing, actor: Actor | null, provider: MessagingProvider) {
  const event = (type: "message_sent" | "notification", payload: Record<string, unknown>) =>
    m.orderId ? db.insert(orderEvents).values({ orderId: m.orderId, type, payload, actorType: actor ? "user" : "system", actorId: actor?.id ?? null }) : null;
  try {
    const { messageId } = await provider.send({ chatId: m.chatId, text: m.text, crmMessageId: m.id });
    // the webhook echo may have overtaken this answer (storeEcho): keep the id it set and a later status
    await db
      .update(messages)
      .set({
        status: sql`case when ${messages.status} = 'queued' then 'sent'::message_status else ${messages.status} end`,
        externalMessageId: sql`coalesce(${messages.externalMessageId}, ${messageId || null})`,
        sentAt: new Date(),
      })
      .where(eq(messages.id, m.id));
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, m.conversationId));
    await event("message_sent", { template: m.templateKey, messageId, provider: provider.name });
    return { ok: true as const, provider: provider.name };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.update(messages).set({ status: "error", error }).where(eq(messages.id, m.id));
    await event("notification", { template: m.templateKey, error });
    return { ok: false as const, error: `Не отправилось: ${error}. Скопируйте текст и отправьте вручную.` };
  }
}

export async function sendMessage(input: SendInput, actor: Actor | null, provider: MessagingProvider = messaging()) {
  const phone = normalizePhone(input.phone);
  const text = input.text.trim();
  if (!phone) return { ok: false as const, error: "Телефон: казахстанский номер, +7 и 10 цифр" };
  if (!text) return { ok: false as const, error: "Пустое сообщение" };

  const { conversationId, chatId } = await whatsappConversation(phone);
  const [msg] = await db
    .insert(messages)
    .values({ conversationId, direction: "out", author: actor ? "operator" : "system", text, status: "queued", templateKey: input.templateKey })
    .returning({ id: messages.id });
  return deliver({ id: msg.id, conversationId, chatId, text, templateKey: input.templateKey, orderId: input.orderId ?? null }, actor, provider);
}

// The assistant's draft goes out as written or as Tatiana corrected it; the author stays `assistant` (spec §19)
export async function sendDraft(id: string, text: string, actor: Actor | null, provider: MessagingProvider = messaging()) {
  const body = text.trim();
  if (!body) return { ok: false as const, error: "Пустое сообщение" };
  const [msg] = await db
    .update(messages)
    .set({ text: body, status: "queued" })
    .where(and(eq(messages.id, id), eq(messages.status, "draft")))
    .returning({ id: messages.id, conversationId: messages.conversationId });
  if (!msg) return { ok: false as const, error: "Черновик уже отправлен или удалён" };
  const [conv] = await db.select({ chatId: conversations.externalId }).from(conversations).where(eq(conversations.id, msg.conversationId));
  return deliver({ ...msg, chatId: conv.chatId, text: body, templateKey: null, orderId: null }, actor, provider);
}

export async function deleteDraft(id: string) {
  const r = await db.delete(messages).where(and(eq(messages.id, id), eq(messages.status, "draft"))).returning({ id: messages.id });
  return r.length ? { ok: true as const } : { ok: false as const, error: "Черновик уже отправлен или удалён" };
}

// «Бот молчит» in one chat: set by Tatiana's echo and by handoff, lifted by the button in the client card (spec §19)
export async function setAssistantMuted(conversationId: string, muted: boolean) {
  await db.update(conversations).set({ assistantMutedAt: muted ? new Date() : null }).where(eq(conversations.id, conversationId));
}

// ——— webhooks (spec §12) ———

// A new message from a client: what the assistant answers
export type Inbound = { id: string; conversationId: string; clientId: string; chatId: string; type: string };

async function storeInbound(m: InMessage): Promise<Inbound | null> {
  const { clientId, conversationId } = await whatsappConversation(`+${m.chatId}`);
  const [row] = await db
    .insert(messages)
    .values({ conversationId, direction: "in", author: "client", text: m.text, attachments: m.attachments, externalMessageId: m.messageId, status: "delivered" })
    .onConflictDoNothing({ target: messages.externalMessageId })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  if (!row) return null; // a repeated webhook: stored and answered the first time
  await db.update(conversations).set({ lastMessageAt: row.createdAt, lastInboundAt: row.createdAt }).where(eq(conversations.id, conversationId));
  return { id: row.id, conversationId, clientId, chatId: m.chatId, type: m.type };
}

async function storeEcho(m: InMessage) {
  const { conversationId } = await whatsappConversation(`+${m.chatId}`);
  const [known] = await db.select({ id: messages.id }).from(messages).where(eq(messages.externalMessageId, m.messageId));
  if (known) return; // the echo of a message the CRM sent
  // ours still in flight: the echo overtook Wazzup's answer to the send, so the row has no messageId yet
  const claimed = await db.execute(sql`
    update messages set external_message_id = ${m.messageId}
    where id = (select id from messages
      where conversation_id = ${conversationId} and direction = 'out' and not is_echo and external_message_id is null
        and status in ('queued', 'sent') and text = ${m.text} and created_at > now() - interval '10 minutes'
      order by created_at limit 1 for update skip locked)
    returning id`);
  if (claimed.length) return;
  // Tatiana wrote from her phone or Wazzup's chat: history, and the bot keeps quiet in this chat
  const [row] = await db
    .insert(messages)
    .values({ conversationId, direction: "out", author: "operator", isEcho: true, text: m.text, attachments: m.attachments, externalMessageId: m.messageId, status: "sent", sentAt: new Date() })
    .onConflictDoNothing({ target: messages.externalMessageId })
    .returning({ id: messages.id });
  if (row)
    await db
      .update(conversations)
      .set({ lastMessageAt: new Date(), assistantMutedAt: sql`coalesce(${conversations.assistantMutedAt}, now())` })
      .where(eq(conversations.id, conversationId));
}

// Statuses only move forward: a late «delivered» doesn't undo «read»
const BEFORE = { sent: ["queued"], delivered: ["queued", "sent"], read: ["queued", "sent", "delivered"], error: ["queued", "sent", "delivered"] } as const;

export async function receiveWebhook(w: Webhook): Promise<Inbound[]> {
  const channel = process.env.WAZZUP_CHANNEL_ID;
  const ours = w.messages.filter((m) => (!channel || m.channelId === channel) && chatAllowed(m.chatId));
  const skipped = w.messages.length - ours.length;
  // counts only: the skipped ones are other people's chats (the test channel is Nikita's own number)
  console.log(`[wazzup] webhook: ${ours.length} messages, ${w.statuses.length} statuses, ${w.channels.length} channel updates${skipped ? `, ${skipped} skipped` : ""}`);
  await saveState("wazzup:webhook", {});
  for (const c of w.channels) if (c.channelId === channel) await saveState("wazzup:channel", { state: c.state });
  // shortcut: a status that comes before the CRM stored its send's messageId is lost (stays «sent»); hold such statuses if it shows up live
  for (const s of w.statuses)
    await db
      .update(messages)
      .set({ status: s.status, error: s.error, ...(s.status === "read" && { readAt: new Date() }) })
      .where(and(eq(messages.externalMessageId, s.messageId), inArray(messages.status, [...BEFORE[s.status]])));
  const fresh: Inbound[] = [];
  for (const m of ours) {
    if (m.isEcho) await storeEcho(m);
    else {
      const r = await storeInbound(m);
      if (r) fresh.push(r);
    }
  }
  return fresh;
}

// «Настройки → WhatsApp»: subscribe the webhooks (Wazzup checks the address first) and read the channel state
export async function connectChannel(provider: MessagingProvider = messaging()) {
  const secret = process.env.WAZZUP_WEBHOOK_SECRET;
  const base = process.env.PUBLIC_URL;
  if (!secret || !base) return { ok: false as const, error: "Не заданы WAZZUP_WEBHOOK_SECRET и PUBLIC_URL" };
  try {
    const uri = await provider.subscribe(`${base}/webhooks/wazzup/${secret}`);
    const ch = await provider.channelStatus();
    await saveState("wazzup:channel", ch);
    return uri === `${base}/webhooks/wazzup/${secret}` ? { ok: true as const, state: ch.state } : { ok: false as const, error: "Wazzup не сохранил адрес вебхука" };
  } catch (e) {
    return { ok: false as const, error: `Не получилось: ${e instanceof Error ? e.message : e}` };
  }
}

// ——— reads ———

export async function channelInfo() {
  const rows = await db.select().from(appState).where(inArray(appState.key, ["wazzup:channel", "wazzup:webhook"]));
  const ch = rows.find((r) => r.key === "wazzup:channel");
  return {
    state: (ch?.value.state as string | undefined) ?? null,
    phone: (ch?.value.phone as string | undefined) ?? null,
    stateAt: ch?.updatedAt ?? null,
    webhookAt: rows.find((r) => r.key === "wazzup:webhook")?.updatedAt ?? null,
  };
}

// The client card: the WhatsApp dialog, last 30 messages oldest first (drafts included)
export async function clientChat(clientId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.clientId, clientId), eq(conversations.channel, "whatsapp")))
    .limit(1);
  if (!conv) return null;
  const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.createdAt)).limit(30);
  return { conversation: conv, messages: rows.reverse() };
}

const who = { id: clients.id, name: clients.name, company: clients.company, phone: clients.phone };

// «Написали, но заказа нет» (spec §5.1): a message in the last 24 h and no live order this season
export async function wroteNoOrder(seasonId: string) {
  return db
    .select({ ...who, at: conversations.lastInboundAt, mutedAt: conversations.assistantMutedAt })
    .from(conversations)
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .where(
      and(
        gt(conversations.lastInboundAt, new Date(Date.now() - 86_400_000)),
        sql`not exists (select 1 from orders o where o.client_id = ${clients.id} and o.season_id = ${seasonId} and o.status in ('new', 'confirmed', 'prepaid', 'ready'))`,
      ),
    )
    .orderBy(desc(conversations.lastInboundAt));
}

// Clients with assistant drafts waiting for «Отправить»
export async function draftClients() {
  return db
    .select({ ...who, drafts: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .where(eq(messages.status, "draft"))
    .groupBy(clients.id);
}
