// Outgoing WhatsApp texts: Tatiana previews, edits and sends one message at a time (spec §3.5, §12)
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, conversations, messages, orderEvents } from "@/db/schema";
import { normalizePhone } from "@/lib/format";
import { messaging, type MessagingProvider } from "@/integrations/messaging";
import type { Actor } from "./orders";

export type SendInput = { phone: string; text: string; templateKey: string; orderId?: string | null };

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

  const event = (type: "message_sent" | "notification", payload: Record<string, unknown>) =>
    input.orderId
      ? db.insert(orderEvents).values({ orderId: input.orderId, type, payload, actorType: actor ? "user" : "system", actorId: actor?.id ?? null })
      : null;

  try {
    const { messageId } = await provider.send({ chatId, text, crmMessageId: msg.id });
    await db
      .update(messages)
      .set({ status: "sent", externalMessageId: messageId || null, sentAt: new Date() })
      .where(eq(messages.id, msg.id));
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    await event("message_sent", { template: input.templateKey, messageId, provider: provider.name });
    return { ok: true as const, provider: provider.name };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.update(messages).set({ status: "error", error }).where(eq(messages.id, msg.id));
    await event("notification", { template: input.templateKey, error });
    return { ok: false as const, error: `Не отправилось: ${error}. Скопируйте текст и отправьте вручную.` };
  }
}
